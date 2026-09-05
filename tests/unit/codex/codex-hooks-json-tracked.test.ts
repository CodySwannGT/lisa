/**
 * `.codex/hooks.json` is a host-owned file, so this repository commits its own.
 *
 * `lisa apply` writes `.codex/hooks.json` into every host it touches, and Lisa
 * is a host of itself. The file was neither tracked nor ignored, which is the
 * one shape that makes `git add -A` after an apply sweep a generated artifact
 * into an unrelated commit — observed on #3700, where it landed and had to be
 * removed in two separate amends.
 *
 * The tempting fix is to add it to `.gitignore` beside the six `.codex/`
 * entries already there. That is wrong, and the fence says so in its own words
 * — `.gitignore` carries, immediately above those six:
 *
 *     # Lisa-generated project Codex overlay. Keep host-owned config.toml and
 *     # hooks.json visible so projects can commit their own merged configuration.
 *
 * `hooks.json` is a tagged-merge file (`src/codex/hooks-merger.ts`): Lisa merges
 * its own `_lisaManaged` entries into whatever hooks the host already declares,
 * and the host is meant to commit the result. Ignoring it would strand real host
 * hook configuration — exactly the reason `.codex/config.toml` is tracked rather
 * than ignored. So the fix is the same one that settled `config.toml`: track it.
 *
 * Tracking is only safe because the writer is deterministic — a file that
 * differed per checkout would leave every lane with a permanently dirty tracked
 * file, which is strictly worse than an untracked one. The second test pins that
 * determinism, so an edit to the hook spec that forgets to update the committed
 * file fails here instead of dirtying the next lane's tree.
 * @module tests/unit/codex/codex-hooks-json-tracked
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { installCodexEnforcementFallback } from "../../../src/codex/enforcement-fallback-installer.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = resolveGit();
const HOOKS_PATH = path.join(".codex", "hooks.json");

describe("the repository's own .codex/hooks.json", () => {
  it("is tracked by git, so an apply cannot smuggle it into an unrelated commit", () => {
    const tracked = boundedExecFileSync({
      label: "git ls-files .codex/hooks.json",
      command: GIT_BIN,
      args: ["ls-files", "--", HOOKS_PATH],
      cwd: REPO_ROOT,
    }).trim();

    expect(tracked).toBe(HOOKS_PATH);
  });

  it("holds exactly the bytes the enforcement-fallback installer writes", async () => {
    const committed = readFileSync(path.join(REPO_ROOT, HOOKS_PATH), "utf8");

    const scratch = mkdtempSync(path.join(tmpdir(), "lisa-codex-hooks-"));
    try {
      await installCodexEnforcementFallback(scratch);
      const written = readFileSync(path.join(scratch, HOOKS_PATH), "utf8");
      expect(committed).toBe(written);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
