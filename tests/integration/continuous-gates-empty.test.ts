/** Execute the seeded nightly guard and its real gate runner. */
import * as fs from "fs-extra";
import { load } from "js-yaml";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CreateOnlyStrategy } from "../../src/strategies/create-only.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const TEMPLATE = "all/create-only/.github/workflows/continuous-gates.yml";
const MOMENT = "continuous:production";
const CONFIG = ".lisa.config.json";
const PROVER = "proof";

/** The workflow fields exercised by this integration suite. */
interface Workflow {
  jobs: Record<
    string,
    {
      needs?: string | string[];
      with?: Record<string, unknown>;
      steps?: { id?: string; run?: string; env?: Record<string, string> }[];
    }
  >;
}

let project = "";

/**
 * Read the actual shipped workflow, never a copied shell fixture.
 * @param file Repository-relative workflow path.
 * @returns Parsed workflow.
 */
function workflow(file: string): Workflow {
  return load(fs.readFileSync(path.join(ROOT, file), "utf8")) as Workflow;
}

/**
 * Seed a host project with the same resolver and runner Lisa installs.
 * @param gates Configured gates, or absent config.
 */
function seed(gates?: object): void {
  const scripts = path.join(project, "scripts");
  fs.ensureDirSync(scripts);
  for (const name of ["lisa-gates.mjs", "lisa-run-gates.mjs", "lib"]) {
    fs.copySync(
      path.join(ROOT, "all/copy-overwrite/scripts", name),
      path.join(scripts, name)
    );
  }
  fs.writeJsonSync(path.join(project, "package.json"), {
    private: true,
    scripts: { [PROVER]: "node proof.cjs" },
  });
  if (gates !== undefined)
    fs.writeJsonSync(path.join(project, CONFIG), { gates });
}

/**
 * Execute a workflow step under the same fail-fast shell used by Actions.
 * @param file Workflow path.
 * @param id Step identifier.
 * @param moment Selected environment moment.
 * @returns Observed exit status and output.
 */
function execute(
  file: string,
  id: string,
  moment = MOMENT
): { status: number | null; output: string } {
  const step = Object.values(workflow(file).jobs)
    .flatMap(job => job.steps ?? [])
    .find(value => value.id === id);
  if (!step?.run) throw new Error(`${file} has no executable ${id} step`);
  const options = {
    cwd: project,
    encoding: "utf8" as const,
    timeout: 30_000,
    input: step.run,
    env: {
      ...process.env,
      GATE_MOMENT: moment,
      GITHUB_OUTPUT: path.join(project, "output"),
      GITHUB_STEP_SUMMARY: path.join(project, "summary"),
    },
  };
  const result = spawnSync("/bin/bash", ["-e", "-s"], options);
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-empty-nightly-"));
});
afterEach(() => {
  fs.removeSync(project);
});

describe("seeded nightly workflows require configured checks", () => {
  it.each([
    ["no gates block", undefined],
    ["empty block", {}],
    [
      "another moment",
      {
        "x-proof": {
          "pre-deploy:production": "required",
          run: PROVER,
        },
      },
    ],
    [
      "another environment",
      {
        "x-proof": { "continuous:staging": "required", run: PROVER },
      },
    ],
    ["disabled gate", { "x-proof": { [MOMENT]: "off", run: PROVER } }],
  ])("fails clearly for %s", (_name, gates) => {
    seed(gates);
    const result = execute(TEMPLATE, "require_gates");
    expect(result.status).toBe(1);
    expect(result.output).toContain(MOMENT);
    expect(result.output).toContain("No checks ran");
    expect(result.output).toContain(CONFIG);
  });

  it.each([0, 1])("preserves a configured prover's exit %i", exit => {
    seed({
      "x-proof": { [MOMENT]: { level: "required", run: PROVER } },
    });
    fs.writeFileSync(
      path.join(project, "proof.cjs"),
      `require('node:fs').writeFileSync('proof-ran', 'yes'); process.exit(${exit});`
    );
    expect(execute(TEMPLATE, "require_gates").status).toBe(0);
    const result = execute(".github/workflows/gates.yml", "gates");
    expect(result.status, result.output).toBe(exit);
    expect(fs.readFileSync(path.join(project, "proof-ran"), "utf8")).toBe(
      "yes"
    );
  });

  it("blocks unreadable config and a missing resolver", () => {
    seed();
    fs.writeFileSync(path.join(project, CONFIG), "{broken");
    expect(execute(TEMPLATE, "require_gates").status).not.toBe(0);
    fs.removeSync(path.join(project, "scripts/lisa-gates.mjs"));
    const result = execute(TEMPLATE, "require_gates");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("lisa apply");
  });

  it("holds execution behind the guard and uses the same environment", () => {
    const jobs = workflow(TEMPLATE).jobs;
    expect([jobs.continuous?.needs].flat()).toContain("configured");
    const guard = jobs.configured?.steps?.find(
      step => step.id === "require_gates"
    );
    expect(guard?.env?.GATE_MOMENT).toBe(jobs.continuous?.with?.moment);
    expect(guard?.run).not.toContain("${{");
  });

  it("preserves an existing project-owned nightly workflow", async () => {
    const dest = path.join(project, ".github/workflows/continuous-gates.yml");
    fs.outputFileSync(dest, "# project-owned nightly workflow\n");
    const result = await new CreateOnlyStrategy().apply(
      path.join(ROOT, TEMPLATE),
      dest,
      ".github/workflows/continuous-gates.yml",
      {
        config: {
          lisaDir: ROOT,
          destDir: project,
          dryRun: false,
          yesMode: true,
          validateOnly: false,
          skipGitCheck: false,
          harness: "claude",
        },
        backupFile: async () => {},
        promptOverwrite: async () => true,
      }
    );
    expect(result.action).toBe("skipped");
    expect(fs.readFileSync(dest, "utf8")).toBe(
      "# project-owned nightly workflow\n"
    );
  });
});
