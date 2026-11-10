// Item C (mcp-root-and-flaky), task 17.8: the web preview sees one paragraph block per WordStar paragraph.
// Lives in src/test because core must not import from web and web scans reject test-support imports.
import { describe, expect, it } from 'vitest';
import { CHAPTER1 } from '../demo-disks/content/prose';
import { writeWordStar } from '../test-support/formats';
import { convertWordStar } from '../core/formats/wordstar';
import { parseMarkdown } from '../web/logic/markdown';

describe('WordStar output in the Markdown preview', () => {
  it('CHAPTER1 gives 11 paragraph blocks', () => {
    // **Validates: Requirements 1.8, 2.11**
    const r = convertWordStar(writeWordStar(CHAPTER1));
    if (!r.ok || typeof r.output !== 'string') throw new Error('conversion failed');
    const blocks = parseMarkdown(r.output).blocks;
    expect(blocks.filter((b) => b.type === 'paragraph')).toHaveLength(11);
    expect(blocks).toHaveLength(11);
  });
});
