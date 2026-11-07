/** Every numeric limit used by the FAT12 core. No other module defines these values. */

/** 2.88 MB maximum image size. */
export const MAX_IMAGE_BYTES = 2_949_120;
/** Smallest image that can hold a boot sector. */
export const MIN_IMAGE_BYTES = 512;
/** Maximum path components. */
export const MAX_DIR_DEPTH = 16;
/** Maximum directory records read in one scan. */
export const MAX_TOTAL_ENTRIES = 4_096;
/** 4 MB cap on a single recovered file. */
export const MAX_FILE_OUTPUT_BYTES = 4_194_304;
/** Maximum long name length in UTF-16 code units. */
export const MAX_NAME_UTF16 = 255;
/** ceil(255 / 13) long-name entries. */
export const MAX_LFN_ENTRIES = 20;
/** Maximum characters in a grave reason. */
export const MAX_REASON_CHARS = 200;
/** 4085 or more data clusters is not FAT12. */
export const FAT12_MAX_DATA_CLUSTERS = 4_084;
/** Bytes in one directory entry. */
export const DIR_ENTRY_BYTES = 32;
/** Scan time budget, asserted by tests only. */
export const SCAN_TIME_BUDGET_MS = 2_000;
