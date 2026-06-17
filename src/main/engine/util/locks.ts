/**
 * Keyed async mutex.
 *
 * Concurrency-safety requirement: git WRITES must be serialized per repo so two
 * operations never mutate the same repo's worktrees/branches at once. Callers
 * key by the normalized repo path; reads don't need to take the lock.
 *
 * Each key owns a promise chain. `withLock` appends its work to the chain and
 * returns a promise for that work's result. The chain advances regardless of
 * whether prior work succeeded or threw, so one failure can't wedge the key.
 */
const chains = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  // Run fn after prev settles (success OR failure) — note both handlers.
  const result = prev.then(fn, fn)
  // Keep the chain alive but swallow errors so they don't reject future links.
  chains.set(
    key,
    result.then(
      () => undefined,
      () => undefined
    )
  )
  return result
}
