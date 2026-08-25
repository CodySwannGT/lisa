/**
 * `lisa doctor` check: is the readiness report actually excluded from git?
 *
 * `.lisa/readiness.json` is a derived report — `lisa doctor --readiness`
 * recomputes every field from the tree on each run, and three of its nine
 * top-level fields (`generated_at`, `lisa_version`, `worker_signature`) describe
 * the run rather than the repository. It is therefore shipped on the ignored
 * side of `.gitignore`, beside the five sibling `.lisa/` artifacts that made the
 * same call (CodySwannGT/lisa#3046).
 *
 * A `.gitignore` line is a protection with the same two-halves failure mode a
 * merge driver has, for a different reason: **git ignores untracked paths only**.
 * A checkout that committed the report before the rule shipped keeps committing
 * it, on every doctor run, and `.gitignore` says nothing about it either way. So
 * does a host repository that has not re-applied Lisa's templates yet, and a
 * checkout where someone ran `git add -f`. In each case the merge exposure the
 * ignore rule removes is still fully present, silently.
 *
 * This check is the sentence that says so. Warn, never fail: a tracked report is
 * a hygiene defect that costs an operator a conflict at merge time, not a broken
 * repository, and reddening CI over it would trade a real signal for noise.
 * @module cli/doctor-readiness-tracking
 */
import * as path from "node:path";
import { resolveReadinessReportPath } from "./doctor-readiness.js";

/** Name of the readiness-tracking check as doctor reports it. */
export const READINESS_REPORT_TRACKING_CHECK_NAME =
  "Readiness report untracked?";

/** Pinned PATH for the git probes, matching the merge-driver install probe. */
const GIT_COMMAND_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};

/** Raw outcome of one git invocation. */
type GitRun =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly missingGit: boolean };

/** Shape of one doctor check result (structurally identical to doctor's). */
interface ReadinessTrackingCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Build one check result under this check's name.
 * @param status - Reported status
 * @param detail - Operator-readable explanation
 * @returns Doctor check result
 */
function result(
  status: "ok" | "warn",
  detail: string
): ReadinessTrackingCheckResult {
  return { name: READINESS_REPORT_TRACKING_CHECK_NAME, status, detail };
}

/**
 * Run one git command, distinguishing a missing binary from a real failure.
 * @param args - Git arguments
 * @param cwd - Directory to run in
 * @returns Structured run outcome
 */
async function tryGit(args: readonly string[], cwd: string): Promise<GitRun> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run("git", [...args], {
      cwd,
      env: GIT_COMMAND_ENV,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    return { ok: false, missingGit: code === "ENOENT" };
  }
}

/**
 * Resolve the report's repo-relative, forward-slashed path.
 *
 * Derived from `resolveReadinessReportPath` rather than hardcoded, so intake
 * decision O2's one-line relocation keeps this check pointed at the real file
 * instead of reporting on a path nothing writes any more.
 * @param targetPath - Project root the report lives under
 * @returns Path relative to `targetPath`, using `/` separators for git
 */
function readinessReportGitPath(targetPath: string): string {
  return path
    .relative(targetPath, resolveReadinessReportPath(targetPath))
    .split(path.sep)
    .join("/");
}

/**
 * Report whether this checkout tracks the derived readiness report.
 *
 * Asks git rather than reading `.gitignore`, because the question is not
 * "is there a rule?" but "does this repository carry the file?" — and a rule
 * present in the working tree changes nothing for a path already in the index.
 * That is the whole failure this check exists to make visible.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkReadinessReportTracking(
  targetPath: string
): Promise<ReadinessTrackingCheckResult> {
  const reportPath = readinessReportGitPath(targetPath);
  try {
    const inWorkTree = await tryGit(
      ["rev-parse", "--is-inside-work-tree"],
      targetPath
    );
    if (!inWorkTree.ok) {
      return inWorkTree.missingGit
        ? result(
            "warn",
            `git executable not found, so whether ${reportPath} is tracked could not be verified — install git, then re-run \`lisa doctor\``
          )
        : result(
            "ok",
            `Not a git repository, so tracking ${reportPath} does not apply`
          );
    }
    if (inWorkTree.stdout !== "true") {
      return result(
        "ok",
        `Not a git working tree, so tracking ${reportPath} does not apply`
      );
    }
    const tracked = await tryGit(["ls-files", "--", reportPath], targetPath);
    if (!tracked.ok) {
      return result(
        "warn",
        `Could not ask git whether ${reportPath} is tracked in this checkout`
      );
    }
    if (tracked.stdout === "") {
      return result("ok", `${reportPath} is not tracked in this checkout`);
    }
    return result(
      "warn",
      `${reportPath} is tracked in this checkout, so every \`lisa doctor --readiness\` run commits a fresh copy. The report is derived — recomputed from the tree on the next run — and its generated_at, lisa_version and worker_signature fields describe the run rather than the repository, so two branches that both ran doctor conflict on it and no resolution of that conflict is correct. Adding the path to .gitignore does not untrack it; stop tracking it with \`git rm --cached ${reportPath}\` and commit that removal.`
    );
  } catch (error) {
    return result(
      "warn",
      `Could not inspect whether ${reportPath} is tracked: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
