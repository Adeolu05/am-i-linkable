import { afterEach, describe, expect, it } from "vitest";
import { describeError, redact } from "./env";

const FAKE_URL = "postgresql://app_owner:pw-not-real-123@ep-quiet-sky-a1b2c3-pooler.example.test/appdb?sslmode=require";
const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("redact", () => {
  it("removes connection strings and every identifying part of them", () => {
    process.env.DATABASE_URL = FAKE_URL;
    const out = redact(
      `connect failed for ${FAKE_URL}; getaddrinfo ENOTFOUND ep-quiet-sky-a1b2c3-pooler.example.test; endpoint ep-quiet-sky-a1b2c3; user app_owner`,
    );
    expect(out).not.toMatch(/pw-not-real|ep-quiet-sky|example\.test|app_owner/);
    expect(out).toContain("[redacted]");
  });

  it("removes API keys and any postgres URL, even unknown ones", () => {
    process.env.THREEXPL_API_KEY = "fakefakefakefake";
    expect(redact("bad token fakefakefakefake")).toBe("bad token [redacted]");
    expect(redact("x postgres://u:p@h/db y")).toBe("x postgres://[redacted] y");
  });

  it("describeError gives one line with the code but no secrets", () => {
    process.env.DATABASE_URL = FAKE_URL;
    const err = Object.assign(new Error(`timeout\nconnecting to ep-quiet-sky-a1b2c3-pooler.example.test`), { code: "ETIMEDOUT" });
    const line = describeError(err);
    expect(line).not.toMatch(/\n|ep-quiet-sky|example\.test/);
    expect(line).toMatch(/\[ETIMEDOUT\]$/);
  });
});
