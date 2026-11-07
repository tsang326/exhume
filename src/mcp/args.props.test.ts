import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { callTool } from '../test-support/mcp/rpc';
import { ERROR_CODES, MESSAGES } from './errors';
import type { ErrorCode } from './errors';
import { MAX_ARG_CHARS } from './limits';
import { createServer } from './server';
import { STATE_TEXT } from './state-text';

const ws = makeWorkspace();
afterAll(() => ws.cleanup());

const MARKER = 'ZQXJ';
const TOOLS = ['open_disk', 'read_grave', 'exhume', 'explain_state'] as const;
type Tool = (typeof TOOLS)[number];
const STATES = ['alive', 'recovered', 'partial', 'lost'] as const;

type Args = Record<string, unknown>;

// A string that carries a marker, so a reflection in a response is detectable.
const markedArb = fc.string({ maxLength: 20 }).map((s) => `${MARKER}${s}`.replace(/\u0000/g, '_'));
const goodString = markedArb;

// Values of any JSON type; strings carry the marker.
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  markedArb,
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
  fc.array(markedArb, { maxLength: 3 }),
  fc.dictionary(fc.constantFrom('a', 'b', MARKER), markedArb, { maxKeys: 2 }),
);

// Strings a tool must refuse for a required string argument.
const badStringArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(''),
  markedArb.map((s) => `${s}\u0000${MARKER}`),
  fc.constant(MARKER.repeat(Math.ceil((MAX_ARG_CHARS + 1) / MARKER.length))),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(markedArb, { maxLength: 2 }),
  fc.dictionary(fc.constantFrom('a', MARKER), markedArb, { maxKeys: 2 }),
);

const extraKeyArb = fc.oneof(
  markedArb.map((s) => `${MARKER}k${s}`),
  fc.constantFrom('dest', 'name', 'folder', 'destination', '__proto__', 'constructor', 'ID', 'Image'),
);

function validFor(tool: Tool, state: string, image: string, path: string): Args {
  if (tool === 'open_disk') return { image };
  if (tool === 'explain_state') return { state };
  return { image, path };
}

const requiredKeys: Record<Tool, string[]> = {
  open_disk: ['image'],
  read_grave: ['image', 'path'],
  exhume: ['image', 'path'],
  explain_state: ['state'],
};

