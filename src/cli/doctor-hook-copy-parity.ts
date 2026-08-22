/**
 * Report sibling copies of one git hook that disagree about a declared feature.
 *
 * Answers a question no other check asks. The Lisa-owned artifact check
 * (`doctor-lisa-owned-artifacts`) compares one destination path in a project
 * against the copies the package ships for it — "is this host running a stale
 * copy of what we shipped?". This asks the orthogonal question: "do the copies
 * inside ONE tree agree with each other?" A second copy at a different path,
 * in a directory the package does not ship, is invisible to the first check by
 * construction and was invisible for four weeks (CodySwannGT/lisa#2847).
 *
 * Naturally quiet in a host project, where each hook has exactly one tracked
 * copy and there is nothing to disagree.
 * @module cli/doctor-hook-copy-parity
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  declaredHookFeatures,
  deriveHookCopyGroups,
  describeHookCopyFinding,
  findHookCopyDrift,
  type HookCopy,
  type HookCopyFinding,
} from "../core/hook-copy-parity.js";
import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Hook copies agree?";
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_REPORTED_FINDINGS = 5;

const run = promisify(execFile);

/**
 * Every path git tracks in a checkout.
 * @param targetPath - Project path to inspect
 * @returns Repo-relative tracked paths, or undefined when git cannot answer
 */
async function trackedPaths(
  targetPath: string
): Promise<readonly string[] | undefined> {
  try {
    const { stdout } = await run("git", ["ls-files", "-z"], {
      cwd: targetPath,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.split("\0").filter(entry => entry.length > 0);
  } catch {
    return undefined;
  }
}

/**
 * Read one hook copy and extract what it declares.
 *
 * A copy that cannot be read is reported as declaring nothing rather than
 * dropped: dropping it would let an unreadable copy silently leave the roster,
 * which is the failure this check exists to prevent.
 * @param targetPath - Project root
 * @param relative - Repo-relative path of the copy
 * @returns The copy and its declared features
 */
async function readHookCopy(
  targetPath: string,
  relative: string
): Promise<HookCopy> {
  try {
    const source = await readFile(path.join(targetPath, relative), "utf8");
    return { path: relative, features: declaredHookFeatures(source) };
  } catch {
    return { path: relative, features: [] };
  }
}

/**
 * Collect every disagreement between sibling copies of a hook in one checkout.
 * @param targetPath - Project path to inspect
 * @param paths - Repo-relative tracked paths
 * @returns Findings across every hook with more than one copy
 */
async function collectFindings(
  targetPath: string,
  paths: readonly string[]
): Promise<readonly HookCopyFinding[]> {
  const groups = deriveHookCopyGroups(paths).filter(
    group => group.paths.length > 1
  );
  const perGroup = await Promise.all(
    groups.map(async group => {
      const copies = await Promise.all(
        group.paths.map(relative => readHookCopy(targetPath, relative))
      );
      return findHookCopyDrift(group.hook, copies);
    })
  );
  return perGroup.flat();
}

/**
 * Report hooks whose tracked copies declare different features.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkHookCopyParity(
  targetPath: string
): Promise<DoctorCheck> {
  const paths = await trackedPaths(targetPath);
  if (paths === undefined) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        "Could not list tracked files, so sibling hook copies were not compared. " +
        "This is not a pass — run `lisa doctor` from inside a git checkout",
    };
  }

  const multiCopy = deriveHookCopyGroups(paths).filter(
    group => group.paths.length > 1
  );
  if (multiCopy.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No hook has more than one tracked copy",
    };
  }

  const findings = await collectFindings(targetPath, paths);
  if (findings.length === 0) {
    const copies = multiCopy.reduce(
      (total, group) => total + group.paths.length,
      0
    );
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `${copies} tracked copies across ${multiCopy.length} hook(s) declare the same features`,
    };
  }

  const shown = findings
    .slice(0, MAX_REPORTED_FINDINGS)
    .map(describeHookCopyFinding);
  const more =
    findings.length > MAX_REPORTED_FINDINGS
      ? ` (+${findings.length - MAX_REPORTED_FINDINGS} more)`
      : "";
  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `${findings.length} feature(s) differ between copies of the same hook: ${shown.join("; ")}${more}`,
  };
}
