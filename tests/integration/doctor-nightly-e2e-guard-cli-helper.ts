/**
 * @file doctor-nightly-e2e-guard-cli-helper.ts
 * @description Isolated host fixture for exercising the built doctor CLI
 * @module tests/integration/doctor-nightly-e2e-guard-cli-helper
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
export const TARGET = "scripts/check-nightly-e2e-health.mjs";

/** One normalized built-doctor child result, including failed exits. */
export interface DoctorExecution {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: string | number | null;
  readonly signal: string | null;
  readonly killed: boolean;
}

/** A single attempt to run the built doctor. */
export type DoctorAttempt = () => Promise<DoctorExecution>;

const DEFAULT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;
const STDERR_LIMIT = 1_000;

/**
 * Read JSON from a child that can legitimately exit non-zero for findings.
 *
 * Saturated CI runners can transiently fail to spawn or reap a child and
 * return no stdout at all. Retry only that transport-shaped result; a semantic
 * doctor failure already has JSON stdout and is returned on its first attempt.
 * @param attempt Execute the built doctor once and return normalized streams.
 * @param maxAttempts Bounded number of empty-output attempts.
 * @returns The first non-empty JSON candidate emitted by the doctor.
 */
export async function readDoctorJson(
  attempt: DoctorAttempt,
  maxAttempts = DEFAULT_ATTEMPTS
): Promise<string> {
  const run = async (number: number): Promise<DoctorExecution> => {
    const result = await attempt();
    if (result.stdout.trim().length > 0 || number >= maxAttempts) return result;
    await delay(RETRY_DELAY_MS * number);
    return run(number + 1);
  };
  const last = await run(1);

  if (last.stdout.trim().length > 0) return last.stdout;

  const stderr = last.stderr.trim().slice(0, STDERR_LIMIT) || "<empty>";
  throw new Error(
    `built doctor emitted no JSON after ${maxAttempts} attempts ` +
      `(code=${String(last.code ?? "unknown")}, ` +
      `signal=${last.signal ?? "none"}, killed=${String(last.killed)}); ` +
      `stderr: ${stderr}`
  );
}

/**
 * Execute one built-doctor attempt while preserving rejected child metadata.
 * @param projectRoot Disposable consumer project inspected by doctor.
 * @returns Normalized streams and child exit evidence.
 */
const executeBuiltDoctor = async (
  projectRoot: string
): Promise<DoctorExecution> =>
  execute(
    process.execPath,
    ["dist/index.js", "doctor", projectRoot, "--offline", "--json"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 20_000 }
  ).then(
    result => ({
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      signal: null,
      killed: false,
    }),
    error => {
      const failure = error as {
        readonly stdout?: string;
        readonly stderr?: string;
        readonly code?: string | number;
        readonly signal?: string;
        readonly killed?: boolean;
      };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? String(error),
        code: failure.code ?? null,
        signal: failure.signal ?? null,
        killed: failure.killed ?? false,
      };
    }
  );

/**
 * Run built doctor against one active workflow and return its nightly row.
 * @param workflow - Complete active workflow source
 * @param additionalFiles - Hostile project files that doctor must never execute
 * @returns The bounded nightly guard check from JSON output
 */
export async function doctorNightlyGuard(
  workflow: string,
  additionalFiles: Readonly<Record<string, string>> = {}
): Promise<{
  readonly status: string;
  readonly detail: string;
}> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-cli-"));
  try {
    await mkdir(path.join(projectRoot, ".github", "workflows"), {
      recursive: true,
    });
    await mkdir(path.join(projectRoot, "scripts"));
    await writeFile(
      path.join(projectRoot, ".github", "workflows", "active.yml"),
      workflow
    );
    await writeFile(
      path.join(projectRoot, TARGET),
      await readFile(
        path.join(
          REPOSITORY_ROOT,
          "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
        )
      )
    );
    await Promise.all(
      Object.entries(additionalFiles).map(async ([file, source]) => {
        await writeFile(path.join(projectRoot, file), source);
      })
    );
    const stdout = await readDoctorJson(() => executeBuiltDoctor(projectRoot));
    const payload = JSON.parse(stdout) as {
      readonly checks: readonly {
        readonly name: string;
        readonly status: string;
        readonly detail: string;
      }[];
    };
    const finding = payload.checks.find(
      check => check.name === "Nightly E2E bypass guard bounded?"
    );
    if (!finding) throw new Error("built doctor omitted the nightly guard row");
    return finding;
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}
