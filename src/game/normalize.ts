import { NAME_MAX_LENGTH } from './config.ts'

/** Trim + lowercase a name/key. Returns null if it is not a string or has an invalid length. Idempotent. */
export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  return name.length >= 1 && name.length <= NAME_MAX_LENGTH ? name : null
}

/** Round to 4 decimals and clamp to [0,1]. Non-finite values become 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, Math.round(n * 1e4) / 1e4))
}
