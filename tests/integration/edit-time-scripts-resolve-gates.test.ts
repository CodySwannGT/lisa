/**
 * The edit-time scripts must resolve their gate before running anything.
 *
 * #2839 made the agent tool boundary REPRESENTABLE — the moments exist, gates
 * list them, a declaration validates clean — and nothing read it. The scripts
 * still resolved a RUNNER (`./node_modules/.bin/oxlint`, else `bunx`/`npx`)
 * and hardcoded the TOOL, which is the inversion the registry exists to fix,
 * and they exit 2 — refusing the edit — when the written-in binary or config
 * filename is absent. A project that lints correctly with something else had
 * every agent write refused until it installed Lisa's choice.
 *
 * WHAT THIS SUITE EXECUTES. The shipped scripts, unmodified, with a JSON
 * payload on stdin, in a temporary project. Not greps: whether a declaration
 * is consulted is a question about what RUNS, and a grep for the helper's name
 * passes against a call on an unreachable branch.
 *
 * THE EQUIVALENCE CONTROL is the one most likely to be waved through as
 * "obviously fine", and it is the one that catches a façade silently changing
 * what runs for the overwhelming majority of projects, which declare nothing.
 * It runs the PRE-CHANGE script — recovered from git, not reconstructed — and
 * the shipped one against the same fixture and compares what each invoked.
 *
 * @module tests/integration/edit-time-scripts-resolve-gates
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** Wall-clock ceiling for one script run. */
const SCRIPT_TIMEOUT_MS = 30_000;

/** The settings file every one of these scripts now consults. */
const CONFIG_FILE = ".lisa.config.json";

/** The shared façade helper, by basename. */
const HELPER = "lisa-edit-gate.sh";

/** The exit status an on-edit hook uses to refuse a write. */
const REFUSED = 2;

/** The TypeScript file the TypeScript-surface subjects act on. */
const TS_FILE = "src/thing.ts";

/** Its contents. */
const TS_SOURCE = "export const thing = 1;\n";

/** The task the fixture declares, and the trace line proving it ran. */
const DECLARED_TASK = "lint:edited";

/**
 * The stub runner every declared task resolves through.
 *
 * Records the task instead of running it, so "which prover ran" is observable
 * without installing five toolchains.
 */
const RUNNER_STUB =
  '#!/bin/sh\nif [ "$1" = "run" ]; then echo "TASK:$2" >> "$LISA_TRACE"; exit 0; fi\nexit 0\n';

/** One shipped edit-time script and what it proves. */
interface Subject {
  /** Repository-relative path to the shipped source script. */
  script: string;
  /** Basename of its pinned pre-façade snapshot. */
  before: string;
  /** Every registry gate one invocation of it proves. */
  gates: readonly string[];
  /** A file it acts on, relative to the fixture project. */
  file: string;
  /** Contents to write at that path. */
  contents: string;
}

/**
 * The Claude-surface scripts, which take one path from `tool_input.file_path`.
 *
 * The Codex copies take a list through a shared extractor and are covered by
 * the derived-population control below rather than executed here: their
 * harness contract differs, and a suite that ran them through the Claude
 * payload would be testing a shape neither surface uses.
 */
const SUBJECTS: readonly Subject[] = [
  {
    script: "plugins/src/typescript/hooks/lint-on-edit.sh",
    before: "typescript-lint-on-edit.sh",
    gates: ["code-style"],
    file: TS_FILE,
    contents: TS_SOURCE,
  },
  {
    script: "plugins/src/typescript/hooks/format-on-edit.sh",
    before: "typescript-format-on-edit.sh",
    gates: ["format-conformance"],
    file: TS_FILE,
    contents: TS_SOURCE,
  },
  {
    script: "plugins/src/typescript/hooks/sg-scan-on-edit.sh",
    before: "typescript-sg-scan-on-edit.sh",
    gates: ["structural-rules"],
    file: TS_FILE,
    contents: TS_SOURCE,
  },
  {
    script: "plugins/src/rails/hooks/rubocop-on-edit.sh",
    before: "rails-rubocop-on-edit.sh",
    gates: ["code-style", "format-conformance"],
    file: "app/thing.rb",
    contents: "class Thing\nend\n",
  },
  {
    script: "plugins/src/rails/hooks/sg-scan-on-edit.sh",
    before: "rails-sg-scan-on-edit.sh",
    gates: ["structural-rules"],
    file: "app/thing.rb",
    contents: "class Thing\nend\n",
  },
];

