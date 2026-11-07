// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANGED_WHILE_READING_MESSAGE,
  OTHERS_IGNORED_MESSAGE,
  READ_FAILED_MESSAGE,
  createIntake,
  type FileLike,
  type Intake,
} from './intake';
import { createStatusRegion } from './status';
import { DROP_REJECT_MESSAGE } from '../logic/drop';
import { MAX_IMAGE_BYTES } from '../logic/limits';

let zone: HTMLElement;
let picker: HTMLButtonElement;
let input: HTMLInputElement;
let statusEl: HTMLElement;
let onBytes: ReturnType<typeof vi.fn>;
let intake: Intake;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function fileLike(name: string, bytes: number | Uint8Array): FileLike & { arrayBuffer: ReturnType<typeof vi.fn> } {
  const data = typeof bytes === 'number' ? new Uint8Array(bytes) : bytes;
  return {
    name,
    size: data.byteLength,
    arrayBuffer: vi.fn(async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer),
  };
}

interface DtInit {
  files?: unknown[];
  items?: { kind: string; webkitGetAsEntry?: () => { isDirectory: boolean } | null }[];
}

function fire(type: 'dragenter' | 'dragover' | 'drop', dt: DtInit | null): Event & { dataTransfer?: { dropEffect?: string } } {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: { dropEffect?: string } };
  Object.defineProperty(ev, 'dataTransfer', { value: dt === null ? null : { dropEffect: 'none', ...dt }, configurable: true });
  document.dispatchEvent(ev);
  return ev;
}

const dropFiles = (files: unknown[], kinds?: string[]) =>
  fire('drop', { files, items: (kinds ?? files.map(() => 'file')).map((kind) => ({ kind })) });

beforeEach(() => {
  document.body.textContent = '';
  zone = document.createElement('div');
  picker = document.createElement('button');
  input = document.createElement('input');
  input.type = 'file';
  statusEl = document.createElement('p');
  statusEl.setAttribute('role', 'status');
  zone.append(picker, input, statusEl);
  document.body.appendChild(zone);
  onBytes = vi.fn();
  intake = createIntake({
    dropZone: zone,
    picker,
    input,
    status: createStatusRegion(statusEl),
    onBytes: onBytes as unknown as (b: Uint8Array, n: string) => void,
  });
  intake.attach();
});

afterEach(() => {
  intake.detach();
});

describe('drag events', () => {
  it('dragenter, dragover and drop call preventDefault', () => {
    expect(fire('dragenter', { files: [] }).defaultPrevented).toBe(true);
    const over = fire('dragover', { files: [] });
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe('copy');
    expect(dropFiles([]).defaultPrevented).toBe(true);
  });

  it('prevents default even without a dataTransfer', () => {
    expect(fire('dragover', null).defaultPrevented).toBe(true);
    expect(fire('drop', null).defaultPrevented).toBe(true);
    expect(statusEl.textContent).toBe(DROP_REJECT_MESSAGE);
  });

  it('detach stops listening', () => {
    intake.detach();
    const ev = dropFiles([fileLike('a.img', 512)]);
    expect(ev.defaultPrevented).toBe(false);
    expect(onBytes).not.toHaveBeenCalled();
  });
});

