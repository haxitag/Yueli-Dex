/**
 * Passive observation store for `ChoiceProvider`s.
 *
 * P1-4: every provider execute attempt (success or failure) records a sample.
 * The router uses `snapshot()` to compute penalties in `orderProviders()`.
 *
 * Design constraints:
 *  - In-process, lock-free, single-threaded (Node.js).
 *  - Sliding window of the last `capacity` samples per provider.
 *  - p95 latency is computed by sorting the window and picking the 95th
 *    percentile; cheap enough for `capacity` <= 512.
 *  - No active health probe (no scheduler, no setInterval). Active probing
 *    is out of scope for v0.2.
 */

export interface ObservationSample {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly at: number; // Date.now()
}

export interface ObservationSnapshot {
  readonly sampleCount: number;
  readonly errorRate?: number; // 0..1 when sampleCount > 0
  readonly p95Ms?: number; // when sampleCount > 0
  readonly avgLatencyMs?: number; // when sampleCount > 0
}

export interface ObservationStore {
  record(providerId: string, sample: ObservationSample): void;
  snapshot(providerId: string): ObservationSnapshot;
  /** Test helper — reset all observations. */
  reset(): void;
}

export function createObservationStore(capacity = 64): ObservationStore {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(
      `createObservationStore: capacity must be a positive integer, got ${capacity}`,
    );
  }
  const windows = new Map<string, ObservationSample[]>();

  function get(id: string): ObservationSample[] {
    let w = windows.get(id);
    if (!w) {
      w = [];
      windows.set(id, w);
    }
    return w;
  }

  return {
    record(id, sample) {
      const w = get(id);
      w.push(sample);
      if (w.length > capacity) {
        // Drop the oldest sample — sliding window by FIFO.
        w.shift();
      }
    },
    snapshot(id) {
      const w = get(id);
      if (w.length === 0) {
        return { sampleCount: 0 };
      }
      let errors = 0;
      let totalLatency = 0;
      for (const s of w) {
        if (!s.ok) errors += 1;
        totalLatency += s.latencyMs;
      }
      const sortedLatencies = w.map((s) => s.latencyMs).sort((a, b) => a - b);
      const p95Index = Math.max(0, Math.ceil(0.95 * sortedLatencies.length) - 1);
      return {
        sampleCount: w.length,
        errorRate: errors / w.length,
        p95Ms: sortedLatencies[p95Index],
        avgLatencyMs: totalLatency / w.length,
      };
    },
    reset() {
      windows.clear();
    },
  };
}