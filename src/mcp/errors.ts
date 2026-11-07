// Error_Catalogue: ten codes, each with one fixed message literal.
// Messages never hold a path, a name, a size, a system error or disk text.

export const ERROR_CODES = [
  'INVALID_ARGUMENTS',
  'PATH_REJECTED',
  'IMAGE_NOT_FOUND',
  'IMAGE_TOO_LARGE',
  'IMAGE_UNREADABLE',
  'GRAVE_NOT_FOUND',
  'GRAVE_NOT_READABLE',
  'NO_CONVERTER',
  'CONVERSION_FAILED',
  'EXHUME_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_ARGUMENTS: 'The tool arguments are missing, malformed or not allowed.',
  PATH_REJECTED:
    'The image path is not allowed. It must be a regular file inside the workspace, with no symbolic links.',
  IMAGE_NOT_FOUND: 'No image file exists at that path inside the workspace.',
  IMAGE_TOO_LARGE: 'The image file is larger than the 2.88 MB floppy limit.',
  IMAGE_UNREADABLE: 'The image file could not be read.',
  GRAVE_NOT_FOUND: 'No grave on this disk matches that path and id.',
  GRAVE_NOT_READABLE:
    'This grave cannot be read. It is a directory, it is lost, or its data is unreadable.',
  NO_CONVERTER:
    'No converter matches this file. Supported formats are WordStar, dBase III, PCX and plain text.',
  CONVERSION_FAILED: 'The file was recognised but could not be converted.',
  EXHUME_FAILED: 'The converted file could not be written to the exhumed folder.',
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };
