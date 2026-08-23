/**
 * Harness that EXECUTES the reusable workflow's EAS build step, pulled verbatim
 * out of the YAML, against a stubbed `eas` CLI.
 *
 * The stub exists so the assertions can read which EAS subcommands actually
 * ran. That is the only way to prove `reuse_build_by_fingerprint` does its job:
 * the feature is not "a fingerprint was computed", it is "`eas build` was NOT
 * invoked" — which on Expo's Free plan is the difference between a suite that
 * runs and a suite that has no quota left to run with.
 *
 * Shared by maestro-build-reuse.test.ts and maestro-eas-quota-diagnosis.test.ts
 * so the two read the same step through the same seam.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The reusable workflow under test. */
export const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The Android artifact the build job must leave behind. */
export const ANDROID_ARTIFACT = "app-android.apk";

/** The iOS artifact the build job must leave behind. */
export const IOS_ARTIFACT = "app-ios.tar.gz";

/** The `eas` subcommand whose ABSENCE is the point of build reuse. */
export const BUILD_SUBCOMMAND = "build";

/** The `eas` subcommand that computes the reuse key. */
export const FINGERPRINT_SUBCOMMAND = "fingerprint:generate";

/** The `eas` subcommand that fetches a finished binary. */
export const DOWNLOAD_SUBCOMMAND = "build:download";

/** The `eas` subcommand behind the weaker latest-finished-build fallback. */
export const LIST_SUBCOMMAND = "build:list";

/** Shape of a single step inside a workflow job's `steps:` list. */
export interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
export interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** How the stubbed `eas fingerprint:generate` should behave. */
export type FingerprintMode = "hit" | "fail" | "empty";

/** How a stubbed `eas build:download` should behave. */
export type DownloadMode = "hit" | "miss";

/** How the stubbed `eas build:list` should behave. */
export type ListMode = "hit" | "miss";

/** How the stubbed `eas build` should behave. */
export type BuildMode = "ok" | "quota" | "error";

/** One execution of the build step, plus what the stub observed. */
export interface StepRun {
  status: number;
  output: string;
  /** Every `eas` argv the step invoked, in order. */
  invocations: string[];
  /** `app-*` files staged in the working directory afterwards. */
  staged: string[];
}

/** Which inputs the caller passed and how the stubbed EAS should behave. */
export interface BuildStepOptions {
  /** Which matrix arm to execute. */
  platform?: "android" | "ios";
  /** The `reuse_build_by_fingerprint` input. */
  reuse?: boolean;
  /** The `diagnose_eas_quota_exhaustion` input. */
  diagnose?: boolean;
  /** How `eas fingerprint:generate` should behave. */
  fingerprint?: FingerprintMode;
  /** How `eas build:download --fingerprint` should behave. */
  download?: DownloadMode;
  /** How `eas build:list` should behave. */
  list?: ListMode;
  /** How `eas build:download --build-id` should behave. */
  buildIdDownload?: DownloadMode;
  /** How `eas build` should behave. */
  build?: BuildMode;
  /** Whether the reusable artifact is an extracted .app DIRECTORY. */
  artifactIsDir?: boolean;
}

/**
 * A stub `eas` whose behaviour is driven entirely by env vars, so one script
 * covers every branch. It logs every invocation before dispatching — the log is
 * what the assertions read.
 */
const EAS_STUB = `#!/bin/bash
echo "$*" >> "$STUB_LOG"
case "$1" in
  fingerprint:generate)
    case "$FP_MODE" in
      hit) echo '{"hash":"fp-abc123"}'; exit 0 ;;
      empty) echo '{}'; exit 0 ;;
      *) echo "eas: could not compute a fingerprint" >&2; exit 1 ;;
    esac
    ;;
  build:download)
    if [[ "$*" == *--fingerprint* ]]; then
      MODE="$DL_MODE"
    else
      MODE="$BUILD_ID_DL_MODE"
    fi
    if [[ "$MODE" == "hit" ]]; then
      if [[ "$STUB_ARTIFACT_IS_DIR" == "true" ]]; then
        mkdir -p "$STUB_ARTIFACT"
        echo "binary" > "$STUB_ARTIFACT/Payload"
      else
        echo "binary" > "$STUB_ARTIFACT"
      fi
      echo "{\\"path\\":\\"$STUB_ARTIFACT\\"}"
      exit 0
    fi
    echo "eas: no matching build to download" >&2
    exit 1
    ;;
  build:list)
    if [[ "$LIST_MODE" == "hit" ]]; then
      echo '[{"id":"build-id-777"}]'
      exit 0
    fi
    echo '[]'
    exit 0
    ;;
  build)
    case "$BUILD_MODE" in
      quota)
        echo "Your account has used its iOS builds from the Free plan for this month." >&2
        exit 1
        ;;
      error)
        echo "Gradle build failed with exit code 1" >&2
        exit 1
        ;;
      *)
        echo '[{"artifacts":{"buildUrl":"https://example.invalid/app"}}]'
        exit 0
        ;;
    esac
    ;;
esac
exit 0
`;

