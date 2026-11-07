import { sep } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { hostileImageArb, oversizedImageArb } from '../test-support/hostile';
import type { HostileImage } from '../test-support/hostile';
import { callTool, lineOf } from '../test-support/mcp/rpc';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { numRuns } from '../test-support/runs';
import { timed } from '../test-support/timed';
import { JSONRPC_INVALID_REQUEST, JSONRPC_PARSE_ERROR, MAX_RESPONSE_BYTES } from './limits';
import { createServer } from './server';

const TIME_BUDGET_MS = 5000;
const JSON_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Zero or one line; the line is framed as the design requires. Returns the parsed response or null. */
function frame(lines: string[]): Record<string, unknown> | null | 'bad' {
  if (lines.length === 0) return null;
  if (lines.length !== 1) return 'bad';
  const line = lines[0] as string;
  if (line.includes('\r') || line.includes('\n')) return 'bad';
  if (Buffer.byteLength(line, 'utf8') > MAX_RESPONSE_BYTES) return 'bad';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return 'bad';
  }
  if (!isObject(parsed) || parsed.jsonrpc !== '2.0') return 'bad';
  const hasResult = Object.hasOwn(parsed, 'result');
  const hasError = Object.hasOwn(parsed, 'error');
  if (hasResult === hasError) return 'bad';
  return parsed;
}

function errorCode(parsed: Record<string, unknown>): unknown {
  return isObject(parsed.error) ? parsed.error.code : undefined;
}

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

const workspace = makeWorkspace();
afterAll(() => workspace.cleanup());
const server = createServer(workspace.root);

const KNOWN_METHODS = ['initialize', 'ping', 'tools/list', 'tools/call', 'notifications/initialized', 'nope'];
const encoder = new TextEncoder();
const json = fc.jsonValue({ maxDepth: 3 });

const envelopeArb = fc
  .record(
    {
      jsonrpc: fc.oneof(fc.constant('2.0'), json),
      id: json,
      method: fc.oneof(fc.constantFrom(...KNOWN_METHODS), json),
      params: json,
    },
    { requiredKeys: [] },
  )
  .map((o) => JSON.stringify(o));

const wellFormedArb = fc
  .record({
    id: fc.oneof(fc.string({ maxLength: 20 }), fc.integer()),
    method: fc.constantFrom(...KNOWN_METHODS),
    params: fc.oneof(json, fc.constant(undefined)),
  })
  .map((r) => JSON.stringify({ jsonrpc: '2.0', ...r }));

const textArb: fc.Arbitrary<string> = fc.oneof(
  envelopeArb,
  wellFormedArb,
  json.map((v) => JSON.stringify(v)),
  json.map((v) => JSON.stringify([v, v])),
  envelopeArb.chain((s) => fc.nat(s.length).map((n) => s.slice(0, n))),
  fc.string({ maxLength: 60 }),
  fc.string({ unit: 'binary', maxLength: 60 }),
  fc.array(fc.constantFrom(' ', '\t', '\r', '\n'), { maxLength: 8 }).map((a) => a.join('')),
  fc.constantFrom('null', 'true', '1', '"x"', '[]', '{}', '[[]]', '\uFEFF{}'),
);

const bytesArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  fc.uint8Array({ maxLength: 200 }),
  textArb.map((s) => encoder.encode(s)),
  // Plausible JSON with an invalid UTF-8 byte planted in it.
  fc.tuple(textArb, fc.constantFrom(0xff, 0xc0, 0x80, 0xed), fc.nat(40)).map(([s, bad, at]) => {
    const b = Array.from(encoder.encode(s));
    b.splice(Math.min(at, b.length), 0, bad);
    return Uint8Array.from(b);
  }),
);

const lineArb: fc.Arbitrary<Uint8Array | string> = fc.oneof(textArb, bytesArb);

/** What the design says, computed independently of the server. */
function expectedKind(line: Uint8Array | string): 'parse' | 'none' | 'invalid' | 'any' {
  let text: string;
  if (typeof line === 'string') {
    text = line;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line);
    } catch {
      return 'parse';
    }
  }
  if ([...text].every((ch) => JSON_WHITESPACE.has(ch))) return 'none';
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'parse';
  }
  return isObject(value) ? 'any' : 'invalid';
}

