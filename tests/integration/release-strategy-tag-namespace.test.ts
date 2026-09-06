/**
 * Every strategy but `custom` scopes its tag by environment (#3741).
 *
 * `release.yml` scopes release tags so dev, staging and main cannot collide:
 * prod cuts the clean `vX.Y.Z`, every other environment cuts
 * `vX.Y.Z-<env>.<timestamp>`. That derivation was gated on
 * `release_strategy == "standard-version"`, so `semantic` and `calendar` fell
 * through and shared one repo-global namespace across all three branches. A
 * promote or a sync-back merge lets staging compute a version main already
 * released and attempt its tag.
 *
 * **What collides is one strategy across environments, not two strategies
 * against each other.** `release_strategy` is a single input per call, so two
 * schemes only coexist in a repository whose caller changed it mid-history —
 * and even then the names do not collide, because `v2026.09.06` and `v4.5.0`
 * are different strings. Nothing in Lisa semver-sorts git tags (the only
 * `rcompare` sorts npm packument versions, and filters to `semver.valid`, which
 * a leading-zero calendar version fails), so mixed schemes do not produce a
 * wrong "latest release" either. The damage is name collision within one
 * scheme, which is what these cases pin.
 *
 * The calendar arm carries the sharper defect. Its collision guard cannot
 * repair a calendar version at all: `npx semver -i patch 2026.09.06` reads it
 * as invalid — leading zeros are not semver — returns nothing, and the run dies
 * at the version check having bumped nothing. Scoping never reaches that path.
 *
 * `custom` is excluded from scoping on purpose and must stay excluded: an
 * explicit pin is never silently renamed. It is asserted to REFUSE instead.
 *
 * Fixtures build a throwaway git repository and tag it. Nothing here touches
 * this repository's tags or any remote.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/release-strategy-tag-namespace
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const WORKFLOW = path.join(process.cwd(), ".github/workflows/release.yml");

const VERSION_JOB = "version";
const DETERMINE_VERSION = "Determine Version";

/** The environment that must cut a clean tag. */
const PROD = "main";

/** A non-prod environment, which must cut a scoped one. */
const STAGING = "staging";

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
 * Run the shipped step body in a disposable git repository.
 * @param env - Extra environment for the run
 * @param existingTag - A tag to create in the fixture before running
 * @returns What the run produced
 */
function runStep(
  env: Readonly<Record<string, string>>,
  existingTag?: string
): Outcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-release-namespace-"));
  try {
    fs.writeFileSync(
      path.join(dir, "release-logger.sh"),
      "log_release_event() { :; }\n"
    );
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@example/fixture-package", version: "0.0.0" })
    );
    const git = (...args: readonly string[]): void => {
      boundedSpawnSync({
        args: [...args],
        command: "git",
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_AUTHOR_NAME: "fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "fixture",
        },
        label: `git ${args[0] ?? ""}`,
      });
    };
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "fixture");
    if (existingTag !== undefined) git("tag", existingTag);

    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // Real semver, so a bump that should happen actually happens and one that
    // cannot happen fails the way it fails in production.
    fs.writeFileSync(
      path.join(bin, "npx"),
      `#!/bin/bash\n[ "$1" = "semver" ] || exit 0\nshift\nSEMVER_ARGS="$*" exec ${process.execPath} -e '\nconst s=require(${JSON.stringify(path.join(process.cwd(), "node_modules/semver"))});\nconst a=(process.env.SEMVER_ARGS||"").split(" ").filter(Boolean);\nif(a[0]==="-i"){const o=s.inc(a[2],a[1]);if(!o)process.exit(1);process.stdout.write(o+"\\n");process.exit(0);}\nconst v=a.filter(x=>s.valid(x));\nif(v.length!==a.length)process.exit(1);\nprocess.stdout.write(v.sort(s.compare).join("\\n")+"\\n");\n'\n`,
      { mode: 0o755 }
    );

    const scriptPath = path.join(dir, "step.sh");
    fs.writeFileSync(scriptPath, stepBody(VERSION_JOB, DETERMINE_VERSION));
    const outputPath = path.join(dir, "github_output");
    fs.writeFileSync(outputPath, "");

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

    return {
      log: `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`,
      outputs: fs.readFileSync(outputPath, "utf-8"),
      status: outcome.status ?? -1,
    };
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * One `$GITHUB_OUTPUT` value.
 * @param outcome - A completed run
 * @param key - The output name
 * @returns The value, or an empty string
 */
