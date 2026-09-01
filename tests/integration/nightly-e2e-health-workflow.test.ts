/**
 * Contract tests for the nightly e2e gate's WIRING — the strings and shapes
 * that break silently.
 *
 * The gate's logic is proven in `tests/unit/scripts/nightly-e2e-health.test.ts`.
 * This file proves the things no unit test can see: that the required
 * status-check context, the caller template's job name and the reusable's job
 * name are the SAME composite string, that the caller pins an immutable ref,
 * and that the deleted anti-pattern ruleset stays deleted.
 *
 * Every assertion here corresponds to a failure that produces NO error message
 * in production. A renamed job does not break a build; GitHub simply waits
 * forever for a context nobody reports, which deadlocks every PR into the
 * protected branch. That is why these are tests and not a paragraph in a README.
 */
import yaml from "js-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REUSABLE_REL = ".github/workflows/nightly-e2e-health.yml";
const CALLER_REL = "expo/create-only/.github/workflows/nightly-e2e-health.yml";
const REAPER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-bypass-reaper.yml";
const RULESET_REL = "expo/github-rulesets/nightly-e2e-health.json";
const MAESTRO_REL = ".github/workflows/maestro-native-e2e.yml";
const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
const SCHEMA_REL =
  "typescript/copy-overwrite/scripts/nightly-e2e-suites.schema.json";
const POLICY_REL = "expo/create-only/.github/nightly-e2e-policy.json";
const DELETED_RULESET_REL = "expo/github-rulesets/playwright.json";

/** One job in a workflow. */
interface WorkflowJob {
  readonly name?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly permissions?: Record<string, string>;
  readonly with?: Record<string, unknown>;
  readonly steps?: readonly { readonly uses?: string; readonly run?: string }[];
}

/** A workflow, as much of it as these tests read. */
interface Workflow {
  readonly name?: string;
  readonly on?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly jobs: Record<string, WorkflowJob>;
}

/** A GitHub ruleset template. */
interface Ruleset {
  readonly name: string;
  readonly conditions: { ref_name: { include: string[] } };
  readonly bypass_actors: readonly { actor_type: string }[];
  readonly rules: readonly {
    type: string;
    parameters?: { required_status_checks?: readonly { context: string }[] };
  }[];
}

/**
 * Reads a repo-relative text file.
 *
 * @param relative - Repo-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

/**
 * Parses a repo-relative workflow.
 *
 * @param relative - Repo-relative path
 * @returns The parsed workflow
 */
function workflow(relative: string): Workflow {
  return yaml.load(read(relative)) as Workflow;
}

/**
 * The `on:` key, which js-yaml resolves to the boolean `true` under YAML 1.1.
 *
 * @param parsed - A parsed workflow
 * @returns The triggers map
 */
function triggers(parsed: Workflow): Record<string, unknown> {
  const record = parsed as unknown as Record<string, unknown>;
  return (record.on ?? record["true"] ?? {}) as Record<string, unknown>;
}

describe("the required status-check context identity", () => {
  // GitHub composes a called workflow's check-run name as
  // `<caller job name> / <called job name>`. The ruleset must require that
  // composite, byte for byte, emoji included. Rename either half alone and the
  // gate stops reporting — which does not de-gate the branch, it DEADLOCKS
  // every PR into it. This is exactly how gemini's `playwright` ruleset ended
  // up enforcing nothing.
  const reusable = workflow(REUSABLE_REL);
  const caller = workflow(CALLER_REL);
  const ruleset = JSON.parse(read(RULESET_REL)) as Ruleset;

  const reusableJobName = reusable.jobs.gate.name;
  const callerJobName = caller.jobs.health.name;
  const requiredContexts =
    ruleset.rules.find(rule => rule.type === "required_status_checks")
      ?.parameters?.required_status_checks ?? [];

  it("the ruleset requires exactly the composite of the two job names", () => {
    expect(reusableJobName).toBe("🌙 Gate");
    expect(callerJobName).toBe("🌙 Nightly E2E Health");
    expect(requiredContexts.map(check => check.context)).toEqual([
      `${callerJobName} / ${reusableJobName}`,
    ]);
  });

  it("the caller's job actually calls the reusable this context names", () => {
    expect(caller.jobs.health.uses).toContain(
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@"
    );
  });

  it("the caller PINS AN IMMUTABLE REF — `@main` is not a pin for a merge gate", () => {
    // The thing that decides whether code may merge must not change under you
    // between two runs of the same PR (Appendix A5).
    const ref = (caller.jobs.health.uses ?? "").split("@")[1];
    expect(ref).not.toBe("main");
    expect(ref).toMatch(/^(v\d+\.\d+\.\d+|[0-9a-f]{40})$/);
  });
});

