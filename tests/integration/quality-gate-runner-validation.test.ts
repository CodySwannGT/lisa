/**
 * Proves a `gates.runner` that cannot run a task is REFUSED, by execution.
 *
 * One key in a host's `.lisa.config.json` used to switch off the entire gate
 * registry and report green. `"runner": ":"` resolved cleanly, every facade
 * ran `: <task>` — the shell's no-op builtin, exit 0 — and the built-in
 * fallbacks stayed skipped because they are gated on `configured == 'false'`
 * and resolution had SUCCEEDED. Both layers off, green, silent. `true` did the
 * same, and the JSON boolean `true` got there through coercion:
 * `RegExp.prototype.test(true)` examines the string "true" and passes.
 *
 * Every assertion here runs the real thing. The resolve block is pulled
 * verbatim out of the workflow and executed under `bash`, and the resolver is
 * executed as its own process, because the property under test is an EXIT
 * CODE. The predecessor test string-matched the YAML for the validator and
 * passed for the whole period the validator permitted `:`.
 *
 * Both halves are exercised SEPARATELY as well as together. The resolver now
 * refuses first, which would leave the facade's own copy of the check
 * unreached — and a host resolving through an older installed package gets
 * exactly that resolver. So the facade is also run against a stub resolver
 * that hands it a clean gate, proving its guard bites on its own.
 *
 * @module tests/integration/quality-gate-runner-validation
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GATES_SCRIPT, resolveStep } from "./quality-gate-facade-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The interpreter running this suite, rather than whatever $PATH offers. */
const NODE = process.execPath;

/** The job whose resolve block stands in for all nineteen copies. */
const JOB_ID = "lint";

/** The gate that job resolves. */
const GATE_ID = "code-style";

/** Where the facade looks for a project-local resolver. */
const RESOLVER_RELATIVE = path.join("scripts", "lisa-gates.mjs");

/** The moment the fixture configs declare their gate at. */
const MOMENT = "pull-request";

/** The output line that means "the project's own gate task will run". */
const RESOLVED = "configured=true";

/** The runner the fixture uses whenever it must be accepted. */
const GOOD_RUNNER = "bun run";

/**
 * A resolver that always reports one runnable gate.
 *
 * Stands in for an older installed `@codyswann/lisa` whose resolver has no
 * runner validation — the case in which the facade's own check is the only
 * thing between a host's JSON and a shell.
 */
const PERMISSIVE_RESOLVER = `#!/usr/bin/env node
console.log(
  JSON.stringify([
    {
      id: ${JSON.stringify(GATE_ID)},
      level: "required",
      mode: "run",
      task: "lint",
    },
  ])
);
`;

/**
 * The resolve step's shell source, as GitHub Actions would run it.
 * @returns The `run:` block.
 */
function resolveBlock(): string {
  const script = resolveStep(JOB_ID)?.run ?? "";
  expect(
    script,
    `quality.yml job '${JOB_ID}' must have a resolve step`
  ).toBeTruthy();
  // The block carries no `${{ }}` expressions of its own, so it runs as
  // written; the step's env supplies everything the workflow interpolates.
  expect(script).not.toContain("${{");
  return script;
}

/** Every value that must never become a runner, and what it is. */
const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ["the JSON boolean true", true],
  ["the shell no-op builtin", ":"],
  ["the string true", "true"],
  ["the string false", "false"],
  ["echo", "echo"],
  ["printf", "printf"],
  ["null", null],
  ["a number", 0],
  ["an array", []],
  ["an object", {}],
  ["an empty string", ""],
  ["whitespace", "   "],
  ["an injection attempt", "npm; rm -rf /"],
];

