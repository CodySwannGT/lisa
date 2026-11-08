/**
 * Runs the real third-party review evidence CLI against raw GitHub responses.
 *
 * Only the external observations are controlled. The prover executes from its
 * source location with its real import closure, reads its declaration from a
 * real `.lisa.config.json`, and reaches GitHub through a `gh` on PATH that
 * answers from frozen raw API payloads and journals every call. That shim has
 * no network and no write route: an unsupported call exits 72, and this
 * harness throws on it, so a missing route can never be reported as a
 * behavioural result (CodySwannGT/lisa#4553).
 * @module tests/helpers/third-party-review-cli-fixture
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  HEAD,
  permissionRoute,
  PINNED_CONFIG,
  PROVER,
  PULL,
  REPO,
  ROUTES,
  SUBSTITUTE_WRITER,
} from "./third-party-review-observations.js";

export * from "./third-party-review-observations.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** What one scenario observes on GitHub. */
export interface Observations {
  /** The declaration, or null for a project with no `.lisa.config.json`. */
  readonly config?: object | null;
  /** Raw commit statuses at the head. */
  readonly statuses?: readonly Record<string, unknown>[];
  /** Raw check runs the reviewer's filtered read returns. */
  readonly checkRuns?: readonly Record<string, unknown>[];
  /** The whole check-run envelope, when a case is about its shape. */
  readonly checkRunEnvelope?: unknown;
  /** Issue comments on the pull request. */
  readonly comments?: readonly Record<string, unknown>[];
  /**
   * Each comment author's raw permission response, keyed by login. Defaults to
   * {@link SUBSTITUTE_WRITER} holding `write`; a login with no entry is an
   * unsupported read, so a case that names another author supplies its answer.
   */
  readonly permissions?: Readonly<Record<string, unknown>>;
  /** Review objects on the pull request — supplied, never expected to be read. */
  readonly reviews?: readonly Record<string, unknown>[];
  /** Open pull requests whose head is the commit. */
  readonly pulls?: readonly Record<string, unknown>[];
  /** The raw PR response, including deliberate API refusal or malformed bodies. */
  readonly pullResponse?: unknown;
  /** Extra CLI arguments, such as `--context`. */
  readonly args?: readonly string[];
}

/** One journaled `gh` invocation. */
export interface JournaledCall {
  readonly argv: readonly string[];
  readonly allowed: boolean;
  readonly refused: boolean;
}

/** Everything one real CLI run produced, with its source and input identity. */
export interface CliRun {
  readonly command: readonly string[];
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly verdict: {
    readonly outcome: string;
    readonly sha: string;
    readonly readings: ReadonlyArray<Record<string, unknown>>;
  };
  readonly calls: readonly JournaledCall[];
  readonly sourceSha256: string;
  readonly inputSha256: string;
}

/**
 * The raw route map one scenario answers from.
 * @param observations - The scenario's observations
 * @returns Route-keyed raw payloads
 */
function responsesFor(observations: Observations): Record<string, unknown> {
  const runs = observations.checkRuns ?? [];
  return {
    [ROUTES.pulls]: Object.hasOwn(observations, "pullResponse")
      ? observations.pullResponse
      : (observations.pulls ?? [
          { number: PULL, state: "open", head: { sha: HEAD } },
        ]),
    [ROUTES.status]: {
      sha: HEAD,
      total_count: (observations.statuses ?? []).length,
      statuses: observations.statuses ?? [],
    },
    [ROUTES.checkRuns]: observations.checkRunEnvelope ?? {
      total_count: runs.length,
      check_runs: runs,
    },
    [ROUTES.comments]: observations.comments ?? [],
    [ROUTES.reviews]: observations.reviews ?? [],
    ...Object.fromEntries(
      Object.entries(
        observations.permissions ?? {
          [SUBSTITUTE_WRITER]: { permission: "write" },
        }
      ).map(([login, answer]) => [permissionRoute(login), answer])
    ),
  };
}

/**
 * Hash the bytes that determine a run, so a result is bound to its inputs.
 * @param parts - Serialisable inputs
 * @returns Hex SHA-256 of their canonical JSON
 */
