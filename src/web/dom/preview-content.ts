// Preview bodies built with h() and Text nodes only. Disk text never reaches markup.
// Creates only: p, br, strong, em, hr, div, span, table parts.

import { h } from './h';
import type { MarkdownModel, InlineNode } from '../logic/markdown';
import type { CsvTable } from '../logic/csv-display';
import type { HexRow } from '../logic/hex';

interface Frame {
  list: InlineNode[];
  at: number;
  el: HTMLElement;
}

/** Iterative build (nesting depth is small, but no recursion is needed). */
function fillInline(target: HTMLElement, children: InlineNode[]): void {
  const stack: Frame[] = [{ list: children, at: 0, el: target }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as Frame;
    if (top.at >= top.list.length) {
      stack.pop();
      continue;
    }
    const node = top.list[top.at] as InlineNode;
    top.at++;
    if (node.type === 'text') {
      top.el.appendChild(document.createTextNode(node.value));
    } else if (node.type === 'line-break') {
      top.el.appendChild(h('br'));
    } else {
      const el = h(node.type === 'strong' ? 'strong' : 'em');
      top.el.appendChild(el);
      stack.push({ list: node.children, at: 0, el });
    }
  }
}

export function buildMarkdown(model: MarkdownModel): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const block of model.blocks) {
    if (block.type === 'thematic-break') {
      frag.appendChild(h('hr'));
    } else {
      const p = h('p');
      fillInline(p, block.children);
      frag.appendChild(p);
    }
  }
  return frag;
}

export function buildCsvTable(table: CsvTable): HTMLElement {
  const wrap = h('div', { class: 'preview-scroll csv-wrap', tabindex: '0', role: 'region', 'aria-label': 'CSV table' });
  const t = h('table', { class: 'csv-table' });
  const [first, ...rest] = table.rows;
  if (first !== undefined) {
    const head = h('tr');
    for (const cell of first) head.appendChild(h('th', { scope: 'col' }, cell));
    t.appendChild(h('thead', undefined, head));
  }
  const body = h('tbody');
  for (const row of rest) {
    const tr = h('tr');
    for (const cell of row) tr.appendChild(h('td', undefined, cell));
    body.appendChild(tr);
  }
  t.appendChild(body);
  wrap.appendChild(t);
  if (table.truncated) {
    let shownCols = 0;
    for (const row of table.rows) if (row.length > shownCols) shownCols = row.length;
    wrap.appendChild(
      h(
        'p',
        { class: 'csv-note' },
        `Preview truncated: showing ${table.rows.length} of ${table.totalRows} rows and ${shownCols} of ${table.totalCols} columns.`,
      ),
    );
  }
  return wrap;
}

export function buildHexView(rows: HexRow[]): HTMLElement {
  const view = h('div', { class: 'preview-scroll hex-view', tabindex: '0', role: 'region', 'aria-label': 'Hex view' });
  for (const row of rows) {
    view.appendChild(
      h(
        'div',
        { class: 'hex-row' },
        h('span', { class: 'hex-offset' }, row.offset),
        h('span', { class: 'hex-bytes' }, row.hex),
        h('span', { class: 'hex-text' }, row.text),
      ),
    );
  }
  return view;
}