describe("🎛️ gates.runner validation", () => {
  let workdir = "";
  let output = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-runner-"));
    output = path.join(workdir, "github-output.txt");
    await fs.writeFile(output, "");
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(GATES_SCRIPT, path.join(workdir, RESOLVER_RELATIVE));
    // The resolver imports a sibling helper, so a lone copy cannot start.
    await fs.copy(
      path.join(path.dirname(GATES_SCRIPT), "lib"),
      path.join(workdir, "scripts", "lib")
    );
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Writes a `.lisa.config.json` declaring one gate and one runner.
   * @param runner The `gates.runner` value verbatim, non-strings included.
   *   `undefined` omits the key.
   * @param task The task the gate declares.
   */
  async function writeConfig(runner: unknown, task = "lint"): Promise<void> {
    const gates: Record<string, unknown> = {
      [GATE_ID]: { [MOMENT]: "required", run: task },
    };
    if (runner !== undefined) gates.runner = runner;
    await fs.writeJson(path.join(workdir, ".lisa.config.json"), { gates });
  }

  /** Replaces the shipped resolver with one that validates nothing. */
  async function installPermissiveResolver(): Promise<void> {
    await fs.writeFile(
      path.join(workdir, RESOLVER_RELATIVE),
      PERMISSIVE_RESOLVER
    );
  }

  /**
   * Runs the facade's resolve step against the fixture.
   * @returns Exit status, combined output, and what reached $GITHUB_OUTPUT.
   */
  function runResolve(): {
    status: number;
    output: string;
    githubOutput: string;
  } {
    const result = spawnSync(BASH, ["-c", resolveBlock()], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        GATE_ID,
        GATE_MOMENT: MOMENT,
        FALLBACK_RUNNER: "npm run",
        GITHUB_OUTPUT: output,
      },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      githubOutput: fs.readFileSync(output, "utf8"),
    };
  }

  /**
   * Runs the shipped resolver directly, the way the facade invokes it.
   * @returns Exit status and combined output.
   */
  function runResolver(): { status: number; output: string } {
    const result = spawnSync(
      NODE,
      [
        path.join(workdir, RESOLVER_RELATIVE),
        "list",
        `--moment=${MOMENT}`,
        "--json",
        "--include-off",
      ],
      { cwd: workdir, encoding: "utf8" }
    );
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  describe("the facade, on its own", () => {
    it.each(REFUSED)("refuses %s", async (_label, runner) => {
      // A permissive resolver hands the facade a clean gate, so the ONLY
      // thing that can refuse the runner here is the facade's own check.
      await installPermissiveResolver();
      await writeConfig(runner);

      const { status, output: text, githubOutput } = runResolve();

      expect(status).not.toBe(0);
      expect(text).toContain("::error");
      expect(githubOutput).not.toContain(RESOLVED);
    });

    it("still resolves an ordinary runner", async () => {
      // The other direction: hardening must not redden a correct config.
      await installPermissiveResolver();
      await writeConfig(GOOD_RUNNER);

      const { status, githubOutput } = runResolve();

      expect(status).toBe(0);
      expect(githubOutput).toContain(RESOLVED);
      expect(githubOutput).toContain(`runner=${GOOD_RUNNER}`);
      expect(githubOutput).toContain("task=lint");
    });

    it("falls back to the package manager when no runner is declared", async () => {
      await installPermissiveResolver();
      await writeConfig(undefined);

      const { status, githubOutput } = runResolve();

      expect(status).toBe(0);
      expect(githubOutput).toContain("runner=npm run");
    });
  });

  describe("the resolver, at the source", () => {
    it.each(REFUSED)("refuses %s", async (_label, runner) => {
      // Reported once where the value is read, rather than nineteen times at
      // the consumers. The facade pipes this through `set -euo pipefail`.
      await writeConfig(runner);

      const { status, output: text } = runResolver();

      expect(status).not.toBe(0);
      expect(text).toContain("gates.runner");
    });

    it("still lists gates for an ordinary runner", async () => {
      await writeConfig(GOOD_RUNNER);

      const { status, output: text } = runResolver();

      expect(status).toBe(0);
      expect(JSON.parse(text)).toContainEqual(
        expect.objectContaining({ id: GATE_ID, command: `${GOOD_RUNNER} lint` })
      );
    });
  });

  describe("the two together", () => {
    it.each(REFUSED)("fails the whole step for %s", async (_label, runner) => {
      // What CI actually sees: shipped resolver, real facade, nothing green.
      await writeConfig(runner);

      const { status, githubOutput } = runResolve();

      expect(status).not.toBe(0);
      expect(githubOutput).not.toContain(RESOLVED);
    });

    it("still accepts a task carrying a colon", async () => {
      // The runner lost `:` from its character class; the TASK must keep it.
      // Real gate tasks are `test:cov`, `lint:staged`, `sg:scan`.
      await writeConfig(GOOD_RUNNER, "test:cov");

      const { status, githubOutput } = runResolve();

      expect(status).toBe(0);
      expect(githubOutput).toContain("task=test:cov");
    });
  });

  describe("why these values are refused rather than discouraged", () => {
    it.each([":", "true", "echo"])(
      "%s reports success while running nothing",
      runner => {
        // Each returns 0 with a task that does not exist, so the gate is
        // green — and the fallback, `if: configured == 'false'`, is skipped
        // too, because resolution succeeded.
        const result = spawnSync(
          BASH,
          ["-c", `${runner} definitely-not-a-real-task`],
          { cwd: REPO_ROOT, encoding: "utf8" }
        );

        expect(result.status).toBe(0);
      }
    );
  });
});
