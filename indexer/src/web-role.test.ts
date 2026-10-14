import { describe, expect, it } from "vitest";
import { readonlyUrl, upsertEnvLine } from "./web-role";

describe("upsertEnvLine", () => {
  it("appends to a file without the key and keeps other lines", () => {
    expect(upsertEnvLine("# note\nOTHER=1\n", "K", "v")).toBe("# note\nOTHER=1\nK=v\n");
    expect(upsertEnvLine("", "K", "v")).toBe("K=v\n");
  });
  it("replaces an existing value in place", () => {
    expect(upsertEnvLine("A=1\nK=old\nB=2\n", "K", "new")).toBe("A=1\nK=new\nB=2\n");
    expect(upsertEnvLine("A=1\r\nK=old\r\n", "K", "new")).toBe("A=1\nK=new\n");
  });
});

describe("readonlyUrl", () => {
  it("swaps in the web role's credentials and keeps host, database and options", () => {
    const u = new URL(readonlyUrl("postgresql://owner:ownerpw@ep-x-pooler.example.test/appdb?sslmode=require", "a-b_c"));
    expect(u.username).toBe("web_readonly");
    expect(decodeURIComponent(u.password)).toBe("a-b_c");
    expect(u.hostname).toBe("ep-x-pooler.example.test");
    expect(u.pathname).toBe("/appdb");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
});
