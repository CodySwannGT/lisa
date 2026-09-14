import path from "node:path";

import type { Command } from "commander";

import { readProjectConfig } from "../core/project-config.js";
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
 * Register the starter adoption command without changing default apply routing.
 * @param program - Commander root.
 * @param run - Adoption handler.
 */
export function addStarterCommand(
  program: Command,
  run: typeof runStarterAdopt = runStarterAdopt
): void {
  program
    .command("starter")
    .description("Manage the project's starter origins")
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
}
