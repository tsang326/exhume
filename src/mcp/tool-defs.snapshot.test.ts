import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { createServer } from './server';
import { TOOL_DEFS } from './tool-defs';

// Read with readFileSync (not toMatchFileSnapshot) so `vitest -u` can never rewrite it.
const snapshot = readFileSync(
  fileURLToPath(new URL('../test-support/mcp/default-tools.snapshot.json', import.meta.url)),
  'utf8',
);

function listResultText(root: string, params: unknown, id: number | string): string {
  const request: Record<string, unknown> = { jsonrpc: '2.0', id, method: 'tools/list' };
  if (params !== undefined) request.params = params;
  const lines = createServer(root).handleLine(JSON.stringify(request));
  return JSON.stringify((JSON.parse(lines[0] ?? 'null') as { result?: unknown }).result);
}

const expectedResultText = JSON.stringify({ tools: JSON.parse(snapshot) as unknown });

const paramsArb = fc.oneof(
  fc.constant(undefined),
  fc.constant({}),
  fc.dictionary(fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('cursor', '__proto__', 'constructor')), fc.jsonValue(), {
    maxKeys: 6,
  }),
);
const rootArb = fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom('', '/', '/nonexistent/x'));
const idArb = fc.oneof(fc.integer(), fc.string({ maxLength: 12 }));
const callArb = fc.record({ name: fc.string({ maxLength: 12 }), args: fc.jsonValue() });

describe('Default_Mode tool definitions', () => {
  it('equal the committed snapshot byte for byte', () => {
    expect(JSON.stringify(TOOL_DEFS)).toBe(snapshot);
  });

  it('list the four tools in the fixed order', () => {
    expect(TOOL_DEFS.map((t) => t.name)).toEqual(['open_disk', 'read_grave', 'exhume', 'explain_state']);
  });

  // Feature: power-workspace, Property 9: Default_Mode tool definitions are byte-identical and constant
  // **Validates: Requirements 8.1, 9.3, 12.5**
  it('tools/list result text equals the snapshot for any root, params and earlier calls', () => {
    fc.assert(
      fc.property(rootArb, paramsArb, idArb, fc.array(callArb, { maxLength: 4 }), (root, params, id, calls) => {
        const server = createServer(root);
        calls.forEach((c, i) => {
          server.handleLine(
            JSON.stringify({
              jsonrpc: '2.0',
              id: i,
              method: 'tools/call',
              params: { name: c.name, arguments: c.args },
            }),
          );
        });
        const request: Record<string, unknown> = { jsonrpc: '2.0', id, method: 'tools/list' };
        if (params !== undefined) request.params = params;
        const lines = server.handleLine(JSON.stringify(request));
        const result = (JSON.parse(lines[0] ?? 'null') as { result?: unknown }).result;
        return JSON.stringify(result) === expectedResultText && listResultText(root, params, id) === expectedResultText;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
