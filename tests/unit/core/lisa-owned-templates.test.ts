/**
 * Which managed files belong to Lisa rather than to the host project.
 *
 * The distinction decides whether a version bump may replace a file without
 * asking. Getting it wrong in one direction leaves security fixes undelivered;
 * getting it wrong in the other silently overwrites a project's build config.
 * These tests pin the line: a `lisa-` namespaced path segment means Lisa owns
 * the file, and nothing else does.
 * @module tests/unit/core/lisa-owned-templates
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { isLisaOwnedTemplate } from "../../../src/core/lisa-owned-templates.js";
import { listFilesRecursive } from "../../../src/utils/file-operations.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

describe("isLisaOwnedTemplate", () => {
  it("owns the enforcement guards", () => {
    expect(isLisaOwnedTemplate("scripts/lisa-hooks/block-no-verify.sh")).toBe(
      true
    );
    expect(isLisaOwnedTemplate("scripts/lisa-enforcement-fallback.sh")).toBe(
      true
    );
  });

  it("owns the other lisa-namespaced scripts Lisa's own skills invoke", () => {
    expect(isLisaOwnedTemplate("scripts/lisa-work-item.mjs")).toBe(true);
    expect(isLisaOwnedTemplate("scripts/lisa-command-envelope.mjs")).toBe(true);
    expect(isLisaOwnedTemplate("scripts/lisa-mutation.mjs")).toBe(true);
  });

  it("normalises Windows separators", () => {
    expect(isLisaOwnedTemplate("scripts\\lisa-hooks\\block-no-verify.sh")).toBe(
      true
    );
  });

  it("does not own files a project legitimately customises", () => {
    for (const hostOwned of [
      "tsconfig.json",
      "knip.json",
      "eslint.config.ts",
      ".prettierrc.json",
      "lefthook.yml",
      ".github/workflows/ci.yml",
      "scripts/check-threshold-ratchet.mjs",
      ".lisa.config.json",
      ".lisa/PROJECT_LEARNINGS.md",
    ]) {
      expect(isLisaOwnedTemplate(hostOwned), hostOwned).toBe(false);
    }
  });

  it("classifies every shipped guard as Lisa-owned", async () => {
    // Belt and braces against the guards moving: whatever is under a
    // `lisa-hooks` directory in the shipped templates must be covered, or a
    // future guard silently goes back to being undeliverable.
    const guardDir = path.join(
      REPO_ROOT,
      "all",
      "copy-overwrite",
      "scripts",
      "lisa-hooks"
    );
    expect(await fs.pathExists(guardDir)).toBe(true);
    const guards = await listFilesRecursive(guardDir);
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) {
      const relativePath = path
        .relative(path.join(REPO_ROOT, "all", "copy-overwrite"), guard)
        .split(path.sep)
        .join("/");
      expect(isLisaOwnedTemplate(relativePath), relativePath).toBe(true);
    }
  });
});
