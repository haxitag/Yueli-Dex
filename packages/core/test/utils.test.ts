import { describe, it, expect } from "vitest";
import { canonicalize, generateDecisionId, hashRequest } from "../src/utils.js";

describe("hashRequest", () => {
  it("is stable across top-level key order", () => {
    const a = { b: 2, a: 1 };
    const b = { a: 1, b: 2 };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("is stable across NESTED key order", () => {
    // P0-6 regression: the old implementation only sorted top-level keys.
    const a = { outer: { b: 2, a: 1, deep: { d: 4, c: 3 } } };
    const b = { outer: { a: 1, deep: { c: 3, d: 4 }, b: 2 } };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("preserves ARRAY order — [1,2] differs from [2,1]", () => {
    expect(hashRequest([1, 2])).not.toBe(hashRequest([2, 1]));
  });

  it("different values produce different hashes", () => {
    const set = new Set([
      hashRequest({ a: 1 }),
      hashRequest({ a: 2 }),
      hashRequest({ a: 1, b: 2 }),
      hashRequest({ a: 1, b: 3 }),
    ]);
    expect(set.size).toBe(4);
  });

  it("throws on non-JSON values (functions, BigInt)", () => {
    expect(() => hashRequest({ a: () => 1 })).toThrow(TypeError);
    expect(() => hashRequest({ a: 1n })).toThrow(TypeError);
  });

  it("drops undefined inside objects (JSON semantics)", () => {
    // undefined is silently dropped from objects, matching JSON.stringify.
    expect(hashRequest({ a: 1, b: undefined })).toBe(hashRequest({ a: 1 }));
  });

  it("returns a 32-char hex string", () => {
    expect(hashRequest({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("canonicalize", () => {
  it("returns primitives unchanged", () => {
    expect(canonicalize(null)).toBeNull();
    expect(canonicalize("s")).toBe("s");
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize(false)).toBe(false);
  });

  it("sorts nested object keys at every depth", () => {
    const input = { b: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] };
    const out = canonicalize(input) as { b: { d: number; c: number }; a: Array<{ x: number; y: number }> };
    expect(Object.keys(out.b)).toEqual(["c", "d"]);
    expect(Object.keys(out.a[0])).toEqual(["x", "y"]);
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });

  // Regression (runtime hardening): adversarially-deep input used to overflow
  // the call stack with an uncontrolled RangeError. It must now throw a
  // controlled TypeError at a bounded depth.
  it("throws a controlled TypeError on input deeper than the max depth", () => {
    const buildDeep = (depth: number): unknown => {
      let out: Record<string, unknown> = {};
      let cur = out;
      for (let i = 0; i < depth; i++) {
        const next: Record<string, unknown> = {};
        cur.a = next;
        cur = next;
      }
      return out;
    };
    expect(canonicalize(buildDeep(100) as never)).toBeDefined();
    expect(() => hashRequest(buildDeep(10_000))).toThrow(/maximum nesting depth/);
  });
});

describe("generateDecisionId", () => {
  it("starts with dex_ prefix", () => {
    expect(generateDecisionId()).toMatch(/^dex_/);
  });
  it("is unique", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateDecisionId()));
    expect(set.size).toBe(100);
  });
});