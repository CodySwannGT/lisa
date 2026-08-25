/**
 * The executable harness the `PreToolUse` refusal controls share.
 *
 * One temporary project, one stub runner, one no-jq PATH, and one way to run a
 * shipped script against a proposed write. It lives here rather than inside a
 * suite because two suites drive it and a second copy would let them disagree
 * about what "installed" means — which is the exact class of defect these
 * controls exist to catch.
 *
 * @module tests/integration/support/pre-tool-refusal-harness
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASH,
  CONFIG_FILE,
  DECLARED_TASK,
  EXTRACTOR,
  HELPER,
  RUNNER_STUB,
  SCRIPT_TIMEOUT_MS,
  locate,
} from "./pre-tool-refusal-fixture.js";
import type { Payload, Subject } from "./pre-tool-refusal-fixture.js";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this module's own location. */
export const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..", "..");

/** Every external binary these scripts reach for, other than jq. */
const REQUIRED_TOOLS = ["cat", "grep", "dirname", "node"];

/** What one script run produced. */
export interface RunResult {
  /** The script's exit status. */
  readonly status: number;
  /** Everything it wrote to stderr. */
  readonly stderr: string;
  /** The trace of what it invoked, one line per invocation. */
  readonly trace: string;
}

/** Environment overrides one case needs to change. */
export interface RunOptions {
  /** Replaces $PATH, which is how jq is made absent. */
  readonly path?: string;
  /** Exit status the declared-task stub returns. */
  readonly taskExit?: string;
}

/** A prepared temporary project and the operations a suite runs against it. */
export interface Harness {
  /** A PATH carrying every binary these scripts reach for except jq. */
  readonly noJqDir: string;
  /** Installs one script's text, with or without the façade helper. */
  readonly install: (source: string, withGate: boolean) => Promise<string>;
  /** Installs the shipped script for one subject, helper included. */
  readonly installShipped: (subject: Subject) => Promise<string>;
  /** Declares the property one subject proves, at `pre-tool`. */
  readonly declare: (subject: Subject) => Promise<void>;
  /** Removes any declaration, putting the project back on the built-in. */
  readonly undeclare: () => Promise<void>;
  /** Runs one installed script against one proposed write. */
  readonly run: (
    installed: string,
    payload: Payload,
    options?: RunOptions
  ) => Promise<RunResult>;
  /** Removes the temporary project. */
  readonly cleanup: () => Promise<void>;
}

/** The directories and files one harness owns. */
interface Layout {
  /** The temporary root everything lives under. */
  readonly root: string;
  /** The fixture project the scripts run against. */
  readonly projectDir: string;
  /** A PATH directory holding the stub task runner. */
  readonly binDir: string;
  /** A PATH directory holding everything except jq. */
  readonly noJqDir: string;
  /** Where the stub runner records what it was asked to run. */
  readonly traceFile: string;
}

/**
 * Creates the temporary project the scripts run against.
 * @returns The paths the rest of the harness works from.
 */
async function prepareLayout(): Promise<Layout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pre-tool-gate-"));
  const layout: Layout = {
    root,
    projectDir: path.join(root, "project"),
    binDir: path.join(root, "bin"),
    noJqDir: path.join(root, "bin-no-jq"),
    traceFile: path.join(root, "trace.log"),
  };
  await fs.ensureDir(
    path.join(layout.projectDir, "src", "database", "migrations")
  );
  await fs.ensureDir(layout.binDir);
  await fs.ensureDir(layout.noJqDir);
  await fs.writeFile(layout.traceFile, "");
  await fs.writeJson(path.join(layout.projectDir, "package.json"), {
    name: "fixture",
    version: "1.0.0",
    scripts: { [DECLARED_TASK]: "echo declared-task-ran" },
  });
  await fs.writeFile(path.join(layout.binDir, "bun"), RUNNER_STUB, {
    mode: 0o755,
  });

  // A PATH with every binary these scripts reach for EXCEPT jq. Built by
  // symlinking real ones rather than by trimming the ambient PATH, because
  // where jq lives differs between a developer machine and CI and a harness
  // that silently stopped removing it would prove nothing.
  for (const tool of REQUIRED_TOOLS) {
    const real = locate(tool);
    if (real !== "") {
      await fs.ensureSymlink(real, path.join(layout.noJqDir, tool));
    }
  }
  return layout;
}

