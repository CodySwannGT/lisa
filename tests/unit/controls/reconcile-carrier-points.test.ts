/**
 * Reading the carrier check as an answer about one enforcement point
 * (CodySwannGT/lisa#5000).
 *
 * `lisa controls install-carriers --check` already knows whether git runs the
 * gate runner at commit and at push in a checkout. The reconciler does not
 * work that out again: it reads the check's result and says, for one point,
 * whether something real starts the runner there. These cases hold that
 * reading to the result, one situation at a time.
 */
import { describe, expect, it } from "vitest";

import { carrierScript } from "../../../src/controls/carrier-script.js";
import type {
  CarrierChange,
  CarrierPoint,
  CarrierResult,
} from "../../../src/controls/carrier-types.js";
import { carrierVerdict } from "../../../src/controls/reconcile-carrier-points.js";

const COMMIT_SCRIPT = ".lisa/hooks/pre-commit";
const RUNNER = "scripts/lisa-run-gates.mjs";
const SETTING = "core.hooksPath";
const HUSKY_HOOK = ".husky/pre-commit";
const ALREADY_WIRED = "already-wired";

/**
 * The commit point of a carrier check.
 * @param overrides - What differs from a point Lisa's own hook folder carries
 * @returns The point
 */
function point(overrides: Partial<CarrierPoint> = {}): CarrierPoint {
  return {
    hook: "pre-commit",
    kind: "git-hook",
    location: "local-checkout",
    moment: "commit",
    outcome: ALREADY_WIRED,
    path: SETTING,
    reason: null,
    wired_through: "lisa",
    ...overrides,
  };
}

/**
 * A carrier check's result.
 * @param changes - What a run would write
 * @returns The result
 */
function result(changes: readonly CarrierChange[] = []): CarrierResult {
  return {
    changes,
    each_checkout: { check: "", command: "", why: "" },
    enforcement_points: [],
    hook_owner: "lisa",
    mode: "check",
    outcome: changes.length === 0 ? ALREADY_WIRED : "updated",
    reason: "",
    record: ".lisa/controls/carriers.json",
    runner: {
      files: [RUNNER, "scripts/lisa-gates.mjs"],
      outcome: ALREADY_WIRED,
      path: RUNNER,
      reason: null,
    },
    schema_version: 1,
  };
}

/**
 * A reader over a few files held in memory.
 * @param files - Each file's content by its path
 * @returns The reader the verdict is given
 */
function reader(
  files: Readonly<Record<string, string>> = {}
): (shown: string) => Promise<string | null> {
  return shown => Promise.resolve(files[shown] ?? null);
}

describe("what the carrier check says about one enforcement point", () => {
  it("is wired when the check would change nothing", async () => {
    const verdict = await carrierVerdict(point(), result(), reader());

    expect(verdict).toEqual({
      checked: SETTING,
      reason:
        "The pre-commit hook starts the gate runner at commit in this checkout.",
      state: "wired",
    });
  });

  it("is not wired when the check says the point is blocked, for its reason", async () => {
    const blocked = point({
      outcome: "blocked",
      path: HUSKY_HOOK,
      reason: "Husky is not switched on in this checkout.",
      wired_through: "husky",
    });

    expect(await carrierVerdict(blocked, result(), reader())).toEqual({
      checked: HUSKY_HOOK,
      reason: "Husky is not switched on in this checkout.",
      state: "not-wired",
    });
  });

  it("is not wired in a new clone, where the hooks setting is not set", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "installed", wired_through: "none" }),
      result([{ action: "set", path: SETTING }]),
      reader()
    );

    expect(verdict.state).toBe("not-wired");
    expect(verdict.reason).toContain("core.hooksPath is not set");
    expect(verdict.reason).toContain("new clone");
  });

  it("is not wired when the hook file does not call the carrier", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "installed", path: HUSKY_HOOK, wired_through: "husky" }),
      result([{ action: "update", path: HUSKY_HOOK }]),
      reader()
    );

    expect(verdict).toMatchObject({
      checked: HUSKY_HOOK,
      reason:
        ".husky/pre-commit does not call the gate runner, so nothing starts it at commit.",
      state: "not-wired",
    });
  });

  it("is not wired when the carrier script is missing, and names it", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "create", path: COMMIT_SCRIPT }]),
      reader()
    );

    expect(verdict).toMatchObject({
      reason:
        ".lisa/hooks/pre-commit is missing, so the pre-commit hook cannot start the gate runner at commit.",
      state: "not-wired",
    });
  });

  it("is not wired when the runner is missing", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "create", path: RUNNER }]),
      reader()
    );

    expect(verdict.state).toBe("not-wired");
    expect(verdict.reason).toContain(`${RUNNER} is missing`);
  });

  it("stays wired when only the other moment's script is missing", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "create", path: ".lisa/hooks/pre-push" }]),
      reader()
    );

    expect(verdict.state).toBe("wired");
  });

  it("stays wired, and says so, when a file only differs from what Lisa installs", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "update", path: RUNNER }]),
      reader()
    );

    expect(verdict.state).toBe("wired");
    expect(verdict.reason).toContain(
      `${RUNNER} differs from what this version of Lisa installs`
    );
  });

  it("stays wired when a rewritten carrier script still starts the runner", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "update", path: COMMIT_SCRIPT }]),
      reader({ [COMMIT_SCRIPT]: `${carrierScript("commit")}# a note\n` })
    );

    expect(verdict.state).toBe("wired");
  });

  it("is not wired when a rewritten carrier script no longer starts the runner", async () => {
    const verdict = await carrierVerdict(
      point({ outcome: "updated" }),
      result([{ action: "update", path: COMMIT_SCRIPT }]),
      reader({
        [COMMIT_SCRIPT]: "#!/bin/sh\n# node lisa-run-gates.mjs\nexit 0\n",
      })
    );

    expect(verdict).toMatchObject({
      reason:
        ".lisa/hooks/pre-commit no longer starts the gate runner at commit.",
      state: "not-wired",
    });
  });

  it("does not ask a project type's own hook for Lisa's carrier script", async () => {
    const verdict = await carrierVerdict(
      point({ path: HUSKY_HOOK, wired_through: "lisa-stack-hook" }),
      result([
        { action: "create", path: COMMIT_SCRIPT },
        { action: "create", path: RUNNER },
      ]),
      reader()
    );

    expect(verdict.state).toBe("wired");
  });
});
