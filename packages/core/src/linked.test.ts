import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addressHash,
  addressVerdict,
  bucketIndex,
  bucketOfHash,
  checkAddress,
  computeLinkInfo,
  encodeBucket,
  explainEvent,
  findInBucket,
  fromBase64,
  roundGapMinutes,
  sha256,
  texFromT1,
  toBase64,
  toHex,
  utf8,
  type AddressEvent,
  type LinkEventInput,
} from "./index";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;

describe("sha256", () => {
  it("matches Node's crypto for many inputs, including multi-block ones", () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 200, 1000]) {
      const data = randomBytes(len);
      expect(toHex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
    expect(toHex(sha256(utf8("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches WebCrypto (what a browser would compute) for addresses", async () => {
    for (const a of ["t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ", "t3Y1BG3MU9Ljvoj2URV85M5FavR5nL8mRBu"]) {
      const web = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", utf8(a)));
      expect(toHex(addressHash(a))).toBe(toHex(web));
      expect(toHex(addressHash(a))).toBe(createHash("sha256").update(a, "utf8").digest("hex"));
    }
  });

  it("round-trips base64", () => {
    for (let i = 0; i < 20; i++) {
      const b = randomBytes(32);
      expect(toBase64(b)).toBe(b.toString("base64"));
      expect(Buffer.from(fromBase64(toBase64(b))).equals(b)).toBe(true);
    }
  });

  it("buckets a hash the same way as the hex helper", () => {
    const h = addressHash("t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ");
    for (const bits of [0, 1, 5, 12]) expect(bucketOfHash(h, bits)).toBe(bucketIndex(toHex(h), bits));
  });
});

describe("checkAddress", () => {
  it("accepts valid t1 and t3 addresses", () => {
    expect(checkAddress(" t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ ")).toEqual({ kind: "transparent", address: "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ", type: "p2pkh" });
    expect(checkAddress("t3Y1BG3MU9Ljvoj2URV85M5FavR5nL8mRBu")).toMatchObject({ kind: "transparent", type: "p2sh" });
  });

  it("rejects a typo via the checksum", () => {
    expect(checkAddress("t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnK")).toMatchObject({ kind: "invalid", message: expect.stringMatching(/checksum/) });
  });

  it("converts TEX to t1 locally (ZIP 320 test vector)", () => {
    expect(checkAddress("tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte")).toEqual({
      kind: "transparent",
      address: "t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC",
      type: "p2pkh",
      fromTex: "tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte",
    });
    expect(texFromT1("t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC")).toBe("tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte");
    expect(checkAddress("tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgtf").kind).toBe("invalid");
  });

  it("explains shielded, unified and testnet addresses instead of checking them", () => {
    expect(checkAddress("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly").kind).toBe("shielded");
    expect(checkAddress("u1qwerty0123456789").kind).toBe("unified");
    expect(checkAddress("tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU").kind).toBe("testnet");
    expect(checkAddress("hello").kind).toBe("invalid");
    expect(checkAddress("").kind).toBe("invalid");
  });
});

describe("computeLinkInfo", () => {
  const ev = (id: number, hoursAgo: number, amountZat: number, direction: "shield" | "unshield"): LinkEventInput => ({ id, time: NOW - hoursAgo * H, amountZat, direction });

  it("counts earlier matching deposits for a withdrawal, and later matching withdrawals for a deposit", () => {
    const events = [
      ev(1, 10, 500_015_000, "shield"), // unique deposit
      ev(2, 4, 500_000_000, "unshield"), // matches only deposit 1
      ...Array.from({ length: 12 }, (_, i) => ev(10 + i, 50 + i, 100_000_000, "shield")), // crowd
      ev(30, 5, 100_000_000, "unshield"), // blends into 12
      ev(31, 2, 600_000_000, "unshield"), // no match
    ];
    const info = computeLinkInfo(events, NOW);
    expect(info.get(2)).toEqual({ matches: 1, crowd: null, gapMs: 6 * H, lookDays: 29 });
    expect(info.get(1)).toEqual({ matches: 1, crowd: 1, gapMs: 6 * H, lookDays: 0 });
    expect(info.get(30)).toMatchObject({ matches: 12 });
    expect(info.get(10)).toMatchObject({ matches: 1, crowd: 12 });
    expect(info.get(31)).toMatchObject({ matches: 0, gapMs: null });
  });

  it("ignores deposits made after a withdrawal", () => {
    const info = computeLinkInfo([ev(1, 3, 200_000_000, "unshield"), ev(2, 1, 200_000_000, "shield")], NOW);
    expect(info.get(1)!.matches).toBe(0);
    expect(info.get(2)!.matches).toBe(0);
  });
});

describe("bucket files", () => {
  const event = (over: Partial<AddressEvent> = {}): AddressEvent => ({
    time: NOW - 5 * H,
    amountZat: 500_000_000,
    direction: "unshield",
    pool: "ironwood",
    txidPrefix: "abcdef012345",
    role: "output",
    info: { matches: 1, crowd: null, gapMs: 3 * H + 7 * 60_000, lookDays: 29 },
    ...over,
  });

  it("encodes and decodes an address's events", () => {
    const a = addressHash("t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ");
    const b = addressHash("t3Y1BG3MU9Ljvoj2URV85M5FavR5nL8mRBu");
    const p = encodeBucket(
      [
        { hash: a, events: [event()] },
        { hash: b, events: [event({ direction: "shield", role: "input", info: { matches: 2, crowd: 1, gapMs: 2 * DAY, lookDays: 3 } })] },
      ],
      { bits: 5, bucket: 13, generatedAt: new Date(NOW).toISOString(), tipHeight: 3_520_000, windowDays: 30 },
    );
    const back = JSON.parse(JSON.stringify(p));
    expect(findInBucket(back, a)).toEqual([
      { time: NOW - 5 * H, amountZat: 500_000_000, direction: "unshield", pool: "ironwood", txidPrefix: "abcdef012345", role: "output", matches: 1, crowd: null, gapMinutes: 180, lookDays: 29 },
    ]);
    expect(findInBucket(back, b)![0]).toMatchObject({ direction: "shield", crowd: 1, gapMinutes: 48 * 60 });
    expect(findInBucket(back, addressHash("t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC"))).toBeNull();
    expect(p.bucketCount).toBe(32);
  });

  it("publishes exactly the documented per-event fields, nothing about counterparties", () => {
    const p = encodeBucket([{ hash: addressHash("t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ"), events: [event()] }], {
      bits: 0,
      bucket: 0,
      generatedAt: "x",
      tipHeight: null,
      windowDays: 30,
    });
    expect(Object.keys(p).sort()).toEqual(["addresses", "baseTime", "bits", "bucket", "bucketCount", "generatedAt", "pools", "tipHeight", "v", "windowDays"]);
    const row = p.addresses[0]![1][0]!;
    expect(row).toHaveLength(10);
    // Every field is a number or the address's own 12-character txid prefix.
    expect(row.filter((x) => typeof x === "string")).toEqual(["abcdef012345"]);
  });

  it("rounds gaps coarsely", () => {
    expect(roundGapMinutes(2 * 60_000)).toBe(5);
    expect(roundGapMinutes(37 * 60_000)).toBe(35);
    expect(roundGapMinutes(3 * H + 29 * 60_000)).toBe(180);
    expect(roundGapMinutes(3 * H + 31 * 60_000)).toBe(240);
  });
});

describe("explanations", () => {
  const base = { time: NOW, amountZat: 1, pool: "sapling" as const, txidPrefix: "x", role: "output" as const, lookDays: 30 };
  it("uses 'may be linkable' wording and the checker's risk rule", () => {
    const w = explainEvent({ ...base, direction: "unshield", matches: 1, crowd: null, gapMinutes: 180 });
    expect(w.risk).toBe("high");
    expect(w.headline).toMatch(/may be linkable/);
    expect(w.headline + w.detail).not.toMatch(/is linked/);
    expect(explainEvent({ ...base, direction: "unshield", matches: 40, crowd: null, gapMinutes: 60 }).risk).toBe("low");
    expect(explainEvent({ ...base, direction: "shield", matches: 0, crowd: null, gapMinutes: null }).risk).toBe("low");
    expect(explainEvent({ ...base, direction: "shield", matches: 3, crowd: 1, gapMinutes: 120 }).risk).toBe("high");
    expect(explainEvent({ ...base, direction: "unshield", matches: 2, crowd: null, gapMinutes: 60, lookDays: 4 }).detail).toMatch(/only compare it with the 4 days/);
  });

  it("takes the worst event as the address verdict", () => {
    const ok = { ...base, direction: "unshield" as const, matches: 40, crowd: null, gapMinutes: 60 };
    const bad = { ...base, direction: "unshield" as const, matches: 1, crowd: null, gapMinutes: 60 };
    expect(addressVerdict([ok])).toBe("low");
    expect(addressVerdict([ok, bad])).toBe("high");
    expect(addressVerdict([])).toBe("low");
  });
});
