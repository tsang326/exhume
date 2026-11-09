import { createHash } from 'node:crypto';

/** Test-only: lowercase hex SHA-256 of the given bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
