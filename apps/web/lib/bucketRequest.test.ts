import { describe, expect, it } from "vitest";
import { parseBucketRequest } from "./bucketRequest";

describe("parseBucketRequest", () => {
  it("accepts exact bucket ids", () => {
    expect(parseBucketRequest("5", "0d", "")).toEqual({ ok: true, bits: 5, prefix: "0d", index: 13 });
    expect(parseBucketRequest("5", "1f", "")).toMatchObject({ ok: true, index: 31 });
    expect(parseBucketRequest("0", "0", "")).toMatchObject({ ok: true, index: 0 });
    expect(parseBucketRequest("12", "abc", "")).toMatchObject({ ok: true, index: 0xabc });
  });

  it("rejects everything else", () => {
    const bad: [string, string, string][] = [
      ["5", "0d", "?x=1"], // parameters
      ["05", "0d", ""], // leading zero
      ["-5", "0d", ""],
      ["5.0", "0d", ""],
      ["25", "0000000", ""], // too many bits
      ["5", "20", ""], // 32 >= 2^5
      ["5", "d", ""], // wrong length
      ["5", "00d", ""],
      ["5", "0D", ""], // uppercase
      ["5", "0g", ""],
      ["5", "../stats", ""],
      ["5", "0d%00", ""],
      ["", "", ""],
      ["0", "1", ""],
    ];
    for (const [b, p, q] of bad) expect(parseBucketRequest(b, p, q).ok, `${b}/${p}${q}`).toBe(false);
  });
});
