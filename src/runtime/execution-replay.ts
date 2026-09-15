/**
 * Remembers spent one-time values, so presenting one twice fails.
 *
 * Used for anything whose signature stays valid longer than its intended single use:
 * an execution assertion's jti, and a tenant binding's nonce. Authenticity is decided
 * by the verifier; this store is what turns "authentic" into "authentic and not yet
 * used", which is the part a captured header cannot satisfy.
 *
 * The retention must cover the full window in which the credential still verifies —
 * forgetting sooner would let a replay succeed simply by waiting.
 *
 * Deliberately timer-free: a sweeper would keep the event loop alive. Entries expire
 * lazily, from the front, which is sound because every entry shares one TTL and so
 * insertion order is expiry order.
 *
 * SCOPE, and the reason this matters: the set lives in one process. Single use is
 * therefore single use *per instance* — behind N instances a captured credential is
 * good for up to N presentations rather than one, because each process starts out
 * never having seen it. That is a large reduction from "replayable for the whole
 * window" and not the same as closing it. Closing it needs the spent set to be shared
 * (Redis or equivalent); until then, run this service as a single instance if the
 * guarantee has to be exact, and treat instance count as a security parameter.
 */

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Complexity: `claim` is amortised O(1). Each entry is walked exactly once, on the
 * call that expires it, so the scan cost is spread across the entries that caused it
 * rather than paid per request. Memory is O(maxEntries).
 *
 * The ceiling is a liveness guard, not a security one: past it the oldest entry is
 * dropped while still unexpired, which would let that one value be replayed. Size it
 * above the busiest expected window rather than relying on eviction.
 */
export class ExecutionReplayStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS, private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  /** True when this value had not been spent, and is now. False on a repeat. */
  claim(key: string, now = Date.now()): boolean {
    this.evictExpired(now);

    const expiresAt = this.entries.get(key);
    if (expiresAt !== undefined) {
      if (expiresAt > now) return false;
      this.entries.delete(key);
    }

    if (this.entries.size >= this.maxEntries) this.evictOldest();
    this.entries.set(key, now + this.ttlMs);
    return true;
  }

  /** Entries share one TTL, so the first still-live entry ends the scan. */
  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt > now) return;
      this.entries.delete(key);
    }
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (oldest.done !== true) this.entries.delete(oldest.value);
  }

  /** Test and diagnostic surface; carries no tenant data. */
  size(): number {
    return this.entries.size;
  }
}
