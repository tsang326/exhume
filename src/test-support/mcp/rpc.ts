// Test-only JSON-RPC helpers for driving the MCP server in-process.
//
// The server shape is the one in the design (createServer(root, { fs }) returns
// { handleLine }). It is declared structurally here so this file compiles
// before src/mcp/server.ts exists; a real Server is assignable to it.

export interface ServerLike {
  handleLine(line: Uint8Array | string): string[];
}

export interface ToolCallResult {
  /** The single response line (empty string if the server returned none). */
  line: string;
  /** The parsed response line (undefined if there was no line). */
  parsed: unknown;
  /** result.isError === true */
  isError: boolean;
  /** JSON.parse of result.content[0].text (undefined if absent or not JSON). */
  output: unknown;
}

/** Build one request line (no trailing newline). */
export function lineOf(value: unknown): string {
  return JSON.stringify(value);
}

/** Send one request and return the parsed response (undefined for no response). */
export function rpc(server: ServerLike, method: string, params: unknown, id: number | string): unknown {
  const lines = server.handleLine(lineOf({ jsonrpc: '2.0', id, method, params }));
  const first = lines[0];
  return first === undefined ? undefined : JSON.parse(first);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Call a tool and parse the result text. */
export function callTool(server: ServerLike, name: string, args: unknown): ToolCallResult {
  const lines = server.handleLine(
    lineOf({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  );
  const line = lines[0] ?? '';
  const parsed: unknown = line === '' ? undefined : JSON.parse(line);
  const result = asRecord(asRecord(parsed)?.result);
  const isError = result?.isError === true;
  let output: unknown;
  const content = result?.content;
  if (Array.isArray(content)) {
    const text = asRecord(content[0])?.text;
    if (typeof text === 'string') {
      try {
        output = JSON.parse(text);
      } catch {
        output = undefined;
      }
    }
  }
  return { line, parsed, isError, output };
}
