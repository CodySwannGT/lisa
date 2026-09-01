/**
 * `--skip-git-check` no longer selects the apply mode (CodySwannGT/lisa#3066).
 *
 * ## The defect
 *
 * One flag carried two unrelated propositions:
 *
 * 1. *"do not require a clean working tree"* — what its name says, and what
 *    every automated caller legitimately needs, because it has just run an
 *    install and `package.json` plus the lockfile are dirty by construction;
 * 2. *"run the reduced `postinstall-safe` subset"* — what it silently also
 *    did, skipping every agent emit (Codex, Claude, agy, Copilot, OpenCode)
 *    and the Sonar integration.
 *
 * Asking for (1) opted a caller into (2) with no way to decline, and nothing
 * in the flag's name suggested it would. Measured consequence: three consumer
 * repositories carried doctor's *"Legacy pre-2.198 Codex overlay present"*
 * finding across every update for months; dropping the flag removed 478, 322
 * and 660 stale files, every one under `.codex/`.
 *
 * ## What separates them
 *
 * The two propositions are scoped to different things. The clean-tree waiver
 * is a property of the INVOCATION — the caller knows its own tree. The reduced
 * subset is a property of the CONTEXT — whether this apply is running inside a
 * package manager's install lifecycle, where regenerating large committed
 * agent trees would be a surprise side effect of `bun install`.
 *
 * So the mode is now keyed off an explicit declaration of that context, which
 * every Lisa-written postinstall invocation carries, and the git flag decides
 * only the git check.
 *
 * ## Why the context is DECLARED and not detected
 *
 * Lisa already has an ambient detector — `isRunningAsLifecycleScript()`, which
 * reads `npm_package_json`. It is not usable here, and the reason is measured
 * rather than assumed:
 *
 * - `npm install` postinstall sets `npm_lifecycle_event=postinstall`.
 * - `bun install` postinstall sets NEITHER `npm_lifecycle_event` nor
 *   `npm_command`, while still running the script. It does set
 *   `npm_config_user_agent` and `npm_package_json`.
 * - Every one of those leaks into descendants of ANY `bun run` / `npm run`,
 *   including the shell an operator or an agent runs an apply from.
 *
 * A detector that over-fires would keep handing the reduced subset to the very
 * callers this fixes, and would do it silently — the defect restated. A
 * declaration cannot over-fire: only Lisa's own postinstall invocations carry
 * it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/core/skip-git-check-decoupling
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPostinstallSafeApply,
  resolveApplyMode,
} from "../../../src/core/apply-mode.js";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  EnsureLisaPostinstallMigration,
  LISA_INVOCATION,
} from "../../../src/migrations/ensure-lisa-postinstall.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The reduced subset a package-manager install runs. */
const REDUCED = "postinstall-safe";

/** The complete apply, including every agent emit and the Sonar integration. */
const FULL = "full";

/** The declaration a Lisa-written postinstall invocation carries. */
const POSTINSTALL_MARKER = "LISA_POSTINSTALL=1";

/**
 * The exact hook text sitting in consumer `package.json` files today, written
 * verbatim rather than derived from the module under test.
 *
 * Deriving it would make the compatibility assertion vacuous: the recogniser
 * would be checked against whatever it currently emits, which is the one input
 * it can never fail on.
 */
const LEGACY_HOOK =
  '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true';

describe("apply mode is decided by the postinstall declaration, not --skip-git-check", () => {
  it("runs the FULL apply when only the git check is waived", () => {
    // THE BITE, and the negative control the fix is judged by: a caller that
    // wants nothing but the clean-tree waiver must get the complete apply.
    // Before this change the combination was unreachable — every
    // `--skip-git-check` apply was reduced, with no way to decline — which is
    // precisely what made the documented fleet-update procedure perform none
    // of the agent-emit work, on any project, at any version.
    const waiverOnly = { skipGitCheck: true };

    expect(resolveApplyMode(waiverOnly)).toBe(FULL);
    expect(isPostinstallSafeApply(waiverOnly)).toBe(false);
  });

  it("runs exactly the reduced subset when a postinstall is declared", () => {
    // The opposing control. The fix must not be satisfiable by making
    // everything full: a full apply under `bun install` regenerates agent
    // trees, which is the failure the reduced mode exists to prevent, and it
    // must stay prevented.
    const declaredPostinstall = { skipGitCheck: false, postinstall: true };

    expect(resolveApplyMode(declaredPostinstall)).toBe(REDUCED);
    expect(isPostinstallSafeApply(declaredPostinstall)).toBe(true);
  });

  it("keeps the postinstall hook's own invocation reduced, byte for byte", () => {
    // The hook waives the git check AND declares its context. This is the
    // combination every Lisa-written postinstall passes, and its resolved mode
    // must be identical to what it was before the decoupling.
    expect(resolveApplyMode({ skipGitCheck: true, postinstall: true })).toBe(
      REDUCED
    );
  });

  it("resolves a plain operator apply as full", () => {
    expect(resolveApplyMode({ skipGitCheck: false })).toBe(FULL);
  });

  it("lets --full-apply override even a declared postinstall", () => {
    // The explicit request always wins, so an operator can force the complete
    // apply from inside a lifecycle script when they mean to.
    expect(
      resolveApplyMode({
        skipGitCheck: true,
        postinstall: true,
        fullApply: true,
      })
    ).toBe(FULL);
  });

  it("agrees with itself across both entry points", () => {
    // The reason this module exists at all: the behaviour half (agent emits,
    // package.json protection) and the receipt half read ONE decision. They
    // used to be independent expressions of the same fact in files that never
    // referenced each other, so a receipt could describe work the run did not
    // do — and `doctor` reads that receipt to decide whether a repo still
    // needs a full apply.
    const cases = [
      { skipGitCheck: true },
      { skipGitCheck: false },
      { skipGitCheck: true, postinstall: true },
      { skipGitCheck: false, postinstall: true },
      { skipGitCheck: true, postinstall: true, fullApply: true },
      { skipGitCheck: true, fullApply: true },
    ] as const;

    for (const config of cases) {
      expect(isPostinstallSafeApply(config)).toBe(
        resolveApplyMode(config) === REDUCED
      );
    }
  });
});

