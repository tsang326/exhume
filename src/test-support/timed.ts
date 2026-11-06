/**
 * Time-budget helper for tests.
 *
 * CONTRACT: `timed` measures ONLY the closure passed to it. It reads
 * performance.now() immediately before calling `fn()` and immediately after
 * it returns. Callers MUST pass a closure containing nothing but the
 * readDisk / readGraveBytes (or openDisk / readBytes) call. Input generation,
 * image building with the writer, and fast-check shrinking all happen outside
 * the closure, so they are never timed and the check does not flake.
 *
 * If the elapsed time exceeds `budgetMs`, a plain Error with the elapsed
 * milliseconds is thrown.
 */
export function timed<T>(fn: () => T, budgetMs = 2000): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  if (elapsed > budgetMs) {
    throw new Error(
      `Time budget exceeded: ${elapsed.toFixed(1)} ms elapsed, budget ${budgetMs} ms`,
    );
  }
  return result;
}
