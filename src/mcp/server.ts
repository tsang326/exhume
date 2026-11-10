// Request dispatch: one input line in, zero or one response line out.
// No per-connection state; no process I/O. The file layer is a test seam.

import { MESSAGES } from './errors';
import type { ErrorCode, Outcome } from './errors';
import { nodeFs } from './fs-layer';
import type { FileLayer } from './fs-layer';
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  classify,
  errorLine,
  getOwn,
  isPlainObject,
  negotiateVersion,
  resultLine,
} from './jsonrpc';
import type { RpcId } from './jsonrpc';
import { MAX_RESPONSE_BYTES } from './limits';
import type { ToolContext } from './grave-source';
import { TOOL_DEFS } from './tool-defs';
import type { ToolDef } from './tool-defs';
import { runExhume } from './tools/exhume';
import { runExplainState } from './tools/explain-state';
import { runOpenDisk } from './tools/open-disk';
import { runReadGrave } from './tools/read-grave';
import { createWorkspaceStrategy } from './workspace';

export const SERVER_NAME = 'exhume';
export const SERVER_VERSION = '0.1.0';

export interface ServerOptions {
  fs?: FileLayer;
}

export interface Server {
  handleLine(line: Uint8Array | string): string[];
}

interface TextContent {
  type: 'text';
  text: string;
}

function toolResult(output: unknown): { content: TextContent[]; isError: false } {
  return { content: [{ type: 'text', text: JSON.stringify(output) }], isError: false };
}

function toolFailure(code: ErrorCode): { content: TextContent[]; isError: true } {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: code, message: MESSAGES[code] }) }],
    isError: true,
  };
}

const JSON_WHITESPACE = [' ', '\t', '\r', '\n'];

function isBlank(text: string): boolean {
  for (const ch of text) {
    if (!JSON_WHITESPACE.includes(ch)) return false;
  }
  return true;
}

/** params must be absent or an object. */
function paramsOk(params: unknown): boolean {
  return params === undefined || isPlainObject(params);
}

function runTool(ctx: ToolContext, name: string, args: unknown): Outcome<unknown> | null {
  switch (name) {
    case 'open_disk':
      return runOpenDisk(ctx, args);
    case 'read_grave':
      return runReadGrave(ctx, args);
    case 'exhume':
      return runExhume(ctx, args);
    case 'explain_state':
      return runExplainState(args);
    default:
      return null;
  }
}

/** A tool call bound to the context and arguments its runner receives. */
export interface BoundCall {
  ctx: ToolContext;
  args: Record<string, unknown>;
}

/** Decides the advertised tools and how a call is bound to a context. */
export interface ModeStrategy {
  readonly tools: readonly ToolDef[];
  bind(name: string, args: Record<string, unknown>): Outcome<BoundCall>;
}

function handleCall(strategy: ModeStrategy, id: RpcId, params: unknown): string {
  if (!isPlainObject(params)) return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
  const name = getOwn(params, 'name');
  if (typeof name !== 'string') return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
  const rawArgs = getOwn(params, 'arguments');
  if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
    return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
  }
  if (!strategy.tools.some((t) => t.name === name)) {
    return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
  }
  const bound = strategy.bind(name, rawArgs === undefined ? {} : rawArgs);
  if (!bound.ok) return resultLine(id, toolFailure(bound.code));
  const outcome = runTool(bound.value.ctx, name, bound.value.args);
  if (outcome === null) return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
  return resultLine(id, outcome.ok ? toolResult(outcome.value) : toolFailure(outcome.code));
}

function dispatch(strategy: ModeStrategy, id: RpcId, method: string, params: unknown): string {
  switch (method) {
    case 'initialize':
      if (!isPlainObject(params)) return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
      return resultLine(id, {
        protocolVersion: negotiateVersion(params),
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case 'ping':
      if (!paramsOk(params)) return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
      return resultLine(id, {});
    case 'tools/list':
      if (!paramsOk(params)) return errorLine(id, JSONRPC_INVALID_PARAMS, INVALID_PARAMS);
      return resultLine(id, { tools: strategy.tools });
    case 'tools/call':
      return handleCall(strategy, id, params);
    default:
      return errorLine(id, JSONRPC_METHOD_NOT_FOUND, METHOD_NOT_FOUND);
  }
}

function buildServer(strategy: ModeStrategy): Server {
  function handleLine(line: Uint8Array | string): string[] {
    let id: RpcId | null = null;
    try {
      let text: string;
      if (typeof line === 'string') {
        text = line;
      } else {
        try {
          text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line);
        } catch {
          return [errorLine(null, JSONRPC_PARSE_ERROR, PARSE_ERROR)];
        }
      }
      if (isBlank(text)) return [];
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return [errorLine(null, JSONRPC_PARSE_ERROR, PARSE_ERROR)];
      }
      const env = classify(value);
      if (env.kind === 'invalid') {
        return [errorLine(null, JSONRPC_INVALID_REQUEST, INVALID_REQUEST)];
      }
      if (env.kind === 'notification') return [];
      id = env.id;
      const response = dispatch(strategy, env.id, env.method, env.params);
      if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES) {
        return [errorLine(env.id, JSONRPC_INTERNAL_ERROR, INTERNAL_ERROR)];
      }
      return [response];
    } catch {
      return [errorLine(id, JSONRPC_INTERNAL_ERROR, INTERNAL_ERROR)];
    }
  }

  return { handleLine };
}

export interface WorkspaceServerOptions extends ServerOptions {
  /** Required: supplies the Home_Directory used to reject Home_Ancestors. */
  homedir: () => string;
}

/** Workspace_Mode: the root is given per call by the agent and validated each time. */
export function createWorkspaceServer(options: WorkspaceServerOptions): Server {
  return buildServer(
    createWorkspaceStrategy({ fs: options.fs ?? nodeFs, homedir: options.homedir }),
  );
}

export function createServer(root: string, options?: ServerOptions): Server {
  const ctx: ToolContext = { root, fs: options?.fs ?? nodeFs };
  return buildServer({
    tools: TOOL_DEFS,
    bind: (_name, args) => ({ ok: true, value: { ctx, args } }),
  });
}
