import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

/**
 * A patch header is only a claim. Before the audit credits it, the claim is
 * executed: the named regression test must pass against every installed copy
 * and must fail against the same copy with the patch reversed. A test that
 * cannot tell the two apart (an empty test, a test of the wrong package, a
 * patch that changes no code) proves nothing, so the advisory stays a finding.
 */

/** Longest a single regression-test run may take before it counts as failed. */
export const REGRESSION_TIMEOUT_MS = 120_000;

/** One hunk of a unified diff, as the lines it replaces and the lines it writes. */
interface Hunk {
  readonly start: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/** The hunks a patch applies to one file. */
interface Section {
  readonly path: string;
  readonly created: boolean;
  readonly hunks: readonly Hunk[];
}

/** The outcome of one regression-test run. */
interface RunOutcome {
  readonly passed: boolean;
  readonly detail: string;
}

/** The line that starts each file's section of a git-style patch. */
const DIFF_LINE = "diff --git ";

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/**
 * The path a `diff --git a/<path> b/<path>` line writes.
 * @param line - A `diff --git` line
 * @returns The target path after `b/`
 */
function diffTarget(line: string): string {
  const at = line.lastIndexOf(" b/");
  return at < 0 ? "" : line.slice(at + 3);
}

/**
 * Every file a patch changes, from its `diff --git` lines.
 * @param text - Complete patch file text
 * @returns The changed paths, relative to the package directory
 */
export function patchTargets(text: string): readonly string[] {
  return text
    .split(/\r?\n/u)
    .filter(line => line.startsWith(DIFF_LINE))
    .map(diffTarget);
}

/**
 * Why a path from a patch cannot be trusted to stay inside the package.
 * @param path - A path named by the patch header or a diff line
 * @param label - What named the path, for the message
 * @returns The problem, or undefined when the path is a plain relative path
 */
export function escapingPath(path: string, label: string): string | undefined {
  const parts = path.split(/[\\/]/u);
  return !path || isAbsolute(path) || parts.includes("..")
    ? `${label} "${path}" is not a relative path inside the package directory`
    : undefined;
}

/**
 * Why a `Lisa-Patched-File` path cannot vouch for the patch.
 * @param path - The header's path
 * @param targets - The files the patch changes
 * @returns The problem, or undefined when the path is a changed file
 */
export function patchedPathProblem(
  path: string,
  targets: readonly string[]
): string | undefined {
  return (
    escapingPath(path, "Lisa-Patched-File") ??
    (targets.includes(path)
      ? undefined
      : `Lisa-Patched-File "${path}" is not a file the patch changes`)
  );
}

/**
 * Read the hunks of one section, starting at its first `@@` line.
 * @param lines - Every patch line
 * @param from - Index of the section's first hunk header
 * @returns The hunks, in order
 */
function readHunks(lines: readonly string[], from: number): readonly Hunk[] {
  const header = HUNK_HEADER.exec(lines[from] ?? "");
  if (!header) return [];
  const beforeCount = Number(header[1] ?? "1");
  const afterCount = Number(header[3] ?? "1");
  const take = (
    index: number,
    before: readonly string[],
    after: readonly string[]
  ): { readonly next: number; readonly hunk: Hunk } => {
    if (before.length >= beforeCount && after.length >= afterCount)
      return {
        next: index,
        hunk: { start: Number(header[2] ?? "1"), before, after },
      };
    const line = lines[index];
    if (line === undefined) throw new Error("the patch ends inside a hunk");
    const body = line.slice(1);
    if (line.startsWith("\\")) return take(index + 1, before, after);
    if (line.startsWith("-")) return take(index + 1, [...before, body], after);
    if (line.startsWith("+")) return take(index + 1, before, [...after, body]);
    return take(index + 1, [...before, body], [...after, body]);
  };
  const { next, hunk } = take(from + 1, [], []);
  return [hunk, ...readHunks(lines, next)];
}

/**
 * Split a patch into the hunks it applies to each file.
 * @param text - Complete patch file text
 * @returns One section per `diff --git` line
 */
function patchSections(text: string): readonly Section[] {
  const lines = text.split(/\r?\n/u);
  return lines.flatMap((line, index) => {
    if (!line.startsWith(DIFF_LINE)) return [];
    const end = lines.findIndex(
      (next, at) => at > index && next.startsWith(DIFF_LINE)
    );
    const body = lines.slice(index, end < 0 ? lines.length : end);
    const first = body.findIndex(next => next.startsWith("@@ "));
    return [
      {
        path: diffTarget(line),
        created: body.some(next => next === "--- /dev/null"),
        hunks: first < 0 ? [] : readHunks(body, first),
      },
    ];
  });
}

/**
 * Undo one section's hunks in a patched file's text.
 * @param text - The patched file
 * @param section - The hunks that produced it
 * @returns The file as it was before the patch
 */
function reverseSection(text: string, section: Section): string {
  const lines = [...section.hunks]
    .reverse()
    .reduce<readonly string[]>((current, hunk) => {
      const at = Math.max(0, hunk.start - 1);
      const found = current.slice(at, at + hunk.after.length);
      if (found.join("\n") !== hunk.after.join("\n"))
        throw new Error(
          `${section.path} does not contain the patched lines at line ${hunk.start}`
        );
      return [
        ...current.slice(0, at),
        ...hunk.before,
        ...current.slice(at + hunk.after.length),
      ];
    }, text.split("\n"));
  return lines.join("\n");
}

/**
 * Copy an installed package and reverse the patch in the copy.
 * @param dir - The installed, patched package directory
 * @param text - Complete patch file text
 * @returns A scratch directory holding the package as published
 */
function reverseInto(dir: string, text: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "lisa-audit-unpatched-"));
  const copy = join(scratch, "package");
  cpSync(dir, copy, { recursive: true });
  for (const section of patchSections(text)) {
    const problem = escapingPath(section.path, "diff target");
    const file = resolve(copy, section.path);
    if (problem) throw new Error(problem);
    if (!file.startsWith(copy + sep) || !existsSync(file))
      throw new Error(`diff target ${section.path} is not in the package`);
    if (section.created) rmSync(file);
    else
      writeFileSync(file, reverseSection(readFileSync(file, "utf8"), section));
  }
  return scratch;
}

