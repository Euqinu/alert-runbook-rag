/**
 * Reciprocal Rank Fusion (RRF): merge several ranked lists into one.
 *
 * Each list gives an item 1 / (constant + position) points (position starts at 1).
 * An item's total is the sum over the lists it appears in; higher total = better.
 * Only POSITIONS are used, never the lists' own scores, because a cosine distance and a
 * ts_rank are different units and one is "smaller is better", the other "bigger is better".
 *
 * Pure function: no database, no network, so it can be tested on plain numbers.
 */

export interface Fused<T> {
  item: T;
  /** Sum of 1 / (constant + position) over the lists the item appears in. */
  score: number;
  /** 1-based position in each input list, in the same order as the lists; null = not in that list. */
  ranks: (number | null)[];
}

export interface FuseOptions {
  /** The 60 in 1 / (60 + position). Larger = a gap between positions matters less. */
  constant?: number;
  /** Keep only the best `limit` items. Default: keep all. */
  limit?: number;
}

// Two totals closer than this count as a tie (guards against float rounding noise).
const TIE_EPSILON = 1e-12;

/**
 * `lists` are ranked best first. Ties on score are broken by position in the FIRST list, then
 * the second, and so on, so an earlier list wins. With vector search first, equal scores
 * resolve by meaning, not by an arbitrary row id. Last resort: the key, so the order is stable.
 */
export function fuseRRF<T>(
  lists: T[][],
  key: (item: T) => string,
  options: FuseOptions = {},
): Fused<T>[] {
  const constant = options.constant ?? 60;
  const byKey = new Map<string, Fused<T>>();

  lists.forEach((list, listIndex) => {
    const seenInThisList = new Set<string>();
    list.forEach((item, i) => {
      const k = key(item);
      // A duplicate inside one list would be counted twice; only its best position counts.
      if (seenInThisList.has(k)) return;
      seenInThisList.add(k);

      const position = i + 1;
      let entry = byKey.get(k);
      if (!entry) {
        entry = { item, score: 0, ranks: lists.map(() => null) };
        byKey.set(k, entry);
      }
      entry.score += 1 / (constant + position);
      entry.ranks[listIndex] = position;
    });
  });

  const fused = [...byKey.entries()]
    .sort(([keyA, a], [keyB, b]) => {
      if (Math.abs(a.score - b.score) > TIE_EPSILON) return b.score - a.score;
      for (let l = 0; l < lists.length; l++) {
        const ra = a.ranks[l] ?? Infinity;
        const rb = b.ranks[l] ?? Infinity;
        if (ra !== rb) return ra - rb;
      }
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    })
    .map(([, entry]) => entry);

  return options.limit === undefined ? fused : fused.slice(0, options.limit);
}
