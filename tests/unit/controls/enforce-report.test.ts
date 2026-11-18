/**
 * The enforce report: exactly one outcome for every Level 1 requirement,
 * derived from the audit report, the register and the results of the three
 * steps (CodySwannGT/lisa#4994, R32 and R38).
 */
import { describe, expect, it } from "vitest";

import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import { ENFORCE_OUTCOMES } from "../../../src/controls/enforce-types.js";
import { askAbout } from "../../helpers/control-audit-report.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { repositoryState } from "../../support/repository-state.js";
import { lintGates } from "./support/enforce-repository.js";
import {
  FOUND_STYLE,
  carriersResult,
  filedTickets,
  prepareEnforce,
  protectResult,
  reportOfCase,
  saveResult,
  useEnforceCases,
} from "./support/enforce-run.js";

useIoLatencyBudget();
useEnforceCases();

const IN_SCOPE = inScopeCriteria(loadCriterionCatalogue());
const STYLE = "SI7";
const MERGE_GATES = lintGates({ "pull-request": "required" });

/**
 * One coding agent's point, as a saved carriers result lists it.
 * @param agent - The agent
 * @param outcome - What the saved result says became of it
 * @returns The point
 */
function savedAgentPoint(
  agent: string,
  outcome = "installed"
): Readonly<Record<string, unknown>> {
  return {
    kind: "agent-hook",
    location: "coding-agent",
    moment: "post-tool",
    agent,
    outcome,
    reason: null,
  };
}

describe("one outcome per requirement", () => {
  it("gives every in-scope requirement exactly one, in catalogue order", async () => {
    const report = await reportOfCase(await prepareEnforce());

    expect(report.requirements).toBe(IN_SCOPE.length);
    expect(report.criteria.map(row => row.criterion)).toEqual(
      IN_SCOPE.map(criterion => criterion.id)
    );
    expect(
      ENFORCE_OUTCOMES.reduce((sum, outcome) => sum + report.counts[outcome], 0)
    ).toBe(IN_SCOPE.length);
    expect(
      report.criteria.filter(row => !ENFORCE_OUTCOMES.includes(row.outcome))
    ).toEqual([]);
  });

  it("is wired for the requirement whose declared check now runs at commit", async () => {
    const report = await reportOfCase(await prepareEnforce());
    const style = report.criteria.find(row => row.criterion === STYLE);

    expect(style?.outcome).toBe("wired");
    expect(report.entries.map(entry => [entry.id, entry.outcome])).toEqual([
      ["code-style@.", "wired"],
    ]);
  });

  it("is blocked for that requirement while merge protection does not require its check", async () => {
    const report = await reportOfCase(
      await prepareEnforce({ gates: MERGE_GATES })
    );
    const style = report.criteria.find(row => row.criterion === STYLE);

    expect(style?.outcome).toBe("blocked");
    expect(style?.reason).toContain("The hosting platform is blocked");
  });

  it("is wired once merge protection requires the check too", async () => {
    const prepared = await prepareEnforce({ gates: MERGE_GATES });
    saveResult(
      prepared,
      "protect",
      await protectResult(prepared.repoPath, "wired")
    );

    const report = await reportOfCase(prepared);

    expect(report.criteria.find(row => row.criterion === STYLE)?.outcome).toBe(
      "wired"
    );
  });

  it("is blocked, never left with nothing to enforce, for a declared check that no moment runs", async () => {
    const report = await reportOfCase(
      await prepareEnforce({ gates: lintGates({ commit: "off" }) })
    );
    const style = report.criteria.find(row => row.criterion === STYLE);

    expect(report.entries).toEqual([
      expect.objectContaining({ id: "code-style@.", points: [] }),
    ]);
    expect(report.entries[0]?.outcome).toBe("blocked");
    expect(style?.outcome).toBe("blocked");
    expect(style?.reason).toContain("no moment to run at");
    expect(style?.reason).toContain("run the configure step");
    expect(report.counts["nothing-to-enforce"]).toBe(0);
  });

  it("blocks every missing requirement, pointing at the tracker question, when no tracker is configured", async () => {
    const report = await reportOfCase(await prepareEnforce());
    const missing = report.criteria.filter(row => row.criterion !== STYLE);

    expect(missing.map(row => row.outcome)).toEqual(
      missing.map(() => "blocked")
    );
    expect(missing[0]?.reason).toContain("No tracker is configured");
    expect(missing[0]?.reason).toContain('"tracker"');
    expect(report.counts).toMatchObject({ wired: 1, ticketed: 0 });
  });

  it("is ticketed, with the ticket, for each missing requirement the flow filed", async () => {
    const prepared = await prepareEnforce({ tracker: "github" });
    const results = await filedTickets(prepared.repoPath);
    saveResult(prepared, "tickets", { schema_version: 1, results });

    const report = await reportOfCase(prepared);

    expect(report.counts).toMatchObject({
      wired: 1,
      ticketed: IN_SCOPE.length - 1,
      blocked: 0,
    });
    expect(
      report.criteria.find(row => row.outcome === "ticketed")?.tickets
    ).toEqual(["tracker#1"]);
  });

  it("is blocked on the operator's answer for a requirement the audit asks about", async () => {
    const prepared = await prepareEnforce({
      report: askAbout(FOUND_STYLE, { criterion: "AC1.7", scope: "." }),
    });

    const asked = (await reportOfCase(prepared)).criteria.find(
      row => row.criterion === "AC1.7"
    );

    expect(asked?.outcome).toBe("blocked");
    expect(asked?.reason).toContain("Waiting on your answer");
  });
});

