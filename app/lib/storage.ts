// ─── Per-track best score storage ────────────────────────────────────────────
// Key format: "sanshin-best-{trackId}"
// Scores are always stored as 0-100 (100-point scale).

export interface BestRecord {
  score: number;    // 0-100
  combo: number;
  perfects: number;
  goods: number;
  misses: number;
}

const MAX_RAW = 120; // 12 notes × 10 pts — used to normalise legacy scores

function key(trackId: string): string {
  return `sanshin-best-${trackId}`;
}

function normalizeScore(score: number): number {
  if (score <= 100) return score;
  return Math.min(100, Math.round((score / MAX_RAW) * 100));
}

export function getBest(trackId: string): BestRecord | null {
  if (typeof window === "undefined") return null;
  try {
    // Also check legacy key (no trackId) for first-time migration
    const raw =
      localStorage.getItem(key(trackId)) ??
      (trackId === "basic-notes" ? localStorage.getItem("sanshin-best") : null);
    if (!raw) return null;
    const rec = JSON.parse(raw) as BestRecord;
    return { ...rec, score: normalizeScore(rec.score) };
  } catch {
    return null;
  }
}

export function saveBest(trackId: string, record: BestRecord): void {
  if (typeof window === "undefined") return;
  const prev = getBest(trackId);
  if (!prev || record.score > prev.score) {
    localStorage.setItem(key(trackId), JSON.stringify(record));
  }
}
