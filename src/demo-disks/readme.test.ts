import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The README documents the demo disks (Requirements 8.6, 8.7, 11.1 to 11.4).
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

describe('README demo-disk section', () => {
  it('names the generator, the folder and both commands', () => {
    for (const text of [
      'scripts/make-demo-disks.ts',
      'public/disks/',
      'npm run make:demos',
      'npm run make:demos -- --check',
    ]) {
      expect(readme, text).toContain(text);
    }
  });

  it('lists the three disk files', () => {
    for (const name of ['writers-disk.img', 'office-disk.img', 'damaged-disk.img']) {
      expect(readme, name).toContain(name);
    }
  });

  it('states the expected state of each deleted file', () => {
    expect(readme).toMatch(/`\/_RAFT1\.WS` is\s+`recovered`/);
    expect(readme).toMatch(/`\/_RAFT2\.WS` is `partial`/);
    expect(readme).toMatch(/`\/_LDCUST\.DBF` is `lost`/);
  });

  it('names the two defects of the damaged disk', () => {
    expect(readme).toContain('broken on purpose in two ways');
    expect(readme).toContain('bad BPB field');
    expect(readme).toContain('cyclic cluster chain');
  });

  it('states determinism and authorship', () => {
    expect(readme).toContain('The same commit produces the same bytes');
    expect(readme).toContain('not recovered archive material');
  });

  it('names plain text among the conversions', () => {
    expect(readme).toContain('plain text files as `.txt` text');
    expect(readme).toContain('Markdown, CSV or plain text, or PNG dimensions');
  });

  it('keeps the prior-art credit and makes no "first" claim', () => {
    expect(readme).toContain('disk-peek');
    const lower = readme.toLowerCase();
    expect(lower).not.toContain('first browser');
    expect(lower).not.toContain('first in the browser');
  });
});

// The "Tested on real disks" section (real-disk-hardening, Requirements 9.1 to 9.8).
describe('README real-disk section', () => {
  const heading = '## Tested on real disks';
  const start = readme.indexOf(heading);
  const next = readme.indexOf('\n## ', start + heading.length);
  const section = readme.slice(start, next === -1 ? undefined : next);

  it('has the heading exactly once, after the demo disks and before the MCP section', () => {
    expect(readme.split(heading).length - 1).toBe(1);
    const demo = readme.indexOf('## Demo disks');
    const mcp = readme.indexOf('## MCP server and Kiro Power');
    expect(demo).toBeGreaterThanOrEqual(0);
    expect(demo).toBeLessThan(start);
    expect(start).toBeLessThan(mcp);
  });

  it('states the counts', () => {
    for (const text of ['35', '24', '11', '942', '63 of the 63', 'other 25', '39 of 39']) {
      expect(section, text).toContain(text);
    }
  });

  it('names the sources and their reference methods', () => {
    expect(section).toContain('FreeDOS');
    expect(section).toContain('PCjs');
    expect(section).toContain('macOS msdos driver');
    expect(section).toContain('per-file MD5 table');
    expect(section).toContain('`dbfread`');
  });

  it('makes no overclaim and says the page does not offer the disks', () => {
    expect(section).not.toContain('two independent');
    expect(section).toContain('The page does not offer these disks');
    expect(section).toContain('not part of the demo disks');
    expect(section.toLowerCase()).not.toMatch(/part of exhume|offered by the page/);
  });

  it('leaves the existing demo-disk text unchanged', () => {
    expect(readme).toContain('## Demo disks');
    expect(readme).toContain('The same commit produces the same bytes');
    expect(readme).toContain('broken on purpose in two ways');
  });
});
