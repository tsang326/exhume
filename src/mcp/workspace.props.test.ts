// Properties 1 to 3 of power-workspace: the Home_Ancestor relation, rejection of unsafe
// workspace values and acceptance of safe ones. Temporary trees only; never the real home.

import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { aliasFs } from '../test-support/mcp/alias-fs';
import { isCaseInsensitive, makeFakeHome } from '../test-support/mcp/fake-home';
import type { FakeHome } from '../test-support/mcp/fake-home';
import { recordingFs } from '../test-support/mcp/recording-fs';
import type { RecordedCall } from '../test-support/mcp/recording-fs';
import { numRuns } from '../test-support/runs';
import { nodeFs } from './fs-layer';
import type { FileLayer } from './fs-layer';
import { MAX_HOME_SEGMENTS } from './limits';
import { isAncestorOrSelf, segmentsOf, validateWorkspace } from './workspace';

// ---------------------------------------------------------------- Property 1

/** Independent, element-by-element model of "candidate is a prefix of of". */
function modelPrefix(c: readonly string[], o: readonly string[]): boolean {
  if (c.length === 0) return true;
  if (o.length === 0) return false;
  return c[0] === o[0] && modelPrefix(c.slice(1), o.slice(1));
}

// Near-equal names: shared string prefixes and case differences.
const segArb = fc.constantFrom('a', 'ab', 'a2', 'A', 'b', 'name', 'name2', 'nam');
const segsArb = fc.array(segArb, { maxLength: 5 });
const asPath = (s: readonly string[]): string => `/${s.join('/')}`;

describe('workspace Home_Ancestor relation', () => {
  // Feature: power-workspace, Property 1: The Home_Ancestor relation is segment-wise
  // **Validates: Requirements 5.6, 5.7, 5.8**
  it('matches an element-by-element model on random segment lists', () => {
    fc.assert(
      fc.property(segsArb, segsArb, (c, o) => {
        return isAncestorOrSelf(c, o) === modelPrefix(c, o);
      }),
      { numRuns: numRuns(500) },
    );
  });

  // Feature: power-workspace, Property 1: The Home_Ancestor relation is segment-wise
  // **Validates: Requirements 5.6, 5.7, 5.8**
  it('is not a string-prefix test: extensions and near-equal siblings follow the model', () => {
    fc.assert(
      fc.property(segsArb, segsArb, segArb, (c, extra, other) => {
        const home = [...c, ...extra];
        // A true prefix is always an ancestor or self.
        if (!isAncestorOrSelf(segmentsOf(asPath(c)), segmentsOf(asPath(home)))) return false;
        // A sibling that only shares a string prefix with the last segment is decided by segments.
        if (c.length === 0) return true;
        const sib = [...c.slice(0, -1), `${c[c.length - 1] as string}${other}`];
        const viaPaths = isAncestorOrSelf(segmentsOf(asPath(sib)), segmentsOf(asPath(c)));
        return viaPaths === modelPrefix(sib, c) && viaPaths === false;
      }),
      { numRuns: numRuns(300) },
    );
  });
});

// ------------------------------------------------------- Properties 2 and 3 setup

let fake: FakeHome;
let linksDir: string;
// Evaluated at collection time so `it.skipIf` sees it; probes the real temp directory.
const caseInsensitive = isCaseInsensitive(realpathSync(tmpdir()));
const links: Record<string, string> = {};

const homeOf = (h: string) => (): string => h;

function link(name: string, target: string): string {
  const p = join(linksDir, name);
  symlinkSync(target, p);
  links[name] = p;
  return p;
}

beforeAll(() => {
  fake = makeFakeHome();
  linksDir = join(fake.outside, 'links');
  mkdirSync(linksDir);

  // Links to unsafe targets, and chains of links.
  const toHome = link('toHome', fake.home);
  link('toRoot', '/');
  fake.ancestors.forEach((a, i) => link(`toAncestor${i}`, a));
  link('chainHome', toHome);
  link('chainChainHome', links['chainHome'] as string);
  link('chainRoot', links['toRoot'] as string);

  // Links to safe targets.
  const toChild = link('toChild', fake.child);
  link('toOutside', fake.outside);
  link('toSibling0', fake.siblings[0] as string);
  link('toSibling1', fake.siblings[1] as string);
  link('chainChild', toChild);
});

