// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_ERROR_MESSAGE, installGlobalErrorHandlers } from './errors';
import { createStatusRegion } from './status';

const HOSTILE = '<img src=x onerror=alert(1)><b>boom</b>';

let statusEl: HTMLElement;
let graveyard: HTMLElement;
let dialog: HTMLElement;
let dropZone: HTMLButtonElement;
let before: { graveyard: string; dialog: string };

function fireError(): void {
  window.dispatchEvent(new ErrorEvent('error', { message: HOSTILE, error: new Error(HOSTILE) }));
}

function fireRejection(): void {
  const ev = new Event('unhandledrejection');
  Object.assign(ev, { reason: HOSTILE, promise: null });
  window.dispatchEvent(ev);
}

// Handlers are added to the shared window; install once per file, rebuild DOM each test.
const state: { status: ReturnType<typeof createStatusRegion> | null } = { status: null };
const proxy = {
  set: (t: string): void => state.status?.set(t),
  clear: (): void => state.status?.clear(),
};
installGlobalErrorHandlers(proxy, window);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

// Structural serialization built from childNodes (no HTML sink).
function serialize(node: Node): string {
  if (node.nodeType === 3) return `#text(${node.textContent ?? ''})`;
  const e = node as Element;
  const attrs = Array.from(e.attributes)
    .map((a) => `${a.name}=${a.value}`)
    .join(',');
  const kids = Array.from(e.childNodes).map(serialize).join('');
  return `<${e.tagName.toLowerCase()} ${attrs}>${kids}</>`;
}

function serializeChildren(node: Node): string {
  return Array.from(node.childNodes).map(serialize).join('');
}

beforeEach(() => {
  const drop = el('button', { id: 'drop', type: 'button' }, 'Drop');
  const grave = el(
    'section',
    { id: 'graveyard' },
    el('div', { class: 'tile' }, 'a'),
    el('div', { class: 'tile' }, 'b'),
  );
  const dlg = el('dialog', { id: 'preview' }, el('p', {}, 'preview'));
  const status = el('div', { id: 'status', role: 'status' });
  document.body.replaceChildren(drop, grave, dlg, status);
  statusEl = status;
  graveyard = grave;
  dialog = dlg;
  dropZone = drop;
  state.status = createStatusRegion(statusEl);
  before = { graveyard: serializeChildren(graveyard), dialog: serializeChildren(dialog) };
});

function expectFixedMessage(): void {
  const text = statusEl.textContent ?? '';
  expect(text).toBe(GLOBAL_ERROR_MESSAGE);
  expect(text.length).toBeGreaterThan(0);
  expect(text.length).toBeLessThanOrEqual(300);
  expect(text).not.toContain('boom');
  expect(text).not.toContain('onerror');
  expect(statusEl.querySelector('img')).toBeNull();
  expect(statusEl.children.length).toBe(0);
}

function expectOthersUntouched(): void {
  expect(serializeChildren(graveyard)).toBe(before.graveyard);
  expect(serializeChildren(dialog)).toBe(before.dialog);
  expect(document.body.contains(dropZone)).toBe(true);
  expect(dropZone.disabled).toBe(false);
}

describe('global error handlers (real DOM)', () => {
  it('shows the fixed message on an error event without echoing it', () => {
    fireError();
    expectFixedMessage();
    expectOthersUntouched();
  });

  it('shows the fixed message on an unhandledrejection event without echoing it', () => {
    fireRejection();
    expectFixedMessage();
    expectOthersUntouched();
  });

  it('keeps a single message across repeated errors', () => {
    fireError();
    fireRejection();
    fireError();
    expectFixedMessage();
    expect(statusEl.childNodes.length).toBe(1);
    expectOthersUntouched();
  });

  it('clear empties the status region', () => {
    fireError();
    state.status?.clear();
    expect(statusEl.textContent).toBe('');
    expect(statusEl.childNodes.length).toBe(0);
  });

  it('set with markup-like text creates no child elements', () => {
    createStatusRegion(statusEl).set(HOSTILE);
    expect(statusEl.children.length).toBe(0);
    expect(statusEl.textContent).toBe(HOSTILE);
  });
});
