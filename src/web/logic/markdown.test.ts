import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { emittedDocArb } from '../../test-support/web/md-emitter';
import { MD_PREVIEW_CHARS } from './limits';
import { parseMarkdown, parseMarkdownWithStats, plainText, truncateForPreview } from './markdown';
import type { BlockNode, InlineNode, MarkdownModel, MarkdownStats } from './markdown';

// ---- helpers (iterative walkers; nesting is at most 2 so recursion would be safe, but not needed) ----

interface Walk {
  ok: boolean;
  textLength: number;
  maxDepth: number;
}

const INLINE_TYPES = new Set(['text', 'line-break', 'strong', 'emphasis']);

function keysAre(o: object, expected: string[]): boolean {
  const keys = Object.keys(o).sort();
  const want = [...expected].sort();
  return keys.length === want.length && keys.every((k, i) => k === want[i]);
}

/** Checks node types and shapes, and measures text length and strong/emphasis depth. */
function walkModel(model: MarkdownModel): Walk {
  let ok = typeof model.dropped === 'number' && Array.isArray(model.blocks);
  let textLength = 0;
  let maxDepth = 0;
  const stack: { nodes: InlineNode[]; depth: number }[] = [];
  for (const block of model.blocks as BlockNode[]) {
    if (block.type === 'thematic-break') {
      ok = ok && keysAre(block, ['type']);
    } else if (block.type === 'paragraph') {
      ok = ok && keysAre(block, ['type', 'children']);
      stack.push({ nodes: block.children, depth: 0 });
    } else {
      ok = false;
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    for (const node of frame.nodes) {
      if (!INLINE_TYPES.has(node.type)) {
        ok = false;
      } else if (node.type === 'text') {
        ok = ok && keysAre(node, ['type', 'value']) && typeof node.value === 'string';
        textLength += node.value.length;
      } else if (node.type === 'line-break') {
        ok = ok && keysAre(node, ['type']);
      } else {
        ok = ok && keysAre(node, ['type', 'children']);
        const depth = frame.depth + 1;
        if (depth > maxDepth) maxDepth = depth;
        stack.push({ nodes: node.children, depth });
      }
    }
  }
  return { ok, textLength, maxDepth };
}

/** Counts every block and inline node, iteratively. */
function countNodes(model: MarkdownModel): number {
  let count = model.blocks.length;
  const stack: InlineNode[][] = [];
  for (const block of model.blocks) {
    if (block.type === 'paragraph') stack.push(block.children);
  }
  while (stack.length > 0) {
    const nodes = stack.pop()!;
    count += nodes.length;
    for (const node of nodes) {
      if (node.type === 'strong' || node.type === 'emphasis') stack.push(node.children);
    }
  }
  return count;
}

/** Canonical structure string; the same format the emitter produces. */
function signature(model: MarkdownModel): string {
  const inline = (nodes: InlineNode[]): string[] =>
    nodes.map((n) => {
      if (n.type === 'text') return `T(${JSON.stringify(n.value)})`;
      if (n.type === 'line-break') return 'BR';
      return `${n.type === 'strong' ? 'S' : 'E'}(${inline(n.children).join(',')})`;
    });
  return model.blocks
    .map((b) => (b.type === 'thematic-break' ? 'HR' : `P(${inline(b.children).join(',')})`))
    .join(';');
}

const FRAGMENTS = [
  '*', '**', '***', '\\', '\\*', '\n', '\n\n', '---', '<b>', '[x](http://a)', '# t', '`c`', 'a', ' ', '\r', '1.', '-', '#', 'é', '_',
];
const heavyArb: fc.Arbitrary<string> = fc.oneof(
  fc.array(fc.constantFrom(...FRAGMENTS), { maxLength: 40 }).map((a) => a.join('')),
  fc.string({ unit: 'binary', maxLength: 120 }),
);

describe('markdown properties', () => {
  // Feature: graveyard-ui, Property 20: The Markdown parser is total and only produces safe nodes
  // **Validates: Requirements 5.2, 5.6, 5.7, 5.9**
  it('Property 20: total, safe node types, nesting at most 2', () => {
    fc.assert(
      fc.property(heavyArb, (s) => {
        const w = walkModel(parseMarkdown(s));
        return w.ok && w.maxDepth <= 2;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 21: No input character is lost or invented
  // **Validates: Requirements 5.3, 5.4**
  it('Property 21: conservation law holds for every string', () => {
    fc.assert(
      fc.property(heavyArb, (s) => {
        const model = parseMarkdown(s);
        return walkModel(model).textLength + model.dropped === s.length;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 21: No input character is lost or invented
  // **Validates: Requirements 5.3, 5.4**
  it('Property 21: text without stars, backslashes or line feeds stays one literal text node', () => {
    const plainArb = fc
      .array(
        fc.constantFrom('[x](http://a)', '# title', '`code`', '<b>', 'a', ' ', 'é', '_', '1.', '+', '>', '\r'),
        { minLength: 1, maxLength: 10 },
      )
      .map((a) => a.join(''));
    fc.assert(
      fc.property(plainArb, (s) => {
        const model = parseMarkdown(s);
        const b = model.blocks;
        return (
          b.length === 1 &&
          b[0].type === 'paragraph' &&
          b[0].children.length === 1 &&
          b[0].children[0].type === 'text' &&
          (b[0].children[0] as { value: string }).value === s &&
          model.dropped === 0
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 21: No input character is lost or invented
  // **Validates: Requirements 5.3, 5.4**
  it('Property 21: an unmatched marker run keeps its original characters', () => {
    const wordArb = fc.array(fc.constantFrom('a', 'b', ' ', 'x1'), { maxLength: 6 }).map((a) => a.join(''));
    fc.assert(
      fc.property(
        wordArb,
        fc.integer({ min: 1, max: 3 }),
        wordArb,
        (before, stars, after) => {
          const s = `${before}${'*'.repeat(stars)}${after}`;
          if (s === '') return true;
          const model = parseMarkdown(s);
          return plainText(model) === s && model.dropped === 0;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 22: Converter-shaped Markdown parses back to its plain text and structure
  // **Validates: Requirements 5.1, 5.8**
  it('Property 22: emitted documents parse back to the emitter structure', () => {
    fc.assert(
      fc.property(emittedDocArb, (doc) => {
        const model = parseMarkdown(doc.markdown);
        const paragraphs = model.blocks.filter((b) => b.type === 'paragraph').length;
        return (
          plainText(model) === doc.plain &&
          paragraphs === doc.paragraphs &&
          signature(model) === doc.signature
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 23: Preview truncation keeps the head and flags it
  // **Validates: Requirements 5.10**
  it('Property 23: truncation keeps the first 1,000,000 characters and flags longer input', () => {
    const lengthArb = fc.oneof(
      fc.integer({ min: 0, max: 50 }),
      fc.constantFrom(MD_PREVIEW_CHARS - 1, MD_PREVIEW_CHARS, MD_PREVIEW_CHARS + 1),
      fc.integer({ min: MD_PREVIEW_CHARS - 5, max: MD_PREVIEW_CHARS + 5000 }),
    );
    fc.assert(
      fc.property(lengthArb, fc.constantFrom('a', 'é', '*'), (len, ch) => {
        const input = ch.repeat(len);
        const before = input.slice();
        const out = truncateForPreview(input);
        return (
          out.text === input.slice(0, Math.min(len, MD_PREVIEW_CHARS)) &&
          out.shortened === len > MD_PREVIEW_CHARS &&
          input === before
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('markdown examples', () => {
  it('parses bold plus emphasis in both close orders', () => {
    const model = parseMarkdown('***x***');
    expect(signature(model)).toBe('P(S(E(T("x"))))');
    expect(model.dropped).toBe(6);
  });

  it('keeps unsupported syntax literal', () => {
    const s = '[x](http://a)\n# title\n`code` <b>';
    const model = parseMarkdown(s);
    expect(plainText(model)).toBe(s.replace(/\n/g, ''));
    expect(signature(model)).toBe(
      'P(T("[x](http://a)"),BR,T("# title"),BR,T("`code` <b>"))',
    );
  });

  it('resolves escapes and treats a spaces-only line as text', () => {
    expect(plainText(parseMarkdown('a\\*b \\\\ \\#'))).toBe('a*b \\ \\#');
    expect(plainText(parseMarkdown('\\#x\n1\\. y'))).toBe('#x1. y');
    expect(signature(parseMarkdown('   '))).toBe('P(T("   "))');
  });

  it('turns unclosed markers and third-level markers into literal text', () => {
    expect(plainText(parseMarkdown('**a'))).toBe('**a');
    expect(plainText(parseMarkdown('**a *b'))).toBe('**a *b');
    expect(plainText(parseMarkdown('a * b'))).toBe('a * b');
  });

  it('recognizes a thematic break only for an exact --- line', () => {
    expect(signature(parseMarkdown('a\n---\n\nb'))).toBe('P(T("a"));HR;P(T("b"))');
    expect(signature(parseMarkdown('----'))).toBe('P(T("----"))');
  });

  it('returns no blocks for the empty string', () => {
    expect(parseMarkdown('')).toEqual({ blocks: [], dropped: 0 });
  });

  it('parses in linear time: doubling the input doubles the loop steps', () => {
    const unit = 'word *em* **bold** \\* more\nline two ***both*** end\n\n';
    const build = (chars: number): string => unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
    const a = parseMarkdownWithStats(build(1_000_000));
    const b = parseMarkdownWithStats(build(2_000_000));
    for (const key of ['lineSteps', 'scanSteps', 'events', 'pairSteps'] as const) {
      expect(a.stats[key]).toBeGreaterThan(0);
      const ratio = b.stats[key] / a.stats[key];
      expect(ratio).toBeGreaterThanOrEqual(1.98);
      expect(ratio).toBeLessThanOrEqual(2.02);
    }
    // The counters are not vacuous: at least one scan step per 2 characters.
    expect(a.stats.scanSteps).toBeGreaterThanOrEqual(500_000);
    // Structural check on whole units, where the scaling is exact.
    const k = Math.ceil(1_000_000 / unit.length);
    const s1 = parseMarkdownWithStats(unit.repeat(k)).model;
    const s2 = parseMarkdownWithStats(unit.repeat(2 * k)).model;
    expect(s2.blocks.length).toBe(2 * s1.blocks.length);
    expect(s2.dropped).toBe(2 * s1.dropped);
    expect(countNodes(s2)).toBe(2 * countNodes(s1));
  });

  // The shape above has short lines and short paragraphs, so a cost that grows with the length of a
  // line or of a paragraph (a re-walk in the pairing loop, a re-scan from the start of the line on
  // each '*') stays bounded there. These shapes have no blank line: one paragraph holds everything.
  // A re-scan from `runStart` is bounded per run (the runs of a line sum to its length), so it is
  // linear overall and no input can tell it from the original.
  const periodic = (unit: string, chars: number): string =>
    unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
  const shapes: { name: string; unit: string; keys: readonly (keyof MarkdownStats)[] }[] = [
    {
      // one paragraph, one very long line: lineSteps stays 1, so it is not compared
      name: 'one very long line',
      unit: 'word *em* **bold** \\* more ***both*** end ',
      keys: ['scanSteps', 'events', 'pairSteps'],
    },
    {
      // one paragraph, very many lines
      name: 'many lines in one paragraph',
      unit: 'word *em* **bold** \\* more\nline two ***both*** end\n',
      keys: ['lineSteps', 'scanSteps', 'events', 'pairSteps'],
    },
  ];
  for (const shape of shapes) {
    it(`parses in linear time on a single paragraph: ${shape.name}`, () => {
      const a = parseMarkdownWithStats(periodic(shape.unit, 1_000_000));
      const b = parseMarkdownWithStats(periodic(shape.unit, 2_000_000));
      // Non-vacuity: the input really is one paragraph and the counters really count.
      expect(a.model.blocks.length).toBe(1);
      expect(b.model.blocks.length).toBe(1);
      expect(a.stats.scanSteps).toBeGreaterThanOrEqual(500_000);
      expect(a.stats.events).toBeGreaterThanOrEqual(100_000);
      if (shape.keys.includes('lineSteps')) expect(a.stats.lineSteps).toBeGreaterThanOrEqual(30_000);
      for (const key of shape.keys) {
        expect(a.stats[key]).toBeGreaterThan(0);
        const ratio = b.stats[key] / a.stats[key];
        expect(ratio).toBeGreaterThanOrEqual(1.98);
        expect(ratio).toBeLessThanOrEqual(2.02);
      }
      // Every event is visited once by the pairing loop.
      expect(a.stats.pairSteps).toBe(a.stats.events);
    });
  }
});