describe("the reusable workflow's contract", () => {
  const reusable = workflow(REUSABLE_REL);
  const call = triggers(reusable).workflow_call as {
    inputs: Record<
      string,
      { required?: boolean; type?: string; default?: unknown }
    >;
    outputs: Record<string, unknown>;
  };

  it("takes `suites` as a REQUIRED structured-JSON string", () => {
    expect(call.inputs.suites.required).toBe(true);
    expect(call.inputs.suites.type).toBe("string");
    // A `workflow_call` input cannot be an object, which is why the table is a
    // JSON string validated against a schema rather than a native type.
    expect(fs.existsSync(path.join(REPO_ROOT, SCHEMA_REL))).toBe(true);
  });

  it("takes `branch` as REQUIRED — an unfiltered read lets any branch clear the gate", () => {
    expect(call.inputs.branch.required).toBe(true);
  });

  it("defaults the bootstrap window to OFF and caps how far out it may sit", () => {
    expect(call.inputs.bootstrap_until.default).toBe("");
    expect(call.inputs.bootstrap_max_days.default).toBe(30);
  });

  it("exposes the verdict and the audit record as outputs", () => {
    expect(
      Object.keys(call.outputs).toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["audit_json", "blocked", "verdict"]);
  });

  it("requests the MINIMUM permissions and never a write", () => {
    // A called workflow's `permissions:` is a CEILING, not a request: a scope
    // absent here can never be granted by the caller. `pull-requests: read` is
    // therefore required for the bypass path to read the PR timeline on a
    // private repository — without it a valid maintainer bypass is rejected as
    // `no_attributable_actor`. Every scope stays read-only.
    expect(reusable.permissions).toEqual({
      contents: "read",
      actions: "read",
      "pull-requests": "read",
    });
    for (const value of Object.values(reusable.permissions ?? {})) {
      expect(value).toBe("read");
    }
  });

  it("asserts the guard's contract major before trusting it", () => {
    // The workflow travels by git ref and the guard by `lisa apply`, so the two
    // halves drift. A mismatch must fail closed, not run a contract neither
    // half agrees on.
    const steps = reusable.jobs.gate.steps ?? [];
    const assertion = steps.find(step =>
      step.run?.includes("--contract-version")
    );
    expect(assertion).toBeDefined();
    expect(assertion?.run).toContain("contract mismatch");
    expect(assertion?.run).toContain("exit 1");
  });

  it("fails closed when the guard is not installed at all", () => {
    const steps = reusable.jobs.gate.steps ?? [];
    const assertion = steps.find(step => step.run?.includes("does not exist"));
    expect(assertion?.run).toContain("green gate that measured nothing");
  });

  it("passes attacker-controlled PR text through `env:`, never into the shell", () => {
    const raw = read(REUSABLE_REL);
    expect(raw).toContain(
      "NIGHTLY_PR_BODY: ${{ github.event.pull_request.body }}"
    );
    // The only interpolation inside a `run:` is the operator-supplied script
    // path; a PR body interpolated into a shell line is a command injection.
    expect(raw).not.toMatch(/run:.*github\.event\.pull_request\.body/);
  });

  it("states in its header that it QUERIES RUN HISTORY and cannot call the suites", () => {
    const raw = read(REUSABLE_REL);
    expect(raw).toContain("QUERIES GITHUB ACTIONS RUN HISTORY");
    expect(raw).toContain("`uses:` must be a static literal");
    // Since rows 36-38 the gate reads artifact NAMES — never artifact CONTENT.
    // That distinction is asserted rather than the old blanket "reads no
    // artifacts", because it is the whole reason the flow-count backstop is
    // affordable on the pull-request path: the names come back in the list, one
    // call, no download, no zip reader, and they outlive the bytes.
    expect(raw).toContain("reads artifact NAMES and never artifact CONTENT");
    expect(raw).not.toMatch(/download(ing)? an artifact is (not )?permitted/i);
  });
});

describe("the caller template", () => {
  const caller = workflow(CALLER_REL);
  const on = triggers(caller);
  const pullRequest = on.pull_request as { types?: string[]; paths?: string[] };

  it("re-evaluates on labeled/unlabeled so a bypass needs no empty push", () => {
    expect(pullRequest.types).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "labeled",
      "unlabeled",
    ]);
  });

  it("carries NO paths filter — a suppressible required context blocks forever", () => {
    expect(pullRequest.paths).toBeUndefined();
    expect(read(CALLER_REL)).not.toMatch(/^ {4}paths(-ignore)?:$/m);
  });

  it("is scoped to the integration branch, not the release branches", () => {
    // Requiring the nightly gate on a release branch blocks a hotfix to
    // production on last night's dev suite — that is, blocks the fix for the
    // failure.
    expect((pullRequest as { branches?: string[] }).branches).toEqual(["dev"]);
  });

  it("grants read-only permissions", () => {
    expect(caller.permissions).toEqual({
      contents: "read",
      actions: "read",
      "pull-requests": "read",
    });
  });

  it("names only workflows the template actually ships", () => {
    // Row 11 is a HARD failure: a `suites` entry naming a workflow file that
    // does not exist red-walls a fresh fork on day one, and the first thing a
    // new adopter would do about that is delete the gate.
    const policy = JSON.parse(read(POLICY_REL)) as {
      suites: { workflow: string }[];
    };
    const suites = policy.suites;
    for (const suite of suites) {
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "expo/create-only/.github/workflows",
            suite.workflow
          )
        )
      ).toBe(true);
    }
  });

  it("ships a `suites` table that the guard's own validator accepts", async () => {
    const guard = (await import(
      new URL(`file://${path.join(REPO_ROOT, GUARD_REL)}`).href
    )) as { validateSuites(raw: string): readonly unknown[] };
    const policy = JSON.parse(read(POLICY_REL)) as {
      suites: readonly unknown[];
    };
    const suites = JSON.stringify(policy.suites);
    expect(() => guard.validateSuites(suites)).not.toThrow();
    // A hardcoded count, not `> 0`: deleting either shipped suite would leave
    // a table that still "validates" while no longer matching the tracker.
    expect(guard.validateSuites(suites)).toHaveLength(2);
    expect(caller.jobs.health.with?.suites).toBe(
      "${{ needs.policy.outputs.suites }}"
    );
  });
});