describe("the postinstall hook Lisa writes", () => {
  it("declares its own postinstall context", () => {
    // THE BITE on the migration side. Without this the hook stops selecting
    // the reduced subset the moment the flag stops selecting it, and every
    // `bun install` in the fleet starts regenerating agent trees.
    expect(LISA_INVOCATION).toContain(POSTINSTALL_MARKER);
  });

  it("still waives the git check, which it needs for an honest reason", () => {
    // The install it runs inside has already modified package.json and the
    // lockfile, so the tree is dirty by construction. Losing this would abort
    // every postinstall apply in the fleet.
    expect(LISA_INVOCATION).toContain("--skip-git-check");
  });

  it("resolves to the reduced subset it resolved to before", () => {
    // Reads the shipped hook text and puts its declaration through the real
    // decision, rather than asserting on a string and hoping the two agree.
    expect(
      resolveApplyMode({
        skipGitCheck: LISA_INVOCATION.includes("--skip-git-check"),
        postinstall: LISA_INVOCATION.includes(POSTINSTALL_MARKER),
      })
    ).toBe(REDUCED);
  });
});

describe("EnsureLisaPostinstallMigration recognises both hook shapes", () => {
  let migration: EnsureLisaPostinstallMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureLisaPostinstallMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for the temp project.
   * @param detectedTypes - Detected project types.
   * @returns A context the migration accepts.
   */
  function createContext(
    detectedTypes: readonly ProjectType[] = ["typescript"]
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun: false,
      logger: new SilentLogger(),
    };
  }

  /**
   * Run the migration over a project whose postinstall is `existing`.
   * @param existing - The postinstall script already in package.json.
   * @returns The postinstall script the migration left behind.
   */
  async function migratePostinstall(existing: string): Promise<string> {
    const manifest = path.join(projectDir, "package.json");
    await fs.writeJson(manifest, { scripts: { postinstall: existing } });
    await migration.apply(createContext());
    const after = (await fs.readJson(manifest)) as {
      scripts?: { postinstall?: string };
    };
    return after.scripts?.postinstall ?? "";
  }

  /**
   * The tail that only survives when the recogniser FAILED to match.
   *
   * A miss does not error — `composePostinstall` concludes there is no Lisa
   * invocation and chains a second one in front of the old text, leaving the
   * pre-#2467 `2>/dev/null || true` tail behind. Its presence is therefore the
   * direct evidence of an unrecognised hook.
   */
  const UNRECOGNISED_TAIL = "2>/dev/null || true";

  it("replaces the legacy marker-less hook in place, never chaining a second apply", async () => {
    // The #3050 hazard in its sharpest form. `LISA_INVOCATION_RE` matches by
    // exact text, that text lives in every consumer's package.json, and a miss
    // does not fail — it APPENDS a second invocation. Every instrument reads
    // normal while the project runs two applies per install.
    const after = await migratePostinstall(LEGACY_HOOK);

    expect(after).toBe(LISA_INVOCATION);
    expect(after).not.toContain(UNRECOGNISED_TAIL);
  });

  it("recognises the new marker-carrying hook on a re-apply", async () => {
    // The other half of "accept both shapes indefinitely". There is no cutover
    // date: a project that never re-applies keeps the old text forever, and a
    // project that has re-applied must not accumulate a third copy.
    const after = await migratePostinstall(LISA_INVOCATION);

    expect(after).toBe(LISA_INVOCATION);
  });

  it("preserves a project's own postinstall work alongside the replacement", async () => {
    const after = await migratePostinstall(`${LEGACY_HOOK} && patch-package`);

    expect(after).toBe(`${LISA_INVOCATION} && patch-package`);
    expect(after).not.toContain(UNRECOGNISED_TAIL);
  });
});
