import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  readProjectConfig,
  writeProjectConfig,
} from "../core/project-config.js";
import type { StarterTemplate } from "../core/project-config-starter.js";

/** Capture bounded command output without invoking a shell. */
export type CaptureCommand = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string }
) => Promise<string>;

const execute = promisify(execFile);

/**
 * Read the small Git/GitHub metadata responses needed for provenance.
 * @param command - Executable name.
 * @param args - Separate command arguments.
 * @param options - Optional working directory.
 * @returns Trimmed standard output.
 */
export const captureCommand: CaptureCommand = async (
  command,
  args,
  options
) => {
  const { stdout } = await execute(command, [...args], {
    ...options,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
};

/**
 * Require a GitHub repository name rather than accepting arbitrary endpoints.
 * @param repo - Owner/repository input.
 * @returns The validated repository name.
 */
export function validateStarterRepo(repo: string): string {
  if (!/^[a-z\d][a-z\d_.-]*\/[a-z\d][a-z\d_.-]*$/i.test(repo)) {
    throw new Error("Name the starter as owner/repository.");
  }
  return repo;
}

/**
 * Validate Git object metadata before persisting a baseline.
 * @param value - Reported object identifier.
 * @returns The verified object identifier.
 */
function gitObject(value: string): string {
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value)) {
    throw new Error(
      "The starter did not return a valid Git object identifier."
    );
  }
  return value;
}

/**
 * Snapshot the GitHub revision whose tree creation must actually copy.
 * @param repo - Starter repository.
 * @param ref - Explicit tracked ref, or the repository's default branch.
 * @param capture - Metadata reader.
 * @returns Provenance and the expected copied tree.
 */
export async function readGitHubStarter(
  repo: string,
  ref: string | undefined,
  capture: CaptureCommand = captureCommand
): Promise<{ template: StarterTemplate; tree: string }> {
  const endpoint = `repos/${validateStarterRepo(repo)}`;
  const trackedRef =
    ref ?? (await capture("gh", ["api", endpoint, "--jq", ".default_branch"]));
  if (!trackedRef.trim())
    throw new Error("The starter has no tracked branch or ref.");
  const raw = await capture("gh", [
    "api",
    `${endpoint}/commits/${encodeURIComponent(trackedRef)}`,
    "--jq",
    "[.sha,.commit.tree.sha] | @tsv",
  ]);
  const [sha, tree] = raw.split("\t");
  return {
    template: {
      repo,
      ref: trackedRef,
      lastSync: { sha: gitObject(sha ?? ""), at: new Date().toISOString() },
    },
    tree: gitObject(tree ?? ""),
  };
}

/**
 * Capture a real clone's revision before setup replaces its Git history.
 * @param repo - Starter repository.
 * @param destination - Clone directory.
 * @param capture - Metadata reader.
 * @returns Provenance tied to the cloned files.
 */
export async function readClonedStarter(
  repo: string,
  destination: string,
  capture: CaptureCommand
): Promise<StarterTemplate> {
  const sha = await capture("git", ["rev-parse", "HEAD"], { cwd: destination });
  const ref = await capture("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd: destination,
  });
  if (!ref.trim()) throw new Error("The starter clone has no tracked branch.");
  return {
    repo,
    ref,
    lastSync: { sha: gitObject(sha), at: new Date().toISOString() },
  };
}

/**
 * Record one baseline while retaining other starters and extension settings.
 * @param destination - Project directory.
 * @param template - Verified starter revision.
 * @param replaceExisting - Creation replaces inherited provenance; adoption does not.
 * @returns Whether the config changed.
 */
export async function recordStarterProvenance(
  destination: string,
  template: StarterTemplate,
  replaceExisting = false
): Promise<boolean> {
  const { starter = {} } = await readProjectConfig(destination);
  const templates = starter.templates ?? [];
  const index = templates.findIndex(
    entry => entry.repo.toLowerCase() === template.repo.toLowerCase()
  );
  if (index !== -1 && !replaceExisting) return false;
  const updated =
    index === -1
      ? [...templates, template]
      : templates.map((entry, at) =>
          at === index ? { ...entry, ...template } : entry
        );
  await writeProjectConfig(destination, {
    starter: { ...starter, templates: updated },
  });
  return true;
}
