// explain_state: fixed text per state. Touches no file.

import { parseStateArgs } from '../args';
import type { Outcome } from '../errors';
import { STATE_TEXT } from '../state-text';

export function runExplainState(args: unknown): Outcome<unknown> {
  const parsed = parseStateArgs(args);
  if (!parsed.ok) return parsed;
  const state = parsed.value.state;
  return { ok: true, value: { state, explanation: STATE_TEXT[state] } };
}
