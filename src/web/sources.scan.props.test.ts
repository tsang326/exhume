// Property tests for the source scanners (Properties 2 to 6 of the
// graveyard-ui design). Callbacks return booleans and never call expect().
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../test-support/runs';
import {
  ALLOWED_CORE_TARGETS,
  DEMOS_FILE,
  FORBIDDEN_PHRASES,
  HTML_SINK_NAMES,
  NETWORK_NAMES,
  scanCoreImports,
  scanNetwork,
  scanPhrasesInHtml,
  scanPhrasesInSource,
  scanSinks,
  scanStorage,
  type SourceFile,
} from '../test-support/web/scan';

// ------------------------------------------------------------- generators

/** Words that contain no sink name, no forbidden phrase and no network name. */
const CLEAN_WORDS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'stone',
  'moss',
  'crypt',
  'lantern',
  'evaluate',
  'retrieval',
  'reeval',
  'evalx',
  'innerHTMLs',
  'myDOMParser',
  'srcdocs',
  'newFunction',
  'setHTMLish',
  'document',
  'write',
  'cookie',
  'fetcher',
  'prefetch',
];

const fillerLineArb = fc
  .array(fc.constantFrom(...CLEAN_WORDS), { minLength: 0, maxLength: 8 })
  .map((words) => words.join(' '));

const fillerLinesArb = fc.array(fillerLineArb, { minLength: 0, maxLength: 12 });

/** One concrete line of code per sink name. */
const SINK_TEXT: Record<string, string> = {
  innerHTML: 'el.innerHTML = x;',
  outerHTML: 'el.outerHTML = x;',
  insertAdjacentHTML: 'el.insertAdjacentHTML(a, b);',
  'document.write': 'document.write(x);',
  'document.writeln': 'document.writeln(x);',
  DOMParser: 'const p = new DOMParser();',
  createContextualFragment: 'range.createContextualFragment(x);',
  srcdoc: 'frame.srcdoc = x;',
  setHTML: 'el.setHTML(x);',
  eval: 'eval(x);',
  'new Function': 'const f = new Function(x);',
  "setAttribute('on*')": "el.setAttribute('onclick', x);",
  "setAttribute('style')": "el.setAttribute('style', x);",
};

const sinkArb = fc.constantFrom(...HTML_SINK_NAMES);

/** Per-character upper/lower-case variation of `phrase`. */
function applyCase(phrase: string, upper: readonly boolean[]): string {
  let out = '';
  for (let i = 0; i < phrase.length; i++) {
    const ch = phrase.charAt(i);
    out += upper[i % upper.length] === true ? ch.toUpperCase() : ch.toLowerCase();
  }
  return out;
}

const caseVariantArb = fc
  .tuple(
    fc.constantFrom(...FORBIDDEN_PHRASES),
    fc.array(fc.boolean(), { minLength: 1, maxLength: 24 }),
  )
  .map(([phrase, upper]) => ({ phrase, variant: applyCase(phrase, upper) }));

/** Filler words that cannot form or join into a forbidden phrase. */
const phraseFillerArb = fc
  .array(fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'stone', 'moss', 'crypt'), {
    minLength: 0,
    maxLength: 6,
  })
  .map((w) => w.join(' '));

// ------------------------------------------------------------- Property 2

