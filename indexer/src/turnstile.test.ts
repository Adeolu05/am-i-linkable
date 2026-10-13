import { describe, expect, it } from "vitest";
import { classifyTx, isTransparentAddress, type RawTx } from "./turnstile";

const T1 = "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ";
const T2 = "t1coinUURxiHT5Qgt2WfGBwv476FXzijnRU";
const T3 = "t3Y1BG3MU9Ljvoj2URV85M5FavR5nL8mRBu";

function tx(effects: [string, bigint][]): RawTx {
  return {
    txid: "ab".repeat(32),
    blockHeight: 3_516_413,
    time: "2026-10-13T13:49:57.000Z",
    effects: effects.map(([address, effectZat]) => ({ address, effectZat })),
  };
}

describe("isTransparentAddress", () => {
  it("accepts t1/t3 and rejects pseudo-addresses", () => {
    expect(isTransparentAddress(T1)).toBe(true);
    expect(isTransparentAddress(T3)).toBe(true);
    expect(isTransparentAddress("ironwood-pool")).toBe(false);
    expect(isTransparentAddress("the-void")).toBe(false);
  });
});

describe("classifyTx", () => {
  it("extracts an unshield from Ironwood", () => {
    const r = classifyTx(tx([["ironwood-pool", -3_135_000n], [T1, 3_120_000n], ["the-void", 15_000n]]));
    expect(r.class).toBe("turnstile");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      pool: "ironwood",
      direction: "out",
      amountZat: "3135000",
      feeZat: "15000",
      transparentInputs: [],
      transparentOutputs: [{ address: T1, amountZat: "3120000" }],
    });
  });

  it("extracts a shield into Sapling with change, netting repeated addresses", () => {
    const r = classifyTx(
      tx([
        [T1, -60_000_000n],
        [T1, -40_000_000n],
        [T2, 9_990_000n],
        ["sapling-pool", 90_000_000n],
        ["the-void", 10_000n],
      ]),
    );
    expect(r.class).toBe("turnstile");
    expect(r.events[0]).toMatchObject({
      pool: "sapling",
      direction: "in",
      amountZat: "90000000",
      transparentInputs: [{ address: T1, amountZat: "100000000" }],
      transparentOutputs: [{ address: T2, amountZat: "9990000" }],
    });
  });

  it("emits one event per pool when a transaction touches two pools", () => {
    const r = classifyTx(
      tx([["orchard-pool", -50_000n], ["sapling-pool", 20_000n], [T1, 20_000n], ["the-void", 10_000n]]),
    );
    expect(r.events.map((e) => [e.pool, e.direction, e.amountZat])).toEqual([
      ["sapling", "in", "20000"],
      ["orchard", "out", "50000"],
    ]);
  });

  it("skips coinbase even when it pays a pool", () => {
    const r = classifyTx(tx([["the-void", -156_410_000n], [T2, 125_160_000n], ["lockbox", 12_500_000n], ["ironwood-pool", 18_750_000n]]));
    expect(r.class).toBe("coinbase");
    expect(r.events).toEqual([]);
  });

  it("stores an Orchard -> Ironwood migration as its own event kind", () => {
    const r = classifyTx(tx([["orchard-pool", -1_000_000n], ["ironwood-pool", 985_000n], ["the-void", 15_000n]]));
    expect(r.class).toBe("pool-migration");
    expect(r.events).toEqual([]);
    expect(r.migration).toMatchObject({
      kind: "pool-migration",
      from: [{ pool: "orchard", amountZat: "1000000" }],
      to: [{ pool: "ironwood", amountZat: "985000" }],
      feeZat: "15000",
    });
  });

  it("classifies a fully shielded transfer inside one pool as shielded-internal", () => {
    const r = classifyTx(tx([["ironwood-pool", -15_000n], ["the-void", 15_000n]]));
    expect(r.class).toBe("shielded-internal");
    expect(r.migration).toBeUndefined();
  });

  it("flags dust at or below 0.001 ZEC", () => {
    const dust = classifyTx(tx([["ironwood-pool", -35_000n], [T1, 20_000n], ["the-void", 15_000n]]));
    expect(dust.events[0]).toMatchObject({ kind: "turnstile", isDust: true });
    const notDust = classifyTx(tx([["ironwood-pool", -200_015_000n], [T1, 200_000_000n], ["the-void", 15_000n]]));
    expect(notDust.events[0]!.isDust).toBe(false);
  });

  it("classifies a plain transparent transfer", () => {
    const r = classifyTx(tx([[T1, -1_010_000n], [T2, 1_000_000n], ["the-void", 10_000n]]));
    expect(r.class).toBe("transparent-only");
  });

  it("flags unknown pseudo-addresses instead of guessing", () => {
    const r = classifyTx(tx([["mystery-pool", 5n], [T1, -5n]]));
    expect(r.class).toBe("unknown");
    expect(r.unknownAddresses).toEqual(["mystery-pool"]);
  });
});
