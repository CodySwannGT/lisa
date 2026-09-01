/**
 * The JIRA journey parser consumes a checkout config only when its server
 * matches the operator-owned home or environment trust root, and it never
 * reaches the network with a server value that failed that validation.
 * @module tests/unit/strategies/jira-config-resolution
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const CONFIG_FILENAME = ".config.yml";
const TRUSTED_HOME_SERVER = "https://home.invalid";
const UNTRUSTED_SERVER = "https://attacker.invalid";
const JIRA_ORIGIN = "https://jira.example";
const TOKEN = "fixture-token";
const TICKET = "KEY-1";

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

/**
 * Drive the parser's real entry point with the network recorded rather than
 * reachable, so a request that should never have been built is still observed.
 *
 * `urllib.request.urlopen` is replaced before the module loads. Every attempt
 * to reach a Jira instance is appended to a transcript and then aborted, which
 * is what turns "the token was not sent" from an assertion about code shape
 * into an assertion about observed behavior.
 * @param cwd Directory the parser starts from.
 * @param env Environment carrying the trust root and credentials.
 * @returns The parser's exit code, its stderr, and every URL it tried to open.
 */
function runParser(
  cwd: string,
  env: NodeJS.ProcessEnv
): { code: number; stderr: string; requests: readonly string[] } {
  const transcript = path.join(fixtureRoot(), "requests.json");
  const program = [
    `PARSER_PATH = ${JSON.stringify(PARSER)}`,
    `TRANSCRIPT = ${JSON.stringify(transcript)}`,
    `TICKET = ${JSON.stringify(TICKET)}`,
    "import json, runpy, sys, urllib.request",
    "sent = []",
    "def recorder(req, *args, **kwargs):",
    "    sent.append(getattr(req, 'full_url', str(req)))",
    "    raise RuntimeError('network blocked')",
    "urllib.request.urlopen = recorder",
    "sys.argv = ['parse-plan.py', TICKET]",
    "code = 0",
    "try:",
    "    runpy.run_path(PARSER_PATH, run_name='__main__')",
    "except SystemExit as exc:",
    "    code = exc.code if isinstance(exc.code, int) else 1",
    "except BaseException:",
    "    code = 70",
    "with open(TRANSCRIPT, 'w') as handle:",
    "    handle.write(json.dumps({'code': code, 'sent': sent}))",
  ].join("\n");
  const result = boundedSpawnSync({
    label: "jira parser entry point",
    command: "python3",
    args: ["-c", program],
    cwd,
    env,
  });
  const recorded = JSON.parse(readFileSync(transcript, "utf8")) as {
    code: number;
    sent: readonly string[];
  };
  return {
    code: recorded.code,
    requests: recorded.sent,
    stderr: result.stderr,
  };
}

/** One disposable checkout plus the operator home that governs it. */
interface Fixture {
  /** Repository root the parser is pointed at. */
  readonly root: string;
  /** Directory the parser starts from, nested inside the root. */
  readonly cwd: string;
  /** Operator-owned home directory. */
  readonly home: string;
  /** Path of the checkout-owned jira-cli config. */
  readonly projectConfig: string;
  /** Path of the operator-owned jira-cli config. */
  readonly homeConfig: string;
}

/**
 * Build a checkout/home pair, writing whichever configs the case needs.
 * @param options Server values to write into each config, if any.
 * @param options.homeServer Server written to the operator-owned home config; omit to leave it absent.
 * @param options.projectServer Server written to the checkout-owned config; omit to leave it absent.
 * @returns The fixture paths.
 */
function fixture(options: {
  readonly homeServer?: string;
  readonly projectServer?: string;
}): Fixture {
  // The parser resolves every candidate path, and the platform temp directory
  // is commonly a symlink, so resolve the root up front. Otherwise a fixture
  // path and the path the parser names in its diagnostic differ by that link.
  const root = realpathSync(fixtureRoot());
  const cwd = path.join(root, "packages", "service");
  const home = path.join(root, OPERATOR_HOME);
  const projectConfig = path.join(root, ".lisa", "jira-cli", CONFIG_FILENAME);
  const homeConfig = path.join(home, ".config", ".jira", CONFIG_FILENAME);
  mkdirSync(cwd, { recursive: true });
  if (options.projectServer !== undefined) {
    mkdirSync(path.dirname(projectConfig), { recursive: true });
    writeFileSync(
      projectConfig,
      `server: ${options.projectServer}\nlogin: project@example.invalid\n`
    );
  }
  if (options.homeServer !== undefined) {
    mkdirSync(path.dirname(homeConfig), { recursive: true });
    writeFileSync(
      homeConfig,
      `server: ${options.homeServer}\nlogin: operator@example.invalid\n`
    );
  }
  return { cwd, home, homeConfig, projectConfig, root };
}

/**
 * Environment for a parser run inside one fixture.
 * @param built The fixture the run happens in.
 * @param extra Additional variables, e.g. an explicit trust root.
 * @returns The child environment.
 */
function parserEnv(
  built: Fixture,
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: built.root,
    HOME: built.home,
    JIRA_API_TOKEN: TOKEN,
    // Cleared rather than inherited. Every case that means "no explicit trust
    // root" would otherwise pick up a developer's or CI runner's exported
    // JIRA_SERVER and exercise the environment path under a name that claims
    // the config path — passing or failing for a reason the test never states.
    // `resolve_trusted_origin` gates on `configured.strip()`, so empty reads as
    // unset, and a case that wants one opts in through `extra`.
    JIRA_SERVER: "",
    ...extra,
  };
}

