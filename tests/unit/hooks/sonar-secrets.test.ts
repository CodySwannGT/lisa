/**
 * The Sonar hook wrapper must degrade, never blockade.
 *
 * `sonar integrate <agent>` generates a shim that passes the CLI's verdict
 * through unchanged, and the CLI answers an unauthenticated invocation with a
 * `decision: block` whose reason is "secret scanning is inactive". That is
 * shaped exactly like a real finding, so the generated shim refuses every prompt
 * and every file read on a workstation that has not logged in — the first prompt
 * of the first session, before anything can explain why.
 *
 * These tests pin the three behaviours that fix has to keep straight: a real
 * finding still blocks, an inactive scanner does not, and a token the project
 * already provisioned is fetched before either conclusion is drawn.
 * @module tests/unit/hooks/sonar-secrets
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The reviewed original, which the plugin ships. */
const SOURCE = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "sonar-secrets.sh"
);

/** What `lisa apply` writes into a host checkout. */
const SHIPPED = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-hooks",
  "sonar-secrets.sh"
);

const INACTIVE = JSON.stringify({
  decision: "block",
  reason:
    "SonarQube secret scanning is inactive: not authenticated. Run 'sonar auth login'.",
});

const FINDING = JSON.stringify({
  decision: "block",
  reason: "Sonar detected secrets in prompt",
});

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A directory holding a stub `sonar`, to be prepended to PATH.
 *
 * The stub models the one behaviour that matters: the real CLI is inactive
 * until a token reaches it, and reports that inactivity as a block verdict
 * rather than as an error or a non-zero exit.
 * @param whenAuthed What the stub prints once a token is in its environment.
 * @returns Path to the directory containing the stub.
 */
function stubSonar(whenAuthed: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-sonar-bin-"));
  const stub = path.join(dir, "sonar");

  temporaries.push(dir);
  writeFileSync(
    stub,
    [
      "#!/bin/bash",
      "cat >/dev/null",
      'if [ -n "${SONARQUBE_CLI_TOKEN:-}" ]; then',
      `  printf '%s' ${JSON.stringify(whenAuthed)}`,
      "else",
      `  printf '%s' ${JSON.stringify(INACTIVE)}`,
      "fi",
      "exit 0",
    ].join("\n")
  );
  chmodSync(stub, 0o755);
  return dir;
}

/**
 * A checkout carrying a stub secrets resolver at one of the searched paths.
 * @param token What `resolve-secret.mjs get` should emit, or "" for nothing.
 * @returns Path to the fake project root.
 */
function projectWithResolver(token: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-sonar-proj-"));
  const dir = path.join(
    root,
    ".claude",
    "skills",
    "lisa-secrets-access",
    "scripts"
  );

  temporaries.push(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "resolve-secret.mjs"),
    `process.stdout.write(${JSON.stringify(token)});\n`
  );
  return root;
}

/**
 * Run the wrapper the way a generated shim does.
 * @param options How to stage the run.
 * @param options.bin Directory holding a stub `sonar`, prepended to PATH.
 * @param options.projectDir Checkout the resolver search starts from.
 * @param options.env Extra environment variables for the run.
 * @returns The completed process.
 */
function run(options: {
  readonly bin?: string;
  readonly projectDir?: string;
  readonly env?: Readonly<Record<string, string>>;
}): ReturnType<typeof spawnSync> {
  const pathEntries = [options.bin, process.env.PATH].filter(Boolean);

  return spawnSync(BASH, [SOURCE, "claude-prompt-submit"], {
    input: JSON.stringify({ prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: pathEntries.join(path.delimiter),
      ...(options.projectDir === undefined
        ? {}
        : { CLAUDE_PROJECT_DIR: options.projectDir }),
      ...options.env,
    },
  });
}

describe("the shipped wrapper", () => {
  it("is byte-identical to the reviewed original", () => {
    // Copies rot. The guards beside it get the same assertion for the same
    // reason: synced by the build, pinned by a test.
    expect(readFileSync(SHIPPED, "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });
});

describe("what the wrapper does with the CLI's verdict", () => {
  it("passes a real finding through, so it still blocks", () => {
    const result = run({
      bin: stubSonar(FINDING),
      projectDir: projectWithResolver("a-token"),
    });

    expect(result.stdout).toBe(FINDING);
    expect(result.status).toBe(0);
  });

  it("swallows an inactive scanner and warns instead", () => {
    // The whole point: no token anywhere, and the prompt still goes through.
    const result = run({
      bin: stubSonar(""),
      projectDir: projectWithResolver(""),
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("secret scanning is inactive");
    expect(result.status).toBe(0);
  });

  it("resolves a provisioned token before giving up on the scanner", () => {
    // A project that declares SONARQUBE_CLI_TOKEN has it in its provider; the
    // CLI reads only the environment and the keychain, so on a local surface
    // the value is present and unreachable at the same time. Reaching for it
    // is what turns the warn path back into a working scanner — proven here by
    // the finding the authenticated stub emits only once a token arrives.
    const result = run({
      bin: stubSonar(FINDING),
      projectDir: projectWithResolver("resolved-from-provider"),
    });

    expect(result.stdout).toBe(FINDING);
    expect(result.stderr).not.toContain("inactive");
  });

  it("never prints the value it resolved", () => {
    const result = run({
      bin: stubSonar(""),
      projectDir: projectWithResolver("super-secret-value"),
    });

    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "super-secret-value"
    );
  });
});

describe("when the wrapper must stand aside", () => {
  it("exits quietly when the CLI is not installed", () => {
    // An empty PATH entry and nothing inherited: `command -v sonar` fails.
    const result = spawnSync(BASH, [SOURCE, "claude-prompt-submit"], {
      input: "{}",
      encoding: "utf8",
      env: { PATH: mkdtempSync(path.join(tmpdir(), "lisa-empty-bin-")) },
    });

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits quietly when switched off", () => {
    const result = run({
      bin: stubSonar(FINDING),
      env: { LISA_SONAR_HOOK: "off" },
    });

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits quietly when given no event name", () => {
    const result = spawnSync(BASH, [SOURCE], { input: "{}", encoding: "utf8" });

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });
});
