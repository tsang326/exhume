import { MAX_IMAGE_BYTES, MAX_TOTAL_ENTRIES, MAX_FILE_OUTPUT_BYTES } from '../../core/fat12/index';

export { MAX_IMAGE_BYTES, MAX_TOTAL_ENTRIES, MAX_FILE_OUTPUT_BYTES };

export const PAGE_SIZE = 200;
export const LABEL_CAP = 255;
export const MD_PREVIEW_CHARS = 1_000_000;
export const CSV_MAX_ROWS = 200;
export const CSV_MAX_COLS = 50;
export const HEX_PREVIEW_BYTES = 4096;
export const HEX_ROW_BYTES = 16;
export const OPEN_TIMEOUT_MS = 15_000;
export const EXHUME_TIMEOUT_MS = 30_000;
export const DEMO_TIMEOUT_MS = 10_000;
export const RISE_MS = 900; // must stay <= RISE_MAX_MS
export const RISE_MAX_MS = 1_200;
export const DOWNLOAD_REVOKE_MS = 500; // must stay <= 1000
export const FX_MAX_FPS = 30;
export const FX_MAX_SHAPES = 60; // must stay <= 200
export const FX_MAX_BACKING = { width: 1920, height: 1080 } as const;
export const FILE_NAME_MAX = 64;
