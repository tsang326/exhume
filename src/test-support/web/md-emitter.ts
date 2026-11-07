// Test emitter for converter-shaped Markdown (the shape convertWordStar writes).
// It builds an abstract document first, then renders it, so the expected plain text,
// paragraph count and node structure are known without running the parser.

import * as fc from 'fast-check';

export type EmItem =
  | { t: 'plain'; text: string }
  | { t: 'strong'; items: EmItem[] }
  | { t: 'em'; items: EmItem[] };
export type EmLine = EmItem[];
export type EmBlock = { t: 'para'; lines: EmLine[] } | { t: 'hr' };

export interface EmittedDoc {
  markdown: string;
  /** Raw text of every plain span in order, joined with nothing. */
  plain: string;
  paragraphs: number;
  /** Canonical structure string, comparable with a signature of the parsed model. */
  signature: string;
}

const ALPHABET = [
  'a', 'b', 'Z', 'q', '0', '1', '7', ' ', '.', ')', ',', '!', '#', '+', '-', '_', '<', '>', '[', ']', '`', '*', '\\', '(', 'é',
];

const ESCAPED_ALWAYS = '\\`*_<>[]';

function renderLine(items: readonly EmItem[]): string {
  let col = 0;
  let firstDigit = false;
  let out = '';
  const renderText = (text: string): void => {
    for (const ch of text) {
      let escape = ESCAPED_ALWAYS.includes(ch);
      if (!escape && col === 0 && (ch === '#' || ch === '+' || ch === '-')) escape = true;
      if (!escape && col === 1 && firstDigit && (ch === '.' || ch === ')')) escape = true;
      out += escape ? `\\${ch}` : ch;
      if (col === 0) firstDigit = ch >= '0' && ch <= '9';
      col++;
    }
  };
  const walk = (list: readonly EmItem[]): void => {
    for (const item of list) {
      if (item.t === 'plain') {
        renderText(item.text);
      } else {
        const marker = item.t === 'strong' ? '**' : '*';
        out += marker;
        walk(item.items);
        out += marker;
      }
    }
  };
  walk(items);
  return out;
}

function itemSignature(item: EmItem): string {
  if (item.t === 'plain') return `T(${JSON.stringify(item.text)})`;
  const tag = item.t === 'strong' ? 'S' : 'E';
  return `${tag}(${item.items.map(itemSignature).join(',')})`;
}

function paragraphSignature(lines: readonly EmLine[]): string {
  const parts: string[] = [];
  lines.forEach((line, i) => {
    if (i > 0) parts.push('BR');
    for (const item of line) parts.push(itemSignature(item));
  });
  return `P(${parts.join(',')})`;
}

function plainOf(items: readonly EmItem[]): string {
  let s = '';
  for (const item of items) s += item.t === 'plain' ? item.text : plainOf(item.items);
  return s;
}

// ---- generators ---------------------------------------------------------

const textArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 8 })
  .map((a) => a.join(''));
const optTextArb: fc.Arbitrary<string | null> = fc.option(textArb, { nil: null });

/**
 * Alternates plain spans and styled spans so that two styled spans are never adjacent.
 * `needHead` forces a non-empty plain span first.
 */
function compose(
  styled: EmItem[],
  between: readonly string[],
  head: string | null,
  tail: string | null,
  needHead: boolean,
): EmItem[] {
  const items: EmItem[] = [];
  if (styled.length === 0) {
    // One plain span only, so the parser's merged text node matches the abstract tree.
    return [{ t: 'plain', text: (head ?? between[0]) + (tail ?? '') }];
  }
  const headText = head ?? (needHead || styled.length === 0 ? between[0] : null);
  if (headText !== null) items.push({ t: 'plain', text: headText });
  styled.forEach((s, j) => {
    if (j > 0) items.push({ t: 'plain', text: between[j - 1] });
    items.push(s);
  });
  if (tail !== null) items.push({ t: 'plain', text: tail });
  return items;
}

const betweenArb = fc.array(textArb, { minLength: 3, maxLength: 3 });

/** strong containing optional em spans (em spans may sit at the start or end). */
const strongArb: fc.Arbitrary<EmItem> = fc
  .record({
    ems: fc.array(textArb, { maxLength: 2 }),
    between: betweenArb,
    head: optTextArb,
    tail: optTextArb,
  })
  .map(({ ems, between, head, tail }) => ({
    t: 'strong' as const,
    items: compose(
      ems.map((text) => ({ t: 'em' as const, items: [{ t: 'plain' as const, text }] })),
      between,
      head,
      tail,
      false,
    ),
  }));

/**
 * em holding plain text only. A strong span inside an em span is deliberately not
 * generated: the design's star-run rule closes an open em on any star run, so
 * `*a**b***` is not a shape the parser is specified to read back. Bold-plus-emphasis
 * is the strong-outside, em-inside form (`***x***`).
 */
const emArb: fc.Arbitrary<EmItem> = textArb.map((text) => ({
  t: 'em' as const,
  items: [{ t: 'plain' as const, text }],
}));

const lineArb: fc.Arbitrary<EmLine> = fc
  .record({
    styled: fc.array(fc.oneof(strongArb, emArb), { maxLength: 3 }),
    between: betweenArb,
    head: optTextArb,
    tail: optTextArb,
  })
  .map(({ styled, between, head, tail }) => compose(styled, between, head, tail, false));

const blockArb: fc.Arbitrary<{ block: EmBlock; gap: number }> = fc.record({
  block: fc.oneof(
    { weight: 3, arbitrary: fc.array(lineArb, { minLength: 1, maxLength: 4 }).map((lines): EmBlock => ({ t: 'para', lines })) },
    { weight: 1, arbitrary: fc.constant<EmBlock>({ t: 'hr' }) },
  ),
  gap: fc.integer({ min: 0, max: 2 }),
});

function emit(spec: { leading: number; blocks: { block: EmBlock; gap: number }[]; trailing: number }): EmittedDoc {
  const lines: string[] = [];
  for (let i = 0; i < spec.leading; i++) lines.push('');
  let prev: EmBlock | null = null;
  const sigs: string[] = [];
  let plain = '';
  let paragraphs = 0;
  for (const { block, gap } of spec.blocks) {
    if (prev !== null) {
      const needed = prev.t === 'para' && block.t === 'para' ? 1 : 0;
      for (let i = 0; i < Math.max(gap, needed); i++) lines.push('');
    }
    if (block.t === 'para') {
      paragraphs++;
      for (const line of block.lines) {
        lines.push(renderLine(line));
        plain += plainOf(line);
      }
      sigs.push(paragraphSignature(block.lines));
    } else {
      lines.push('---');
      sigs.push('HR');
    }
    prev = block;
  }
  for (let i = 0; i < spec.trailing; i++) lines.push('');
  return { markdown: lines.join('\n'), plain, paragraphs, signature: sigs.join(';') };
}

export const emittedDocArb: fc.Arbitrary<EmittedDoc> = fc
  .record({
    leading: fc.integer({ min: 0, max: 2 }),
    blocks: fc.array(blockArb, { maxLength: 5 }),
    trailing: fc.integer({ min: 0, max: 2 }),
  })
  .map(emit);
