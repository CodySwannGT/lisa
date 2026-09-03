/**
 * Proof that a gate report says WHICH Lisa produced it.
 *
 * A consumer runs two Lisas at once: its `package.json` pins the version that
 * governs the local pre-push gate, while its CI calls the reusable workflow at
 * a floating ref. Neither surface used to name what it ran, so a push-gate
 * observation and a CI observation were claims about different code that read
 * as claims about the same thing — and a floating ref means CI behaviour can
 * change with NO commit in the consuming repository, so a true warning about
 * gate behaviour goes stale with nothing able to notice.
 *
 * The assertions that carry weight here are the refusals: an unresolvable
 * version must render as `unknown` and must never be filled in from the host
 * application's manifest, because a confidently wrong version is worse than an
 * absent one — it dates a claim to a Lisa that never ran.
 * @module tests/unit/scripts/lisa-gates-identity
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  artifactDigest,
  formatIdentityLine,
  formatIdentityMarkdown,
  identityRegistryPath,
  IDENTITY_UNKNOWN,
  lisaIdentity,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY_SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-gates.mjs"
);

/** The two artifacts whose bytes decide a verdict. */
const ARTIFACTS = ["lisa-gates.mjs", "lisa-run-gates.mjs"] as const;

/** A digest a reader can compare between two printed reports. */
const DIGEST = /^sha256:[0-9a-f]{12}$/;

/** A workflow ref shaped the way GitHub supplies one to a called workflow. */
const WORKFLOW_REF = "o/r/.github/workflows/quality.yml@refs/heads/main";

/** The commit that workflow was read from. */
const WORKFLOW_SHA = "a83dc2124";

/** A digest reused across renderings so a reader can compare them. */
const GATES_DIGEST = "sha256:612ce565f3ee";

type Identity = {
  surface: string;
  registry_version: string | null;
  registry_path: string;
  workflow_ref: string | null;
  workflow_sha: string | null;
  artifacts: Record<string, string | null>;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * A scratch directory cleaned up after the test that made it.
 * @returns The absolute path to the directory.
 */
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-identity-"));
  roots.push(root);
  return root;
}

/**
 * This process's environment with the surface signal removed.
 *
 * `lisaIdentity` reads `GITHUB_ACTIONS` to decide whether it is on `ci` or
 * `local`, and a test suite RUNS on both — locally where the variable is
 * absent, and in CI where it is `true`. Inheriting it made every assertion
 * about the local surface a claim about where the suite happened to run,
 * so the two `surface=local` cases below failed in CI on every diff.
 *
 * Scrubbed rather than accommodated. An assertion relaxed to accept either
 * surface would pass in both environments while proving neither, which is
 * the shape of a control that reports success having checked nothing —
 * and the whole point of the stamp under test is that it names its surface
 * correctly. A test wanting the CI surface still gets it by passing
 * `GITHUB_ACTIONS` explicitly, which is also what makes each case say out
 * loud which surface it is about.
 * @returns The environment a child inherits unless a case says otherwise.
 */
function surfacelessEnv(): NodeJS.ProcessEnv {
  const { GITHUB_ACTIONS: _runnerSignal, ...rest } = process.env;
  return rest;
}

/**
 * Run the registry CLI from the repository root.
 * @param args - Arguments after the script path.
 * @param env - Environment overrides layered on a surface-free environment.
 * @returns The completed child process.
 */
function runCli(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return boundedSpawnSync({
    label: "lisa-gates identity",
    command: process.execPath,
    args: [REGISTRY_SCRIPT, ...args],
    cwd: REPO_ROOT,
    env: { ...surfacelessEnv(), ...env },
  });
}