/**
 * Where the pre-façade snapshot of each script is pinned.
 *
 * CHECKED IN, not read from `origin/main`, and the reason is not merely that
 * CI's shallow checkout has no such ref — though it does not, which is how
 * this was found. Reading the default branch means that the moment this work
 * merges, the "before" and the "after" become the SAME FILE and the comparison
 * passes by comparing the new script against itself. A control that silently
 * stops testing is the exact defect this epic exists to remove, and it would
 * have arrived on the merge that closed the ticket.
 *
 * The snapshots are byte-exact `git show` output from the commit before the
 * façade landed, and they are immutable: the question "does an undeclared
 * project still get the pre-façade command" does not change its meaning as the
 * scripts evolve.
 */
const PRE_FACADE = "tests/fixtures/edit-time-pre-facade";

describe("edit-time scripts resolve their gate before running anything", () => {
  let projectDir = "";
  let binDir = "";
  let traceFile = "";

  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edit-gate-"));
    projectDir = path.join(root, "project");
    binDir = path.join(root, "bin");
    traceFile = path.join(root, "trace.log");
    await fs.ensureDir(path.join(projectDir, "src"));
    await fs.ensureDir(path.join(projectDir, "app"));
    await fs.ensureDir(binDir);
    await fs.writeFile(traceFile, "");
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "fixture",
      version: "1.0.0",
      scripts: { [DECLARED_TASK]: "echo declared-task-ran" },
    });
    await fs.writeFile(path.join(projectDir, "Gemfile"), "source 'x'\n");
    // Every tool the built-in path could reach records the fact instead of
    // running. That is what makes "which prover ran" observable without
    // installing five toolchains.
    for (const tool of [
      "oxlint",
      "prettier",
      "ast-grep",
      "sg",
      "bundle",
      "npx",
      "bunx",
    ]) {
      await fs.writeFile(
        path.join(binDir, tool),
        `#!/bin/sh\necho "TOOL:${tool}" >> "$LISA_TRACE"\nexit 0\n`,
        { mode: 0o755 }
      );
    }
    await fs.writeFile(path.join(binDir, "bun"), RUNNER_STUB, { mode: 0o755 });
  });

  afterEach(async () => {
    await fs.remove(path.dirname(projectDir));
  });

  /**
   * Copies one shipped script, plus the façade helper, into the fixture.
   * @param source The script's text.
   * @param withHelper Whether to install the helper beside it.
   * @returns Absolute path to the installed script.
   */
  const install = async (
    source: string,
    withHelper: boolean
  ): Promise<string> => {
    const hookDir = path.join(projectDir, ".hooks");
    await fs.ensureDir(hookDir);
    const installed = path.join(hookDir, "hook.sh");
    await fs.writeFile(installed, source, { mode: 0o755 });
    const helper = path.join(hookDir, HELPER);
    if (withHelper) {
      await fs.copy(
        path.join(REPO_ROOT, "plugins/src/typescript/hooks", HELPER),
        helper
      );
      await fs.copy(
        path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-gates.mjs"),
        path.join(projectDir, "scripts/lisa-gates.mjs")
      );
      // The registry imports its helpers by relative path, so the installed
      // copy is a directory beside it, not a lone file.
      await fs.copy(
        path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib"),
        path.join(projectDir, "scripts/lib")
      );
    } else if (await fs.pathExists(helper)) {
      await fs.remove(helper);
    }
    return installed;
  };

  /**
   * Runs one installed script against one edited file.
   * @param installed Absolute path to the script.
   * @param file Project-relative path of the edited file.
   * @returns Exit status, output, and the trace of what it invoked.
   */
  const run = async (
    installed: string,
    file: string
  ): Promise<{ status: number; output: string; trace: string }> => {
    await fs.writeFile(traceFile, "");
    const absolute = path.join(projectDir, file);
    const result = spawnSync(BASH, [installed], {
      cwd: projectDir,
      encoding: "utf8",
      timeout: SCRIPT_TIMEOUT_MS,
      input: JSON.stringify({ tool_input: { file_path: absolute } }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        LISA_TRACE: traceFile,
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    });
    if (result.signal !== null) {
      throw new Error(
        `${installed} was KILLED (${result.signal}) rather than completing.`
      );
    }
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      trace: await fs.readFile(traceFile, "utf8"),
    };
  };

  /**
   * Writes a gates block declaring every property one subject proves.
   * @param subject The script under test.
   * @param task The task each gate should name.
   */
  const declare = async (subject: Subject, task: string): Promise<void> => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      gates: {
        runner: "bun run",
        ...Object.fromEntries(
          subject.gates.map(gate => [
            gate,
            { "post-tool": { level: "required", run: task } },
          ])
        ),
      },
    });
  };

  describe("a project that declares its own task gets it", () => {
    it.each(SUBJECTS)("$script runs the declared task", async subject => {
      await fs.writeFile(path.join(projectDir, subject.file), subject.contents);
      await declare(subject, DECLARED_TASK);
      const installed = await install(
        await fs.readFile(path.join(REPO_ROOT, subject.script), "utf8"),
        true
      );

      const { status, trace } = await run(installed, subject.file);

      expect(trace).toContain(`TASK:${DECLARED_TASK}`);
      expect(status).toBe(0);
    });

    it.each(SUBJECTS)(
      "$script does not reach for its own tool once a task is declared",
      async subject => {
        await fs.writeFile(
          path.join(projectDir, subject.file),
          subject.contents
        );
        await declare(subject, DECLARED_TASK);
        const installed = await install(
          await fs.readFile(path.join(REPO_ROOT, subject.script), "utf8"),
          true
        );

        const { trace } = await run(installed, subject.file);

        expect(trace).not.toContain("TOOL:");
      }
    );
  });

  describe("a missing tool no longer refuses the edit", () => {
    it.each(SUBJECTS)(
      "$script does not exit 2 when Lisa's binary and config are both absent",
      async subject => {
        // The sharper half of the criterion. These scripts exit 2 — refusing
        // the write — when their hardcoded binary or their hardcoded config
        // filename is missing. With a declaration in place neither is
        // consulted, so neither can refuse.
        await fs.writeFile(
          path.join(projectDir, subject.file),
          subject.contents
        );
        await declare(subject, DECLARED_TASK);
        await fs.remove(binDir);
        await fs.ensureDir(binDir);
        await fs.writeFile(path.join(binDir, "bun"), RUNNER_STUB, {
          mode: 0o755,
        });
        const installed = await install(
          await fs.readFile(path.join(REPO_ROOT, subject.script), "utf8"),
          true
        );

        const { status } = await run(installed, subject.file);

        expect(status).not.toBe(REFUSED);
      }
    );
  });

  describe("a script proving two properties stands down only for both", () => {
    const rails = SUBJECTS.find(subject => subject.gates.length > 1);

    it("has a multi-property script to assert about", () => {
      // Without this the case below silently generates nothing the day the
      // Rails hook stops proving two properties.
      expect(rails).toBeDefined();
      expect(rails?.gates.length).toBeGreaterThan(1);
    });

    it("still runs its built-in when only one property is covered", async () => {
      const subject = rails as Subject;
      await fs.writeFile(path.join(projectDir, subject.file), subject.contents);
      await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
        gates: {
          runner: "bun run",
          [subject.gates[0] as string]: {
            "post-tool": { level: "required", run: DECLARED_TASK },
          },
        },
      });
      const installed = await install(
        await fs.readFile(path.join(REPO_ROOT, subject.script), "utf8"),
        true
      );

      const { trace } = await run(installed, subject.file);

      // Standing down on one covered property would silently stop proving the
      // other, which the hook's own header says it proves.
      expect(trace).not.toContain(`TASK:${DECLARED_TASK}`);
      expect(trace).toContain("TOOL:");
    });
  });

  describe("an undeclared project sees no change", () => {
    it.each(SUBJECTS)(
      "$script invokes the same thing before and after the façade change",
      async subject => {
        // EXECUTABLE, not argued, and pinned against an immutable snapshot so
        // it keeps meaning the same thing after this merges.
        const before = await fs.readFile(
          path.join(REPO_ROOT, PRE_FACADE, subject.before),
          "utf8"
        );
        const after = await fs.readFile(
          path.join(REPO_ROOT, subject.script),
          "utf8"
        );
        // The snapshot must genuinely BE the "before": one that had already
        // grown the façade would make this compare the change to itself.
        expect(before).not.toContain("lisa_edit_gate_tasks");
        expect(after).toContain("lisa_edit_gate_tasks");

        await fs.writeFile(
          path.join(projectDir, subject.file),
          subject.contents
        );
        await fs.remove(path.join(projectDir, CONFIG_FILE));

        const beforeRun = await run(await install(before, false), subject.file);
        const afterRun = await run(await install(after, true), subject.file);

        expect(afterRun.trace).toEqual(beforeRun.trace);
        expect(afterRun.status).toBe(beforeRun.status);
      }
    );
  });
});