describe("what a run reports having changed", () => {
  it("lists what the carriers step wrote and the tickets the flow created", async () => {
    const prepared = await prepareEnforce({ tracker: "github" });
    const results = await filedTickets(prepared.repoPath);
    saveResult(prepared, "tickets", { schema_version: 1, results });
    saveResult(prepared, "protect", {
      ...(await protectResult(prepared.repoPath)),
      handover: {
        path: ".lisa/controls/merge-protection-change.md",
        action: "written",
      },
    });

    const { changes } = await reportOfCase(prepared);

    expect(changes.slice(0, 2)).toEqual([
      { step: "carriers", target: ".lisa/hooks/pre-commit", action: "create" },
      { step: "carriers", target: "core.hooksPath", action: "set" },
    ]);
    expect(changes.filter(change => change.step === "tickets")).toHaveLength(
      results.length
    );
    expect(changes.at(-1)).toEqual({
      step: "merge-protection",
      target: ".lisa/controls/merge-protection-change.md",
      action: "written",
    });
  });

  it("lists nothing on a second run that found everything in place", async () => {
    const prepared = await prepareEnforce({ tracker: "github" });
    saveResult(prepared, "carriers", carriersResult([]));
    saveResult(prepared, "tickets", {
      schema_version: 1,
      results: await filedTickets(prepared.repoPath, "existing"),
    });

    const report = await reportOfCase(prepared);

    expect(report.changes).toEqual([]);
    expect(report.reason).toContain("reported 0 changes");
  });

  it("gives the same outcomes on that second run as on the first", async () => {
    const prepared = await prepareEnforce({ tracker: "github" });
    saveResult(prepared, "tickets", {
      schema_version: 1,
      results: await filedTickets(prepared.repoPath),
    });
    const first = await reportOfCase(prepared);
    saveResult(prepared, "carriers", carriersResult([]));
    saveResult(prepared, "tickets", {
      schema_version: 1,
      results: await filedTickets(prepared.repoPath, "existing"),
    });

    const second = await reportOfCase(prepared);

    expect(second.criteria.map(row => [row.criterion, row.outcome])).toEqual(
      first.criteria.map(row => [row.criterion, row.outcome])
    );
  });

  it("writes nothing in the repository", async () => {
    const prepared = await prepareEnforce();
    const before = repositoryState(prepared.repoPath);

    await reportOfCase(prepared);

    expect(repositoryState(prepared.repoPath)).toEqual(before);
  });
});

describe("what the result does not show", () => {
  it("always says that wired is not proved, and names the per-checkout hook setting", async () => {
    const { limits } = await reportOfCase(await prepareEnforce());

    expect(limits[0]).toContain("the attest step proves");
    expect(limits.join("\n")).toContain("core.hooksPath");
  });

  it("names the agents whose refusal is assumed and the one that cannot refuse", async () => {
    const prepared = await prepareEnforce({
      agents: ["copilot", "devin", "agy"],
    });
    const carriers = carriersResult();
    saveResult(prepared, "carriers", {
      ...carriers,
      enforcement_points: [
        ...(carriers.enforcement_points as readonly unknown[]),
        savedAgentPoint("copilot"),
        savedAgentPoint("devin"),
        savedAgentPoint("agy", "unenforceable"),
      ],
    });

    const limits = (await reportOfCase(prepared)).limits.join("\n");

    expect(limits).toContain("On copilot and devin");
    expect(limits).toContain("It has not been measured");
    expect(limits).toContain("agy has no hook that can refuse a file write");
  });

  it("says that an agent which is only told of a failed check is not stopped by it", async () => {
    const prepared = await prepareEnforce({ agents: ["cursor"] });
    const carriers = carriersResult();
    saveResult(prepared, "carriers", {
      ...carriers,
      enforcement_points: [
        ...(carriers.enforcement_points as readonly unknown[]),
        savedAgentPoint("cursor"),
      ],
    });

    const limits = (await reportOfCase(prepared)).limits.join("\n");

    expect(limits).toContain(
      "On cursor, a failed check does not fail the file write."
    );
  });

  it("names no agent the saved result claims and the checkout does not carry", async () => {
    const prepared = await prepareEnforce();
    const carriers = carriersResult();
    saveResult(prepared, "carriers", {
      ...carriers,
      enforcement_points: [
        ...(carriers.enforcement_points as readonly unknown[]),
        savedAgentPoint("devin"),
      ],
    });

    const limits = (await reportOfCase(prepared)).limits.join("\n");

    expect(limits).not.toContain("On devin");
  });

  it("says a declared threshold has nothing that stops it being loosened", async () => {
    const prepared = await prepareEnforce({
      gates: lintGates(
        {},
        { parameters: { "longest-line": { value: 120, direction: "ceiling" } } }
      ),
    });

    expect((await reportOfCase(prepared)).limits.join("\n")).toContain(
      "1 threshold is declared"
    );
  });
});
