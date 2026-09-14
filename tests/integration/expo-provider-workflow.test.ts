import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Workflow step fields exercised by the authentication fixtures. */
type Step = {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};
/** Parsed jobs from the shipped workflow templates. */
type Workflow = {
  jobs: Record<string, { steps: Step[]; secrets?: Record<string, string> }>;
};
const build = yaml.load(
  readFileSync(".github/workflows/build.yml", "utf8")
) as Workflow;
const deploy = yaml.load(
  readFileSync("expo/create-only/.github/workflows/deploy.yml", "utf8")
) as Workflow;
const RESOLVE_STEP = "Resolve Expo token";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lisa-expo-workflow-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * Execute shipped shell steps without workstation startup files.
 * @param script - The workflow step's shell script.
 * @param extra - Synthetic environment inputs.
 * @returns The captured subprocess result.
 */
function execute(script: string, extra: Record<string, string>) {
  return spawnSync(
    "/bin/bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", script],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        BASH_ENV: "/dev/null",
        ENV: "/dev/null",
        GITHUB_OUTPUT: join(root, "output"),
        ...extra,
      },
    }
  );
}

describe("Expo provider eligibility", () => {
  const check = deploy.jobs.check_eas_setup.steps.find(
    step => step.id === "check"
  )!.run!;
  it.each([
    ["explicit", "", {}, true],
    ["", "bootstrap", { secrets: { provider: "bitwarden" } }, true],
    ["", "bootstrap", {}, false],
    ["", "", { secrets: { provider: "bitwarden" } }, false],
  ])(
    "preserves explicit and provider eligibility (%s, %s)",
    (token, bootstrap, config, expected) => {
      writeFileSync(join(root, ".lisa.config.json"), JSON.stringify(config));
      const result = execute(check, {
        EXPO_TOKEN: token,
        LISA_SECRETS_BOOTSTRAP: bootstrap,
      });
      expect(result.status).toBe(0);
      expect(readFileSync(join(root, "output"), "utf8")).toBe(
        `has_eas_setup=${expected}\n`
      );
    }
  );
});

describe.each([
  { steps: build.jobs.build.steps },
  { steps: deploy.jobs.deploy.steps },
])("Expo authentication steps", ({ steps }) => {
  it("installs Lisa before resolving, then supplies the resolved token to Expo", () => {
    const install = steps.findIndex(
      step => step.name === "Install dependencies"
    );
    const resolve = steps.findIndex(step => step.name === RESOLVE_STEP);
    const expo = steps.findIndex(step =>
      step.uses?.startsWith("expo/expo-github-action@")
    );
    expect(install).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(install);
    expect(expo).toBeGreaterThan(resolve);
    expect(steps[expo].with?.token).toBe(
      "${{ secrets.EXPO_TOKEN || env.EXPO_TOKEN }}"
    );
  });

  it.each([
    ["explicit", "bootstrap"],
    ["", ""],
  ])(
    "keeps existing callers working without the new adapter",
    (token, bootstrap) => {
      const script = steps.find(step => step.name === RESOLVE_STEP)?.run;
      expect(script).toBeDefined();
      expect(
        execute(script!, {
          EXPO_TOKEN: token,
          LISA_SECRETS_BOOTSTRAP: bootstrap,
        }).status
      ).toBe(0);
    }
  );

  it("names the missing adapter when an opted-in old Lisa package cannot resolve", () => {
    const script = steps.find(step => step.name === RESOLVE_STEP)?.run;
    expect(script).toBeDefined();
    const result = execute(script!, {
      EXPO_TOKEN: "",
      LISA_SECRETS_BOOTSTRAP: "bootstrap",
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Upgrade");
  });
});
