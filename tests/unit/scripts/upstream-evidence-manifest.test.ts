/** Determinism and scope contract for the upstream evidence manifest. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  UPSTREAM_EVIDENCE_MANIFEST,
  UPSTREAM_PUBLIC_COMMITS,
  UPSTREAM_SURFACE_MANIFEST,
} from "../../../src/core/upstream-evidence-manifest.js";

describe("upstream evidence manifest", () => {
  it("is deterministically synchronized with tracked public sources", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/generate-upstream-evidence-manifest.mjs", "--check"],
        { cwd: path.resolve("."), stdio: "pipe" }
      )
    ).not.toThrow();
  });

  it("hash-pins canonical sources and excludes local or generated mirrors", () => {
    const canonical = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";
    const digest = createHash("sha256")
      .update(readFileSync(path.resolve(canonical)))
      .digest("hex");

    expect(UPSTREAM_EVIDENCE_MANIFEST[canonical]).toBe(digest);
    expect(
      UPSTREAM_SURFACE_MANIFEST["src/core/upstream-attribution-body.ts"]
    ).toBe(true);
    expect(
      UPSTREAM_EVIDENCE_MANIFEST["src/core/upstream-attribution-body.ts"]
    ).toBeUndefined();
    expect(UPSTREAM_EVIDENCE_MANIFEST["scripts/build-plugins.sh"]).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(
      UPSTREAM_EVIDENCE_MANIFEST[
        "scripts/generate-upstream-evidence-manifest.mjs"
      ]
    ).toMatch(/^[a-f0-9]{64}$/);
    for (const forbidden of [
      ".git/config",
      ".lisa.config.json",
      ".mcp.json",
      "audit.local",
      "plugins/lisa/skills/lisa-persist-learning/SKILL.md",
      "src/core/upstream-evidence-manifest.ts",
    ]) {
      expect(UPSTREAM_EVIDENCE_MANIFEST[forbidden]).toBeUndefined();
    }
  });

  it("freezes exact public-origin full-SHA membership", () => {
    const current = "90549e6dae19aa5e53b86908d5050d303b724f55";
    const arbitrary = "0".repeat(40);
    expect(Object.hasOwn(UPSTREAM_PUBLIC_COMMITS, current)).toBe(true);
    expect(Object.hasOwn(UPSTREAM_PUBLIC_COMMITS, arbitrary)).toBe(false);
    expect(Object.isFrozen(UPSTREAM_PUBLIC_COMMITS)).toBe(true);
    expect(Reflect.set(UPSTREAM_PUBLIC_COMMITS, arbitrary, true)).toBe(false);
    expect(Object.hasOwn(UPSTREAM_PUBLIC_COMMITS, arbitrary)).toBe(false);
    expect(
      Object.keys(UPSTREAM_PUBLIC_COMMITS).every(sha =>
        /^[a-f0-9]{40}$/.test(sha)
      )
    ).toBe(true);
  });
});
