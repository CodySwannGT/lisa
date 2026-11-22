/**
 * The enforce report never rests on the saved carriers result alone.
 *
 * `lisa controls install-carriers` prints what one run did, and the enforce
 * step saves that in a file. A file can be the output of a `--check` run
 * that installed nothing, and a hook can be gone since the run. So the
 * report refuses a check run's output outright, reads the checkout's
 * carriers again itself, and calls a point `wired` only when that read finds
 * the carrier in place now (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import { installCarriers } from "../../../src/controls/carriers.js";
import { buildEnforceReport } from "../../../src/controls/enforce-report.js";
import type { EnforceReport } from "../../../src/controls/enforce-types.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { repositoryState } from "../../support/repository-state.js";
import {
  NOT_MEASURED,
  carriersResult,
  prepareEnforce,
  reportOfCase,
  reportRun,
  saveResult,
  useEnforceCases,
} from "./support/enforce-run.js";

useIoLatencyBudget();
useEnforceCases();

const STYLE = "SI7";
const READ_AGAIN = "this checkout was read again just now";

/**
 * The commit point of a report's one entry.
 * @param report - The report
 * @returns Its state and reason
 */
function commitPoint(report: EnforceReport): {
  readonly state: string;
  readonly reason: string;
} {
  const point = report.entries[0]?.points.find(
    each => each.moment === "commit"
  );
  if (point === undefined) throw new Error("The entry has no commit point.");
  return point;
}

describe("a saved result of a run that installed nothing", () => {
  it("is refused when it is what a check run printed, naming the file to pass", async () => {
    const prepared = await prepareEnforce({ carriers: "absent" });
    const checked = await installCarriers(prepared.repoPath, { check: true });
    if (checked.problems !== null) throw new Error(checked.problems.join(" "));
    saveResult(prepared, "carriers", checked.result);

    const run = await reportRun(prepared);

    expect(checked.result.changes.length).toBeGreaterThan(0);
    expect(run.problems?.join("\n")).toContain("a check installs nothing");
    expect(run.problems?.join("\n")).toContain("carriers.json");
  });

  it("leaves the repository as it was when it refuses", async () => {
    const prepared = await prepareEnforce({ carriers: "absent" });
    saveResult(prepared, "carriers", { ...carriersResult(), mode: "check" });
    const before = repositoryState(prepared.repoPath);

    await reportRun(prepared);

    expect(repositoryState(prepared.repoPath)).toEqual(before);
  });
});

describe("a saved result that says a carrier was installed", () => {
  it("does not make the point wired when the checkout holds no carrier", async () => {
    const prepared = await prepareEnforce({ carriers: "absent" });

    const report = await reportOfCase(prepared);

    expect(report.entries[0]?.outcome).toBe("blocked");
    expect(commitPoint(report).state).toBe("blocked");
    expect(report.criteria.find(row => row.criterion === STYLE)?.outcome).toBe(
      "blocked"
    );
    expect(report.counts.wired).toBe(0);
  });

  it("says that the saved result claimed otherwise, and which one is reported", async () => {
    const report = await reportOfCase(
      await prepareEnforce({ carriers: "absent" })
    );
    const { reason } = commitPoint(report);

    expect(reason).toContain("says this carrier is in place");
    expect(reason).toContain(READ_AGAIN);
    expect(reason).toContain("the carrier is not in place");
    expect(reason).not.toContain("Git starts the declared checks");
  });

  it("is wired, with nothing more said, when the checkout holds the carrier", async () => {
    const report = await reportOfCase(await prepareEnforce());

    expect(commitPoint(report)).toMatchObject({
      reason: "Git starts the declared checks at commit in this checkout.",
      state: "wired",
    });
  });

  it("stops being wired once the hook is removed from the checkout", async () => {
    const prepared = await prepareEnforce();
    const git = await import("../../helpers/control-audit-fixtures.js");
    git.runControlAuditGit(prepared.repoPath, [
      "config",
      "--unset",
      "core.hooksPath",
    ]);

    expect(commitPoint(await reportOfCase(prepared)).state).toBe("blocked");
  });
});

describe("a saved result that says a carrier is blocked", () => {
  it("is overruled by a checkout that holds the carrier, and the report says so", async () => {
    const prepared = await prepareEnforce();
    const saved = carriersResult();
    saveResult(prepared, "carriers", {
      ...saved,
      enforcement_points: (
        saved.enforcement_points as readonly Record<string, unknown>[]
      ).map(point => ({
        ...point,
        outcome: "blocked",
        reason: "A hook file is in the way.",
      })),
    });

    const point = commitPoint(await reportOfCase(prepared));

    expect(point.state).toBe("wired");
    expect(point.reason).toContain("says this carrier is not in place");
    expect(point.reason).toContain(READ_AGAIN);
  });
});

describe("a checkout whose carriers cannot be read", () => {
  it("gets no report, and the reason says what was not known", async () => {
    const prepared = await prepareEnforce();

    const run = await buildEnforceReport(prepared.repoPath, prepared.paths, {
      checkCarriers: () =>
        Promise.resolve({ problems: ["It is not the top folder."] }),
      measure: () => Promise.resolve(NOT_MEASURED),
    });

    expect(run.problems).toEqual([
      "The carriers of this checkout could not be read, so whether the declared checks run here is not known.",
      "It is not the top folder.",
    ]);
  });
});
