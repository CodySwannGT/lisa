/**
 * Behavioral tests for the preflight per-flow `appId` lint — these EXECUTE the
 * workflow's own shell, pulled verbatim out of the YAML, against fixture flow
 * trees on disk.
 *
 * The lint exists because its failure mode is silent. The app id reaches flows
 * as `-e MAESTRO_APP_ID=…`, so a flow naming `${APP_ID}` interpolates to an
 * EMPTY app id and Maestro reports a launch failure that names no cause — a
 * red suite that reads as a broken app and is a one-line config error, found
 * only after an EAS build and an emulator boot have been paid for.
 *
 * So the load-bearing case here is the FAILING one: a lint asserted only to
 * pass a healthy tree has never been shown to catch anything. Every check
 * below is paired — the clean tree must pass AND the specific defect must fail
 * by name.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** A flow file to write into the fixture tree, keyed by repo-relative path. */
type FlowTree = Record<string, string>;

/** A flow that declares the app id correctly. */
const GOOD_FLOW = `appId: \${MAESTRO_APP_ID}
---
- launchApp
- assertVisible: "Home"
`;

/** A flow naming the variable the workflow does NOT forward. */
const WRONG_VARIABLE_FLOW = `appId: \${APP_ID}
---
- launchApp
`;

/**
 * A leftover debug artifact under the Maestro root that WOULD match the
 * ${APP_ID} scan if the scan read it. Deliberately plain ASCII with no
 * padding: pad it with spaces and a formatter can rewrite them, pad it with
 * NUL and grep binary-suppresses the file — either way the fixture would
 * stop proving that `--include` is what excludes it.
 */
const DEBUG_ARTIFACT = `appId: \${APP_ID}\n`;

/** A flow with no appId at all — a subflow shape, in the wrong place. */
const NO_APP_ID_FLOW = `---
- tapOn: "Continue"
`;