describe("lisaIdentity", () => {
  it("names the CI surface only when the runner says so", () => {
    const ci = lisaIdentity({ env: { GITHUB_ACTIONS: "true" } }) as Identity;
    const local = lisaIdentity({ env: {} }) as Identity;
    expect(ci.surface).toBe("ci");
    expect(local.surface).toBe("local");
  });

  it("carries the workflow ref and sha CI supplies", () => {
    const identity = lisaIdentity({
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_WORKFLOW_REF: WORKFLOW_REF,
        GITHUB_WORKFLOW_SHA: WORKFLOW_SHA,
      },
    }) as Identity;
    expect(identity.workflow_ref).toBe(WORKFLOW_REF);
    expect(identity.workflow_sha).toBe(WORKFLOW_SHA);
  });

  it("records null, not a guess, when CI supplied nothing", () => {
    const identity = lisaIdentity({ env: {} }) as Identity;
    expect(identity.workflow_ref).toBeNull();
    expect(identity.workflow_sha).toBeNull();
  });

  it("digests the enforcement scripts that decide a verdict", () => {
    const identity = lisaIdentity({ env: {} }) as Identity;
    for (const name of ARTIFACTS) {
      expect(identity.artifacts[name], name).toMatch(DIGEST);
    }
  });

  it("distinguishes two copies of a script that share a version string", () => {
    const root = scratch();
    const one = path.join(root, "a.mjs");
    const two = path.join(root, "b.mjs");
    writeFileSync(one, "// 2745 lines\n");
    writeFileSync(two, "// 2744 lines\n");
    expect(artifactDigest(one)).not.toBe(artifactDigest(two));
  });

  it("reports a missing artifact as null rather than inventing a digest", () => {
    const identity = lisaIdentity({
      env: {},
      directory: scratch(),
    }) as Identity;
    for (const name of ARTIFACTS)
      expect(identity.artifacts[name], name).toBeNull();
  });
});

describe("formatIdentityLine", () => {
  it("names the surface, the package, the workflow and the bytes", () => {
    const line = formatIdentityLine({
      surface: "ci",
      registry_version: "4.32.2",
      workflow_ref: WORKFLOW_REF,
      workflow_sha: WORKFLOW_SHA,
      artifacts: { "lisa-gates.mjs": GATES_DIGEST },
    });
    expect(line).toContain("surface=ci");
    expect(line).toContain("package=@codyswann/lisa@4.32.2");
    expect(line).toContain(`workflow=${WORKFLOW_REF}@${WORKFLOW_SHA}`);
    expect(line).toContain(`lisa-gates.mjs=${GATES_DIGEST}`);
  });

  it("says unknown rather than guessing an unresolvable version", () => {
    const line = formatIdentityLine({
      surface: "local",
      registry_version: null,
      workflow_ref: null,
      workflow_sha: null,
      artifacts: { "lisa-gates.mjs": null },
    });
    expect(line).toContain(`package=@codyswann/lisa@${IDENTITY_UNKNOWN}`);
    expect(line).toContain(`workflow=${IDENTITY_UNKNOWN}`);
    expect(line).toContain(`lisa-gates.mjs=${IDENTITY_UNKNOWN}`);
  });

  it("lets a reader tell two surfaces apart from the output alone", () => {
    const shared = {
      registry_version: "4.32.2",
      artifacts: { "lisa-gates.mjs": GATES_DIGEST },
    };
    const ci = formatIdentityLine({
      ...shared,
      surface: "ci",
      workflow_ref: WORKFLOW_REF,
      workflow_sha: WORKFLOW_SHA,
    });
    const local = formatIdentityLine({
      ...shared,
      surface: "local",
      workflow_ref: null,
      workflow_sha: null,
    });
    expect(ci).not.toBe(local);
    // Same bytes on both surfaces: the reader can establish the two ran the
    // same enforcement code, which is the question a version alone cannot
    // answer once a checked-in copy has forked from its release.
    expect(ci).toContain(`lisa-gates.mjs=${GATES_DIGEST}`);
    expect(local).toContain(`lisa-gates.mjs=${GATES_DIGEST}`);
  });
});

describe("formatIdentityMarkdown", () => {
  it("renders every field of the line as a summary row", () => {
    const markdown = formatIdentityMarkdown({
      surface: "ci",
      registry_version: null,
      workflow_ref: WORKFLOW_REF,
      workflow_sha: WORKFLOW_SHA,
      artifacts: { "lisa-run-gates.mjs": GATES_DIGEST },
    });
    expect(markdown).toContain("| surface | `ci` |");
    expect(markdown).toContain(
      `| package | \`@codyswann/lisa@${IDENTITY_UNKNOWN}\` |`
    );
    expect(markdown).toContain(`| workflow sha | \`${WORKFLOW_SHA}\` |`);
    expect(markdown).toContain(`| lisa-run-gates.mjs | \`${GATES_DIGEST}\` |`);
  });
});

