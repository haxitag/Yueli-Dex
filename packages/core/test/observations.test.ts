import { describe, it, expect } from "vitest";
import { createObservationStore } from "../src/observations.js";

describe("observation store", () => {
  it("starts empty", () => {
    const store = createObservationStore();
    expect(store.snapshot("p1").sampleCount).toBe(0);
    expect(store.snapshot("p1").p95Ms).toBeUndefined();
  });

  it("records a sample and exposes snapshot fields", () => {
    const store = createObservationStore();
    store.record("p1", { ok: true, latencyMs: 100, at: Date.now() });
    const snap = store.snapshot("p1");
    expect(snap.sampleCount).toBe(1);
    expect(snap.p95Ms).toBe(100);
    expect(snap.avgLatencyMs).toBe(100);
    expect(snap.errorRate).toBe(0);
  });

  it("computes errorRate across the window", () => {
    const store = createObservationStore(10);
    store.record("p1", { ok: true, latencyMs: 50, at: Date.now() });
    store.record("p1", { ok: false, latencyMs: 50, at: Date.now() });
    store.record("p1", { ok: false, latencyMs: 100, at: Date.now() });
    const snap = store.snapshot("p1");
    expect(snap.sampleCount).toBe(3);
    expect(snap.errorRate).toBeCloseTo(2 / 3, 2);
  });

  it("computes p95 as the 95th percentile of latency", () => {
    const store = createObservationStore(20);
    for (let i = 1; i <= 20; i++) {
      store.record("p1", { ok: true, latencyMs: i, at: Date.now() });
    }
    const snap = store.snapshot("p1");
    expect(snap.sampleCount).toBe(20);
    expect(snap.p95Ms).toBe(19);
  });

  it("drops oldest samples when capacity exceeded (sliding window)", () => {
    const store = createObservationStore(2);
    store.record("p1", { ok: true, latencyMs: 1, at: Date.now() });
    store.record("p1", { ok: true, latencyMs: 2, at: Date.now() });
    store.record("p1", { ok: true, latencyMs: 3, at: Date.now() });
    expect(store.snapshot("p1").sampleCount).toBe(2);
    expect(store.snapshot("p1").p95Ms).toBe(3);
  });

  it("isolates providers", () => {
    const store = createObservationStore();
    store.record("p1", { ok: false, latencyMs: 100, at: Date.now() });
    store.record("p2", { ok: true, latencyMs: 50, at: Date.now() });
    expect(store.snapshot("p1").errorRate).toBe(1);
    expect(store.snapshot("p2").errorRate).toBe(0);
  });

  it("reset clears all observations", () => {
    const store = createObservationStore();
    store.record("p1", { ok: true, latencyMs: 1, at: Date.now() });
    store.reset();
    expect(store.snapshot("p1").sampleCount).toBe(0);
  });

  it("rejects invalid capacity", () => {
    expect(() => createObservationStore(0)).toThrow(RangeError);
    expect(() => createObservationStore(-1)).toThrow(RangeError);
    expect(() => createObservationStore(1.5)).toThrow(RangeError);
  });
});