function sha256Of(...parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** A controlled GitHub installed into one fixture folder. */
export interface ControlledGitHub {
  /** The directory to put first on PATH. */
  readonly bindir: string;
  /** The declaration written, or null when none was. */
  readonly config: object | null;
  /** The raw route map the shim answers from. */
  readonly responses: Record<string, unknown>;
  /** Every call made so far, throwing if any was unsupported. */
  readonly calls: () => readonly JournaledCall[];
}

/**
 * Install a scenario's declaration and a journaling `gh` into a folder.
 * @param folder - A fresh fixture folder the caller owns
 * @param observations - The scenario's raw GitHub observations
 * @returns Where the shim lives, what it answers, and its journal
 */
export function installControlledGitHub(
  folder: string,
  observations: Observations
): ControlledGitHub {
  const bindir = path.join(folder, "bin");
  const journal = path.join(folder, "calls.jsonl");
  const config =
    observations.config === undefined ? PINNED_CONFIG : observations.config;
  const responses = responsesFor(observations);
  const shim = fs.readFileSync(
    path.join(ROOT, "tests/fixtures/third-party-review-gh.cjs"),
    "utf8"
  );
  const calls = (): readonly JournaledCall[] => {
    const journaled = fs
      .readFileSync(journal, "utf8")
      .split("\n")
      .filter(line => line !== "")
      .map(line => JSON.parse(line) as JournaledCall);
    const unsupported = journaled.filter(call => !call.allowed);
    if (unsupported.length > 0) {
      throw new Error(
        `Invalid replay: ${unsupported.length} unsupported GitHub call(s), so this run is not behavioural evidence: ${JSON.stringify(unsupported)}`
      );
    }
    return journaled;
  };
  fs.mkdirSync(bindir);
  if (config !== null) {
    fs.writeFileSync(
      path.join(folder, ".lisa.config.json"),
      JSON.stringify(config)
    );
  }
  fs.writeFileSync(
    path.join(folder, "responses.json"),
    JSON.stringify(responses)
  );
  fs.writeFileSync(journal, "");
  fs.writeFileSync(
    path.join(bindir, "gh"),
    `#!${process.execPath}\nprocess.argv.splice(2, 0, ${JSON.stringify(folder)});\n${shim}`,
    { mode: 0o755 }
  );
  return { bindir, config, responses, calls };
}

/**
 * Execute the real CLI once against one scenario's raw responses.
 *
 * Throws, rather than returning a result, when the run is not valid evidence:
 * an unsupported `gh` call, or output that is not the verdict JSON.
 * @param observations - The scenario's raw GitHub observations
 * @param env - The test's own environment, supplied explicitly by the suite
 * @returns The run, its verdict, and its full call journal
 */
export function runThirdPartyReviewCli(
  observations: Observations,
  env: NodeJS.ProcessEnv
): CliRun {
  const folder = fs.mkdtempSync(path.join(tmpdir(), "third-party-review-"));
  try {
    const github = installControlledGitHub(folder, observations);
    const { bindir, config, responses } = github;
    const args = [
      path.join(ROOT, PROVER),
      `--sha=${HEAD}`,
      `--repo=${REPO}`,
      `--root=${folder}`,
      "--json",
      ...(observations.args ?? []),
    ];
    const result = boundedSpawnSync({
      label: "the real third-party review evidence CLI",
      command: process.execPath,
      args,
      cwd: folder,
      env: {
        ...env,
        PATH: `${bindir}${path.delimiter}${env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "",
      },
      baseMs: 30000,
    });
    const calls = github.calls();
    const stdout = String(result.stdout);
    return {
      command: [process.execPath, ...args],
      status: result.status,
      stdout,
      stderr: String(result.stderr),
      verdict: JSON.parse(stdout),
      calls,
      sourceSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(ROOT, PROVER)))
        .digest("hex"),
      inputSha256: sha256Of(config, responses, observations.args ?? []),
    };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/** The prover and its one flat peer; its `lib/` is copied whole. */
const PROVER_FILES = [
  "check-third-party-review-evidence.mjs",
  "lisa-gates.mjs",
] as const;

/**
 * Install the shipped prover where a host's workflow runs it: `scripts/`.
 *
 * The bytes are the source bytes, copied with their whole import closure, so a
 * workflow step executed against this folder runs exactly what ships.
 * @param folder - A fixture folder standing in for a host checkout
 */
export function installProverAsHost(folder: string): void {
  const source = path.join(ROOT, "all/copy-overwrite/scripts");
  const destination = path.join(folder, "scripts");
  // The whole directory, never its members by name: a listed roster is a
  // second copy of the prover's imports that goes stale without a sound.
  fs.cpSync(path.join(source, "lib"), path.join(destination, "lib"), {
    recursive: true,
  });
  for (const file of PROVER_FILES) {
    fs.copyFileSync(path.join(source, file), path.join(destination, file));
  }
}

/**
 * The single reading a one-reviewer run produced.
 * @param run - A completed CLI run
 * @returns Its only reading
 */
export function onlyReading(run: CliRun): Record<string, unknown> {
  if (run.verdict.readings.length !== 1) {
    throw new Error(
      `Expected one reading, saw ${run.verdict.readings.length}: ${run.stdout}`
    );
  }
  return run.verdict.readings[0] ?? {};
}

/**
 * The routes a run actually read, in order.
 * @param run - A completed CLI run
 * @returns The API path of every journaled call — its last argv element, so a
 *   paginated `api --paginate --slurp <path>` read names its path too
 */
export function routesRead(run: CliRun): readonly string[] {
  return run.calls.map(call => call.argv.at(-1) ?? "");
}
