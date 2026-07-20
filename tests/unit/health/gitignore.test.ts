import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Health v1 local runtime state", () => {
  it("ships the exact latest-result gitignore entry", () => {
    const gitignore = readFileSync(
      path.resolve("all/copy-contents/gitignore"),
      "utf8"
    );
    expect(gitignore.split("\n")).toContain(".lisa/health/latest.json");
    expect(gitignore).not.toContain(".lisa/health/\n");
  });
});
