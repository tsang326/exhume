import { describe, expect, it } from 'vitest';
import {
  CHANGED_WHILE_READING_MESSAGE,
  OTHERS_IGNORED_MESSAGE,
  READ_FAILED_MESSAGE,
  checkLoadedBytes,
  createIntake,
  type FileLike,
  type ListenTarget,
} from './intake';
import { DROP_REJECT_MESSAGE } from '../logic/drop';
import { MAX_IMAGE_BYTES } from '../logic/limits';
import type { StatusRegion } from './status';

class FakeTarget implements ListenTarget {
  map = new Map<string, (ev: never) => void>();
  addEventListener(type: string, l: (ev: never) => void): void {
    this.map.set(type, l);
  }
  removeEventListener(type: string, l: (ev: never) => void): void {
    if (this.map.get(type) === l) this.map.delete(type);
  }
  fire(type: string, ev: unknown): void {
    this.map.get(type)?.(ev as never);
  }
}

function setup() {
  const doc = new FakeTarget();
  const picker = new FakeTarget();
  const input = new FakeTarget() as FakeTarget & { value: string; files: FileLike[] | null; clicks: number; click(): void };
  input.value = 'x';
  input.files = null;
  input.clicks = 0;
  input.click = () => void input.clicks++;
  const writes: string[] = [];
  const status: StatusRegion = { set: (t) => void writes.push(t), clear: () => void writes.push('') };
  const got: Array<{ bytes: Uint8Array; name: string }> = [];
  const intake = createIntake({
    dropZone: {} as HTMLElement,
    picker: picker as unknown as HTMLButtonElement,
    input: input as unknown as HTMLInputElement,
    status,
    onBytes: (bytes, name) => void got.push({ bytes, name }),
    target: doc,
  });
  intake.attach();
  return { doc, picker, input, writes, got, intake };
}

function file(name: string, size: number, read?: () => Promise<ArrayBuffer>): FileLike & { reads: number } {
  const f = {
    name,
    size,
    reads: 0,
    arrayBuffer: () => {
      f.reads++;
      return read ? read() : Promise.resolve(new ArrayBuffer(size));
    },
  };
  return f;
}

function dropEvent(files: FileLike[], opts: { dir?: boolean; kinds?: string[] } = {}) {
  let prevented = 0;
  const kinds = opts.kinds ?? files.map(() => 'file');
  return {
    ev: {
      preventDefault: () => void prevented++,
      dataTransfer: {
        files,
        items: kinds.map((kind, i) => ({
          kind,
          webkitGetAsEntry: () => (i === 0 && opts.dir ? { isDirectory: true } : { isDirectory: false }),
        })),
      },
    },
    prevented: () => prevented,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('intake', () => {
  it('prevents default on dragenter, dragover and drop', () => {
    const { doc } = setup();
    for (const t of ['dragenter', 'dragover', 'drop']) {
      let n = 0;
      doc.fire(t, { preventDefault: () => void n++, dataTransfer: null });
      expect(n).toBe(1);
    }
  });

  it('delivers a valid dropped file', async () => {
    const { doc, got } = setup();
    doc.fire('drop', dropEvent([file('a.img', 1440)]).ev);
    await tick();
    expect(got).toHaveLength(1);
    expect(got[0]!.bytes.byteLength).toBe(1440);
    expect(got[0]!.name).toBe('a.img');
  });

  it('rejects too-large and empty files without reading', async () => {
    const { doc, writes, got } = setup();
    const big = file('big', MAX_IMAGE_BYTES + 1);
    const empty = file('e', 0);
    doc.fire('drop', dropEvent([big]).ev);
    doc.fire('drop', dropEvent([empty]).ev);
    await tick();
    expect(big.reads + empty.reads).toBe(0);
    expect(got).toHaveLength(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe('This file is empty.');
  });

  it('rejects non-file and directory drops', () => {
    const { doc, writes, got } = setup();
    doc.fire('drop', dropEvent([], { kinds: ['string'] }).ev);
    doc.fire('drop', dropEvent([file('d', 0)], { dir: true }).ev);
    expect(writes).toEqual([DROP_REJECT_MESSAGE, DROP_REJECT_MESSAGE]);
    expect(got).toHaveLength(0);
  });

  it('uses the first of several files and says the others were ignored', async () => {
    const { doc, writes, got } = setup();
    const a = file('a', 512);
    const b = file('b', 512);
    doc.fire('drop', dropEvent([a, b]).ev);
    await tick();
    expect(writes).toEqual([OTHERS_IGNORED_MESSAGE]);
    expect(got.map((g) => g.name)).toEqual(['a']);
    expect(b.reads).toBe(0);
  });

  it('reports a read failure and changes nothing', async () => {
    const { doc, writes, got } = setup();
    doc.fire('drop', dropEvent([file('a', 512, () => Promise.reject(new Error('gone')))]).ev);
    await tick();
    expect(writes).toEqual([READ_FAILED_MESSAGE]);
    expect(got).toHaveLength(0);
  });

  it('rejects bytes whose length changed during the read', async () => {
    const { doc, writes, got } = setup();
    doc.fire('drop', dropEvent([file('a', 512, () => Promise.resolve(new ArrayBuffer(0)))]).ev);
    doc.fire('drop', dropEvent([file('b', 512, () => Promise.resolve(new ArrayBuffer(MAX_IMAGE_BYTES + 1)))]).ev);
    await tick();
    expect(got).toHaveLength(0);
    expect(writes.filter((w) => w === CHANGED_WHILE_READING_MESSAGE).length).toBeGreaterThanOrEqual(1);
  });

  it('latest choice wins over an earlier slow read', async () => {
    const { doc, got } = setup();
    let release: (b: ArrayBuffer) => void = () => {};
    const slow = file('slow', 512, () => new Promise<ArrayBuffer>((r) => (release = r)));
    doc.fire('drop', dropEvent([slow]).ev);
    doc.fire('drop', dropEvent([file('fast', 1024)]).ev);
    await tick();
    release(new ArrayBuffer(512));
    await tick();
    expect(got.map((g) => g.name)).toEqual(['fast']);
  });

  it('picker button opens the input; change reads the file and clears the value', async () => {
    const { picker, input, got } = setup();
    picker.map.get('click')?.(undefined as never);
    expect(input.clicks).toBe(1);
    input.files = [file('p.img', 2048)];
    input.map.get('change')?.(undefined as never);
    expect(input.value).toBe('');
    await tick();
    expect(got.map((g) => g.name)).toEqual(['p.img']);
  });

  it('intakeBytes applies the same size check for demo bytes', () => {
    const { intake, writes, got } = setup();
    expect(intake.intakeBytes(new Uint8Array(0), 'demo')).toBe(false);
    expect(intake.intakeBytes(new Uint8Array(MAX_IMAGE_BYTES + 1), 'demo')).toBe(false);
    expect(intake.intakeBytes(new Uint8Array(512), 'demo')).toBe(true);
    expect(writes).toHaveLength(2);
    expect(got).toHaveLength(1);
    expect(checkLoadedBytes(new Uint8Array(1)).ok).toBe(true);
  });

  it('detach removes the listeners', () => {
    const { doc, intake } = setup();
    intake.detach();
    expect(doc.map.size).toBe(0);
  });
});
