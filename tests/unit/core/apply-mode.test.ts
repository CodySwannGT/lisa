/**
 * Apply-mode resolution (#3066).
 *
 * Two properties matter here, and they pull in opposite directions.
 *
 * The FIX: a caller that waives the dirty-tree check for an honest reason — it
 * has just run an install, so the tree is dirty by construction — can now ask
 * for the full apply instead of silently receiving the reduced subset.
 *
 * The COMPATIBILITY GUARANTEE: every caller that does NOT ask keeps today's
 * behaviour byte for byte. That is the dangerous direction, and it is asserted
 * harder than the fix. #3021 measured the shape of that risk on a neighbouring
 * change: 22 callers, 2 opted in, 20 on the default — a naive collapse would
 * have reddened the 20. The postinstall hook is one of the 20 here, and a full
 * apply under `bun install` regenerates agent trees, which is exactly what the
 * reduced mode exists to prevent.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/core/apply-mode
 */
import { describe, expect, it } from "vitest";
import {
  isPostinstallSafeApply,
  resolveApplyMode,
} from "../../../src/core/apply-mode.js";

/** The reduced subset a postinstall runs. */
const REDUCED = "postinstall-safe";

/** The complete apply, including every agent emit. */
const FULL = "full";

describe("resolveApplyMode", () => {
  it("keeps --skip-git-check alone meaning postinstall-safe", () => {
    // The compatibility guarantee. This is the postinstall hook's own
    // invocation and the majority of existing callers; if this flips, agent
    // trees start regenerating under `bun install`.
    expect(resolveApplyMode({ skipGitCheck: true })).toBe(REDUCED);
    expect(resolveApplyMode({ skipGitCheck: true, fullApply: false })).toBe(
      REDUCED
    );
  });

  it("resolves a plain apply as full", () => {
    expect(resolveApplyMode({ skipGitCheck: false })).toBe(FULL);
  });

  it("lets a caller waive the git check AND keep the full apply", () => {
    // The fix. Before this, the combination was unreachable: waiving the
    // dirty-tree check silently reduced the apply with no way to decline.
    expect(resolveApplyMode({ skipGitCheck: true, fullApply: true })).toBe(
      FULL
    );
  });

  it("treats fullApply as opt-in only, never as a requirement", () => {
    // fullApply without skipGitCheck is already full; asserting it pins that
    // the flag never *narrows* anything.
    expect(resolveApplyMode({ skipGitCheck: false, fullApply: true })).toBe(
      FULL
    );
  });

  it("agrees with itself across both entry points", () => {
    // The whole point of this module: behaviour and receipt read ONE decision.
    // They used to be independent expressions of the same fact in two files
    // that never referenced each other, so a receipt could describe work the
    // run did not do — and doctor reads that receipt.
    const cases = [
      { skipGitCheck: true },
      { skipGitCheck: false },
      { skipGitCheck: true, fullApply: true },
      { skipGitCheck: false, fullApply: true },
      { skipGitCheck: true, fullApply: false },
    ] as const;

    for (const config of cases) {
      expect(isPostinstallSafeApply(config)).toBe(
        resolveApplyMode(config) === REDUCED
      );
    }
  });
});