describe('sink scan properties', () => {
  // Feature: graveyard-ui, Property 2: The sink scan finds every sink and reports where
  // **Validates: Requirements 1.1, 1.5, 1.6, 1.7**
  it('Property 2: a sink inserted at any line is reported with file, line and name', () => {
    fc.assert(
      fc.property(
        fillerLinesArb,
        sinkArb,
        fc.nat(),
        fc.constantFrom('src/web/a.ts', 'src/web/dom/h.ts', 'src/web/logic/x.ts'),
        (filler, sink, rawAt, file) => {
          const at = rawAt % (filler.length + 1);
          const lines = filler.slice();
          lines.splice(at, 0, SINK_TEXT[sink] as string);
          const found = scanSinks(file, lines.join('\n'));
          return found.some((v) => v.file === file && v.line === at + 1 && v.name === sink);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 2: The sink scan finds every sink and reports where
  // **Validates: Requirements 1.1, 1.5, 1.6, 1.7**
  it('Property 2: a fixture with every sink reports exactly one violation per name', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...HTML_SINK_NAMES], { minLength: HTML_SINK_NAMES.length }), (order) => {
        const text = order.map((n) => SINK_TEXT[n] as string).join('\n');
        const found = scanSinks('src/web/fixture.ts', text);
        if (found.length !== HTML_SINK_NAMES.length) return false;
        return order.every((name, i) => {
          const hits = found.filter((v) => v.name === name);
          return hits.length === 1 && hits[0]?.line === i + 1;
        });
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 3: The sink scan accepts clean text
  // **Validates: Requirements 1.5, 1.6**
  it('Property 3: text without sink names, including look-alike words, has no violations', () => {
    fc.assert(
      fc.property(fillerLinesArb, (filler) => scanSinks('src/web/clean.ts', filler.join('\n')).length === 0),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 3 examples: look-alike words are accepted', () => {
    expect(scanSinks('src/web/x.ts', 'evaluate(retrieval); reeval; evalx;')).toEqual([]);
  });
});

// ------------------------------------------------------------- Property 4

describe('network scan properties', () => {
  const pathArb = fc.constantFrom(DEMOS_FILE, 'src/web/main.ts', 'src/web/dom/h.ts', 'src/web/logic/x.ts');
  const filesArb = fc
    .uniqueArray(pathArb, { minLength: 1, maxLength: 4 })
    .chain((paths) =>
      fc.tuple(...paths.map((p) => fc.constantFrom(...NETWORK_NAMES).map((n) => ({ file: p, name: n })))),
    );
  const allowListArb = fc.constantFrom<string[]>(
    [DEMOS_FILE],
    [DEMOS_FILE, 'src/web/main.ts'],
    ['src/web/main.ts'],
    ['src/web/main.ts', DEMOS_FILE],
    [],
  );

  // Feature: graveyard-ui, Property 4: Network API names are confined to one allow-listed file
  // **Validates: Requirements 1.6, 13.2, 13.5, 13.7**
  it('Property 4: only fetch in demos.ts with an exact one-file allow-list is accepted', () => {
    fc.assert(
      fc.property(filesArb, allowListArb, (entries, allowList) => {
        const files: SourceFile[] = entries.map((e) => ({ file: e.file, source: `const r = ${e.name}(1);\n` }));
        const found = scanNetwork(files, allowList);
        const exact = allowList.length === 1 && allowList[0] === DEMOS_FILE;
        const expected = entries
          .filter((e) => !(exact && e.file === DEMOS_FILE && e.name === 'fetch'))
          .map((e) => `${e.file}|${e.name}`)
          .sort();
        const actual = found
          .filter((v) => v.name !== 'allow-list')
          .map((v) => `${v.file}|${v.name}`)
          .sort();
        const allowFlagged = found.some((v) => v.name === 'allow-list');
        return allowFlagged === !exact && JSON.stringify(actual) === JSON.stringify(expected);
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 4: Network API names are confined to one allow-listed file
  // **Validates: Requirements 1.6, 13.2, 13.5, 13.7**
  it('Property 4: storage and cookie names are reported in every file', () => {
    fc.assert(
      fc.property(
        pathArb,
        fc.constantFrom('localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'),
        fillerLineArb,
        (file, name, filler) => {
          const found = scanStorage(file, `${filler}\nconst v = ${name};\n`);
          return found.some((v) => v.file === file && v.name === name && v.line === 2);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 4 examples: fetch in demos.ts alone is accepted', () => {
    const files = [{ file: DEMOS_FILE, source: 'await fetch(u);' }];
    expect(scanNetwork(files, [DEMOS_FILE])).toEqual([]);
  });
});

// ------------------------------------------------------------- Property 5

describe('phrase scan properties', () => {
  const quoteArb = fc.constantFrom('double', 'single', 'template');

  function literal(kind: string, text: string): string {
    if (kind === 'double') return `"${text}"`;
    if (kind === 'single') return `'${text.replace(/'/g, "\\'")}'`;
    return `\`${text}\``;
  }

  // Feature: graveyard-ui, Property 5: Forbidden phrases are found in literals in any letter case, and ignored in comments
  // **Validates: Requirements 13.4, 13.6**
  it('Property 5: a phrase in any letter case inside a literal is reported', () => {
    fc.assert(
      fc.property(
        caseVariantArb,
        phraseFillerArb,
        phraseFillerArb,
        quoteArb,
        fc.nat({ max: 5 }),
        (cv, before, after, kind, blank) => {
          const file = 'src/web/ui.ts';
          const source = `${'\n'.repeat(blank)}const s = ${literal(kind, `${before} ${cv.variant} ${after}`)};\n`;
          const found = scanPhrasesInSource(file, source);
          return found.some((v) => v.file === file && v.name === cv.phrase && v.line === blank + 1);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 5: Forbidden phrases are found in literals in any letter case, and ignored in comments
  // **Validates: Requirements 13.4, 13.6**
  it('Property 5: a phrase only inside a // or /* */ comment is ignored', () => {
    fc.assert(
      fc.property(
        caseVariantArb,
        phraseFillerArb,
        phraseFillerArb,
        fc.constantFrom('line', 'block', 'multiline'),
        (cv, before, after, kind) => {
          const body = `${before} ${cv.variant} ${after}`;
          const comment =
            kind === 'line'
              ? `// ${body}`
              : kind === 'block'
                ? `/* ${body} */`
                : `/*\n * ${before}\n * ${cv.variant}\n */`;
          const source = `const a = 1; ${comment}\nconst b = "ok";\n`;
          return scanPhrasesInSource('src/web/ui.ts', source).length === 0;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 5: Forbidden phrases are found in literals in any letter case, and ignored in comments
  // **Validates: Requirements 13.4, 13.6**
  it('Property 5: filler without a forbidden phrase reports nothing', () => {
    fc.assert(
      fc.property(phraseFillerArb, quoteArb, (filler, kind) => {
        const source = `const s = ${literal(kind, filler)}; // ${filler}\n`;
        return scanPhrasesInSource('src/web/ui.ts', source).length === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 5: Forbidden phrases are found in literals in any letter case, and ignored in comments
  // **Validates: Requirements 13.4, 13.6**
  it('Property 5: in index.html the phrase is found in visible text and ignored in comments and scripts', () => {
    fc.assert(
      fc.property(caseVariantArb, phraseFillerArb, phraseFillerArb, (cv, before, after) => {
        const file = 'index.html';
        const visible = scanPhrasesInHtml(file, `<h1>x</h1>\n<p>${before} ${cv.variant} ${after}</p>\n`);
        const hit = visible.some((v) => v.file === file && v.name === cv.phrase && v.line === 2);
        const hiddenComment = scanPhrasesInHtml(file, `<p>${before}</p><!-- ${cv.variant} -->`);
        const hiddenScript = scanPhrasesInHtml(file, `<script>// ${cv.variant}</script><p>${after}</p>`);
        const clean = scanPhrasesInHtml(file, `<p>${before} ${after}</p>`);
        return hit && hiddenComment.length === 0 && hiddenScript.length === 0 && clean.length === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it("Property 5 examples: upper case and the apostrophe phrase", () => {
    const found = scanPhrasesInSource('src/web/ui.ts', 'const s = "WORLD\'S FIRST";');
    expect(found.map((v) => v.name)).toContain("world's first");
  });
});

// ------------------------------------------------------------- Property 6

describe('core import properties', () => {
  interface Target {
    path: string;
    isDir: boolean;
    allowed: boolean;
  }

  const TARGETS: Target[] = [
    { path: 'src/core/fat12/index', isDir: false, allowed: true },
    { path: 'src/core/formats/index', isDir: false, allowed: true },
    { path: 'src/core/fat12', isDir: true, allowed: true },
    { path: 'src/core/formats', isDir: true, allowed: true },
    { path: 'src/core/fat12/disk', isDir: false, allowed: false },
    { path: 'src/core/fat12/types', isDir: false, allowed: false },
    { path: 'src/core/formats/csv', isDir: false, allowed: false },
    { path: 'src/core/formats/dbase', isDir: false, allowed: false },
    { path: 'src/core/other', isDir: false, allowed: false },
    { path: 'src/web/logic/size', isDir: false, allowed: true },
    { path: 'src/web/demos', isDir: false, allowed: true },
    { path: 'src/test-support/runs', isDir: false, allowed: true },
  ];

  const importerArb = fc
    .tuple(
      fc.constantFrom('src/web', 'src/web/logic', 'src/web/dom', 'src/web/worker', 'src/web/a/b'),
      fc.constantFrom('main', 'x', 'thing.test', 'disk-handler'),
    )
    .map(([dir, base]) => `${dir}/${base}.ts`);

  const formArb = fc.constantFrom('import', 'import-type', 'dynamic', 'url', 'export-from', 'side-effect');

  function statement(form: string, spec: string): string {
    switch (form) {
      case 'import':
        return `import { a } from '${spec}';`;
      case 'import-type':
        return `import type { A } from '${spec}';`;
      case 'dynamic':
        return `const m = await import('${spec}');`;
      case 'url':
        return `const u = new URL('${spec}', import.meta.url);`;
      case 'export-from':
        return `export { a } from '${spec}';`;
      default:
        return `import '${spec}';`;
    }
  }

  // Feature: graveyard-ui, Property 6: Core imports are limited to the two index files
  // **Validates: Requirements 3.2, 15.3, 15.4**
  it('Property 6: an import is allowed exactly when it resolves to a permitted index or leaves src/core', () => {
    fc.assert(
      fc.property(
        importerArb,
        fc.constantFrom(...TARGETS),
        fc.constantFrom('', '.ts', '.js'),
        formArb,
        fc.boolean(),
        (importer, target, ext, form, repoRelative) => {
          let spec: string;
          if (repoRelative) {
            spec = target.path + (target.isDir ? '' : ext);
          } else {
            const rel = posix.relative(posix.dirname(importer), target.path + (target.isDir ? '' : ext));
            spec = rel.startsWith('.') ? rel : `./${rel}`;
          }
          const found = scanCoreImports(importer, `${statement(form, spec)}\n`);
          const expectedAllowed = target.allowed;
          return expectedAllowed ? found.length === 0 : found.length === 1 && found[0]?.name === spec;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 6 examples: the allow-list is exactly the two index files', () => {
    expect([...ALLOWED_CORE_TARGETS]).toEqual(['src/core/fat12/index', 'src/core/formats/index']);
    expect(scanCoreImports('src/web/x.ts', "import { a } from '../core/fat12/disk';")).toHaveLength(1);
    expect(scanCoreImports('src/web/x.ts', "import { a } from '../core/fat12';")).toHaveLength(0);
  });
});
