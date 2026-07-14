export interface IncrementalTarget {
  platform?: unknown;
  url: string;
  title?: unknown;
}

export interface IncrementalSelection<T extends IncrementalTarget> {
  targets: T[];
  scannedCount: number;
  knownCount: number;
  consecutiveKnown: number;
  stopReason: "known_streak" | "scan_limit" | "source_exhausted";
}

export function selectIncrementalTargets<T extends IncrementalTarget>(
  targets: T[],
  options: { knownUrls: ReadonlySet<string>; maxItems?: number; stopAfterKnown?: number }
): IncrementalSelection<T> {
  const maxItems = Math.min(Math.max(Math.trunc(options.maxItems ?? 50), 1), 200);
  const stopAfterKnown = Math.min(Math.max(Math.trunc(options.stopAfterKnown ?? 10), 1), 50);
  const selected: T[] = [];
  let scannedCount = 0;
  let knownCount = 0;
  let consecutiveKnown = 0;

  for (const target of targets.slice(0, maxItems)) {
    scannedCount += 1;
    if (options.knownUrls.has(target.url)) {
      knownCount += 1;
      consecutiveKnown += 1;
      if (consecutiveKnown >= stopAfterKnown) {
        return {
          targets: selected,
          scannedCount,
          knownCount,
          consecutiveKnown,
          stopReason: "known_streak"
        };
      }
      continue;
    }

    consecutiveKnown = 0;
    selected.push(target);
  }

  return {
    targets: selected,
    scannedCount,
    knownCount,
    consecutiveKnown,
    stopReason: targets.length > maxItems ? "scan_limit" : "source_exhausted"
  };
}
