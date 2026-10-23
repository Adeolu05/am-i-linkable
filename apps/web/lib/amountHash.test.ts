import { describe, expect, it } from "vitest";
import { exampleHref, handOverAmount, readAmountHash, takeHandedAmount } from "./amountHash";

describe("readAmountHash", () => {
  it("reads the two examples", () => {
    expect(readAmountHash("#risky")).toEqual({ kind: "example", which: "risky" });
    expect(readAmountHash("#common")).toEqual({ kind: "example", which: "common" });
  });
  it("never reads an amount from a URL", () => {
    expect(readAmountHash("#2.5")).toBeNull();
    expect(readAmountHash("#1%2C000.5")).toBeNull();
    expect(readAmountHash("#abc")).toBeNull();
  });
  it("ignores an empty fragment", () => {
    expect(readAmountHash("")).toBeNull();
    expect(readAmountHash("#")).toBeNull();
  });
});

describe("exampleHref", () => {
  it("names only the example", () => {
    expect(exampleHref("risky")).toBe("/check#risky");
    expect(exampleHref("common")).toBe("/check#common");
  });
});

describe("in-memory hand-over", () => {
  it("gives the amount once, trimmed, then nothing", () => {
    expect(takeHandedAmount()).toBeNull();
    handOverAmount(" 147.74714597 ");
    expect(takeHandedAmount()).toBe("147.74714597");
    expect(takeHandedAmount()).toBeNull();
  });
});
