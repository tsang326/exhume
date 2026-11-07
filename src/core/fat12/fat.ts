/** 12-bit FAT decoding, classification and FAT-copy comparison (Requirement 4). Warning-free. */

import type { ByteView } from './bytes';
import type { Layout } from './geometry';

export const FatClass = {
  Free: 'free',
  Reserved: 'reserved',
  Next: 'next',
  Bad: 'bad',
  End: 'end',
} as const;
export type FatClassName = (typeof FatClass)[keyof typeof FatClass];

/**
 * Decode the 12-bit entry for cluster `n` from the first FAT copy.
 * Returns undefined unless both bytes at floor(n*3/2) and +1 lie inside
 * [fatStart, fatStart + fatBytes) and inside the image. The caller adds the
 * `out-of-bounds-read` warning.
 */
export function readFatEntry(view: ByteView, layout: Layout, n: number): number | undefined {
  if (!Number.isSafeInteger(n) || n < 0) return undefined;
  const rel = Math.floor((n * 3) / 2);
  const lo = layout.fatStart + rel;
  const end = layout.fatStart + layout.fatBytes;
  if (!Number.isSafeInteger(lo) || lo < layout.fatStart || lo + 1 >= end) return undefined;
  const word = view.u16(lo); // undefined when outside the image
  if (word === undefined) return undefined;
  return n % 2 === 0 ? word & 0xfff : word >> 4;
}

/** Classify a 12-bit FAT value (Requirement 4.2). Out-of-range values (above 0xFFF) are treated as reserved. */
export function classifyFat(value: number): FatClassName {
  if (value === 0x000) return FatClass.Free;
  if (value === 0x001) return FatClass.Reserved;
  if (value <= 0xfef) return value >= 0x002 ? FatClass.Next : FatClass.Reserved;
  if (value <= 0xff6) return FatClass.Reserved;
  if (value === 0xff7) return FatClass.Bad;
  if (value <= 0xfff) return FatClass.End;
  return FatClass.Reserved;
}

/**
 * True when fatCount is 2 and the two FAT copies differ in at least one byte.
 * Choice for unreadable data: if any byte of either copy lies outside the image,
 * the copies are reported as differing (a truncated copy is not identical to the first).
 * The loop is bounded by fatBytes.
 */
export function fatCopiesDiffer(view: ByteView, layout: Layout): boolean {
  if (layout.fatCount !== 2) return false;
  const second = layout.fatStart + layout.fatBytes;
  for (let i = 0; i < layout.fatBytes; i++) {
    const a = view.u8(layout.fatStart + i);
    const b = view.u8(second + i);
    if (a === undefined || b === undefined || a !== b) return true;
  }
  return false;
}
