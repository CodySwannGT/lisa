/**
 * The version guard reads an UNCACHED registry endpoint (#3685).
 *
 * `Determine Version` picks the version the release will cut, and its last act
 * on a production release is to check that the computed version is above what
 * npm already has. It asked `npm view <pkg> version` — the most-cached endpoint
 * npm serves.
 *
 * Measured 2026-09-03, in the ~13 minutes after a publish completed: `npm
 * view`, the plain packument and `/-/package/.../dist-tags` all reported a
 * version two behind, while the exact-version endpoint and `?write=true` both
 * reported the truth. A guard fed a stale base under-corrects, and the
 * under-correction is silent — the release still cuts a tag, a GitHub release
 * and an attestation, and only the npm publish fails. That is how a version
 * ends up tagged, released and attested but absent from the registry.
 *
 * ## What each half of this file proves
 *
 * The differential is the point, and it needs no network: hold the computed
 * version constant, vary only what the registry answers, and watch the chosen
 * version change. A stale answer two behind yields the version that collides;
 * the true answer yields one above it. That is the defect stated as a
 * measurement rather than as a claim about an endpoint.
 *
 * The source-level assertions carry what execution cannot: WHICH endpoint the
 * shipped step asks. A stubbed registry answers whatever it is told regardless
 * of the URL requested, so only reading the shipped body can show the cached
 * call is gone. Same split `guard-behavioural-parity` makes, for the same
 * reason.
 *
 * The unreachable case runs the real shipped `node -e` against an address that
 * cannot resolve, so the fetch, the failure and the warning are all genuine.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/release-published-version-read
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const WORKFLOW = path.join(process.cwd(), ".github/workflows/release.yml");

/** The job and step that choose the release version. */
const VERSION_JOB = "version";
const DETERMINE_VERSION = "Determine Version";

/** The environment that reaches the registry comparison at all. */
const PRODUCTION = "production";

/** The strategy that lets a case state the computed version outright. */
const CUSTOM_STRATEGY = "custom";

/** The package name the stubbed `node -p` reports. */
const PACKAGE_NAME = "@example/fixture-package";

/**
 * The cached answer measured while a publish had already landed, and the truth.
 *
 * Both are the real numbers from the incident: `npm view` said `4.33.6` for
 * minutes after `4.33.8` was live.
 */
const STALE_LATEST = "4.33.6";
const TRUE_LATEST = "4.33.8";

/** The version standard-version would compute from the branch's own history. */
const COMPUTED = "4.33.7";

/** The shape of the parsed workflow this test reads. */
interface Workflow {
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly steps?: readonly {
          readonly name?: string;
          readonly run?: string;
        }[];
      }
    >
  >;
}

/**
 * Read one step's shipped `run:` body out of the real workflow.
 * @param jobName - Job key in `jobs:`
 * @param stepName - The step's `name:`
 * @returns The step's script, exactly as it ships
 */
function stepBody(jobName: string, stepName: string): string {
  const workflow = loadYaml(fs.readFileSync(WORKFLOW, "utf-8")) as Workflow;
  const step = workflow.jobs[jobName]?.steps?.find(s => s.name === stepName);
  if (step?.run === undefined)
    throw new Error(`step not found in ${WORKFLOW}: ${jobName} / ${stepName}`);
  return step.run;
}

/** What one execution of the step left behind. */
interface Outcome {
  readonly status: number;
  readonly outputs: string;
  readonly log: string;
}

/**
 * Run the shipped step body in a sandbox.
 * @param env - Extra environment for the run
 * @param stubNode - Whether to put a canned-registry `node` on PATH
 * @returns What the run produced
 */
