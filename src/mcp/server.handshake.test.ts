import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesOf, dbfFile, diskWith, hostileNameDisk, pcxFile } from '../test-support/mcp/images';
import { faultyFs } from '../test-support/mcp/recording-fs';
import { callTool, lineOf, rpc } from '../test-support/mcp/rpc';
import { makeWorkspace, type Workspace } from '../test-support/mcp/workspace';
import { ERROR_CODES, MESSAGES, type ErrorCode } from './errors';
import { nodeFs, type FileLayer } from './fs-layer';
import { createServer } from './server';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT = '2025-06-18';
const TOO_BIG = 2_949_121;

let ws: Workspace;

beforeEach(() => {
  ws = makeWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

function asRecord(v: unknown): Record<string, unknown> {
  expect(typeof v).toBe('object');
  expect(v).not.toBeNull();
  return v as Record<string, unknown>;
}

function resultOf(response: unknown): Record<string, unknown> {
  return asRecord(asRecord(response).result);
}

function errorOf(response: unknown): Record<string, unknown> {
  return asRecord(asRecord(response).error);
}

describe('handshake', () => {
  it('answers initialize, ignores the initialized notification, lists tools and pings', () => {
    const server = createServer(ws.root);
    const init = rpc(server, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }, 1);
    const result = resultOf(init);
    expect(asRecord(init).jsonrpc).toBe('2.0');
    expect(asRecord(init).id).toBe(1);
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo).toEqual({ name: 'exhume', version: '0.1.0' });

    expect(server.handleLine(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toEqual([]);

    const list = resultOf(rpc(server, 'tools/list', undefined, 2));
    expect(Array.isArray(list.tools)).toBe(true);
    expect(resultOf(rpc(server, 'ping', undefined, 3))).toEqual({});
  });

  it('serves ping and tools/list before initialize', () => {
    const server = createServer(ws.root);
    expect(resultOf(rpc(server, 'ping', undefined, 'p'))).toEqual({});
    expect(resultOf(rpc(server, 'tools/list', {}, 'l')).tools).toHaveLength(4);
  });

  it('gives no line for notifications, known or unknown', () => {
    const server = createServer(ws.root);
    for (const method of ['notifications/initialized', 'notifications/cancelled', 'no/such/method', 'ping', 'tools/call']) {
      expect(server.handleLine(lineOf({ jsonrpc: '2.0', method }))).toEqual([]);
      expect(server.handleLine(lineOf({ jsonrpc: '2.0', method, params: { x: 1 } }))).toEqual([]);
    }
  });

  it('gives no line for blank and whitespace-only lines', () => {
    const server = createServer(ws.root);
    for (const line of ['', ' ', '\t', '\r', ' \t \r\n ']) {
      expect(server.handleLine(line)).toEqual([]);
      expect(server.handleLine(Buffer.from(line, 'utf8'))).toEqual([]);
    }
  });

  it('answers an unknown method request with -32601', () => {
    const server = createServer(ws.root);
    const err = errorOf(rpc(server, 'no/such/method', undefined, 7));
    expect(err.code).toBe(-32601);
    expect(err.message).toBe('Method not found');
  });
});

describe('version negotiation', () => {
  for (const version of VERSIONS) {
    it(`answers ${version} with the same version`, () => {
      const server = createServer(ws.root);
      const result = resultOf(rpc(server, 'initialize', { protocolVersion: version }, 1));
      expect(result.protocolVersion).toBe(version);
    });
  }

  it('answers other values with the default version and never echoes the request', () => {
    const server = createServer(ws.root);
    const hostile = 'HOSTILE-VERSION-' + 'x'.repeat(5000);
    const cases: unknown[] = ['1999-01-01', hostile, undefined, 20250618, null, { v: 1 }, ['2025-06-18']];
    for (const protocolVersion of cases) {
      const params = protocolVersion === undefined ? {} : { protocolVersion };
      const line = server.handleLine(lineOf({ jsonrpc: '2.0', id: 1, method: 'initialize', params }))[0] ?? '';
      const result = resultOf(JSON.parse(line));
      expect(result.protocolVersion).toBe(DEFAULT);
      expect(line).not.toContain('1999-01-01');
      expect(line).not.toContain('HOSTILE-VERSION');
    }
  });
});

describe('tools/call envelope errors', () => {
  it('gives -32602 for an unknown tool name without the name', () => {
    const server = createServer(ws.root);
    const line = server.handleLine(
      lineOf({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'secret_tool_xyz', arguments: {} } }),
    )[0] ?? '';
    const err = errorOf(JSON.parse(line));
    expect(err.code).toBe(-32602);
    expect(err.message).toBe('Invalid params');
    expect(line).not.toContain('secret_tool_xyz');
  });

  it('gives -32603 when the file layer throws, and keeps serving', () => {
    ws.write('disk.img', diskWith([{ name: 'A.TXT', content: bytesOf('a') }]));
    // lstat returns an object whose property read throws outside any errno handling.
    const broken: FileLayer = {
      ...nodeFs,
      lstat: () => {
        const bad = {};
        Object.defineProperty(bad, 'isSymlink', {
          get() {
            throw new Error('boom: /secret/path');
          },
        });
        return bad as ReturnType<FileLayer['lstat']>;
      },
    };
    const server = createServer(ws.root, { fs: broken });
    const line = server.handleLine(
      lineOf({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'open_disk', arguments: { image: 'disk.img' } } }),
    )[0] ?? '';
    const response = JSON.parse(line) as Record<string, unknown>;
    expect(response.id).toBe(5);
    const err = errorOf(response);
    expect(err.code).toBe(-32603);
    expect(err.message).toBe('Internal error');
    expect(line).not.toContain('boom');
    expect(line).not.toContain('secret');

    expect(resultOf(rpc(server, 'ping', undefined, 6))).toEqual({});
    const ok = callTool(server, 'explain_state', { state: 'lost' });
    expect(ok.isError).toBe(false);
  });
});