function output(outcome: Outcome, key: string): string {
  const hit = outcome.outputs
    .split("\n")
    .filter(line => line.startsWith(`${key}=`))
    .pop();
  return hit ? hit.slice(key.length + 1) : "";
}

describe("a non-prod release is scoped on every derived strategy", () => {
  it("semantic on staging cuts a scoped tag", () => {
    const result = runStep({
      RELEASE_CUSTOM_VERSION: "4.5.0",
      RELEASE_ENVIRONMENT: STAGING,
      RELEASE_PRERELEASE: "",
      RELEASE_STRATEGY: "custom",
    });
    // `custom` is the one strategy that must NOT be scoped, asserted here so
    // the scoping cases below cannot be read as "everything gets a suffix".
    expect(output(result, "tag")).toBe("v4.5.0");
    expect(output(result, "prerelease")).toBe("false");
  });

  it.each(["semantic", "calendar"])(
    "%s on staging cuts a scoped tag",
    strategy => {
      const result = runStep({
        RELEASE_CUSTOM_VERSION: "",
        RELEASE_ENVIRONMENT: STAGING,
        RELEASE_PRERELEASE: "",
        RELEASE_STRATEGY: strategy,
      });

      expect(output(result, "prerelease")).toBe("true");
      expect(output(result, "tag")).toMatch(/-staging\.\d+$/u);
    }
  );

  it.each(["semantic", "calendar"])("%s on prod stays clean", strategy => {
    // The converse. A change that suffixed every tag would satisfy the cases
    // above while breaking the production tag every consumer pins against.
    const result = runStep({
      RELEASE_CUSTOM_VERSION: "",
      RELEASE_ENVIRONMENT: PROD,
      RELEASE_PRERELEASE: "",
      RELEASE_STRATEGY: strategy,
    });

    expect(output(result, "prerelease")).toBe("false");
    expect(output(result, "tag")).not.toMatch(/-main\./u);
  });

  it("an explicit prerelease still wins over the derived one", () => {
    const result = runStep({
      RELEASE_CUSTOM_VERSION: "",
      RELEASE_ENVIRONMENT: STAGING,
      RELEASE_PRERELEASE: "nightly",
      RELEASE_STRATEGY: "semantic",
    });

    expect(output(result, "tag")).toMatch(/-nightly\.\d+$/u);
  });
});

describe("an explicitly pinned version is refused, never renamed", () => {
  it("names the tag and does not bump past it", () => {
    const result = runStep(
      {
        RELEASE_CUSTOM_VERSION: "4.5.0",
        RELEASE_ENVIRONMENT: PROD,
        RELEASE_PRERELEASE: "",
        RELEASE_STRATEGY: "custom",
      },
      "v4.5.0"
    );

    expect(result.status).not.toBe(0);
    expect(result.log).toContain("tag v4.5.0 already exists");
    expect(result.log).toContain("not renamed or bumped");
    // The pin is intact: nothing published a bumped version.
    expect(output(result, "version")).not.toBe("4.5.1");
  });

  it("proceeds when the pinned tag is free", () => {
    // Without this, "custom always fails" would satisfy the case above.
    const result = runStep({
      RELEASE_CUSTOM_VERSION: "4.5.0",
      RELEASE_ENVIRONMENT: PROD,
      RELEASE_PRERELEASE: "",
      RELEASE_STRATEGY: "custom",
    });

    expect(result.status).toBe(0);
    expect(output(result, "tag")).toBe("v4.5.0");
  });
});
