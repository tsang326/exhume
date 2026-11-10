// Workspace_Mode tool definitions (Requirements 4.1 to 4.3 and 9.1 to 9.3).
// Built once from deep copies of TOOL_DEFS plus one constant property.
// Nothing here derives from process input, environment, file names or disk content.

import { MAX_ARG_CHARS } from './limits';
import { TOOL_DEFS } from './tool-defs';
import type { ToolDef } from './tool-defs';

export const WORKSPACE_PROPERTY = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_ARG_CHARS,
  description:
    'Absolute path of the folder the user has open in Kiro. Always pass it. ' +
    'Images are read from inside it and exhumed files are written to its exhumed folder. ' +
    'The server rejects the filesystem root, the user home folder and any folder above it.',
} as const;

/** Pure. Returns new objects; `defs` and everything inside it are left untouched. */
export function toWorkspaceToolDefs(defs: readonly ToolDef[]): readonly ToolDef[] {
  return defs.map((def): ToolDef => {
    const copy = structuredClone(def) as ToolDef;
    return {
      ...copy,
      inputSchema: {
        ...copy.inputSchema,
        properties: { workspace: structuredClone(WORKSPACE_PROPERTY), ...copy.inputSchema.properties },
        required: ['workspace', ...copy.inputSchema.required],
        additionalProperties: false,
      },
    };
  });
}

export const WORKSPACE_TOOL_DEFS: readonly ToolDef[] = toWorkspaceToolDefs(TOOL_DEFS);
