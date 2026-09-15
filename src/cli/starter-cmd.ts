import path from "node:path";

import type { Command } from "commander";

import { readProjectConfig } from "../core/project-config.js";
import {
  runStarterSync,
  type StarterSyncCommandOptions,
} from "./starter-sync-command.js";
import {
  captureCommand,
  readGitHubStarter,
  recordStarterProvenance,
  validateStarterRepo,
  type CaptureCommand,
} from "./starter-provenance.js";

/** Adoption records a baseline; it does not apply starter changes. */
export interface StarterAdoptOptions {
  path?: string;
  ref?: string;
}

/**
 * Adopt a starter without resetting a baseline that is already tracked.
 * @param repo - Starter's owner/repository name.
 * @param options - Project path and tracked ref.
 * @param capture - Bounded GitHub metadata reader.
 */
export async function runStarterAdopt(
  repo: string,
  options: StarterAdoptOptions = {},
  capture: CaptureCommand = captureCommand
): Promise<void> {
  const validatedRepo = validateStarterRepo(repo);
  const destination = path.resolve(options.path ?? ".");
  const config = await readProjectConfig(destination);
  if (
    config.starter?.templates?.some(
      entry => entry.repo.toLowerCase() === repo.toLowerCase()
    )
  ) {
    console.log(
      `Starter ${repo} is already tracked; its baseline is unchanged.`
    );
    return;
  }
  const { template } = await readGitHubStarter(
    validatedRepo,
    options.ref,
    capture
  );
  await recordStarterProvenance(destination, template);
  console.log(
    `Adopted ${repo} at ${template.lastSync.sha}. This records a baseline for future changes; existing project files were not synchronized.`
  );
}

/**
 * Register the starter adoption and sync commands without changing default apply routing.
 * @param program - Commander root.
 * @param run - Adoption handler.
 */
export function addStarterCommand(
  program: Command,
  run: typeof runStarterAdopt = runStarterAdopt
): void {
  const starter = program
    .command("starter")
    .description("Manage the project's starter origins");
  starter
    .command("adopt")
    .description("Record a starter baseline for an existing project")
    .argument("<repo>", "Starter as owner/repository")
    .option("--path <path>", "Existing project directory")
    .option(
      "--ref <ref>",
      "Tracked branch or ref (default: starter's default branch)"
    )
    .action(async (repo: string, options: StarterAdoptOptions) => {
      await run(repo, options);
    });
  starter
    .command("sync")
    .description("Open a starter update PR, or commit with direct-when-clean")
    .option("--path <path>", "Existing project root")
    .option("--base <branch>", "PR base (default: current branch)")
    .option(
      "--work-item <ref>",
      "Existing tracker item for commit and PR linkage"
    )
    .option("--co-author <identity>", "Actual agent co-author, when applicable")
    .option("--json", "Print the landing result as JSON")
    .action(async (options: StarterSyncCommandOptions & { json?: boolean }) => {
      const result = await runStarterSync(options);
      if (result.worktree)
        console.error(
          `PR created; inspect retained worktree: ${result.worktree}`
        );
      console.log(
        options.json
          ? JSON.stringify(result)
          : result.url
            ? `Starter update PR: ${result.url}`
            : result.commit
              ? `Committed starter updates: ${result.commit}`
              : "Starter is already current."
      );
    });
}
