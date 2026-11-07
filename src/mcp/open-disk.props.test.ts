import fc from 'fast-check';
import { afterAll, describe, it } from 'vitest';
import { openDisk } from '../core/fat12/index';
import type { DiskReport } from '../core/fat12/index';
import { fittedTreeArb } from '../test-support/fat12/arbitraries';
import { writeFat12Image } from '../test-support/fat12/index';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { numRuns } from '../test-support/runs';
import { MAX_REPORT_ENTRIES } from './limits';
import { viewPath } from './sanitize';
import { createServer } from './server';

const workspace = makeWorkspace();
afterAll(() => workspace.cleanup());
const server = createServer(workspace.root);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when the first entries of the tool output match the core report, up to sanitizing and caps. */
function agrees(report: DiskReport, output: unknown): boolean {
  if (!isObject(output)) return false;
  const entries: unknown = output.entries;
  if (!Array.isArray(entries)) return false;
  const expected = report.files.slice(0, MAX_REPORT_ENTRIES);
  if (output.totalEntries !== report.files.length) return false;
  if (entries.length !== expected.length) return false;
  return expected.every((g, i) => {
    const e: unknown = entries[i];
    return (
      isObject(e) &&
      e.id === g.id &&
      e.path === viewPath(g.path) &&
      e.kind === g.kind &&
      e.size === g.size &&
      e.state === g.state
    );
  });
}

describe('open_disk against the core', () => {
  // Feature: mcp-server, Property 16: open_disk agrees with the core on writer images
  // **Validates: Requirements 7.10**
  it('reports the same entries as the core DiskReport for writer images', () => {
    fc.assert(
      fc.property(fittedTreeArb, (fitted) => {
        const image = writeFat12Image(fitted.tree, fitted.geometryName);
        workspace.write('disk.img', image);
        const report = openDisk(image).report;
        const res = callTool(server, 'open_disk', { image: 'disk.img' });
        return !res.isError && agrees(report, res.output);
      }),
      { numRuns: numRuns(25) },
    );
  });
});
