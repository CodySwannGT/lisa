/**
 * The `environment-prepare` reusable workflow.
 *
 * Three properties carry the weight here, and each is asserted against the
 * workflow's real content rather than against a description of it:
 *
 * 1. **It refuses a pull-request event.** The gate registry deliberately points
 *    `environment-reset` at `environment:reset:verify` rather than at the reset
 *    itself, so that declaring the gate required cannot converge a shared
 *    environment on every pull request. This workflow runs the real thing, so
 *    it must not reopen that hazard from the other side.
 * 2. **An unresolvable script FAILS.** A caller asked for a prepared
 *    environment; concluding green without having prepared one is the defect
 *    the whole subsystem exists to prevent, and it would be indistinguishable
 *    from a healthy run. The resolution snippet is EXECUTED here, both with the
 *    script present and with it absent, because a `grep` for `exit 1` proves
 *    the line exists and nothing about whether it is reached.
 * 3. **`environment` has no default.** A default that is safe in one repo is
 *    the production default in another.
 * @module tests/integration/environment-prepare-workflow
 */

import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "environment-prepare.yml"
);

const SCRIPT_NAME = "lisa-environment-prepare.mjs";

/** Absolute, so the shell under test is never resolved through PATH. */
const BASH = "/bin/bash";

/**
 * The parsed workflow.
 * @returns The workflow document.
 */
function workflow(): {
  on: { workflow_call: { inputs: Record<string, unknown> } };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    { steps: { name: string; if?: string; run?: string }[] }
  >;
} {
  return yaml.load(readFileSync(WORKFLOW_PATH, "utf8")) as ReturnType<
    typeof workflow
  >;
}

/**
 * The steps of the single job.
 * @returns The step list.
 */
function steps() {
  return workflow().jobs.prepare.steps;
}

/**
 * Run the resolution half of the prepare step in a throwaway directory.
 *
 * Only the resolution is extracted — the final `node "$PREPARE" ...` line is
 * dropped so the test never invokes a real verb. What is under test is which
 * branch the shell takes, not what the script then does.
 * @param present Whether a resolvable script exists in the sandbox.
 * @returns The exit status and combined output.
 */
function runResolution(present: boolean): { status: number; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-prepare-"));
  if (present) {
    const nested = path.join(dir, "scripts");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, SCRIPT_NAME), "// stand-in\n");
  }

  const prepareStep = steps().find(step =>
    step.name.includes("Prepare the environment")
  );
  const lines = String(prepareStep?.run ?? "").split("\n");
  const kept = lines.filter(line => !line.trim().startsWith('node "$PREPARE"'));
  // The strip must actually strip. A renamed or reshaped invocation line would
  // otherwise leave this test running the REAL verb invocation in a sandbox,
  // which would either fail for the wrong reason or, worse, succeed.
  if (kept.length === lines.length) {
    throw new Error("the verb invocation line was not found to strip");
  }
  const script = kept.join("\n");
  writeFileSync(path.join(dir, "resolve.sh"), script);

  try {
    const output = execFileSync(BASH, ["resolve.sh"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, TARGET: "dev", VERBS: "reset,reseed" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("environment-prepare — refusing a pull-request event", () => {
  it("carries a refusal step guarded on both pull-request events", () => {
    const refusal = steps().find(step =>
      step.name.includes("Refuse to prepare")
    );

    expect(refusal).toBeDefined();
    // `pull_request_target` matters as much as `pull_request`: it is the
    // trigger that still fires when the merge ref cannot be built, and it runs
    // with the base repository's token.
    expect(refusal?.if).toContain("pull_request");
    expect(refusal?.if).toContain("pull_request_target");
  });

  it("puts the refusal before the checkout, so nothing is fetched first", () => {
    const names = steps().map(step => step.name);
    const refusalAt = names.findIndex(name =>
      name.includes("Refuse to prepare")
    );
    const checkoutAt = names.findIndex(name => name.includes("Checkout"));

    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(refusalAt).toBeLessThan(checkoutAt);
  });
});

describe("environment-prepare — script resolution", () => {
  it("fails when no candidate resolves", () => {
    const { status, output } = runResolution(false);

    expect(status).not.toBe(0);
    expect(output).toContain("was not found");
  });

  it("succeeds when a candidate resolves", () => {
    // The positive control. Without it, the failing case above is equally
    // consistent with a snippet that cannot run at all — which would make this
    // suite pass while proving nothing about the branch it claims to test.
    const { status } = runResolution(true);

    expect(status).toBe(0);
  });
});

describe("environment-prepare — inputs and permissions", () => {
  it("requires environment and gives it no default", () => {
    const input = workflow().on.workflow_call.inputs.environment as {
      required: boolean;
      default?: unknown;
    };

    expect(input.required).toBe(true);
    expect(input.default).toBeUndefined();
  });

  it("requires both verbs by default", () => {
    const input = workflow().on.workflow_call.inputs.verbs as {
      default: string;
    };

    expect(input.default).toBe("reset,reseed");
  });

  it("declares least-privilege permissions at workflow level only", () => {
    // A called workflow may only DOWNGRADE its caller's grant, and a scope
    // requested here that a caller does not hold is a startup_failure for the
    // entire run — decided before any `if:` is evaluated.
    expect(workflow().permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow().jobs)) {
      expect(job).not.toHaveProperty("permissions");
    }
  });
});