describe("maestro-native-e2e per-flow appId lint (executed)", () => {
  let workflow: ReusableWorkflow;
  let lintScript: string;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
    const step = (workflow.jobs.preflight.steps ?? []).find(candidate =>
      candidate.name?.includes("Lint per-flow appId")
    );
    if (!step?.run) {
      throw new Error("no `Lint per-flow appId` step in the preflight job");
    }
    lintScript = step.run;
  });

  /**
   * Runs the real lint against a fixture tree.
   * @param tree - Files to create, keyed by path relative to the fixture root
   * @param flowsDir - The `flows_dir` input the caller passed
   * @returns The lint's exit status and combined output
   */
  const lint = async (
    tree: FlowTree,
    flowsDir = ".maestro/flows"
  ): Promise<{ status: number; output: string }> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-appid-"));
    try {
      for (const [relative, contents] of Object.entries(tree)) {
        const target = path.join(dir, relative);
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, contents);
      }
      try {
        const stdout = execFileSync(BASH, ["-c", lintScript], {
          cwd: dir,
          env: { ...process.env, FLOWS_DIR: flowsDir },
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { status: 0, output: stdout };
      } catch (error) {
        const failure = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          status: failure.status ?? -1,
          output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
        };
      }
    } finally {
      await fs.remove(dir);
    }
  };

  it("PASSES a tree where every flow declares appId: ${MAESTRO_APP_ID}", async () => {
    const result = await lint({
      ".maestro/flows/sign-in.yaml": GOOD_FLOW,
      ".maestro/flows/browse.yml": GOOD_FLOW,
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("every flow under '.maestro/flows'");
  });

  it("FAILS a flow that omits appId, and names the file", async () => {
    // The load-bearing case. Without this the lint could be a no-op and every
    // other assertion here would still pass.
    const result = await lint({
      ".maestro/flows/sign-in.yaml": GOOD_FLOW,
      ".maestro/flows/browse.yaml": NO_APP_ID_FLOW,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "::error title=Maestro flow declares no appId::"
    );
    expect(result.output).toContain(".maestro/flows/browse.yaml");
    // Naming the innocent file would send the reader to the wrong place.
    expect(result.output).not.toContain("flows/sign-in.yaml");
  });

  it("FAILS a flow naming ${APP_ID}, the variable this workflow does not forward", async () => {
    const result = await lint({
      ".maestro/flows/sign-in.yaml": WRONG_VARIABLE_FLOW,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "::error title=Maestro flow uses the wrong app id variable::"
    );
    expect(result.output).toContain("interpolates to EMPTY");
    expect(result.output).toContain(".maestro/flows/sign-in.yaml");
  });

  it("FAILS a shared SUBFLOW outside the flows directory — the drift that started this", async () => {
    // The measured shape: every flow declared MAESTRO_APP_ID while the shared
    // subflow beside them still said APP_ID. A lint scanning only the flows
    // directory passes that tree and the suite still dies on launch, which is
    // why the ${APP_ID} scan covers the Maestro ROOT.
    const result = await lint({
      ".maestro/flows/sign-in.yaml": GOOD_FLOW,
      ".maestro/shared/open-app.yaml": WRONG_VARIABLE_FLOW,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("wrong app id variable");
    expect(result.output).toContain(".maestro/shared/open-app.yaml");
  });

  it("does not read debug artifacts left under the Maestro root", async () => {
    // grep reports ZERO matches in a file it decides is binary, so an
    // unfiltered recursive scan can pass by refusing to read. The `--include`
    // filters keep the scan to files that are actually flows — proven here by
    // a fixture that would otherwise match.
    const result = await lint({
      ".maestro/flows/sign-in.yaml": GOOD_FLOW,
      ".maestro/screenshot.png": DEBUG_ARTIFACT,
    });
    expect(result.status).toBe(0);
  });

  it("handles a flows_dir with no parent path component", async () => {
    // `dirname flows` is `.`, and scanning the repo ROOT for ${APP_ID} would
    // walk node_modules. The step falls back to the flows directory itself.
    const clean = await lint({ "flows/sign-in.yaml": GOOD_FLOW }, "flows");
    expect(clean.status).toBe(0);

    const dirty = await lint(
      { "flows/sign-in.yaml": WRONG_VARIABLE_FLOW },
      "flows"
    );
    expect(dirty.status).toBe(1);
    expect(dirty.output).toContain("wrong app id variable");
  });

  it("tolerates leading whitespace and both file extensions", async () => {
    const result = await lint({
      ".maestro/flows/a.yaml": `  appId: \${MAESTRO_APP_ID}\n---\n- launchApp\n`,
      ".maestro/flows/b.yml": GOOD_FLOW,
    });
    expect(result.status).toBe(0);
  });
});

describe("maestro-native-e2e per-flow appId lint contract", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("is OFF by default — four repositories consume this reusable", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    expect(inputs.lint_flow_app_id?.default).toBe(false);
    expect(inputs.lint_flow_app_id?.type).toBe("boolean");
  });

  it("runs only when opted in AND the prerequisites held", () => {
    const step = (workflow.jobs.preflight.steps ?? []).find(candidate =>
      candidate.name?.includes("Lint per-flow appId")
    );
    // The second clause matters: an unwired adopter has no flows directory,
    // and failing there would convert warn-and-skip into a red for reasons
    // that belong to `require_prerequisites` rather than to this lint.
    expect(step?.if).toBe(
      "${{ inputs.lint_flow_app_id && steps.check.outputs.should_run == 'true' }}"
    );
    // Caller-supplied, so it travels through `env:` — a `${{ }}` expansion
    // inside the script body would make `flows_dir` workflow SOURCE.
    expect(step?.env?.FLOWS_DIR).toBe("${{ inputs.flows_dir }}");
    expect(step?.run).not.toContain("${{ inputs.flows_dir }}");
  });

  it("keeps the two build-reuse inputs off by default too", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    expect(inputs.reuse_build_by_fingerprint?.default).toBe(false);
    expect(inputs.reuse_build_by_fingerprint?.type).toBe("boolean");
    expect(inputs.diagnose_eas_quota_exhaustion?.default).toBe(false);
    expect(inputs.diagnose_eas_quota_exhaustion?.type).toBe("boolean");
  });
});
