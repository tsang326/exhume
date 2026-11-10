// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { createDemoSlot } from './demo-slot';
import type { DemoDisk, DemoLoad } from '../demos';

const good = (id: string, over: Partial<DemoDisk> = {}): DemoDisk => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  url: `/disks/${id}.img`,
  ...over,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createDemoSlot (happy-dom)', () => {
  it('hides everything with the default empty registry', () => {
    const slot = createDemoSlot(vi.fn(), []);
    expect(slot.count).toBe(0);
    expect(slot.element.hasAttribute('hidden')).toBe(true);
    expect(slot.element.querySelector('h2')).toBeNull();
    expect(slot.element.querySelector('button')).toBeNull();
    expect(slot.element.textContent).toBe('');
  });

  it('renders a labelled section with one native button per valid entry', () => {
    const load = vi.fn();
    const slot = createDemoSlot(vi.fn(), [good('a'), good('b')], load);
    expect(slot.count).toBe(2);
    const root = slot.element;
    expect(root.tagName).toBe('SECTION');
    expect(root.hasAttribute('hidden')).toBe(false);
    const label = root.querySelector('h2');
    expect(label?.textContent).toBe('Demo disks');
    expect(root.getAttribute('aria-labelledby')).toBe(label?.id);
    const buttons = root.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    for (const b of Array.from(buttons)) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.hasAttribute('tabindex')).toBe(false);
      expect(b.getAttribute('aria-pressed')).toBe('false');
      expect(b.querySelector('strong')).not.toBeNull();
      expect(b.querySelector('span')).not.toBeNull();
    }
    expect(buttons[0].textContent).toContain('Title a');
    expect(buttons[0].textContent).toContain('Description a');
    expect(load).not.toHaveBeenCalled();
  });

  it('renders hostile titles as text only', () => {
    const slot = createDemoSlot(vi.fn(), [good('x', { title: '<img src=x onerror=1>' })], vi.fn());
    expect(slot.element.querySelector('img')).toBeNull();
    expect(slot.element.querySelector('button')?.textContent).toContain('<img src=x onerror=1>');
  });

  it('omits invalid and duplicate entries and never loads them', async () => {
    const load = vi.fn(async (): Promise<DemoLoad> => ({ ok: true, bytes: new Uint8Array(1) }));
    const entries = [
      good('ok'),
      good('badurl', { url: 'https://evil.example/x.img' }),
      good('ok', { title: 'Duplicate' }),
      good('longtitle', { title: 'x'.repeat(81) }),
      good('longdesc', { description: 'y'.repeat(201) }),
    ];
    const slot = createDemoSlot(vi.fn(), entries, load);
    expect(slot.count).toBe(1);
    const buttons = slot.element.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    (buttons[0] as HTMLButtonElement).click();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect((load.mock.calls[0] as unknown[])[0]).toBe(entries[0]);
  });

  it('disables buttons and shows loading while pending, then hands on bytes', async () => {
    let resolve!: (v: DemoLoad) => void;
    const load = vi.fn(() => new Promise<DemoLoad>((r) => (resolve = r)));
    const onBytes = vi.fn();
    const entries = [good('a'), good('b')];
    const slot = createDemoSlot(onBytes, entries, load);
    const buttons = Array.from(slot.element.querySelectorAll('button'));
    buttons[0].click();
    expect(buttons.every((b) => b.hasAttribute('disabled'))).toBe(true);
    expect(slot.element.getAttribute('aria-busy')).toBe('true');
    const status = slot.element.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Loading the demo disk.');

    const bytes = new Uint8Array([1, 2, 3]);
    resolve({ ok: true, bytes });
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
    expect(onBytes).toHaveBeenCalledWith(bytes, entries[0]);
    expect(status?.textContent).toBe('');
    expect(buttons.some((b) => b.hasAttribute('disabled'))).toBe(false);
    expect(slot.element.hasAttribute('aria-busy')).toBe(false);
  });

  it('shows the message and re-enables buttons on failure', async () => {
    const load = vi.fn(
      async (): Promise<DemoLoad> => ({ ok: false, reason: 'http', message: 'Server said no.' }),
    );
    const onBytes = vi.fn();
    const slot = createDemoSlot(onBytes, [good('a')], load);
    const button = slot.element.querySelector('button') as HTMLButtonElement;
    button.click();
    await flush();
    expect(slot.element.querySelector('[role="status"]')?.textContent).toBe('Server said no.');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(slot.element.hasAttribute('aria-busy')).toBe(false);
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('treats a thrown load as a failure', async () => {
    const load = vi.fn(async (): Promise<DemoLoad> => {
      throw new Error('boom');
    });
    const onBytes = vi.fn();
    const slot = createDemoSlot(onBytes, [good('a')], load);
    const button = slot.element.querySelector('button') as HTMLButtonElement;
    button.click();
    await flush();
    expect(slot.element.querySelector('[role="status"]')?.textContent).toBe(
      'The demo disk could not be loaded.',
    );
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(onBytes).not.toHaveBeenCalled();
  });
});

describe('createDemoSlot setPressed (property)', () => {
  // Feature: ui-polish, Property 5: Exactly one demo card is pressed
  // **Validates: Requirements 8.5, 8.6**
  it('presses exactly the card whose id matches, and none for null or unknown ids', () => {
    const idArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);
    const caseArb = fc
      .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
      .chain((ids) =>
        fc.record({
          ids: fc.constant(ids),
          pick: fc.oneof(
            fc.constantFrom(...ids),
            fc.constant(null),
            fc.string({ maxLength: 12 }).filter((s) => !ids.includes(s)),
          ),
        }),
      );
    fc.assert(
      fc.property(caseArb, ({ ids, pick }) => {
        const slot = createDemoSlot(vi.fn(), ids.map((id) => good(id)), vi.fn());
        slot.setPressed(pick);
        const buttons = Array.from(slot.element.querySelectorAll('button'));
        return (
          slot.count === ids.length &&
          buttons.length === ids.length &&
          buttons.every(
            (b, i) => b.getAttribute('aria-pressed') === (pick !== null && ids[i] === pick ? 'true' : 'false'),
          )
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});
