/**
 * The pre-push dependency-tree preflight (CodySwannGT/lisa#3913).
 *
 * Every push gate resolves its tool out of `node_modules` — tsc, knip, vitest.
 * An empty tree does not stop them, it makes them answer from nothing, and an
 * empty answer is not silent: the `type-correctness` gate concluded from zero
 * parsed diagnostics that all 370 quarantined files had been fixed and
 * instructed a reader to delete their quarantine entries. `knip:check` reports
 * unlisted binaries from the identical cause and merely looks odd, which is why
 * the dangerous one hid behind it for as long as it did.
 *
 * The preflight is therefore in the hook rather than in each gate — one place
 * where "the tools did not resolve" is separated from "the repository is at
 * fault", which is the acceptance bar #3888 states.
 *
 * ## Why the block is EXECUTED rather than grepped for
 *
 * A test asserting the text is present passes just as happily when the
 * condition is inverted, and a guard that cannot fire is the failure being
 * fixed. So the real bytes are lifted out of the tracked hook and run under
 * `sh` against fixtures — including the three cases where it must stay SILENT,
 * because a preflight that blocks a correctly installed tree gets deleted
 * within a week and takes the protection with it.
 *
 * Locating the block by its sentinel comments also fails closed: if either
 * marker is renamed or removed, extraction throws rather than silently probing
 * an empty string.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/config/dependency-tree-preflight
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Both tracked copies: this repo's own gate, and the one shipped to hosts. */
const HOOKS = Object.freeze([
  ".husky/pre-push",
  "typescript/copy-contents/.husky/pre-push",
]);

const START = "# The DEPENDENCY TREE is proved here too";
const END = "# BEGIN: push destination guard";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * Lift the preflight out of a tracked hook.
 * @param hook - Repo-relative hook path.
 * @returns The block's source.
 */
function preflightBlock(hook: string): string {
  const source = readFileSync(path.resolve(hook), "utf-8");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start === -1 ? 0 : start);
  if (start === -1 || end === -1) {
    throw new Error(
      `${hook}: could not locate the dependency-tree preflight between its sentinels. ` +
        `If it was renamed, rename the sentinels here too — do not delete this test.`
    );
  }
  return source.slice(start, end);
}

/**
 * Flatten a spawn result to the two things every case asserts on.
 * @param result - The finished child process.
 * @param result.status - Its exit status, or `null` if it was signalled.
 * @param result.stderr - Whatever it wrote to stderr.
 * @param result.stdout - Whatever it wrote to stdout.
 * @returns Exit status and combined output.
 */
function summarize(result: {
  readonly status: number | null;
  readonly stderr: string | null;
  readonly stdout: string | null;
}): { status: number; output: string } {
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? -1,
  };
}

/**
 * Build a project and run a preflight block in it.
 * @param options - The fixture's shape.
 * @param options.block - The preflight source to execute.
 * @param options.manifest - `package.json` contents, or `null` for no manifest.
 * @param options.nodeModules - Whether the tree is absent, empty or populated.
 * @returns Exit status and combined output.
 */
function runPreflight({
  block,
  manifest,
  nodeModules,
}: {
  readonly block: string;
  readonly manifest: string | null;
  readonly nodeModules: "absent" | "empty" | "populated";
}): { status: number; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3913-hook-"));
  const script = path.join(root, "preflight.sh");
  const modules = path.join(root, "node_modules");

  roots.push(root);
  if (manifest !== null)
    writeFileSync(path.join(root, "package.json"), manifest);
  if (nodeModules !== "absent") mkdirSync(modules);
  if (nodeModules === "populated") mkdirSync(path.join(modules, "typescript"));
  writeFileSync(script, block);

  return summarize(
    boundedSpawnSync({
      args: [script],
      command: "/bin/sh",
      cwd: root,
      label: "pre-push dependency-tree preflight",
    })
  );
}

/** Three dependencies across both manifest fields. */
const WITH_DEPS = JSON.stringify({
  dependencies: { a: "1" },
  devDependencies: { b: "2", c: "3" },
  name: "fixture",
});

describe.each(HOOKS)("dependency-tree preflight in %s", hook => {
  const block = preflightBlock(hook);

  it("blocks when dependencies are declared and node_modules is absent", () => {
    const { output, status } = runPreflight({
      block,
      manifest: WITH_DEPS,
      nodeModules: "absent",
    });

    expect(status).toBe(1);
    expect(output).toContain("CANNOT MEASURE");
    expect(output).toContain("3 dependencies");
  });

  it("blocks when node_modules exists but is empty", () => {
    // The case that produced the destructive finding: a directory is present,
    // so a guard testing only for existence would have waved this through.
    const { output, status } = runPreflight({
      block,
      manifest: WITH_DEPS,
      nodeModules: "empty",
    });

    expect(status).toBe(1);
    expect(output).toContain("CANNOT MEASURE");
  });

  it("denies the inference rather than only reporting the cause", () => {
    const { output } = runPreflight({
      block,
      manifest: WITH_DEPS,
      nodeModules: "empty",
    });

    expect(output).toContain("NOT a finding about your code");
  });

  it("stays silent when dependencies are installed", () => {
    const { output, status } = runPreflight({
      block,
      manifest: WITH_DEPS,
      nodeModules: "populated",
    });

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  it("stays silent when the manifest declares no dependencies", () => {
    const { status } = runPreflight({
      block,
      manifest: JSON.stringify({ name: "fixture" }),
      nodeModules: "absent",
    });

    expect(status).toBe(0);
  });

  it("stays silent when there is no manifest at all", () => {
    const { status } = runPreflight({
      block,
      manifest: null,
      nodeModules: "absent",
    });

    expect(status).toBe(0);
  });

  it("does not block over an unreadable manifest, which is not its job", () => {
    const { status } = runPreflight({
      block,
      manifest: "not json",
      nodeModules: "absent",
    });

    expect(status).toBe(0);
  });
});