/**
 * Installs one script's text into the fixture, with the helpers beside it.
 * @param layout The harness paths.
 * @param source The script's text.
 * @param withGate Whether to install the façade helper and gate registry.
 * @returns Absolute path to the installed script.
 */
async function installScript(
  layout: Layout,
  source: string,
  withGate: boolean
): Promise<string> {
  const hookDir = path.join(layout.projectDir, ".hooks");
  await fs.remove(hookDir);
  await fs.ensureDir(hookDir);
  const installed = path.join(hookDir, "hook.sh");
  await fs.writeFile(installed, source, { mode: 0o755 });
  // The extractor ships beside the Codex copies on both sides of the change —
  // the pre-change Codex migration script already sourced it — so it is not
  // part of what "with gate" installs.
  await fs.copy(
    path.join(REPO_ROOT, "src/codex/scripts", EXTRACTOR),
    path.join(hookDir, EXTRACTOR)
  );
  if (withGate) {
    await fs.copy(
      path.join(REPO_ROOT, "plugins/src/typescript/hooks", HELPER),
      path.join(hookDir, HELPER)
    );
    await fs.copy(
      path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-gates.mjs"),
      path.join(layout.projectDir, "scripts/lisa-gates.mjs")
    );
    // The registry imports its helpers by relative path, so the installed copy
    // is a directory beside it, not a lone file.
    await fs.copy(
      path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib"),
      path.join(layout.projectDir, "scripts/lib")
    );
  }
  return installed;
}

/**
 * Runs one installed script against one proposed write.
 * @param layout The harness paths.
 * @param installed Absolute path to the script.
 * @param payload The write the tool proposes.
 * @param options Environment overrides for this run.
 * @returns Exit status, stderr, and the trace of what it invoked.
 */
async function runScript(
  layout: Layout,
  installed: string,
  payload: Payload,
  options: RunOptions
): Promise<RunResult> {
  await fs.writeFile(layout.traceFile, "");
  const result = spawnSync(BASH, [installed], {
    cwd: layout.projectDir,
    encoding: "utf8",
    timeout: SCRIPT_TIMEOUT_MS,
    input: JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: path.join(layout.projectDir, payload.file),
        content: payload.text,
      },
    }),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: layout.projectDir,
      LISA_TRACE: layout.traceFile,
      LISA_TASK_EXIT: options.taskExit ?? "0",
      PATH: options.path ?? `${layout.binDir}:${process.env["PATH"] ?? ""}`,
    },
  });
  // A killed child returns EMPTY streams, so a timeout reads as a content
  // failure that never mentions time. Raised as what it is instead.
  if (result.signal !== null) {
    throw new Error(
      `${installed} was KILLED (${result.signal}) rather than completing.`
    );
  }
  return {
    status: result.status ?? -1,
    stderr: result.stderr ?? "",
    trace: await fs.readFile(layout.traceFile, "utf8"),
  };
}

/**
 * Builds a temporary project and the operations that drive a script in it.
 * @returns The prepared harness.
 */
export async function createHarness(): Promise<Harness> {
  const layout = await prepareLayout();
  return {
    noJqDir: layout.noJqDir,
    install: async (source: string, withGate: boolean): Promise<string> =>
      installScript(layout, source, withGate),
    installShipped: async (subject: Subject): Promise<string> =>
      installScript(
        layout,
        await fs.readFile(path.join(REPO_ROOT, subject.script), "utf8"),
        true
      ),
    declare: async (subject: Subject): Promise<void> => {
      await fs.writeJson(path.join(layout.projectDir, CONFIG_FILE), {
        gates: {
          runner: "bun run",
          [subject.gate]: {
            "pre-tool": { level: "required", run: DECLARED_TASK },
          },
        },
      });
    },
    undeclare: async (): Promise<void> => {
      await fs.remove(path.join(layout.projectDir, CONFIG_FILE));
    },
    run: async (
      installed: string,
      payload: Payload,
      options: RunOptions = {}
    ): Promise<RunResult> => runScript(layout, installed, payload, options),
    cleanup: async (): Promise<void> => {
      await fs.remove(layout.root);
    },
  };
}
