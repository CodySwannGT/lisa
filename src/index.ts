#!/usr/bin/env node

import { CommanderError } from "commander";
import { createProgram } from "./cli/index.js";

/**
 * Run the Lisa CLI entrypoint.
 *
 * The npm update-check now runs inside the program's `preAction` hook (wired in
 * {@link createProgram}) so it fires exactly once per invocation before the
 * matched action, for every subcommand and the positional default alike.
 * @returns Promise that resolves after Commander completes
 */
async function main(): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

main().catch(error => {
  console.error(
    "Error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