/** A stub `curl` that writes the requested output file without any network. */
const CURL_STUB = `#!/bin/bash
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$out" ]] && echo "downloaded" > "$out"
exit 0
`;

/**
 * Parses the reusable workflow from disk.
 * @returns The parsed workflow document
 */
export const loadReusable = async (): Promise<ReusableWorkflow> =>
  yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as ReusableWorkflow;

/**
 * The verbatim `run:` text of the EAS build step — never a copy of it.
 * @param workflow - The parsed reusable workflow
 * @returns The build step's shell script exactly as CI will run it
 */
export const buildStepScript = (workflow: ReusableWorkflow): string => {
  const step = (workflow.jobs.build.steps ?? []).find(candidate =>
    candidate.name?.includes("Build with EAS")
  );
  if (!step?.run) {
    throw new Error("no `Build with EAS` step in the build job");
  }
  return step.run;
};

/**
 * Runs a script under bash, folding a non-zero exit into a value rather than a
 * throw — a failing build IS an outcome under test here, not an error.
 * @param script - The shell to execute
 * @param cwd - Working directory for the run
 * @param env - Environment for the run
 * @returns The exit status and the combined stdout/stderr
 */
const execute = (
  script: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): { status: number; output: string } => {
  try {
    return {
      status: 0,
      output: boundedExecFileSync({
        label: "the maestro build step",
        command: BASH,
        args: ["-c", script],
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const failure = error as {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.exitCode ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
};

/**
 * Runs the real build step against the stubbed CLI.
 * @param script - The build step's shell, from {@link buildStepScript}
 * @param options - Which inputs the caller passed and how EAS should behave
 * @returns The step's exit status, output, EAS invocations, and staged files
 */
export const runBuildStep = async (
  script: string,
  options: BuildStepOptions = {}
): Promise<StepRun> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-build-"));
  try {
    const stubs = path.join(dir, "stubs");
    await fs.ensureDir(stubs);
    await fs.writeFile(path.join(stubs, "eas"), EAS_STUB, { mode: 0o755 });
    await fs.writeFile(path.join(stubs, "curl"), CURL_STUB, { mode: 0o755 });

    const log = path.join(dir, "eas-invocations.log");
    await fs.writeFile(log, "");

    const env = {
      ...process.env,
      PATH: `${stubs}${path.delimiter}${process.env.PATH ?? ""}`,
      STUB_LOG: log,
      STUB_ARTIFACT: path.join(
        dir,
        options.artifactIsDir === true ? "Reused.app" : "reused-artifact.bin"
      ),
      STUB_ARTIFACT_IS_DIR: String(options.artifactIsDir === true),
      FP_MODE: options.fingerprint ?? "hit",
      DL_MODE: options.download ?? "hit",
      LIST_MODE: options.list ?? "miss",
      BUILD_ID_DL_MODE: options.buildIdDownload ?? "hit",
      BUILD_MODE: options.build ?? "ok",
      EAS_PLATFORM: options.platform ?? "android",
      EAS_PROFILE: "dev-e2e",
      REUSE_BY_FINGERPRINT: String(options.reuse === true),
      DIAGNOSE_QUOTA: String(options.diagnose === true),
    };

    const outcome = execute(script, dir, env);

    const invocations = (await fs.readFile(log, "utf-8"))
      .split("\n")
      .filter(Boolean);
    const staged = (await fs.readdir(dir)).filter(name =>
      name.startsWith("app-")
    );
    return { ...outcome, invocations, staged };
  } finally {
    await fs.remove(dir);
  }
};

/**
 * Whether any logged EAS invocation started with the given subcommand.
 * @param invocations - The stub's invocation log
 * @param subcommand - The `eas` subcommand to look for
 * @returns True when that subcommand ran at least once
 */
export const ran = (invocations: string[], subcommand: string): boolean =>
  invocations.some(
    line => line === subcommand || line.startsWith(`${subcommand} `)
  );
