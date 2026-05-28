#!/usr/bin/env node

import { createProgram } from "./cli/index.js";
import { printUpdateWarning } from "./cli/print-update-warning.js";
import { runUpdateCheck } from "./cli/update-check.js";

/**
 * Run the Lisa CLI entrypoint.
 * @returns Promise that resolves after Commander completes
 */
async function main(): Promise<void> {
  const updateCheck = await runUpdateCheck();
  const program = createProgram();

  printUpdateWarning(updateCheck);
  await program.parseAsync();
}

main().catch(error => {
  console.error(
    "Error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