/** Server values that must never become a request base. */
const AMBIGUOUS_SERVERS = [
  "https://operator:token@jira.example",
  "https://jira.example?redirect=elsewhere.example",
  "https://jira.example#section",
  "https://jira.example/proxy",
] as const;

describe("JIRA journey project configuration", () => {
  it("preserves IPv6 brackets while normalizing trusted origins", () => {
    const result = runParserExpression(
      'module["server_origin"]("https://[2001:db8::1]:8443")'
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("https://[2001:db8::1]:8443");
  });

  it("rejects an invalid explicit JIRA_SERVER before reading credentials", () => {
    const built = fixture({ homeServer: TRUSTED_HOME_SERVER });

    const result = runParserExpression('module["get_jira_config"]()', {
      ...process.env,
      HOME: built.home,
      JIRA_SERVER: ["http", "://not-trusted.invalid"].join(""),
      JIRA_API_TOKEN: TOKEN,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ERROR: JIRA_SERVER must be a valid HTTPS URL"
    );
  });

  it("prefers a project config whose server matches the home trust root", () => {
    const built = fixture({
      homeServer: TRUSTED_HOME_SERVER,
      projectServer: TRUSTED_HOME_SERVER,
    });

    expect(resolveConfig(built.cwd, parserEnv(built))).toBe(
      realpathSync(built.projectConfig)
    );
  });

  it("falls back to the home config when no project config exists", () => {
    const built = fixture({ homeServer: TRUSTED_HOME_SERVER });

    expect(
      resolveConfig(built.cwd, parserEnv(built, { CLAUDE_PROJECT_DIR: "" }))
    ).toBe(realpathSync(built.homeConfig));
  });

  it("names the rejected project config and the trust-root mismatch", () => {
    const built = fixture({
      homeServer: TRUSTED_HOME_SERVER,
      projectServer: UNTRUSTED_SERVER,
    });

    const run = runParser(built.cwd, parserEnv(built));

    expect(run.code).toBe(1);
    expect(run.requests).toEqual([]);
    expect(run.stderr).toContain(built.projectConfig);
    expect(run.stderr).toMatch(/trust root|does not match/i);
    expect(run.stderr).not.toContain("config not found");
  });

  it("names the rejected project config rather than the absent home config", () => {
    const built = fixture({ projectServer: UNTRUSTED_SERVER });

    const run = runParser(
      built.cwd,
      parserEnv(built, { JIRA_SERVER: JIRA_ORIGIN })
    );

    expect(run.code).toBe(1);
    expect(run.requests).toEqual([]);
    expect(run.stderr).toContain(built.projectConfig);
    expect(run.stderr).not.toContain(built.homeConfig);
  });

  it("never echoes the rejected server or the token in a diagnostic", () => {
    const built = fixture({
      homeServer: TRUSTED_HOME_SERVER,
      projectServer: UNTRUSTED_SERVER,
    });

    const run = runParser(built.cwd, parserEnv(built));

    expect(run.stderr).not.toContain("attacker.invalid");
    expect(run.stderr).not.toContain(TOKEN);
  });

  describe.each(AMBIGUOUS_SERVERS)("ambiguous server %s", server => {
    it("is refused when it arrives through the environment", () => {
      const built = fixture({ homeServer: JIRA_ORIGIN });

      const run = runParser(
        built.cwd,
        parserEnv(built, { JIRA_SERVER: server })
      );

      expect(run.code).toBe(1);
      expect(run.requests).toEqual([]);
      expect(run.stderr).toContain("JIRA_SERVER");
    });

    it("is refused when it arrives through the project config", () => {
      const built = fixture({
        homeServer: JIRA_ORIGIN,
        projectServer: server,
      });

      const run = runParser(built.cwd, parserEnv(built));

      expect(run.code).toBe(1);
      expect(run.requests).toEqual([]);
    });

    it("is refused when it arrives through the home config", () => {
      const built = fixture({ homeServer: server });

      const run = runParser(built.cwd, parserEnv(built));

      expect(run.code).toBe(1);
      expect(run.requests).toEqual([]);
    });
  });

  it("builds the request from the canonical origin, not the configured string", () => {
    const built = fixture({ homeServer: "https://jira.example:443/" });

    const run = runParser(built.cwd, parserEnv(built));

    expect(run.requests).toEqual([
      "https://jira.example/rest/api/3/issue/KEY-1?fields=description",
    ]);
  });

  it("builds the request from the canonical origin when the environment supplies it", () => {
    const built = fixture({ homeServer: JIRA_ORIGIN });

    const run = runParser(
      built.cwd,
      parserEnv(built, { JIRA_SERVER: "HTTPS://JIRA.EXAMPLE:443/" })
    );

    expect(run.requests).toEqual([
      "https://jira.example/rest/api/3/issue/KEY-1?fields=description",
    ]);
  });

  it("refuses a project config when no trust root exists to approve it", () => {
    const built = fixture({ projectServer: JIRA_ORIGIN });

    const run = runParser(built.cwd, parserEnv(built));

    expect(run.code).toBe(1);
    expect(run.requests).toEqual([]);
    expect(run.stderr).toContain(built.projectConfig);
  });
});