describe("lisa-gates.mjs identity", () => {
  it("prints one operator-readable line by default", () => {
    const run = runCli(["identity"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("🔖 Lisa identity");
    expect(run.stdout).toContain("surface=local");
  });

  it("emits the same facts as JSON", () => {
    const run = runCli(["identity", "--json"]);
    const parsed = JSON.parse(run.stdout) as Identity;
    expect(parsed.surface).toBe("local");
    expect(parsed.artifacts["lisa-gates.mjs"]).toMatch(DIGEST);
  });

  it("annotates and summarises on the GitHub surface", () => {
    const summary = path.join(scratch(), "summary.md");
    writeFileSync(summary, "");
    const run = runCli(["identity", "--format=github"], {
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_WORKFLOW_REF: WORKFLOW_REF,
      GITHUB_WORKFLOW_SHA: WORKFLOW_SHA,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("::notice title=Lisa identity::");
    expect(run.stdout).toContain("surface=ci");
    const written = readFileSync(summary, "utf8");
    expect(written).toContain("### 🔖 Which Lisa ran this");
    expect(written).toContain(`| workflow sha | \`${WORKFLOW_SHA}\` |`);
  });

  it("answers where the gate declarations are the thing under suspicion", () => {
    // Reads no gates: this command has to work on the project whose config a
    // reader is trying to date, including one this registry would refuse.
    const root = scratch();
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates: { runner: ":" } })
    );
    const run = boundedSpawnSync({
      label: "lisa-gates identity on a refused config",
      command: process.execPath,
      args: [REGISTRY_SCRIPT, "identity"],
      cwd: root,
      env: surfacelessEnv(),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("🔖 Lisa identity");
  });
});

describe("identityRegistryPath", () => {
  it("names the copy the digests were taken from, relative to the run", () => {
    // The form the resolving shell prints, and the form two reports compare
    // in. An absolute runner path is neither.
    expect(
      identityRegistryPath("/w/r/node_modules/@codyswann/lisa", "/w/r")
    ).toBe("node_modules/@codyswann/lisa");
    expect(identityRegistryPath("/w/r/scripts", "/w/r")).toBe("scripts");
  });

  it("renders a copy outside the run absolutely, not as a ../.. chain", () => {
    // A relative path that climbs out names a location only the process that
    // produced it can resolve, which is the opposite of what the field is for.
    expect(identityRegistryPath("/opt/unpacked/scripts", "/w/r")).toBe(
      "/opt/unpacked/scripts"
    );
  });

  it("renders the run directory itself as a path rather than an empty string", () => {
    expect(identityRegistryPath("/w/r", "/w/r")).toBe(".");
  });
});

describe("which copy the stamp measured", () => {
  it("names the directory whose bytes it digested", () => {
    const identity = lisaIdentity({
      env: {},
      directory: "/w/r/node_modules/@codyswann/lisa/all/copy-overwrite/scripts",
      cwd: "/w/r",
    }) as Identity;
    expect(identity.registry_path).toBe(
      "node_modules/@codyswann/lisa/all/copy-overwrite/scripts"
    );
  });

  it("tells two copies of the registry apart by more than their digests", () => {
    // The failure this closes: a stamp resolved on a filesystem the gates had
    // not been installed onto digested the copied `scripts/lisa-gates.mjs`
    // while every gate job ran the installed one. Both stamps are twelve hex
    // characters and neither said which file it read.
    const installed = lisaIdentity({
      env: {},
      directory: "/w/r/node_modules/@codyswann/lisa/all/copy-overwrite/scripts",
      cwd: "/w/r",
    }) as Identity;
    const copied = lisaIdentity({
      env: {},
      directory: "/w/r/scripts",
      cwd: "/w/r",
    }) as Identity;
    expect(installed.registry_path).not.toBe(copied.registry_path);
  });

  it("names a path that really holds the bytes it reported", () => {
    // The whole value of the field is that a reader can go and check it, so
    // an independent digest of the file at the reported path has to match.
    const run = runCli(["identity", "--json"]);
    const identity = JSON.parse(run.stdout) as Identity;
    const measured = path.resolve(REPO_ROOT, identity.registry_path);
    const bytes = readFileSync(path.join(measured, "lisa-gates.mjs"));
    const hex = createHash("sha256").update(bytes).digest("hex");
    expect(identity.artifacts["lisa-gates.mjs"]).toBe(
      `sha256:${hex.slice(0, 12)}`
    );
  });

  it("prints the path beside the digests an operator reads", () => {
    const run = runCli(["identity"]);
    expect(run.stdout).toContain("registry=all/copy-overwrite/scripts");
  });

  it("carries the path into the run summary a ticket links to", () => {
    const summary = path.join(scratch(), "summary.md");
    writeFileSync(summary, "");
    runCli(["identity", "--format=github"], {
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(readFileSync(summary, "utf8")).toContain(
      "| registry path | `all/copy-overwrite/scripts` |"
    );
  });
});
