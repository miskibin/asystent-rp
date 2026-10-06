// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/**
 * A cache for things whose *size* matters as much as their count. Highlighted
 * code is the case it exists for: 200 entries of a three-line snippet is
 * nothing, and 200 entries of a 4000-line file is a hundred megabytes of HTML
 * held for a transcript nobody is looking at any more. So both bounds are
 * enforced — the oldest entries leave until the new one fits under the entry
 * count *and* the byte budget — and an entry larger than the whole budget is
 * simply not stored rather than emptying the cache to make room for itself.
 *
 * Sizes are approximate on purpose: a caller passes what it can measure
 * cheaply (string length, a multiple of it), never a real heap measurement.
 */
type CacheEntry<T> = { value: T; approximateSize: number }

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private totalSize = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    // Re-inserting is what makes the Map's insertion order an LRU order.
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  has(key: string) {
    return this.cache.has(key)
  }

  set(key: string, value: T, approximateSize: number) {
    if (approximateSize > this.maxBytes) return
    const existing = this.cache.get(key)
    if (existing) {
      this.totalSize -= existing.approximateSize
      this.cache.delete(key)
    }
    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxEntries ||
        this.totalSize + approximateSize > this.maxBytes)
    ) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      const evicted = this.cache.get(oldest)
      if (evicted) this.totalSize -= evicted.approximateSize
      this.cache.delete(oldest)
    }
    this.cache.set(key, { value, approximateSize })
    this.totalSize += approximateSize
  }

  clear() {
    this.cache.clear()
    this.totalSize = 0
  }

  /** For tests and diagnostics — never a reason to reach into the map. */
  get size() {
    return this.cache.size
  }

  get bytes() {
    return this.totalSize
  }
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

/**
 * A 32-bit FNV-1a hash, for cache keys that would otherwise be the whole
 * document. Keying a highlight cache by the source text means every lookup
 * hashes a megabyte of string; keying it by `hash:length` compares two short
 * ones, and the length beside the hash is what makes a collision harmless in
 * practice.
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32 >>> 0
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0
  }
  return hash >>> 0
}
