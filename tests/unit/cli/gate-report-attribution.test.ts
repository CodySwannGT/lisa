/**
 * Tests for the facts the report gained an owner for.
 *
 * The through-line is one ruling: every finding is attributed, and a project is
 * never shown someone else's defect as its own. Attribution, not suppression —
 * so each test here has a companion asserting the unflattering half stays
 * exactly where it was.
 * @module tests/unit/cli/gate-report-attribution
 */
import { describe, expect, it } from "vitest";

import { readFacadeFacts } from "../../../src/cli/gate-report-facade.js";
import {
  matchesEditTool,
  scriptNameOf,
} from "../../../src/cli/gate-report-agent-hooks.js";
import {
  PRE_TOOL_REASON,
  PRE_TOOL_UNWIRED_REASON,
} from "../../../src/cli/gate-report-upstream.js";

import {
  makeProject,
  reportFor,
  row,
  TYPE_CORRECTNESS,
  TYPECHECK,
  TYPECHECK_SCRIPT,
} from "./gate-report-fixtures.js";
import {
  EDIT_MATCHER,
  HOUSE_CONTEXT,
  ownWorkflow,
  PULL_REQUEST,
  QUALITY_YML,
  TYPE_CHECK_CONTEXT,
  WITH_EDIT_PLUGIN,
} from "./gate-report-workflows.js";

/** A project that holds the reusable workflow — the upstream case. */
const UPSTREAM = { config: {}, workflows: { "quality.yml": QUALITY_YML } };

describe("Tier 3, once the workflow is on disk", () => {
  it("refuses the question in a project that holds no workflow", async () => {
    const built = await reportFor({ config: {} });
    const cell = row(built, TYPE_CORRECTNESS).moments.find(
      entry => entry.moment === PULL_REQUEST
    );
    expect(cell?.facadeReadsDeclaration.state).toBe("unknown");
    expect(built.facadeSource.present).toBe(false);
  });

  it("answers it where the workflow is present", async () => {
    const built = await reportFor(UPSTREAM);
    expect(built.facadeSource.present).toBe(true);
    const typecheck = row(built, TYPE_CORRECTNESS).moments.find(
      entry => entry.moment === PULL_REQUEST
    );
    expect(typecheck?.facadeReadsDeclaration).toEqual({
      state: "verified",
      value: true,
    });
  });

  it("says no rather than unknown for a job that runs a fixed command", async () => {
    const built = await reportFor(UPSTREAM);
    const scan = row(built, "dependency-vulnerability").moments.find(
      entry => entry.moment === PULL_REQUEST
    );
    expect(scan?.facadeReadsDeclaration).toEqual({
      state: "verified",
      value: false,
    });
  });

  it("scans sibling workflows, so a job that moved is still found", async () => {
    const facts = await readFacadeFacts(
      await makeProject({
        workflows: { "quality.yml": QUALITY_YML, "own.yml": ownWorkflow() },
      })
    );
    expect(facts.files).toHaveLength(2);
    expect(facts.gatesByJob.get("typecheck")).toBe(TYPE_CORRECTNESS);
    expect(facts.projectContexts.has(HOUSE_CONTEXT)).toBe(true);
  });
});

describe("upstream attribution", () => {
  it("states one limitation with a count and a ticket, not N blanks", async () => {
    const built = await reportFor({ config: {} });
    const tier3 = built.upstream.find(
      entry => entry.reason === "determined-by-quality-yml"
    );
    expect(tier3?.ticket).toBe("CodySwannGT/lisa#2830");
    expect(tier3?.affected).toBeGreaterThan(1);
  });

  it("leaves the unknown cells exactly as unknown as they were", async () => {
    const built = await reportFor({ config: {} });
    expect(built.summary.bucketUnknown).toBeGreaterThan(0);
    expect(built.summary.bucketUnknownUpstream).toBeLessThanOrEqual(
      built.summary.bucketUnknown
    );
    const classified =
      built.summary.buckets.A +
      built.summary.buckets.B +
      built.summary.buckets.C +
      built.summary.buckets.D;
    expect(classified + built.summary.bucketUnknown).toBe(
      built.summary.legalCells
    );
  });

  it("keeps a project's own missing script in the project's view", async () => {
    const built = await reportFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      scripts: {},
    });
    const cell = row(built, TYPE_CORRECTNESS).moments.find(
      entry => entry.moment === "push"
    );
    expect(cell?.commandExists).toEqual({ state: "verified", value: false });
    expect(
      built.upstream.some(entry => entry.reason === "package-json-unreadable")
    ).toBe(false);
  });

  it("knows a consumer project is not Lisa itself", async () => {
    expect((await reportFor({ config: {} })).projectIsUpstream).toBe(false);
  });
});

