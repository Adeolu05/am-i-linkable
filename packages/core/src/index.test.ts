import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index";

describe("core", () => {
  it("exports a version string", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });
});
