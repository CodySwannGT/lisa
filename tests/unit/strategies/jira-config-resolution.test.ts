/**
 * The JIRA journey parser consumes a checkout config only when its server
 * matches the operator-owned home or environment trust root.
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

/**
 * Invoke one parser function through runpy.
 * @param expression Python expression evaluated against the loaded module.
 * @param env Environment passed to the bounded subprocess.
 * @returns The bounded child-process result.
 */
function runParserExpression(expression: string, env = process.env) {
  return boundedSpawnSync({
    label: "jira parser expression",
    command: "python3",
    args: [
      "-c",
      [
        "import runpy",
        `module = runpy.run_path(${JSON.stringify(PARSER)})`,
        `print(${expression})`,
      ].join("; "),
    ],
    env,
  });
}

describe("JIRA journey project configuration", () => {
  it("preserves IPv6 brackets while normalizing trusted origins", () => {
    const result = runParserExpression(
      'module["server_origin"]("https://[2001:db8::1]:8443")'
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("https://[2001:db8::1]:8443");
  });

  it("rejects an invalid explicit JIRA_SERVER before reading credentials", () => {
    const root = fixtureRoot();
    const home = path.join(root, OPERATOR_HOME);
    const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(homeConfig, HOME_CONFIG);

    const result = runParserExpression('module["get_jira_config"]()', {
      ...process.env,
      HOME: home,
      JIRA_SERVER: ["http", "://not-trusted.invalid"].join(""),
      JIRA_API_TOKEN: "fixture-token",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ERROR: JIRA_SERVER must be a valid HTTPS URL"
    );
  });

  it("prefers a project config whose server matches the home trust root", () => {
    const root = fixtureRoot();
    const nested = path.join(root, "packages", "service");
    const home = path.join(root, OPERATOR_HOME);
    const projectConfig = path.join(root, ".lisa", "jira-cli", CONFIG_FILENAME);
    const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
    mkdirSync(nested, { recursive: true });
    mkdirSync(path.dirname(projectConfig), { recursive: true });
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(
      projectConfig,
      "server: https://home.invalid\nlogin: project@example.invalid\n"
    );
    writeFileSync(homeConfig, HOME_CONFIG);

    expect(
      resolveConfig(nested, {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        HOME: home,
      })
    ).toBe(realpathSync(projectConfig));
  });

  it("rejects a checkout-selected server and falls back to the home config", () => {
    const root = fixtureRoot();
    const nested = path.join(root, "packages", "service");
    const home = path.join(root, OPERATOR_HOME);
    const projectConfig = path.join(root, ".lisa", "jira-cli", CONFIG_FILENAME);
    const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
    mkdirSync(nested, { recursive: true });
    mkdirSync(path.dirname(projectConfig), { recursive: true });
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(projectConfig, "server: https://attacker.invalid\n");
    writeFileSync(homeConfig, HOME_CONFIG);

    expect(
      resolveConfig(nested, {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        HOME: home,
      })
    ).toBe(realpathSync(homeConfig));
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
