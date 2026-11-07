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

  it('keeps the prior-art credit and makes no "first" claim', () => {
    expect(readme).toContain('disk-peek');
    const lower = readme.toLowerCase();
    expect(lower).not.toContain('first browser');
    expect(lower).not.toContain('first in the browser');
  });
});
