// Fixed explain_state texts. No disk text, no input is echoed.

import type { GraveState } from '../core/fat12/index';

export const STATE_TEXT: Readonly<Record<GraveState, string>> = {
  alive: 'The file is present in the directory and its data chain is intact. It was not deleted.',
  recovered:
    'The file was deleted, but its clusters were contiguous and unallocated, so its data was read back in full. FAT12 stores no checksum, so this is an honest best effort.',
  partial:
    'The file was deleted and part of its data is missing: some of its clusters are in use by another file, run past the disk, or the chain is broken. The content may be incomplete or wrong.',
  lost: 'The file was deleted and its data cannot be read: its clusters are in use, out of range or unreadable. Only the name, size and date remain, and the data may be gone.',
};