afterAll(() => {
  fake.cleanup();
});

const SAFE_OPS = new Set(['lstat', 'realpath']);

/** True when the recording layer saw only lstat/realpath: no image read, write, create or mkdir. */
function onlyProbes(calls: readonly RecordedCall[]): boolean {
  return calls.every((c) => SAFE_OPS.has(c.op));
}

function rejected(
  arg: string,
  home: () => string,
  base: FileLayer = nodeFs,
): boolean {
  const { fs, calls } = recordingFs(base);
  const out = validateWorkspace(arg, { fs, homedir: home });
  const codeOk = !out.ok && (out.code === 'PATH_REJECTED' || out.code === 'INVALID_ARGUMENTS');
  return codeOk && onlyProbes(calls);
}

/** Several spellings of an existing directory `p` (chain-below `below` is a child used for `..`). */
function spellings(p: string, below: string | undefined): string[] {
  const out = [p, `${p}/`, `${p}//`, `${p}/.`, `${p}/./`, `/.${p}`];
  if (below !== undefined) out.push(`${below}/..`, `${below}/../`);
  return out;
}

// ---------------------------------------------------------------- Property 2

describe('workspace rejection of unsafe values', () => {
  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 12.1, 12.2**
  it('rejects relative, empty, control-character, missing and non-directory values', () => {
    const ctrl = fc.constantFrom('\u0000', '\n', '\r', '\t', '\u001b', '\u007f', '\u0085', '\u009f');
    const missing = fc
      .stringMatching(/^[a-z0-9]{1,12}$/)
      .map((s) => join(fake.child, `missing-${s}`));
    const relative = fc
      .stringMatching(/^[A-Za-z0-9._-]{1,16}$/)
      .map((s) => `${s}/x`);
    const withCtrl = fc
      .tuple(ctrl, fc.constantFrom(fake.child, fake.outside))
      .chain(([c, p]) => fc.constantFrom(`${p}${c}`, `${c}${p}`, `${p}/${c}x`));
    const filePaths = fc.constantFrom(fake.file, `${fake.file}/`, `${fake.file}/.`);
    const arb = fc.oneof(
      relative,
      fc.constant(''),
      fc.constant('.'),
      fc.constant('~'),
      withCtrl,
      missing,
      filePaths,
    );
    fc.assert(
      fc.property(arb, (arg) => rejected(arg, homeOf(fake.home))),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 12.1**
  it('rejects `/`, the home and every ancestor in several spellings', () => {
    const chain = [fake.home, ...fake.ancestors]; // home, b, a, base
    const targets: string[] = [];
    chain.forEach((p, i) => {
      const below = i === 0 ? fake.child : chain[i - 1];
      targets.push(...spellings(p, below));
    });
    // Ancestors above the temp base, up to and including `/`.
    let up = dirname(fake.ancestors[fake.ancestors.length - 1] as string);
    for (let i = 0; i < MAX_HOME_SEGMENTS; i += 1) {
      targets.push(...spellings(up, undefined));
      if (up === '/') break;
      up = dirname(up);
    }
    targets.push('/', '//', '///', '/.', '/./', '/..', '/../');
    fc.assert(
      fc.property(fc.constantFrom(...targets), (arg) => rejected(arg, homeOf(fake.home))),
      { numRuns: numRuns(Math.max(200, targets.length * 2)) },
    );
  });

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 12.1**
  it('rejects symbolic links and chains of links to `/`, the home and its ancestors', () => {
    const unsafe = Object.keys(links).filter(
      (n) => n.startsWith('toHome') || n.startsWith('toAncestor') || n.endsWith('Home') || n.endsWith('Root') || n === 'toRoot',
    );
    fc.assert(
      fc.property(fc.constantFrom(...unsafe), fc.constantFrom('', '/', '/.'), (name, tail) =>
        rejected(`${links[name] as string}${tail}`, homeOf(fake.home)),
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.8, 5.9**
  it('rejects alias spellings whose dev and ino equal an ancestor or the home', () => {
    const real = [fake.home, ...fake.ancestors];
    fc.assert(
      fc.property(
        fc.constantFrom(...real),
        fc.constantFrom('-alias', '-ALIAS', '-x'),
        fc.constantFrom('', '/'),
        (realPrefix, suffix, tail) => {
          const aliasPrefix = `${fake.ancestors[fake.ancestors.length - 1] as string}${suffix}`;
          const alias = aliasFs(nodeFs, aliasPrefix, realPrefix);
          return rejected(`${aliasPrefix}${tail}`, homeOf(fake.home), alias);
        },
      ),
      { numRuns: numRuns(60) },
    );
  });

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.8, 5.9, 12.2**
  // Skipped on case-sensitive file systems: a case variant of an existing path does not exist
  // there, so there is no second spelling of the same directory to test.
  it.skipIf(!caseInsensitive)(
    'rejects case variants of the home path and its ancestors (case-insensitive file systems)',
    () => {
      const variants: string[] = [];
      for (const p of [fake.home, ...fake.ancestors]) {
        variants.push(p.toUpperCase(), p.toLowerCase());
      }
      fc.assert(
        fc.property(fc.constantFrom(...variants), (arg) => rejected(arg, homeOf(fake.home))),
        { numRuns: numRuns(60) },
      );
    },
  );

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.11, 12.2**
  it('rejects every value when the home provider throws or returns an unusable value', () => {
    const providers: Array<() => string> = [
      () => {
        throw new Error('no home');
      },
      () => '',
      () => 'relative/home',
      () => 'home',
      () => `${fake.home}\u0000`,
      () => join(fake.outside, 'does-not-exist'),
      () => '/'.repeat(1) + 'x'.repeat(5000),
      () => 42 as unknown as string,
      () => undefined as unknown as string,
    ];
    const safe = [fake.child, fake.outside, fake.siblings[0] as string, links['toChild'] as string];
    fc.assert(
      fc.property(fc.constantFrom(...providers), fc.constantFrom(...safe), (home, arg) =>
        rejected(arg, home),
      ),
      { numRuns: numRuns(100) },
    );
  });
});

// ---------------------------------------------------------------- Property 3

describe('workspace acceptance of safe values', () => {
  // Feature: power-workspace, Property 3: Safe workspace values are accepted and canonicalised
  // **Validates: Requirements 5.9, 5.10, 7.4, 12.1**
  it('accepts children, deeper descendants and tails, returning the realpath within the call bound', () => {
    const deepArb = fc.array(fc.constantFrom('a', 'ab', 'project', 'name2'), {
      minLength: 0,
      maxLength: 4,
    });
    fc.assert(
      fc.property(deepArb, fc.constantFrom('', '/', '/.'), (parts, tail) => {
        const dir = join(fake.child, ...parts);
        mkdirSync(dir, { recursive: true });
        const { fs, calls } = recordingFs();
        const out = validateWorkspace(`${dir}${tail}`, { fs, homedir: homeOf(fake.home) });
        return (
          out.ok && out.value === realpathSync(dir) && calls.length <= MAX_HOME_SEGMENTS + 4
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: power-workspace, Property 3: Safe workspace values are accepted and canonicalised
  // **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 5.10, 7.4**
  it('accepts siblings with a shared string prefix, outside directories and links to them', () => {
    const safe = [
      ...fake.siblings,
      fake.outside,
      links['toChild'] as string,
      links['toOutside'] as string,
      links['toSibling0'] as string,
      links['toSibling1'] as string,
      links['chainChild'] as string,
      fake.child,
    ];
    fc.assert(
      fc.property(fc.constantFrom(...safe), fc.constantFrom('', '/'), (p, tail) => {
        const { fs, calls } = recordingFs();
        const arg = `${p}${tail}`;
        const out = validateWorkspace(arg, { fs, homedir: homeOf(fake.home) });
        return out.ok && out.value === realpathSync(arg) && calls.length <= MAX_HOME_SEGMENTS + 4;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
