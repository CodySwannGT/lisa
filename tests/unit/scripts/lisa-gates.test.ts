/**
 * Tests for the gate registry and resolver.
 *
 * The assertions that matter most are about the failure modes this design
 * exists to prevent: a misspelled gate id must not read as an enabled
 * guarantee, a gate enabled with nothing to run must not pass silently, and a
 * renamed CI job must be able to keep its old branch-protection context alive
 * while the fleet catches up.
 * @module tests/unit/scripts/lisa-gates
 */

import { describe, expect, it } from "vitest";

import {
  contextsFor,
  gateFloor,
  REGISTRY,
  resolveStage,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const QUALITY = "🔍 Quality Checks";
const MUTATION_TASK = "test:mutation";

describe("REGISTRY", () => {
  it("marks intercepting gates as lisa-implemented", () => {
    // These refuse an action before it happens. A project task cannot do that:
    // by the time it ran, the thing it prevents has already run.
    const intercepting = [
      "verification-bypass",
      "destructive-safety",
      "instruction-integrity",
    ] as const;
    for (const id of intercepting) {
      expect(REGISTRY[id].implementation).toBe("lisa");
    }
  });

  it("gives every gate a label, since rulesets match by exact string", () => {
    for (const [id, gate] of Object.entries(REGISTRY)) {
      expect(gate.label, id).toBeTruthy();
      expect(gate.summary, id).toBeTruthy();
    }
  });
});

describe("validateGates", () => {
  it("accepts a well-formed gate", () => {
    expect(
      validateGates({
        "credential-leakage": {
          run: "security:check-for-leaks",
          commit: "required",
          ci: { pull_request: "required" },
        },
      })
    ).toEqual([]);
  });

  it("rejects an unknown gate id and suggests the nearest real one", () => {
    // The failure this prevents is invisible: a misspelled gate reads as an
    // enabled guarantee and runs nothing at all.
    const problems = validateGates({ "credential-leakge": { run: "x" } });
    expect(problems.join(" ")).toContain("not a gate Lisa knows");
    expect(problems.join(" ")).toContain('Did you mean "credential-leakage"?');
  });

  it("accepts a custom gate behind the x- prefix", () => {
    expect(
      validateGates({
        "x-vendor-policy": {
          run: "policy:check",
          ci: { pull_request: "optional" },
        },
      })
    ).toEqual([]);
  });

  it("does not suggest a gate when nothing is close", () => {
    const problems = validateGates({ "totally-unrelated-thing": { run: "x" } });
    expect(problems.join(" ")).toContain("not a gate Lisa knows");
    expect(problems.join(" ")).not.toContain("Did you mean");
  });

  it("rejects a gate that is enabled but names nothing to run", () => {
    const problems = validateGates({ "code-style": { commit: "required" } });
    expect(problems.join(" ")).toContain('names no "run" task');
  });

  it("does not demand a run task for a gate Lisa implements", () => {
    expect(
      validateGates({
        "verification-bypass": { agent: { PreToolUse: "required" } },
      })
    ).toEqual([]);
  });

  it("rejects delegating a gate that must intercept", () => {
    const problems = validateGates({
      "verification-bypass": {
        run: "security:no-verify",
        agent: { PreToolUse: "required" },
      },
    });
    expect(problems.join(" ")).toContain("cannot be delegated");
  });

  it("rejects an unknown enforcement level", () => {
    const problems = validateGates({
      "code-style": { run: "lint", commit: "yes" },
    });
    expect(problems.join(" ")).toContain("expected required, optional, off");
  });

  it("rejects an unknown agent event", () => {
    const problems = validateGates({
      "code-style": { run: "lint", agent: { OnSave: "required" } },
    });
    expect(problems.join(" ")).toContain('event "OnSave"');
  });

  it("reports every problem rather than the first", () => {
    const problems = validateGates({
      "code-style": { run: "lint", commit: "maybe" },
      "unknown-gate": {},
    });
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe("resolveStage", () => {
  const gates = {
    "code-style": {
      run: "lint",
      commit: "required",
      ci: { pull_request: "required" },
    },
    "test-meaningfulness": {
      run: MUTATION_TASK,
      ci: { pull_request: "optional" },
    },
    "dead-code": { run: "knip", commit: "off" },
    "verification-bypass": { agent: { PreToolUse: "required" } },
  };

  it("returns only gates enabled at the stage, with their command", () => {
    const resolved = resolveStage({
      gates,
      stage: "commit",
      runner: "bun run",
    });
    expect(resolved).toEqual([
      {
        id: "code-style",
        level: "required",
        run: "lint",
        command: "bun run lint",
        label: "🧹 Lint",
      },
    ]);
  });

  it("treats an explicit off exactly like an absent stage", () => {
    const resolved = resolveStage({ gates, stage: "push" });
    expect(resolved).toEqual([]);
  });

  it("resolves an agent event", () => {
    const resolved = resolveStage({ gates, stage: "agent:PreToolUse" });
    expect(resolved.map(gate => gate.id)).toEqual(["verification-bypass"]);
    expect(resolved[0]?.command).toBeNull();
  });

  it("resolves a ci environment and keeps the level distinct", () => {
    const resolved = resolveStage({ gates, stage: "ci:pull_request" });
    expect(resolved.map(gate => [gate.id, gate.level])).toEqual([
      ["code-style", "required"],
      ["test-meaningfulness", "optional"],
    ]);
  });

  it("returns nothing for an environment no gate names", () => {
    expect(resolveStage({ gates, stage: "ci:production" })).toEqual([]);
  });
});

describe("contextsFor", () => {
  const gates = {
    "code-style": { run: "lint", ci: { pull_request: "required" } },
    "test-meaningfulness": {
      run: MUTATION_TASK,
      ci: { pull_request: "optional" },
    },
  };

  it("derives required contexts, so the list stops being transcribed by hand", () => {
    expect(contextsFor(gates, { workflowName: QUALITY })).toEqual([
      `${QUALITY} / 🧹 Lint`,
    ]);
  });

  it("omits optional gates, which are not merge blockers", () => {
    expect(contextsFor(gates, { workflowName: QUALITY })).not.toContain(
      `${QUALITY} / 🧬 Mutation Testing Gate`
    );
  });

  it("keeps a retired label alive during a rename", () => {
    // Downstream repositories call the shared workflow unpinned, so a rename
    // lands everywhere before any ruleset is reconciled. Both contexts must
    // report or pull requests wait indefinitely — and the fastest way out of
    // that is deleting the requirement, which is how a rename removes a gate.
    const contexts = contextsFor(gates, {
      workflowName: QUALITY,
      previousLabels: ["🧹 Lint (legacy)"],
    });
    expect(contexts).toContain(`${QUALITY} / 🧹 Lint`);
    expect(contexts).toContain(`${QUALITY} / 🧹 Lint (legacy)`);
  });

  it("de-duplicates when a retired label equals a current one", () => {
    const contexts = contextsFor(gates, {
      workflowName: QUALITY,
      previousLabels: ["🧹 Lint"],
    });
    expect(contexts).toEqual([`${QUALITY} / 🧹 Lint`]);
  });

  it("scopes contexts to one environment", () => {
    // A gate required before a production deploy is not thereby a merge
    // blocker on a pull request. Collapsing the two would silently promote
    // every deploy-time gate into branch protection.
    const deployOnly = {
      "test-meaningfulness": {
        run: MUTATION_TASK,
        ci: { pull_request: "optional", production: "required" },
      },
    };
    expect(contextsFor(deployOnly, { workflowName: QUALITY })).toEqual([]);
    expect(
      contextsFor(deployOnly, {
        workflowName: QUALITY,
        environment: "production",
      })
    ).toEqual([`${QUALITY} / 🧬 Mutation Testing Gate`]);
  });

  it("requires a gate once even when several environments require it", () => {
    const contexts = contextsFor(
      {
        "code-style": {
          run: "lint",
          ci: { pull_request: "required", production: "required" },
        },
      },
      { workflowName: QUALITY }
    );
    expect(contexts).toEqual([`${QUALITY} / 🧹 Lint`]);
  });
});

describe("gateFloor", () => {
  it("implies traceability from a declared tracker", () => {
    expect(gateFloor({ tracker: "github" })).toEqual({
      traceability: 'tracker is "github"',
    });
  });

  it("implies credential readiness from a real provider", () => {
    expect(gateFloor({ secrets: { provider: "bitwarden" } })).toHaveProperty(
      "credential-availability"
    );
  });

  it("does not imply credential readiness from the env provider", () => {
    expect(gateFloor({ secrets: { provider: "env" } })).toEqual({});
  });

  it("implies nothing from an empty config", () => {
    expect(gateFloor({})).toEqual({});
  });
});