/**
 * Reverse a patch into a scratch copy, reporting why when it cannot be done.
 * @param dir - The installed, patched package directory
 * @param text - Complete patch file text
 * @returns The scratch directory, or the reason it could not be made
 */
function unpatchedCopy(
  dir: string,
  text: string
): { readonly scratch: string } | { readonly problem: string } {
  try {
    return { scratch: reverseInto(dir, text) };
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

/**
 * Run a regression test against package directories with a bounded timeout.
 * @param root - Project root the test path is relative to
 * @param test - The regression test path
 * @param dirs - The package directories to test
 * @returns Whether the test exited 0, and why not
 */
async function runRegression(
  root: string,
  test: string,
  dirs: readonly string[]
): Promise<RunOutcome> {
  const run = promisify(execFile);
  return run(process.execPath, [resolve(root, test), ...dirs], {
    cwd: root,
    timeout: REGRESSION_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  }).then(
    () => ({ passed: true, detail: "" }),
    (
      error: Error & { readonly killed?: boolean; readonly stdout?: string }
    ) => ({
      passed: false,
      detail: error.killed
        ? `killed after ${REGRESSION_TIMEOUT_MS}ms`
        : `${error.stdout ?? ""}${error.message}`
            .trim()
            .split("\n")
            .slice(-3)
            .join(" | "),
    })
  );
}

/**
 * Execute a patch's regression test: it must pass on every installed copy and
 * fail on an unpatched copy, or the patch proves nothing.
 * @param root - Project root
 * @param patch - Patch file path and regression test path, relative to root
 * @param patch.file - The patch file
 * @param patch.regressionTest - The regression test the patch names
 * @param dirs - Every installed directory of the patched version
 * @returns One message per unmet condition
 */
export async function regressionProblems(
  root: string,
  patch: { readonly file: string; readonly regressionTest: string },
  dirs: readonly string[]
): Promise<readonly string[]> {
  const test = patch.regressionTest;
  const escape = escapingPath(test, "Lisa-Regression-Test");
  if (escape) return [`${patch.file}: ${escape}`];
  if (!existsSync(resolve(root, test)))
    return [
      `${patch.file} names regression test "${test}", which does not exist`,
    ];
  const text = readFileSync(resolve(root, patch.file), "utf8");
  const [first = ""] = dirs;
  const copy = unpatchedCopy(first, text);
  if ("problem" in copy)
    return [
      `${patch.file} cannot be reversed to test the unpatched package: ${copy.problem}`,
    ];
  const { scratch } = copy;
  try {
    const [patched, unpatched] = await Promise.all([
      runRegression(root, test, dirs),
      runRegression(root, test, [join(scratch, "package")]),
    ]);
    return [
      ...(patched.passed
        ? []
        : [
            `regression test ${test} fails against the installed copies, so the patch does not fix them (${patched.detail})`,
          ]),
      ...(unpatched.passed
        ? [
            `regression test ${test} also passes against the unpatched package, so it does not detect the advisory`,
          ]
        : []),
    ];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
