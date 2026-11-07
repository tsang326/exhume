import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { createServer } from './server';

const TOOL_NAMES = ['open_disk', 'read_grave', 'exhume', 'explain_state'];

const ws = makeWorkspace();
afterAll(() => ws.cleanup());

function listResult(root: string, params: unknown, id: number | string): unknown {
  const request: Record<string, unknown> = { jsonrpc: '2.0', id, method: 'tools/list' };
  if (params !== undefined) request.params = params;
  const lines = createServer(root).handleLine(JSON.stringify(request));
  if (lines.length !== 1) return undefined;
  const parsed: unknown = JSON.parse(lines[0] as string);
  return (parsed as { result?: unknown }).result;
}

const baseline = listResult(ws.root, undefined, 1);

// Params that are absent or an object, with hostile member names and arbitrary JSON values.
const paramsArb = fc.oneof(
  fc.constant(undefined),
  fc.constant({}),
  fc.dictionary(fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('cursor', '__proto__', 'constructor')), fc.jsonValue(), {
    maxKeys: 6,
  }),
);

// Roots need not exist: tools/list never touches the file layer.
const rootArb = fc.oneof(fc.constant(ws.root), fc.string({ maxLength: 40 }), fc.constantFrom('', '/', '/nonexistent/x'));

const idArb = fc.oneof(fc.integer(), fc.string({ maxLength: 12 }));

describe('tools/list properties', () => {
  it('has exactly the four tools in the fixed order and no nextCursor', () => {
    const result = baseline as { tools?: { name: string }[] } | undefined;
    expect(result?.tools?.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(Object.keys(result ?? {})).toEqual(['tools']);
  });

  // Feature: mcp-server, Property 6: tools/list is constant
  // **Validates: Requirements 4.1, 4.2, 4.8, 4.9**
  it('returns a result deeply equal to every other call, whatever the root and params', () => {
    fc.assert(
      fc.property(rootArb, paramsArb, idArb, (root, params, id) => {
        const result = listResult(root, params, id) as { tools?: { name: string }[] } | undefined;
        const sameAsBaseline = JSON.stringify(result) === JSON.stringify(baseline);
        const names = result?.tools?.map((t) => t.name) ?? [];
        const fixedOrder = names.length === TOOL_NAMES.length && names.every((n, i) => n === TOOL_NAMES[i]);
        const noCursor = result !== undefined && !('nextCursor' in result);
        return sameAsBaseline && fixedOrder && noCursor;
      }),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: mcp-server, Property 6: tools/list is constant
  // **Validates: Requirements 4.1, 4.2, 4.8, 4.9**
  it('is unchanged by earlier calls on the same server', () => {
    fc.assert(
      fc.property(fc.array(paramsArb, { minLength: 1, maxLength: 5 }), (all) => {
        const server = createServer(ws.root);
        return all.every((params, i) => {
          const request: Record<string, unknown> = { jsonrpc: '2.0', id: i, method: 'tools/list' };
          if (params !== undefined) request.params = params;
          const lines = server.handleLine(JSON.stringify(request));
          const parsed = JSON.parse(lines[0] ?? 'null') as { result?: unknown };
          return JSON.stringify(parsed.result) === JSON.stringify(baseline);
        });
      }),
      { numRuns: numRuns(100) },
    );
  });
});
