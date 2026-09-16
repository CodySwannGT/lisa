/** Adapter for existing lifecycle accounting and read-only queue reports. */
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import {
  recordEffectiveness,
  recordRecurrence,
  readEffectivenessReport,
} from "../core/effectiveness-store.js";
import { invariantFingerprint } from "../utils/effectiveness.js";

const INPUT_OPTION = "--input <file>";

/**
 * Register observation writes and inspection; no scheduling or tracker writes.
 * @param program - Parent CLI
 */
export function addEffectivenessCommand(program: Command): void {
  const command = program
    .command("effectiveness")
    .description(
      "Record sourced delivery observations and report recurring failures"
    );
  command
    .command("record")
    .requiredOption(
      INPUT_OPTION,
      "JSON accounting row: entryId, artifactRef, effectiveness"
    )
    .action(async (options: { input: string }) => {
      await recordEffectiveness(
        process.cwd(),
        JSON.parse(await readFile(options.input, "utf8")) as unknown
      );
      process.stdout.write("Local effectiveness observation recorded.\n");
    });
  command
    .command("recurrence")
    .requiredOption(INPUT_OPTION, "JSON post-control recurrence evidence")
    .action(async (options: { input: string }) => {
      const count = await recordRecurrence(
        process.cwd(),
        JSON.parse(await readFile(options.input, "utf8")) as unknown
      );
      process.stdout.write(`${JSON.stringify({ recurrenceCount: count })}\n`);
    });
  command
    .command("report")
    .description(
      "Read local observations and committed recurrence history without writing"
    )
    .action(async () => {
      process.stdout.write(
        `${JSON.stringify(await readEffectivenessReport(process.cwd()), null, 2)}\n`
      );
    });
  command
    .command("fingerprint")
    .requiredOption(INPUT_OPTION, "Invariant text, shared with the gardener")
    .action(async (options: { input: string }) => {
      process.stdout.write(
        `${invariantFingerprint(await readFile(options.input, "utf8"))}\n`
      );
    });
}
