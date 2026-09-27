/**
 * The deploy path must actually DELIVER the scanner secrets quality.yml
 * declares (issue #4287).
 *
 * A consumer's deploy.yml calls release.yml with an explicit `secrets:` map —
 * `inherit` is deliberately refused in caller templates because SonarCloud
 * flags it as a vulnerability (#3065). An explicit map can only pass secrets
 * the callee DECLARES in `workflow_call.secrets`, and release.yml declared
 * none of the scanner tokens. SONAR_TOKEN therefore died at the release.yml
 * hop: `secrets: inherit` to quality.yml forwarded an empty set, the quality
 * run took its "no token, skip" branch, and the release stayed green with no
 * analysis and no signal — a skip indistinguishable from a pass.
 *
 * The same silent-skip shape covers every scanner secret, not just
 * SONAR_TOKEN, so the invariant is stated over the whole set. Tracker
 * credentials are excluded on purpose: quality.yml's work_item_traceability
 * job is pull_request-only and never runs on the release path, so release.yml
 * does not declare them and callers must not map them.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/config/release-quality-secret-forwarding
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** The scanner secrets the release quality run needs to reach quality.yml. */
const SCANNER_SECRETS = [
  "SONAR_TOKEN",
  "SNYK_TOKEN",
  "GITGUARDIAN_API_KEY",
  "FOSSA_API_KEY",
  "MAESTRO_API_KEY",
] as const;

/** Shape of the parts of a workflow file this test reads. */
interface WorkflowDoc {
  readonly on?: {
    readonly workflow_call?: {
      readonly secrets?: Record<string, unknown>;
    };
  };
  readonly jobs?: Record<
    string,
    {
      readonly uses?: string;
      readonly secrets?: Record<string, unknown> | string;
    }
  >;
}

/**
 * Parses a workflow file into the subset of its structure this test reads.
 * @param relative - Repo-relative workflow path.
 * @returns The parsed document.
 */
function readWorkflow(relative: string): WorkflowDoc {
  return loadYaml(
    readFileSync(path.join(ROOT, relative), "utf-8")
  ) as WorkflowDoc;
}

/** release.yml as a parsed document — the middle hop this issue is about. */
const RELEASE = readWorkflow(".github/workflows/release.yml");

/** The declared `workflow_call` secret names on release.yml. */
const RELEASE_DECLARED = new Set(
  Object.keys(RELEASE.on?.workflow_call?.secrets ?? {})
);

/**
 * The secrets release.yml hands its quality job — every name when the call
 * inherits, else the mapped keys.
 * @returns The set of secret names reaching quality.yml.
 */
function releaseForwardsToQuality(): ReadonlySet<string> | "inherit" {
  const quality = Object.values(RELEASE.jobs ?? {}).find(
    job => job.uses === "./.github/workflows/quality.yml"
  );
  if (quality === undefined) throw new Error("release.yml has no quality call");
  if (quality.secrets === "inherit") return "inherit";
  return new Set(Object.keys(quality.secrets ?? {}));
}

describe("the deploy path delivers scanner secrets to quality.yml", () => {
  it.each(SCANNER_SECRETS.map(name => [name] as const))(
    "release.yml declares %s in workflow_call.secrets so a mapping caller can pass it",
    name => {
      expect(RELEASE_DECLARED.has(name)).toBe(true);
    }
  );

  it("release.yml's quality call forwards them (inherit or explicit)", () => {
    const forwarded = releaseForwardsToQuality();
    if (forwarded !== "inherit") {
      for (const name of SCANNER_SECRETS) {
        expect(forwarded.has(name), `${name} reaching quality.yml`).toBe(true);
      }
    }
  });

  it("every shipped deploy.yml that calls release.yml maps every scanner secret", () => {
    const deploys = globSync("*/create-only/.github/workflows/deploy.yml", {
      cwd: ROOT,
    });
    const callers = deploys.filter(file => {
      const doc = readWorkflow(file);
      return Object.values(doc.jobs ?? {}).some(job =>
        job.uses?.includes("workflows/release.yml@")
      );
    });
    // The discovery itself must not be vacuous — a rename would otherwise
    // turn this suite into a check that proves nothing.
    expect(callers.length).toBeGreaterThan(0);
    for (const file of callers) {
      const doc = readWorkflow(file);
      const releaseJobs = Object.values(doc.jobs ?? {}).filter(job =>
        job.uses?.includes("workflows/release.yml@")
      );
      for (const job of releaseJobs) {
        const map = job.secrets;
        expect(typeof map, `${file} must map secrets, not inherit`).toBe(
          "object"
        );
        const passed = new Set(Object.keys(map as Record<string, unknown>));
        for (const name of SCANNER_SECRETS) {
          expect(
            passed.has(name),
            `${file} forwards ${name} to release.yml`
          ).toBe(true);
        }
      }
    }
  });

  it("quality.yml's CE-task query uses Bearer auth, which org-scoped tokens accept", () => {
    const body = readFileSync(
      path.join(ROOT, ".github/workflows/quality.yml"),
      "utf-8"
    );
    const lines = body.split("\n");
    const taskQuery = lines.find(line => line.includes("api/ce/task"));
    expect(taskQuery).toBeDefined();
    // Bearer auth, carried in a header FILE rather than argv so the token
    // never appears in the runner's process list.
    expect(taskQuery).toContain('-H "@$AUTH_HEADER_FILE"');
    expect(taskQuery).not.toContain('-u "$SONAR_TOKEN:"');
    expect(
      lines.some(line =>
        line.includes("printf 'Authorization: Bearer %s\\n' \"$SONAR_TOKEN\"")
      )
    ).toBe(true);
  });
});