describe('server.handleLine on hostile lines', () => {
  // Feature: mcp-server, Property 1: handleLine is total and frames every response
  it('never throws and frames every response', () => {
    // **Validates: Requirements 3.7, 3.8, 3.13, 3.14, 16.9**
    fc.assert(
      fc.property(lineArb, (line) => {
        let lines: string[];
        try {
          lines = server.handleLine(line);
        } catch {
          return false;
        }
        const framed = frame(lines);
        if (framed === 'bad') return false;
        const kind = expectedKind(line);
        if (kind === 'none') return framed === null;
        if (kind === 'parse') {
          return framed !== null && errorCode(framed) === JSONRPC_PARSE_ERROR && framed.id === null;
        }
        if (kind === 'invalid') {
          return framed !== null && errorCode(framed) === JSONRPC_INVALID_REQUEST && framed.id === null;
        }
        return true;
      }),
      { numRuns: numRuns(400) },
    );
  });

  it('answers a ping after every hostile line', () => {
    // **Validates: Requirements 3.13, 3.14**
    fc.assert(
      fc.property(lineArb, (line) => {
        server.handleLine(line);
        const lines = server.handleLine(lineOf({ jsonrpc: '2.0', id: 7, method: 'ping' }));
        const framed = frame(lines);
        return framed !== null && framed !== 'bad' && framed.id === 7 && Object.hasOwn(framed, 'result');
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('answers examples: invalid UTF-8, truncated JSON, batch, scalar, blank', () => {
    const parse = (l: Uint8Array | string) => frame(server.handleLine(l));
    const bad = parse(Uint8Array.of(0x7b, 0xff, 0x7d));
    expect(bad).toMatchObject({ id: null, error: { code: JSONRPC_PARSE_ERROR } });
    expect(parse('{"jsonrpc":"2.0",')).toMatchObject({ id: null, error: { code: JSONRPC_PARSE_ERROR } });
    expect(parse('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).toMatchObject({
      id: null,
      error: { code: JSONRPC_INVALID_REQUEST },
    });
    expect(parse('42')).toMatchObject({ id: null, error: { code: JSONRPC_INVALID_REQUEST } });
    expect(parse('  \t ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property 23
// ---------------------------------------------------------------------------

function inside(root: string, p: string): boolean {
  return p === root || p.startsWith(root + sep);
}

interface Outcome23 {
  ok: boolean;
  why?: string;
}

function runImage(h: HostileImage): Outcome23 {
  const ws = makeWorkspace();
  try {
    ws.write('disk.img', h.image);
    const { fs, calls } = recordingFs();
    const srv = createServer(ws.root, { fs });
    const before = ws.tree();

    const checkResponse = (name: string, line: string): Outcome23 | null => {
      const framed = frame([line]);
      return framed === null || framed === 'bad' ? { ok: false, why: `${name}: malformed response` } : null;
    };

    // open_disk
    const open = timed(() => callTool(srv, 'open_disk', { image: 'disk.img' }), TIME_BUDGET_MS);
    const openBad = checkResponse('open_disk', open.line);
    if (openBad) return openBad;
    if (ws.tree().join('\n') !== before.join('\n')) return { ok: false, why: 'open_disk changed the tree' };

    // read_grave and exhume on up to two entries (or on an invented path if none)
    const entries: { path: string; id: number }[] = [];
    if (!open.isError && isObject(open.output) && Array.isArray(open.output.entries)) {
      for (const e of open.output.entries.slice(0, 2)) {
        if (isObject(e) && typeof e.path === 'string' && typeof e.id === 'number') {
          entries.push({ path: e.path, id: e.id });
        }
      }
    }
    if (entries.length === 0) entries.push({ path: '/MISSING.TXT', id: 0 });

    for (const e of entries) {
      const args = { image: 'disk.img', path: e.path, id: e.id };
      const read = timed(() => callTool(srv, 'read_grave', args), TIME_BUDGET_MS);
      const readBad = checkResponse('read_grave', read.line);
      if (readBad) return readBad;
    }
    if (ws.tree().join('\n') !== before.join('\n')) return { ok: false, why: 'read_grave changed the tree' };

    for (const e of entries) {
      const args = { image: 'disk.img', path: e.path, id: e.id };
      const ex = timed(() => callTool(srv, 'exhume', args), TIME_BUDGET_MS);
      const exBad = checkResponse('exhume', ex.line);
      if (exBad) return exBad;
    }
    const outside = (t: string[]) => t.filter((l) => !l.startsWith('exhumed/')).join('\n');
    if (outside(ws.tree()) !== outside(before)) return { ok: false, why: 'exhume changed files outside exhumed/' };

    // The server still answers
    const pong = frame(srv.handleLine(lineOf({ jsonrpc: '2.0', id: 3, method: 'ping' })));
    if (pong === null || pong === 'bad' || pong.id !== 3) return { ok: false, why: 'ping failed' };

    // No path outside the workspace was handed to the file layer
    for (const c of calls) {
      if (c.path !== undefined && !inside(ws.root, c.path)) return { ok: false, why: `path outside root: ${c.op}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : 'threw' };
  } finally {
    ws.cleanup();
  }
}

describe('server on hostile images', () => {
  // Feature: mcp-server, Property 23: Hostile images never break the server or the workspace
  it('keeps responses well formed and the workspace intact', () => {
    // **Validates: Requirements 2.3, 2.7, 7.8, 8.11, 12.2, 12.5, 12.6, 16.9, 16.12**
    fc.assert(
      fc.property(hostileImageArb, (h) => {
        const r = runImage(h);
        if (!r.ok) console.error(`Property 23 failure (${h.family}): ${r.why}`);
        return r.ok;
      }),
      { numRuns: numRuns(30) },
    );
  });

  it('keeps responses well formed on oversized images', () => {
    // **Validates: Requirements 2.3, 2.7, 12.5, 16.12**
    fc.assert(
      fc.property(oversizedImageArb, (h) => {
        const r = runImage(h);
        if (!r.ok) console.error(`Property 23 failure (${h.family}): ${r.why}`);
        return r.ok;
      }),
      { numRuns: numRuns(6) },
    );
  });
});
