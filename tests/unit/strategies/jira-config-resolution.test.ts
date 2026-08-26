/**
 * The JIRA journey parser consumes the checkout's generated jira-cli config
 * before the operator's unrelated home-level default.
 * @module tests/unit/strategies/jira-config-resolution
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const PARSER = path.resolve(
  "plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py"
);

const roots: string[] = [];
const OPERATOR_HOME = "operator-home";
const HOME_CONFIG = "server: https://home.invalid\n";
const CONFIG_FILENAME = ".config.yml";

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Create and register one disposable repository root.
 * @returns Absolute fixture root.
 */
function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-jira-config-"));
  roots.push(root);
  return root;
}

/**
 * Resolve the parser's selected jira-cli config in a subprocess.
 * @param cwd Directory the parser starts from.
 * @param env Environment carrying project/home identity.
 * @returns Canonical selected config path.
 */
function resolveConfig(cwd: string, env: NodeJS.ProcessEnv): string {
  const script = [
    "import runpy",
    `module = runpy.run_path(${JSON.stringify(PARSER)})`,
    'print(module["resolve_jira_config_path"]())',
  ].join("; ");
  const result = boundedSpawnSync({
    label: "jira config resolver",
    command: "python3",
    args: ["-c", script],
    cwd,
    env,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe("JIRA journey project configuration", () => {
  it("prefers the project config discovered above the current directory", () => {
    const root = fixtureRoot();
    const nested = path.join(root, "packages", "service");
    const home = path.join(root, OPERATOR_HOME);
    const projectConfig = path.join(root, ".lisa", "jira-cli", CONFIG_FILENAME);
    const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
    mkdirSync(nested, { recursive: true });
    mkdirSync(path.dirname(projectConfig), { recursive: true });
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(projectConfig, "server: https://project.invalid\n");
    writeFileSync(homeConfig, HOME_CONFIG);

    expect(
      resolveConfig(nested, {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        HOME: home,
      })
    ).toBe(realpathSync(projectConfig));
  });

  it("falls back to the home config when no project config exists", () => {
    const root = fixtureRoot();
    const cwd = path.join(root, "checkout");
    const home = path.join(root, OPERATOR_HOME);
    const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(homeConfig, HOME_CONFIG);

    expect(
      resolveConfig(cwd, {
        ...process.env,
        CLAUDE_PROJECT_DIR: "",
        HOME: home,
      })
    ).toBe(realpathSync(homeConfig));
  });
});
