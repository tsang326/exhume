// Intake: drop and picker entry points. The size is checked before any read, the bytes
// read are checked again, and the newest choice wins. Messages go through the status region.
import { classifyDrop } from '../logic/drop';
import { MAX_IMAGE_BYTES } from '../logic/limits';
import { checkImageSize } from '../logic/size';
import type { StatusRegion } from './status';

export const CHANGED_WHILE_READING_MESSAGE = 'The file changed while it was being read. Please choose it again.';
export const READ_FAILED_MESSAGE = 'The file could not be read.';
export const OTHERS_IGNORED_MESSAGE = 'Several files were dropped. Only one was used and the other files were ignored.';

/** The slice of File that intake needs; injectable for tests. */
export interface FileLike {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Minimal event surface used by the handlers. */
interface DragEventLike {
  preventDefault(): void;
  dataTransfer?: {
    dropEffect?: string;
    files?: ArrayLike<FileLike>;
    items?: ArrayLike<{ kind: string; webkitGetAsEntry?: () => { isDirectory: boolean } | null }>;
  } | null;
}

type Listener = (ev: never) => void;

/** Event target shape shared by document, the picker button and the input. */
export interface ListenTarget {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface IntakeDeps {
  dropZone: HTMLElement;
  picker: HTMLButtonElement;
  input: HTMLInputElement;
  status: StatusRegion;
  onBytes: (bytes: Uint8Array, name: string) => void;
  /** Where dragenter/dragover/drop are listened for; defaults to the document. */
  target?: ListenTarget;
}

export interface Intake {
  attach(): void;
  detach(): void;
  /** Same pipeline for already-loaded bytes (demo slot): size check, then onBytes. */
  intakeBytes(bytes: Uint8Array, name: string): boolean;
}

export type BytesCheck = { ok: true } | { ok: false; message: string };

/** Size check for bytes that are already in memory (demos and re-checks after a read). */
export function checkLoadedBytes(bytes: Uint8Array): BytesCheck {
  const r = checkImageSize(bytes.byteLength);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

export function createIntake(deps: IntakeDeps): Intake {
  const { picker, input, status, onBytes } = deps;
  let token = 0;
  let attached = false;

  function intakeBytes(bytes: Uint8Array, name: string): boolean {
    token++;
    const check = checkLoadedBytes(bytes);
    if (!check.ok) {
      status.set(check.message);
      return false;
    }
    onBytes(bytes, name);
    return true;
  }

  async function handleFile(file: FileLike): Promise<void> {
    const mine = ++token;
    const size = checkImageSize(file.size);
    if (!size.ok) {
      status.set(size.message);
      return;
    }
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      if (mine === token) status.set(READ_FAILED_MESSAGE);
      return;
    }
    if (mine !== token) return;
    const len = buffer.byteLength;
    if (len < 1 || len > MAX_IMAGE_BYTES) {
      status.set(CHANGED_WHILE_READING_MESSAGE);
      return;
    }
    onBytes(new Uint8Array(buffer), file.name);
  }

  function handleList(files: ArrayLike<FileLike>, firstIsDirectory: boolean, kinds: readonly string[]): void {
    const decision = classifyDrop({ itemKinds: kinds, fileCount: files.length, firstIsDirectory });
    if (decision.action === 'reject') {
      token++; // a rejected choice still supersedes an earlier read
      status.set(decision.message);
      return;
    }
    const first = files[0];
    if (first === undefined) return;
    if (decision.ignoredOthers) status.set(OTHERS_IGNORED_MESSAGE);
    void handleFile(first);
  }

  const onDragEnterOver = (ev: DragEventLike): void => {
    ev.preventDefault();
    try {
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    } catch {
      // ignore: the effect is cosmetic
    }
  };

  const onDrop = (ev: DragEventLike): void => {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    const files: ArrayLike<FileLike> = dt?.files ?? [];
    const items = dt?.items;
    const kinds: string[] = [];
    let firstIsDirectory = false;
    if (items) {
      for (let i = 0; i < items.length; i++) kinds.push(items[i]!.kind);
      try {
        const entry = items.length > 0 ? items[0]!.webkitGetAsEntry?.() : null;
        firstIsDirectory = entry?.isDirectory === true;
      } catch {
        firstIsDirectory = false;
      }
    }
    handleList(files, firstIsDirectory, kinds);
  };

  const onPickerClick = (): void => {
    input.click();
  };

  const onInputChange = (): void => {
    const files: ArrayLike<FileLike> = (input.files as ArrayLike<FileLike> | null) ?? [];
    try {
      handleList(files, false, []);
    } finally {
      input.value = ''; // the same file can be chosen again
    }
  };

  const target = (): ListenTarget => deps.target ?? (document as unknown as ListenTarget);

  return {
    attach(): void {
      if (attached) return;
      attached = true;
      const t = target();
      t.addEventListener('dragenter', onDragEnterOver as Listener);
      t.addEventListener('dragover', onDragEnterOver as Listener);
      t.addEventListener('drop', onDrop as Listener);
      picker.addEventListener('click', onPickerClick);
      input.addEventListener('change', onInputChange);
    },
    detach(): void {
      if (!attached) return;
      attached = false;
      const t = target();
      t.removeEventListener('dragenter', onDragEnterOver as Listener);
      t.removeEventListener('dragover', onDragEnterOver as Listener);
      t.removeEventListener('drop', onDrop as Listener);
      picker.removeEventListener('click', onPickerClick);
      input.removeEventListener('change', onInputChange);
    },
    intakeBytes,
  };
}
