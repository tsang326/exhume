import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Feature: power-workspace, documents
// **Validates: Requirements 10.1, 10.2, 10.3, 10.6, 10.7, 11.1-11.7, 14.1**

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readText(...parts: string[]): string {
  return readFileSync(resolve(ROOT, ...parts), 'utf8');
}

const readme = readText('README.md');
// README is hard-wrapped; phrase checks run on whitespace-collapsed text.
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const power = readText('power', 'POWER.md');
const safety = readText('.kiro', 'steering', 'safety.md');

const OLD_LINE =
  'Tools take an image path that must resolve (realpath) inside the workspace root; refuse symlinks and anything outside.';

describe('README.md', () => {
  it('states the Power status and has no "NOT WORKING YET"', () => {
    expect(flat(readme)).toContain('is verified by hand in Kiro (2026-11-10)');
    expect(readme).not.toContain('NOT WORKING YET');
  });

  it('keeps the results heading and says packaging and Workspace_Mode were built', () => {
    expect(readme).toMatch(/^#+ Power and plugin results/m);
    expect(readme).toContain('Power packaging and Workspace_Mode were built');
  });

  it('keeps the disk-peek credit and makes no "first" claim', () => {
    expect(readme).toContain('andete/disk-peek');
    expect(readme.toLowerCase()).not.toContain('first browser undelete');
  });

  it('names the home folder, its ancestors, /tmp and /Volumes/x in the residual risks', () => {
    const start = readme.indexOf('### Accepted residual risks');
    expect(start).toBeGreaterThanOrEqual(0);
    const risks = readme.slice(start);
    expect(risks).toContain("user's home folder and every folder above it");
    expect(risks).toContain('/tmp');
    expect(risks).toContain('/Volumes/x');
  });

  it('lists the manual check steps and the fixture path', () => {
    const start = readme.indexOf('### Manual check of the Power (owner)');
    expect(start).toBeGreaterThanOrEqual(0);
    const section = readme.slice(start);
    expect(section).toContain('The Owner performs this check');
    expect(section).toContain('fixtures/real-disks/freedos13/fd13-720k-dsk01.img');
    expect(section).toMatch(/^1\. Install the Power from `power\/`/m);
    expect(section).toMatch(/^5\. Exhume one file/m);
  });
});

describe('power/POWER.md', () => {
  it('states the Power status and has no "NOT WORKING YET"', () => {
    expect(power).toContain('Status: verified by hand in Kiro on 2026-11-10');
    expect(power).not.toContain('NOT WORKING YET');
  });
});

describe('.kiro/steering/safety.md', () => {
  const lines = safety.split('\n');

  it('describes both modes and the home-directory rejection', () => {
    expect(safety).toContain('In default mode the root is fixed when the server starts');
    expect(safety).toContain('In workspace mode (`--workspace-from-agent`');
    expect(safety).toContain("shown to the user in the chat's record of each tool call");
    expect(safety).toContain(
      "the server rejects the filesystem root, the user's home directory and every directory above it",
    );
  });

  it('extends the old single line instead of keeping it alone', () => {
    expect(lines).not.toContain(OLD_LINE);
    expect(lines).not.toContain(`- ${OLD_LINE}`);
    const extended = lines.filter((l) => l.startsWith(`- ${OLD_LINE}`));
    expect(extended).toHaveLength(1);
    expect(extended[0]?.length).toBeGreaterThan(OLD_LINE.length + 2);
  });

  it('keeps the unchanged rules', () => {
    expect(safety).toContain('No auto-approve in any shipped');
    expect(safety).toContain('pinned, committed build');
  });
});
