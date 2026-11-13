/**
 * `lisa admit --workers <n> [--max-wait <duration>] -- <command…>`.
 *
 * Waits for headroom, runs the command with `LISA_ADMITTED_WORKERS` set to the
 * workers it was granted, removes the reservation when the command ends, and
 * exits with the command's status. Scripts (the push gate runner, Rails hosts)
 * call this instead of importing TypeScript.
 *
 * One command argument runs through the shell, so a caller can hand over a
 * whole command line such as `bun run typecheck`; several run as an argv.
 * @module cli/admit-cmd
 */
import { spawn } from "node:child_process";
import { env } from "node:process";
import type { Command } from "commander";

import { ADMISSION_REFUSED_EXIT, requestAdmission } from "../core/admission.js";
import {
  ADMISSION_HOLDER_ENV,
  ADMITTED_WORKERS_ENV,
  resolveAdmissionSettings,
} from "../core/admission-settings.js";

/** Options Commander parses. */
interface AdmitOptions {
  readonly workers: string;
  readonly minWorkers?: string;
  readonly maxWait?: string;
}

/** Signals forwarded to the admitted command. */
const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Parse a positive integer option.
 * @param raw - Option text
 * @param name - Option name
 * @returns The integer
 */
function positiveInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

/**
 * Run the admitted command and settle with its status.
 * @param argv - Command and arguments
 * @param environment - Child environment
 * @param onExit - Runs if this process exits first (removes the reservation)
 * @returns Exit status, or the signal that ended it
 */
function runAdmitted(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  onExit: () => void
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const [file, ...args] = argv;
  const child =
    args.length === 0
      ? // The caller's own command line, run exactly as it would run unadmitted.
        // eslint-disable-next-line sonarjs/os-command -- operator-supplied command, by design
        spawn(file ?? "", { shell: true, stdio: "inherit", env: environment })
      : spawn(file ?? "", args, { stdio: "inherit", env: environment });
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  for (const signal of FORWARDED) process.on(signal, forward);
  process.once("exit", onExit);
  return new Promise(resolve => {
    child.once("error", error => {
      process.stderr.write(`lisa admit: ${error.message}\n`);
      resolve({ code: 127, signal: null });
    });
    child.once("close", (code, signal) => {
      for (const name of FORWARDED) process.off(name, forward);
      resolve({ code, signal });
    });
  });
}

/**
 * Admit, run, release.
 * @param argv - Command and arguments
 * @param options - Parsed options
 * @returns Exit status
 */
export async function runAdmit(
  argv: readonly string[],
  options: AdmitOptions
): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write("lisa admit: name the command after `--`\n");
    return 2;
  }
  const workers = positiveInt(options.workers, "--workers");
  const outcome = await requestAdmission({
    workers,
    minimumWorkers:
      options.minWorkers === undefined
        ? workers
        : positiveInt(options.minWorkers, "--min-workers"),
    command: argv.join(" "),
    cwd: process.cwd(),
    environment: env,
    settings: resolveAdmissionSettings({
      environment: env,
      cwd: process.cwd(),
      ...(options.maxWait === undefined
        ? {}
        : { maxWaitOverride: options.maxWait }),
    }),
  });
  if (outcome.kind === "refused") {
    process.stderr.write(`${outcome.message}\n`);
    return ADMISSION_REFUSED_EXIT;
  }
  return runAndRelease(
    argv,
    outcome.kind === "admitted" ? outcome.release : () => {},
    {
      ...env,
      [ADMITTED_WORKERS_ENV]: String(outcome.granted),
      ...(outcome.kind === "admitted"
        ? { [ADMISSION_HOLDER_ENV]: String(process.pid) }
        : {}),
    }
  );
}

/**
 * Run the admitted command, then remove the reservation however it ended.
 * @param argv - Command and arguments
 * @param release - Removes the reservation; idempotent
 * @param environment - Child environment
 * @returns Exit status
 */
async function runAndRelease(
  argv: readonly string[],
  release: () => void,
  environment: NodeJS.ProcessEnv
): Promise<number> {
  const result = await runAdmitted(argv, environment, release);
  release();
  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return 128;
  }
  return result.code ?? 1;
}

/**
 * Register `lisa admit`.
 * @param program - Root program
 */
export function addAdmitCommand(program: Command): void {
  program
    .command("admit")
    .description(
      "Run a heavy command once the machine has headroom for its workers"
    )
    .requiredOption("--workers <n>", "Workers the command will use")
    .option(
      "--min-workers <n>",
      "Fewest workers it accepts (the grant is sized to the headroom)"
    )
    .option(
      "--max-wait <duration>",
      "Longest wait before refusing, e.g. 300, 90s, 5m"
    )
    .argument("<command...>", "Command to run, after --")
    .action(async (argv: string[], options: AdmitOptions) => {
      try {
        process.exitCode = await runAdmit(argv, options);
      } catch (error) {
        process.stderr.write(
          `lisa admit: ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 2;
      }
    });
}