describe("what runs on every edit", () => {
  it("finds the hooks an enabled plugin registers", async () => {
    const built = await reportFor(WITH_EDIT_PLUGIN);
    expect(built.agentHooks.state).toBe("verified");
    const scripts =
      built.agentHooks.state === "verified"
        ? built.agentHooks.value.map(hook => hook.script)
        : [];
    expect(scripts).toEqual(["lint-on-edit.sh", "block.sh"]);
  });

  it("files them as an upstream limitation, and keeps reporting once they are declarable", async () => {
    const built = await reportFor(WITH_EDIT_PLUGIN);

    // The registry now ships gates at both tool moments, so the original
    // "nothing can be declared here" reason no longer applies and must NOT be
    // reported — an upstream entry that outlived its cause is a false finding.
    expect(
      built.upstream.find(entry => entry.reason === PRE_TOOL_REASON)
    ).toBeUndefined();

    // What replaces it is the half that has not shipped: the scripts run and
    // read no declaration. Reporting nothing at all here would let the report
    // go silent about live, ungoverned enforcement the moment half its cause
    // was fixed, which is the exact failure this report exists to surface.
    const unwired = built.upstream.find(
      entry => entry.reason === PRE_TOOL_UNWIRED_REASON
    );
    expect(unwired?.ticket).toBe("CodySwannGT/lisa#2839");
    expect(unwired?.affected).toBe(2);
  });

  it("says unknown, not none, when the settings file cannot be read", async () => {
    expect((await reportFor({ config: {} })).agentHooks.state).toBe("unknown");
  });

  it("does not count a task-list tool as one that writes a file", () => {
    expect(matchesEditTool("TodoWrite")).toBe(false);
    expect(matchesEditTool(EDIT_MATCHER)).toBe(true);
    expect(matchesEditTool("Edit|Write|NotebookEdit|Bash")).toBe(true);
  });

  it("names the script rather than a slice of shell syntax", () => {
    expect(scriptNameOf("${ROOT}/hooks/lint-on-edit.sh")).toBe(
      "lint-on-edit.sh"
    );
    expect(scriptNameOf("command -v x >/dev/null && run || true")).toBe(
      "command"
    );
  });
});

describe("what else gates my merges", () => {
  /** The contexts a fixture repository's ruleset requires. */
  const required = [
    TYPE_CHECK_CONTEXT,
    "🔍 Quality Checks / 🔒 Security Scan",
    HOUSE_CONTEXT,
    "CodeRabbit",
  ];

  it("separates Lisa's, the project's own, and everyone else's", async () => {
    const built = await reportFor(
      {
        config: {
          gates: { [TYPE_CORRECTNESS]: { [PULL_REQUEST]: "required" } },
        },
        workflows: { "quality.yml": QUALITY_YML, "own.yml": ownWorkflow() },
        scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
      },
      { offline: false, readRequiredContexts: async () => required }
    );
    const rows =
      built.requiredContexts.state === "verified"
        ? built.requiredContexts.value
        : [];
    const byContext = new Map(rows.map(entry => [entry.context, entry.origin]));
    expect(byContext.get(TYPE_CHECK_CONTEXT)).toBe("lisa-governed");
    expect(byContext.get("🔍 Quality Checks / 🔒 Security Scan")).toBe(
      "lisa-undeclared"
    );
    expect(byContext.get(HOUSE_CONTEXT)).toBe("project-workflow");
    expect(byContext.get("CodeRabbit")).toBe("third-party");
  });

  it("carries the unknown through rather than reporting an empty list", async () => {
    expect((await reportFor({ config: {} })).requiredContexts.state).toBe(
      "unknown"
    );
  });
});

describe("does this block a merge", () => {
  it("says yes under the gate's own name", async () => {
    const built = await reportFor(
      {
        config: {
          gates: { [TYPE_CORRECTNESS]: { [PULL_REQUEST]: "required" } },
        },
        workflows: { "quality.yml": QUALITY_YML },
        scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
      },
      {
        offline: false,
        readRequiredContexts: async () => [TYPE_CHECK_CONTEXT],
      }
    );
    expect(row(built, TYPE_CORRECTNESS).merge).toEqual({
      state: "verified",
      value: {
        verdict: "yes",
        context: TYPE_CHECK_CONTEXT,
        underJob: null,
      },
    });
  });

  it("says yes under another job's name when a different job proves it", async () => {
    const built = await reportFor(
      {
        config: {},
        workflows: {
          "own.yml": ownWorkflow("npm run typecheck"),
          "quality.yml": QUALITY_YML,
        },
        scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
      },
      { offline: false, readRequiredContexts: async () => [HOUSE_CONTEXT] }
    );
    const verdict = row(built, TYPE_CORRECTNESS).merge;
    expect(verdict.state === "verified" && verdict.value.verdict).toBe(
      "yes-under-another-name"
    );
    expect(verdict.state === "verified" && verdict.value.underJob).toBe(
      "House check"
    );
  });

  it("says no only where the workflows could be read", async () => {
    const built = await reportFor(UPSTREAM, {
      offline: false,
      readRequiredContexts: async () => [],
    });
    expect(row(built, TYPE_CORRECTNESS).merge).toEqual({
      state: "verified",
      value: { verdict: "no", context: null, underJob: null },
    });
  });

  it("refuses rather than saying no where they could not", async () => {
    const built = await reportFor(
      { config: {} },
      { offline: false, readRequiredContexts: async () => [] }
    );
    const verdict = row(built, TYPE_CORRECTNESS).merge;
    expect(verdict.state).toBe("unknown");
    expect(verdict.state === "unknown" && verdict.reason).toBe(
      "determined-by-quality-yml"
    );
  });
});
