import fc from 'fast-check';
import { afterAll, describe, it } from 'vitest';
import { makeFakeHome } from '../test-support/mcp/fake-home';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { lineOf } from '../test-support/mcp/rpc';
import { numRuns } from '../test-support/runs';
import { timed } from '../test-support/timed';
import { ERROR_CODES, MESSAGES } from './errors';
import type { ErrorCode } from './errors';
import { MAX_ARG_CHARS } from './limits';
import { createWorkspaceServer } from './server';

const TIME_BUDGET_MS = 5000;
const WINDOW = 8;
const ABSENT = Symbol('absent');
type Hostile = unknown;

const fake = makeFakeHome();
afterAll(() => fake.cleanup());

const TOOLS = ['open_disk', 'read_grave', 'exhume'] as const;
const IMAGE = 'x.img';

/** Fixed text that may legitimately appear in any response line. */
const FIXED_TEXT = [
  ...Object.values(MESSAGES),
  ...ERROR_CODES,
  ...TOOLS,
  IMAGE,
  'jsonrpc',
  'content',
  'isError',
  // The fixed response envelope, as it appears on the wire (text is JSON inside JSON).
  ...ERROR_CODES.map((code) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: code, message: MESSAGES[code] }) }],
        isError: true,
      },
    }),
  ),
].join('\n');

const controlChars = fc.constantFrom('\u0000', '\u0001', '\u001b', '\u007f', '\u0085', '\u009f', '\n', '\r', '\t');

const stringArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
  // absolute-looking paths with control characters and traversal
  fc
    .tuple(fc.string({ maxLength: 20 }), controlChars, fc.string({ maxLength: 20 }))
    .map(([a, c, b]) => `/${a}${c}${b}`),
  fc.array(fc.constantFrom('..', '.', '', 'secret-name', 'ZZtopQQ'), { maxLength: 6 }).map((a) => `/${a.join('/')}`),
  // lengths around and above the limit
  fc
    .tuple(fc.integer({ min: -2, max: 40 }), fc.constantFrom('/', 'a', '\u0000', '\u00e9'))
    .map(([d, ch]) => `/${ch.repeat(Math.max(0, MAX_ARG_CHARS + d - 1))}`),
  fc.constantFrom('', '/', '//', '/.', '/..'),
);

const hostileArb: fc.Arbitrary<Hostile> = fc.oneof(
  { arbitrary: stringArb, weight: 5 },
  { arbitrary: fc.jsonValue({ maxDepth: 3 }), weight: 3 },
  { arbitrary: fc.oneof(fc.integer(), fc.double(), fc.boolean(), fc.constant(null)), weight: 2 },
  { arbitrary: fc.array(stringArb, { maxLength: 3 }), weight: 1 },
  { arbitrary: fc.dictionary(fc.string({ maxLength: 8 }), stringArb, { maxKeys: 3 }), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 },
);

/** Wrong type or length: the server must not touch the file system at all. */
function mustNotTouchFs(v: Hostile): boolean {
  if (v === ABSENT) return true;
  if (typeof v !== 'string') return true;
  return v.length < 1 || v.length > MAX_ARG_CHARS;
}

/** Substrings of the received value that must not occur in the response line. */
function probes(v: Hostile): string[] {
  if (v === ABSENT || v === undefined) return [];
  const texts: string[] = [];
  if (typeof v === 'string') texts.push(v);
  else texts.push(JSON.stringify(v));
  const out: string[] = [];
  for (const t of texts) {
    if (t.length < WINDOW) continue;
    const offsets = [0, Math.floor((t.length - WINDOW) / 2), t.length - WINDOW];
    for (const o of offsets) {
      const w = t.slice(o, o + WINDOW);
      out.push(w, JSON.stringify(w).slice(1, -1));
    }
  }
  return out;
}

function isCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);
}

function check(tool: string, v: Hostile): boolean {
  const { fs, calls } = recordingFs();
  const server = createWorkspaceServer({ fs, homedir: () => fake.home });
  const args: Record<string, unknown> = { image: IMAGE };
  if (v !== ABSENT) args.workspace = v;
  if (tool === 'read_grave') args.path = '/A.TXT';
  const request = lineOf({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });

  let lines: string[];
  try {
    lines = timed(() => server.handleLine(request), TIME_BUDGET_MS);
  } catch {
    return false;
  }
  if (lines.length !== 1) return false;
  const line = lines[0] as string;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const result = (parsed as { result?: { isError?: unknown; content?: { text?: unknown }[] } }).result;
  const text = result?.content?.[0]?.text;
  if (result?.isError !== true || typeof text !== 'string') return false;

  // Exactly { error, message } from the catalogue.
  let body: { error?: unknown; message?: unknown };
  try {
    body = JSON.parse(text) as { error?: unknown; message?: unknown };
  } catch {
    return false;
  }
  if (!isCode(body.error)) return false;
  if (text !== JSON.stringify({ error: body.error, message: MESSAGES[body.error] })) return false;

  // No echo of the received value.
  for (const p of probes(v)) {
    if (FIXED_TEXT.includes(p)) continue;
    if (line.includes(p)) return false;
  }

  if (mustNotTouchFs(v)) {
    if (body.error !== 'INVALID_ARGUMENTS') return false;
    if (calls.length !== 0) return false;
  }
  return true;
}

describe('workspace argument on hostile values', () => {
  // Feature: power-workspace, Property 4: A hostile workspace argument gets a fixed structured error and is never echoed
  it('answers with a fixed catalogue error and never echoes the value', () => {
    // **Validates: Requirements 4.5, 5.2, 5.3, 7.1, 7.2, 7.3, 7.5, 12.7**
    fc.assert(
      fc.property(fc.constantFrom(...TOOLS), hostileArb, (tool, v) => check(tool, v)),
      { numRuns: numRuns(300) },
    );
  });

  it('rejects an over-length string without any file system call', () => {
    // **Validates: Requirements 4.5, 7.1, 12.7**
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.constantFrom('/', 'a', '\u0000'), (extra, ch) => {
        return check('open_disk', `/${ch.repeat(MAX_ARG_CHARS + extra)}`);
      }),
      { numRuns: numRuns(20) },
    );
  });
});