const IMAGE_PROP = { type: 'string', minLength: 1, maxLength: 4096 };
const PATH_PROP = { type: 'string', minLength: 1, maxLength: 4096 };
const ID_PROP = { type: 'integer', minimum: 0 };

describe('tools/list', () => {
  it('lists the four tools with the designed schemas and annotations', () => {
    const server = createServer(ws.root);
    const tools = resultOf(rpc(server, 'tools/list', undefined, 1)).tools as Record<string, unknown>[];
    expect(tools.map((t) => t.name)).toEqual(['open_disk', 'read_grave', 'exhume', 'explain_state']);

    const stripped = tools.map((t) => {
      const { description: _d, inputSchema, ...rest } = t;
      const schema = asRecord(inputSchema);
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(asRecord(schema.properties))) {
        const { description: _pd, ...pRest } = asRecord(v);
        props[k] = pRest;
      }
      return { ...rest, inputSchema: { ...schema, properties: props } };
    });

    expect(stripped).toEqual([
      {
        name: 'open_disk',
        inputSchema: {
          type: 'object',
          properties: { image: IMAGE_PROP },
          required: ['image'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'read_grave',
        inputSchema: {
          type: 'object',
          properties: { image: IMAGE_PROP, path: PATH_PROP, id: ID_PROP },
          required: ['image', 'path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'exhume',
        inputSchema: {
          type: 'object',
          properties: { image: IMAGE_PROP, path: PATH_PROP, id: ID_PROP },
          required: ['image', 'path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'explain_state',
        inputSchema: {
          type: 'object',
          properties: { state: { type: 'string', enum: ['alive', 'recovered', 'partial', 'lost'] } },
          required: ['state'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    ]);
  });

  it('says disk data is untrusted in the three disk-facing tools', () => {
    const server = createServer(ws.root);
    const tools = resultOf(rpc(server, 'tools/list', undefined, 1)).tools as Record<string, unknown>[];
    for (const t of tools.slice(0, 3)) expect(String(t.description)).toContain('untrusted');
    expect(String(tools[3]?.description)).toContain('fixed text');
  });
});

describe('Error_Catalogue', () => {
  function expectCode(result: ReturnType<typeof callTool>, code: ErrorCode): void {
    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: code, message: MESSAGES[code] });
  }

  function graveByKind(server: ReturnType<typeof createServer>, image: string, kind: string): string {
    const out = asRecord(callTool(server, 'open_disk', { image }).output);
    const entries = out.entries as Record<string, unknown>[];
    const hit = entries.find((e) => e.kind === kind);
    expect(hit).toBeDefined();
    return String(hit?.path);
  }

  it('reaches every code with its fixed message', () => {
    const server = createServer(ws.root);
    const reached = new Set<ErrorCode>();
    const check = (r: ReturnType<typeof callTool>, code: ErrorCode): void => {
      expectCode(r, code);
      reached.add(code);
    };

    ws.write('notes.img', diskWith([
      { name: 'PLAIN.BIN', content: Uint8Array.of(0x01, 0x02, 0xfe, 0x00) },
      { name: 'BAD.DBF', content: dbfFile().subarray(0, 40) },
      { name: 'PIC.PCX', content: pcxFile() },
    ]));
    ws.write('dirs.img', hostileNameDisk());
    ws.write('big.img', new Uint8Array(TOO_BIG));
    ws.write('exhumed', 'a file where the folder should be');

    check(callTool(server, 'open_disk', {}), 'INVALID_ARGUMENTS');
    check(callTool(server, 'open_disk', { image: '../outside.img' }), 'PATH_REJECTED');
    check(callTool(server, 'open_disk', { image: 'missing.img' }), 'IMAGE_NOT_FOUND');
    check(callTool(server, 'open_disk', { image: 'big.img' }), 'IMAGE_TOO_LARGE');
    check(callTool(server, 'read_grave', { image: 'notes.img', path: '/NOPE.TXT' }), 'GRAVE_NOT_FOUND');
    check(
      callTool(server, 'read_grave', { image: 'dirs.img', path: graveByKind(server, 'dirs.img', 'directory') }),
      'GRAVE_NOT_READABLE',
    );
    check(callTool(server, 'read_grave', { image: 'notes.img', path: '/PLAIN.BIN' }), 'NO_CONVERTER');
    check(callTool(server, 'read_grave', { image: 'notes.img', path: '/BAD.DBF' }), 'CONVERSION_FAILED');
    check(callTool(server, 'exhume', { image: 'notes.img', path: '/PIC.PCX' }), 'EXHUME_FAILED');

    const short = createServer(ws.root, { fs: faultyFs(nodeFs, [{ kind: 'shortRead', bytes: 10 }]) });
    check(callTool(short, 'open_disk', { image: 'notes.img' }), 'IMAGE_UNREADABLE');

    expect([...reached].sort()).toEqual([...ERROR_CODES].sort());
  });
});
