// Fixed modification times for the demo disks. Explicit values between 1988 and 1993,
// never the writer default of 1980-01-01. Seconds are even (DOS stores seconds / 2).
// Each constant has the string the Reader is expected to show for it.

import type { DosDateTime } from '../../test-support/fat12/index';

export interface FixedDate {
  modified: DosDateTime;
  /** `YYYY-MM-DDTHH:MM:SS`, the form the Reader reports. */
  expected: string;
}

function fixed(year: number, month: number, day: number, hour: number, minute: number, second: number): FixedDate {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return {
    modified: { year, month, day, hour, minute, second },
    expected: `${year}-${p2(month)}-${p2(day)}T${p2(hour)}:${p2(minute)}:${p2(second)}`,
  };
}

// Writer's disk
export const WRITERS_CHAPTER1 = fixed(1989, 3, 14, 21, 42, 10);
export const WRITERS_DRAFT1 = fixed(1989, 2, 27, 22, 5, 36);
export const WRITERS_CHAPTER2 = fixed(1989, 4, 2, 20, 18, 52);
export const WRITERS_DRAFT2 = fixed(1989, 3, 20, 23, 11, 4);
export const WRITERS_CHAPTER3 = fixed(1989, 5, 9, 19, 33, 28);
export const WRITERS_README = fixed(1989, 5, 10, 8, 0, 0);

// Small-business disk
export const OFFICE_CUSTOMER = fixed(1991, 6, 28, 16, 45, 20);
export const OFFICE_LOGO = fixed(1991, 2, 11, 10, 12, 44);
export const OFFICE_INVOICES_DIR = fixed(1991, 6, 3, 9, 30, 0);
export const OFFICE_INVOICE = fixed(1991, 6, 3, 9, 41, 16);
export const OFFICE_OLDCUST = fixed(1990, 11, 19, 14, 7, 8);
export const OFFICE_README = fixed(1991, 6, 30, 8, 0, 0);

// Damaged disk
export const DAMAGED_LETTER = fixed(1992, 9, 15, 13, 24, 40);
export const DAMAGED_MEMO = fixed(1992, 9, 16, 11, 2, 18);
export const DAMAGED_README = fixed(1992, 9, 17, 8, 0, 0);
