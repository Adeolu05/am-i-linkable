import { describe, expect, it } from "vitest";
import { checkHref, readAmountHash } from "./amountHash";

describe("readAmountHash", () => {
  it("reads an amount", () => {
    expect(readAmountHash("#2.5")).toEqual({ kind: "amount", raw: "2.5" });
  });
  it("reads the two examples", () => {
    expect(readAmountHash("#risky")).toEqual({ kind: "example", which: "risky" });
    expect(readAmountHash("#common")).toEqual({ kind: "example", which: "common" });
  });
  it("ignores an empty fragment", () => {
    expect(readAmountHash("")).toBeNull();
    expect(readAmountHash("#")).toBeNull();
    expect(readAmountHash("#   ")).toBeNull();
  });
  it("passes garbage through as an amount, so the prompt can show the parse error", () => {
    expect(readAmountHash("#abc")).toEqual({ kind: "amount", raw: "abc" });
  });
  it("ignores malformed encoding and over-long fragments", () => {
    expect(readAmountHash("#%E0%A4%A")).toBeNull();
    expect(readAmountHash(`#${"9".repeat(41)}`)).toBeNull();
  });
  it("decodes an encoded comma", () => {
    expect(readAmountHash("#1%2C000.5")).toEqual({ kind: "amount", raw: "1,000.5" });
  });
});

describe("checkHref", () => {
  it("puts the value in the fragment only", () => {
    expect(checkHref(" 1,000.5 ")).toBe("/check#1%2C000.5");
    expect(checkHref("risky")).toBe("/check#risky");
  });
  it("round-trips through readAmountHash", () => {
    const href = checkHref("147.74714597");
    expect(readAmountHash(href.slice(href.indexOf("#")))).toEqual({ kind: "amount", raw: "147.74714597" });
  });
});