describe('drops', () => {
  it('reads a valid file and passes bytes and name on', async () => {
    const f = fileLike('disk.img', new Uint8Array([1, 2, 3]));
    dropFiles([f]);
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
    const [bytes, name] = onBytes.mock.calls[0] as [Uint8Array, string];
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(name).toBe('disk.img');
  });

  it('reads a real happy-dom File', async () => {
    const f = new File([new Uint8Array([9, 8, 7, 6])], 'real.img');
    dropFiles([f]);
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
    expect(Array.from((onBytes.mock.calls[0] as [Uint8Array])[0])).toEqual([9, 8, 7, 6]);
  });

  it('checks the size before reading: too large is never read', async () => {
    const f = fileLike('big.img', 1);
    Object.defineProperty(f, 'size', { value: MAX_IMAGE_BYTES + 1 });
    dropFiles([f]);
    await flush();
    expect(f.arrayBuffer).not.toHaveBeenCalled();
    expect(onBytes).not.toHaveBeenCalled();
    expect(statusEl.textContent).toMatch(/supported/);
  });

  it('accepts a file of exactly the cap size', async () => {
    const f = fileLike('cap.img', 1);
    Object.defineProperty(f, 'size', { value: MAX_IMAGE_BYTES });
    f.arrayBuffer.mockResolvedValue(new ArrayBuffer(MAX_IMAGE_BYTES));
    dropFiles([f]);
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
  });

  it('shows the empty message for a 0-byte file without reading it', async () => {
    const f = fileLike('empty.img', 0);
    dropFiles([f]);
    await flush();
    expect(f.arrayBuffer).not.toHaveBeenCalled();
    expect(statusEl.textContent).toBe('This file is empty.');
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('uses the first of several files and notes the others were ignored', async () => {
    const a = fileLike('a.img', 4);
    const b = fileLike('b.img', 4);
    dropFiles([a, b]);
    await flush();
    expect(statusEl.textContent).toBe(OTHERS_IGNORED_MESSAGE);
    expect(a.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(b.arrayBuffer).not.toHaveBeenCalled();
    expect((onBytes.mock.calls[0] as [Uint8Array, string])[1]).toBe('a.img');
  });

  it('rejects a non-file drop (text)', async () => {
    fire('drop', { files: [], items: [{ kind: 'string' }] });
    await flush();
    expect(statusEl.textContent).toBe(DROP_REJECT_MESSAGE);
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('rejects a directory drop', async () => {
    const f = fileLike('folder', 4);
    fire('drop', { files: [f], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] });
    await flush();
    expect(statusEl.textContent).toBe(DROP_REJECT_MESSAGE);
    expect(f.arrayBuffer).not.toHaveBeenCalled();
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('survives a throwing webkitGetAsEntry and treats the item as a file', async () => {
    const f = fileLike('a.img', 4);
    fire('drop', {
      files: [f],
      items: [
        {
          kind: 'file',
          webkitGetAsEntry: () => {
            throw new Error('nope');
          },
        },
      ],
    });
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
  });

  it('shows the read failure message when arrayBuffer rejects', async () => {
    const f = fileLike('a.img', 4);
    f.arrayBuffer.mockRejectedValue(new Error('boom'));
    dropFiles([f]);
    await flush();
    expect(statusEl.textContent).toBe(READ_FAILED_MESSAGE);
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('reports a file that changed while reading (now empty, or now too large)', async () => {
    const shrunk = fileLike('a.img', 4);
    shrunk.arrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    dropFiles([shrunk]);
    await flush();
    expect(statusEl.textContent).toBe(CHANGED_WHILE_READING_MESSAGE);

    statusEl.textContent = '';
    const grown = fileLike('b.img', 4);
    grown.arrayBuffer.mockResolvedValue(new ArrayBuffer(MAX_IMAGE_BYTES + 1));
    dropFiles([grown]);
    await flush();
    expect(statusEl.textContent).toBe(CHANGED_WHILE_READING_MESSAGE);
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('latest wins: an older slow read is discarded', async () => {
    let resolveA!: (b: ArrayBuffer) => void;
    const a = fileLike('a.img', 4);
    a.arrayBuffer.mockReturnValue(new Promise<ArrayBuffer>((r) => (resolveA = r)));
    const b = fileLike('b.img', new Uint8Array([5, 5]));
    dropFiles([a]);
    dropFiles([b]);
    await flush();
    resolveA(new ArrayBuffer(4));
    await flush();
    expect(onBytes).toHaveBeenCalledTimes(1);
    expect((onBytes.mock.calls[0] as [Uint8Array, string])[1]).toBe('b.img');
  });

  it('a rejected drop supersedes an older read, and a failed older read stays silent', async () => {
    let rejectA!: (e: unknown) => void;
    const a = fileLike('a.img', 4);
    a.arrayBuffer.mockReturnValue(new Promise<ArrayBuffer>((_, rej) => (rejectA = rej)));
    dropFiles([a]);
    fire('drop', { files: [], items: [{ kind: 'string' }] });
    rejectA(new Error('late'));
    await flush();
    expect(statusEl.textContent).toBe(DROP_REJECT_MESSAGE);
    expect(onBytes).not.toHaveBeenCalled();
  });

  it('keeps a hostile file name out of the markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>.img';
    const f = fileLike(hostile, 4);
    dropFiles([f, fileLike('<b>x</b>', 4)]);
    await flush();
    expect(statusEl.children.length).toBe(0);
    expect(zone.querySelector('img, script, b')).toBeNull();
    expect((onBytes.mock.calls[0] as [Uint8Array, string])[1]).toBe(hostile);

    const big = fileLike('<script>alert(1)</script>', 1);
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });
    dropFiles([big]);
    expect(statusEl.children.length).toBe(0);
    expect(statusEl.textContent).not.toContain('<script>');
    expect(document.body.contains(zone)).toBe(true);
  });
});

describe('picker and input', () => {
  function setFiles(files: unknown[]): { values: string[] } {
    const values: string[] = [];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => 'C:\\fakepath\\x.img',
      set: (v: string) => {
        values.push(v);
      },
    });
    return { values };
  }

  it('clicking the picker button clicks the file input', () => {
    const clicked = vi.fn();
    input.addEventListener('click', clicked);
    picker.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('input change reads the file and clears the input value', async () => {
    const { values } = setFiles([fileLike('pick.img', new Uint8Array([4, 2]))]);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(values).toEqual(['']);
    expect(onBytes).toHaveBeenCalledTimes(1);
    expect((onBytes.mock.calls[0] as [Uint8Array, string])[1]).toBe('pick.img');
  });

  it('input change with several files notes the ignored ones; with none shows the reject message', async () => {
    setFiles([fileLike('a.img', 4), fileLike('b.img', 4)]);
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(statusEl.textContent).toBe(OTHERS_IGNORED_MESSAGE);

    const { values } = setFiles([]);
    input.dispatchEvent(new Event('change'));
    expect(values).toEqual(['']);
    expect(statusEl.textContent).toBe(DROP_REJECT_MESSAGE);
  });
});

describe('intakeBytes', () => {
  it('passes valid bytes on and rejects empty or oversize bytes with a message', () => {
    expect(intake.intakeBytes(new Uint8Array([1]), 'demo.img')).toBe(true);
    expect(onBytes).toHaveBeenCalledTimes(1);
    expect(intake.intakeBytes(new Uint8Array(0), 'demo.img')).toBe(false);
    expect(statusEl.textContent).toBe('This file is empty.');
    expect(onBytes).toHaveBeenCalledTimes(1);
  });
});