// An argument object that is invalid for the tool, built by one of four mutations.
const invalidCallArb: fc.Arbitrary<{ tool: Tool; args: Args }> = fc
  .record({
    tool: fc.constantFrom(...TOOLS),
    state: fc.constantFrom(...STATES),
    image: goodString,
    path: goodString,
    mutation: fc.constantFrom('missing', 'wrongValue', 'extraKey'),
    pick: fc.nat(),
    bad: badStringArb,
    badState: fc.oneof(
      anyValueArb,
      fc.constantFrom('ALIVE', 'alive ', ' alive', 'Lost', '__proto__', 'toString', ''),
    ),
    extraKey: extraKeyArb,
    extraValue: anyValueArb,
  })
  .map(({ tool, state, image, path, mutation, pick, bad, badState, extraKey, extraValue }) => {
    const args = validFor(tool, state, image, path);
    const keys = requiredKeys[tool];
    const key = keys[pick % keys.length] as string;
    if (mutation === 'missing') {
      delete args[key];
    } else if (mutation === 'wrongValue') {
      if (tool === 'explain_state') {
        if (STATES.includes(badState as (typeof STATES)[number])) args[key] = 'unknown';
        else args[key] = badState;
      } else {
        args[key] = bad;
      }
    } else {
      Object.defineProperty(args, extraKey, {
        value: extraValue,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { tool, args };
  });

function expectedText(code: ErrorCode): string {
  return JSON.stringify({ error: code, message: MESSAGES[code] });
}

function isCatalogueError(output: unknown, text: string): boolean {
  if (typeof output !== 'object' || output === null) return false;
  const o = output as { error?: unknown };
  if (typeof o.error !== 'string') return false;
  const code = ERROR_CODES.find((c) => c === o.error);
  return code !== undefined && JSON.stringify(output) === expectedText(code) && text === expectedText(code);
}

function contentText(parsed: unknown): string {
  const r = (parsed as { result?: { content?: { text?: unknown }[] } }).result;
  const t = r?.content?.[0]?.text;
  return typeof t === 'string' ? t : '';
}

describe('tool argument properties', () => {
  // Feature: mcp-server, Property 7: Tool arguments are validated, and errors are catalogue literals
  // **Validates: Requirements 5.3, 5.4, 5.6, 5.7, 5.9, 10.3**
  it('rejects invalid arguments with INVALID_ARGUMENTS, as a catalogue literal that reflects nothing', () => {
    fc.assert(
      fc.property(invalidCallArb, ({ tool, args }) => {
        const { fs } = recordingFs();
        const res = callTool(createServer(ws.root, { fs }), tool, args);
        const output = res.output as { error?: unknown } | undefined;
        return (
          res.isError &&
          output?.error === 'INVALID_ARGUMENTS' &&
          isCatalogueError(res.output, contentText(res.parsed)) &&
          !res.line.includes(MARKER)
        );
      }),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 7: Tool arguments are validated, and errors are catalogue literals
  // **Validates: Requirements 5.3, 5.4, 5.6, 5.7, 5.9, 10.3**
  it('turns every tool error into a catalogue literal for arbitrary argument objects', () => {
    const argsArb = fc.dictionary(
      fc.constantFrom('image', 'path', 'id', 'state', 'extra'),
      fc.oneof(anyValueArb, fc.constantFrom<unknown>(...STATES)),
      { maxKeys: 5 },
    );
    fc.assert(
      fc.property(fc.constantFrom(...TOOLS), argsArb, (tool, args) => {
        const { fs } = recordingFs();
        const res = callTool(createServer(ws.root, { fs }), tool, args);
        if (res.parsed === undefined) return false;
        if (!res.isError) return tool === 'explain_state' && !res.line.includes(MARKER);
        return isCatalogueError(res.output, contentText(res.parsed)) && !res.line.includes(MARKER);
      }),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 7: Tool arguments are validated, and errors are catalogue literals
  // **Validates: Requirements 5.3, 5.4, 5.6, 5.7, 5.9, 10.3**
  it('treats a missing arguments member for explain_state as INVALID_ARGUMENTS', () => {
    const res = callTool(createServer(ws.root), 'explain_state', undefined);
    expect((res.output as { error?: string }).error).toBe('INVALID_ARGUMENTS');
  });

  // Feature: mcp-server, Property 8: Invalid id values are rejected
  // **Validates: Requirements 5.6, 8.15**
  it('rejects every id that is not a safe integer >= 0 before any file access', () => {
    const badIdArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.integer({ max: -1 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
      fc.double({ min: 2 ** 53, max: 1e300, noNaN: true }),
      fc.double({ min: -1e300, max: -1, noNaN: true }),
      markedArb,
      fc.constantFrom('NaN', 'Infinity', '-1', '0', '1', '', '0x1'),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.nat({ max: 5 }), { maxLength: 2 }),
      fc.dictionary(fc.constantFrom('a', 'b'), fc.nat({ max: 5 }), { maxKeys: 2 }),
    );
    fc.assert(
      fc.property(fc.constantFrom('read_grave', 'exhume'), goodString, goodString, badIdArb, (tool, image, path, id) => {
        const { fs, calls } = recordingFs();
        const res = callTool(createServer(ws.root, { fs }), tool, { image, path, id });
        const output = res.output as { error?: unknown } | undefined;
        return res.isError && output?.error === 'INVALID_ARGUMENTS' && calls.length === 0 && !res.line.includes(MARKER);
      }),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 24: explain_state is deterministic
  // **Validates: Requirements 10.1, 10.4, 10.5**
  it('returns identical fixed texts for each state and touches no file', () => {
    const rootArb = fc.oneof(fc.constant(ws.root), fc.string({ maxLength: 30 }), fc.constantFrom('', '/', '/nonexistent/x'));
    fc.assert(
      fc.property(fc.constantFrom(...STATES), rootArb, fc.integer({ min: 2, max: 4 }), (state, root, repeats) => {
        const { fs, calls } = recordingFs();
        const server = createServer(root, { fs });
        const first = callTool(server, 'explain_state', { state });
        const expected = JSON.stringify({ state, explanation: STATE_TEXT[state] });
        let same = !first.isError && JSON.stringify(first.output) === expected;
        for (let i = 1; i < repeats; i += 1) {
          const again = callTool(server, 'explain_state', { state });
          same = same && again.line === first.line;
        }
        return same && calls.length === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('keeps all four explanations distinct and non-empty', () => {
    const texts = STATES.map((s) => STATE_TEXT[s]);
    expect(new Set(texts).size).toBe(STATES.length);
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });
});