function runStep(
  env: Readonly<Record<string, string>>,
  stubNode: boolean
): Outcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-release-registry-"));
  try {
    fs.writeFileSync(
      path.join(dir, "release-logger.sh"),
      "log_release_event() { :; }\n"
    );
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "0.0.0" })
    );
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);

    // `npx semver`, for real. The bump loop's correctness is the thing under
    // test here, so a recorder that returned nothing would make every version
    // assertion below vacuous.
    fs.writeFileSync(
      path.join(bin, "npx"),
      `#!/bin/bash\n[ "$1" = "semver" ] || exit 0\nshift\nSEMVER_ARGS="$*" exec ${process.execPath} -e '\nconst s=require(${JSON.stringify(path.join(process.cwd(), "node_modules/semver"))});\nconst a=(process.env.SEMVER_ARGS||"").split(" ").filter(Boolean);\nif(a[0]==="-i"){const o=s.inc(a[2],a[1]);if(!o)process.exit(1);process.stdout.write(o+"\\n");process.exit(0);}\nconst v=a.filter(x=>s.valid(x));\nif(v.length!==a.length)process.exit(1);\nprocess.stdout.write(v.sort(s.compare).join("\\n")+"\\n");\n'`,
      { mode: 0o755 }
    );

    if (stubNode) {
      // Answers the package-name probe and the registry read. It ignores the
      // URL, which is exactly why the source-level assertions exist.
      fs.writeFileSync(
        path.join(bin, "node"),
        `#!/bin/bash\nif [ "$1" = "-p" ]; then printf '%s\\n' "${PACKAGE_NAME}"; exit 0; fi\nif [ "$1" = "-e" ]; then printf '%s' "\${FAKE_REGISTRY_LATEST:-}"; exit 0; fi\nexec ${process.execPath} "$@"\n`,
        { mode: 0o755 }
      );
    }

    const scriptPath = path.join(dir, "step.sh");
    fs.writeFileSync(scriptPath, stepBody(VERSION_JOB, DETERMINE_VERSION));
    const outputPath = path.join(dir, "github_output");
    fs.writeFileSync(outputPath, "");
    const logPath = path.join(dir, "log");

    const outcome = boundedSpawnSync({
      args: [scriptPath],
      command: "bash",
      cwd: dir,
      env: {
        ...process.env,
        ...env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: path.join(dir, "step_summary"),
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      },
      label: "release.yml Determine Version",
    });
    fs.writeFileSync(logPath, `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`);

    return {
      log: fs.readFileSync(logPath, "utf-8"),
      outputs: fs.readFileSync(outputPath, "utf-8"),
      status: outcome.status ?? -1,
    };
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * The `version=` value the step published.
 * @param outcome - A completed run
 * @returns The chosen version, or an empty string
 */
function chosenVersion(outcome: Outcome): string {
  const hit = outcome.outputs
    .split("\n")
    .filter(line => line.startsWith("version="))
    .pop();
  return hit ? hit.slice("version=".length) : "";
}

describe("the chosen version depends on what the registry actually says", () => {
  it("a stale answer picks the version that collides", () => {
    // The defect as a differential. Nothing about the endpoint is asserted
    // here — only that a base two behind yields 4.33.7, which is the version
    // the incident found tagged and unpublished.
    const result = runStep(
      {
        FAKE_REGISTRY_LATEST: STALE_LATEST,
        RELEASE_CUSTOM_VERSION: COMPUTED,
        RELEASE_ENVIRONMENT: PRODUCTION,
        RELEASE_PRERELEASE: "",
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
      },
      true
    );

    expect(result.status).toBe(0);
    expect(chosenVersion(result)).toBe("4.33.7");
  });

  it("the true answer picks one above what is published", () => {
    const result = runStep(
      {
        FAKE_REGISTRY_LATEST: TRUE_LATEST,
        RELEASE_CUSTOM_VERSION: COMPUTED,
        RELEASE_ENVIRONMENT: PRODUCTION,
        RELEASE_PRERELEASE: "",
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
      },
      true
    );

    expect(result.log).toContain("is not above published");
    expect(chosenVersion(result)).toBe("4.33.9");
    expect(result.status).toBe(0);
  });
});

describe("an unreadable registry is unknown, not empty", () => {
  it("warns and does not silently proceed as if nothing were published", () => {
    // Real shipped `node -e`, real fetch, an address that cannot resolve. The
    // pre-fix code answered the empty string here too — and said nothing, which
    // is the shape that let a broken guard look like a clean run.
    const result = runStep(
      {
        LISA_NPM_REGISTRY: "http://127.0.0.1:1",
        RELEASE_CUSTOM_VERSION: COMPUTED,
        RELEASE_ENVIRONMENT: PRODUCTION,
        RELEASE_PRERELEASE: "",
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
      },
      false
    );

    expect(result.status).toBe(0);
    expect(result.log).toContain("guard did NOT run");
    expect(result.log).toContain("not as nothing being published");
  });
});

describe("the shipped step asks an uncached endpoint", () => {
  const body = stepBody(VERSION_JOB, DETERMINE_VERSION);

  it("no longer reads the cached npm view", () => {
    // The rejection control, kept verbatim as it shipped before this change.
    expect(body).not.toContain('npm view "$PACKAGE_NAME" version');
  });

  it("requests the cache-busting packument", () => {
    // A stubbed registry answers whatever it is told regardless of URL, so
    // this is the only place the endpoint itself can be pinned.
    expect(body).toContain("?write=true");
    expect(body).toContain("dist-tags");
  });

  it("names why, so the next author does not simplify it back", () => {
    expect(body).toContain("most-cached");
  });
});