describe("the bypass reaper", () => {
  const reaper = workflow(REAPER_REL);

  it("removes the label on CLOSE, never on use", () => {
    // Removing it during evaluation fires `unlabeled`, re-runs the gate, and
    // re-blocks the PR the bypass was meant to unblock.
    expect(Object.keys(triggers(reaper))).toEqual(["pull_request_target"]);
    expect(
      (triggers(reaper).pull_request_target as { types: string[] }).types
    ).toEqual(["closed"]);
  });

  it("is the ONLY workflow in the standard that holds a write scope", () => {
    expect(reaper.permissions?.["pull-requests"]).toBe("write");
    // The gate reads the PR timeline, so it holds `pull-requests: read` — but
    // never `write`. Removal is the reaper's job precisely so the thing that
    // runs on every pull request needs no write scope at all.
    expect(workflow(REUSABLE_REL).permissions?.["pull-requests"]).toBe("read");
  });

  it("never checks out pull-request code under its writable token", () => {
    // `pull_request_target` runs with a writable token against the BASE repo.
    const steps = reaper.jobs.reap.steps ?? [];
    expect(steps.some(step => step.uses?.startsWith("actions/checkout"))).toBe(
      false
    );
  });
});

describe("the deleted anti-pattern ruleset", () => {
  it("`expo/github-rulesets/playwright.json` is gone and stays gone", () => {
    // It required `🔍 Quality Checks / 🎭 Playwright E2E Tests`, a context that
    // PR runs SKIP. GitHub counts a skipped required check as SATISFIED, so the
    // ruleset enforced nothing while looking fully armed — gemini had to
    // disable it. Replaced by the nightly-gate ruleset, which requires a
    // context that always reports.
    expect(fs.existsSync(path.join(REPO_ROOT, DELETED_RULESET_REL))).toBe(
      false
    );
  });

  // This assertion is about the ruleset Lisa SHIPS, and it stays: a greenfield
  // repo must not be born with an admin path past the gate. What it does NOT
  // prove is that no admin can merge past a red gate in practice — a consumer
  // is free to add a `RepositoryRole` bypass actor to its own ruleset, and as
  // measured 2026-08-19 every portfolio repo where the gate was required had
  // done exactly that. Reading this test as a claim about deployments is the
  // mistake the 2026-08-19 amendment to §6 of the contract exists to correct.
  it("its replacement grants NO RepositoryRole bypass in the SHIPPED template", () => {
    const ruleset = JSON.parse(read(RULESET_REL)) as Ruleset;
    expect(ruleset.bypass_actors.map(actor => actor.actor_type)).not.toContain(
      "RepositoryRole"
    );
  });

  it("its replacement is scoped to the integration branch only", () => {
    const ruleset = JSON.parse(read(RULESET_REL)) as Ruleset;
    expect(ruleset.conditions.ref_name.include).toEqual(["refs/heads/dev"]);
  });
});

describe("maestro-native-e2e `require_prerequisites`", () => {
  const maestro = workflow(MAESTRO_REL);
  const inputs = (
    triggers(maestro).workflow_call as {
      inputs: Record<string, { type?: string; default?: unknown }>;
    }
  ).inputs;

  it("exists, is boolean, and defaults to the safe-to-install behaviour", () => {
    expect(inputs.require_prerequisites.type).toBe("boolean");
    expect(inputs.require_prerequisites.default).toBe(false);
  });

  it("inverts warn-and-skip into a hard failure when true", () => {
    const preflight = maestro.jobs.preflight.steps ?? [];
    const check = preflight.find(step => step.run?.includes("should_run=true"));
    expect(check?.run).toContain('REQUIRE_PREREQUISITES" == "true"');
    expect(check?.run).toContain("exit 1");
    // The reason it matters: a suite that skips its way to `success` is
    // indistinguishable from one that ran, to anything reading the conclusion.
    expect(check?.run).toContain("green run that tested nothing");
  });

  it("still warns and skips by default, so it stays safe to install fleet-wide", () => {
    const preflight = maestro.jobs.preflight.steps ?? [];
    const check = preflight.find(step => step.run?.includes("should_run=true"));
    expect(check?.run).toContain("::warning::Maestro native e2e skipped");
  });
});
