// Feature: mcp-server, explain_state examples (Requirements 11.1 to 11.9)
// **Validates: Requirements 11.1, 11.3, 11.9**
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace, type Workspace } from '../test-support/mcp/workspace';
import { MESSAGES } from './errors';
import { createServer } from './server';
import { STATE_TEXT } from './state-text';

let ws: Workspace;

beforeEach(() => {
  ws = makeWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

function explain(state: unknown, root = ws.root): { isError: boolean; out: Record<string, unknown> } {
  const r = callTool(createServer(root), 'explain_state', { state });
  return { isError: r.isError, out: r.output as Record<string, unknown> };
}

describe('explain_state', () => {
  it.each(['alive', 'recovered', 'partial', 'lost'] as const)(
    'returns the fixed text for %s',
    (state) => {
      const { isError, out } = explain(state);
      expect(isError).toBe(false);
      expect(out.state).toBe(state);
      expect(out.explanation).toBe(STATE_TEXT[state]);
    },
  );

  it('recovered mentions contiguous and unallocated clusters', () => {
    const text = String(explain('recovered').out.explanation);
    expect(text).toContain('contiguous');
    expect(text).toContain('unallocated');
  });

  it.each(['partial', 'lost'] as const)('%s says what is missing and that data may be gone', (state) => {
    const text = String(explain(state).out.explanation);
    expect(text).toMatch(/missing|cannot be read/);
    expect(text).toMatch(/incomplete|gone/);
  });

  it.each([['bogus'], [''], [42], [null], [['alive']]])(
    'rejects invalid state %j with INVALID_ARGUMENTS',
    (state) => {
      const { isError, out } = explain(state);
      expect(isError).toBe(true);
      expect(out).toEqual({ error: 'INVALID_ARGUMENTS', message: MESSAGES.INVALID_ARGUMENTS });
    },
  );

  it('does not depend on the workspace root', () => {
    const other = makeWorkspace();
    try {
      for (const s of ['alive', 'recovered', 'partial', 'lost']) {
        expect(explain(s, other.root)).toEqual(explain(s));
      }
    } finally {
      other.cleanup();
    }
  });
});
