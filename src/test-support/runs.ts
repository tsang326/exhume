/**
 * Scales a base fast-check run count by FC_RUNS_MULTIPLIER (integer 1..100).
 * Any other value, or an unset variable, means a multiplier of 1.
 */
export function numRuns(base: number): number {
  const m = Number(process.env.FC_RUNS_MULTIPLIER);
  const multiplier = Number.isInteger(m) && m >= 1 && m <= 100 ? m : 1;
  return base * multiplier;
}
