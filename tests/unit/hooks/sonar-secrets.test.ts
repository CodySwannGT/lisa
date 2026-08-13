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
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

// Spawns `/bin/bash` against the real generated shim. Failed 4 of 12 full-suite
// runs measured at load ~115 with 38 agent worktrees present, without being
// touched by the change under test. Appears independently in both failure sets
// collected for CodySwannGT/lisa#2490.
useIoLatencyBudget();

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

/** The vendor event name the Claude prompt shim passes through. */
const PROMPT_EVENT = "claude-prompt-submit";

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
  return checkoutWithResolver(
    `process.stdout.write(${JSON.stringify(token)});\n`,
    "lisa-sonar-proj-"
  );
}

/**
 * The first path the wrapper's resolver search checks, inside a fake checkout.
 * @param root The fake checkout.
 * @returns Absolute path to where `resolve-secret.mjs` must be planted.
 */
function resolverScriptPath(root: string): string {
  return path.join(
    root,
    ".claude",
    "skills",
    "lisa-secrets-access",
    "scripts",
    "resolve-secret.mjs"
  );
}

/**
 * A fresh checkout carrying a stub resolver with the given body.
 * @param body Node source for the stub resolver.
 * @param prefix Temp-directory prefix, so a failing run names itself.
 * @returns Path to the fake checkout.
 */
function checkoutWithResolver(body: string, prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const script = resolverScriptPath(root);

  temporaries.push(root);
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, body);
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

  return spawnSync(BASH, [SOURCE, PROMPT_EVENT], {
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

describe("the resolved value never reaches the filesystem", () => {
  // CWE-922. The first version of this captured the resolver's output through
  // `mktemp` and deleted the file afterwards, which is a race rather than a
  // cleanup: kill the hook between the write and the `rm` and the token stays
  // readable on disk. Process substitution has no path to leak, so this holds on
  // every exit path, signalled or not.

  it("carries the value over a pipe, never a regular file", () => {
    // The mechanism, pinned directly, because it is the whole guarantee. A FIFO
    // holds no data at rest, so there is no window between writing the token
    // and deleting it for a termination to land in. `mktemp -d` appears here —
    // it makes the 0700 directory the FIFO lives in — so the pin is on the
    // redirection target being a pipe, not on the absence of a temp path.
    const code = readFileSync(SOURCE, "utf8")
      .split("\n")
      .filter(line => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(code).toContain("mkfifo");
    expect(code).toContain('>"$fifo"');
    // A bare `mktemp` (no -d) is the regular-file capture this replaced.
    expect(code).not.toMatch(/mktemp(?!\s+-d)/u);
  });

  it("survives being killed mid-resolve without leaving the token behind", async () => {
    // Scans the real temp directory rather than a redirected one: macOS
    // `mktemp` reads the `_CS_DARWIN_USER_TEMP_DIR` confstr and ignores
    // `TMPDIR` entirely, so a test that points TMPDIR at a scratch dir watches
    // a location the leak could never appear in and passes against the very
    // implementation it exists to reject. Only files that appear during the run
    // are read, and only for a canary no other process emits.
    const before = new Set(readdirSync(tmpdir()));
    // Emits the token, then holds the pipe open — so the kill lands squarely
    // inside the window where a regular-file capture has already written it and
    // not yet deleted it.
    const slow = checkoutWithResolver(
      'process.stdout.write("killed-run-token");\nsetTimeout(() => {}, 30000);\n',
      "lisa-sonar-slow-"
    );

    const child = spawn(BASH, [SOURCE, PROMPT_EVENT], {
      env: {
        ...process.env,
        PATH: [stubSonar(""), process.env.PATH].join(path.delimiter),
        CLAUDE_PROJECT_DIR: slow,
      },
    });

    child.stdin.end(JSON.stringify({ prompt: "hello" }));
    // Awaited, not slept through. A blocking sleep here holds Node's event
    // loop, so the payload queued by `stdin.end` never flushes, the script
    // sits in `payload="$(cat)"`, and the kill lands before the resolver has
    // been reached at all — the test then passes against every implementation
    // because nothing ever ran.
    await new Promise(resolve => setTimeout(resolve, 3000));
    child.kill("SIGKILL");
    await new Promise(resolve => setTimeout(resolve, 1000));

    const leaked = readdirSync(tmpdir())
      .filter(entry => !before.has(entry))
      .filter(entry => {
        try {
          return readFileSync(path.join(tmpdir(), entry), "utf8").includes(
            "killed-run-token"
          );
        } catch {
          return false;
        }
      });

    expect(leaked).toEqual([]);
  });
});

describe("the resolver deadline is enforced, not just declared", () => {
  it("kills and reaps a resolver that outlives the ceiling", async () => {
    // `read -t` bounds how long the hook WAITS; on its own it does not bound
    // the work. A resolver blocked on the network otherwise outlives the hook
    // that started it, and this runs in front of every prompt and file read —
    // so the ceiling has to terminate the child, not merely stop listening.
    // Never writes and never exits: the read times out with nothing, which is
    // exactly the case where an unreaped child lingers.
    const slow = checkoutWithResolver(
      "setTimeout(() => {}, 600000);\n",
      "lisa-sonar-hang-"
    );

    run({ bin: stubSonar(""), projectDir: slow });

    // The hook has returned. Anything still running the stub resolver is a
    // child it failed to reap.
    const survivors = spawnSync(
      "/bin/sh",
      [
        "-c",
        `ps -eo pid,args | grep -F ${JSON.stringify(resolverScriptPath(slow))} | grep -v grep`,
      ],
      { encoding: "utf8" }
    );

    expect(survivors.stdout.trim()).toBe("");
  }, 40_000);
});

describe("when the wrapper must stand aside", () => {
  it("exits quietly when the CLI is not installed", () => {
    // An empty PATH entry and nothing inherited: `command -v sonar` fails.
    const result = spawnSync(BASH, [SOURCE, PROMPT_EVENT], {
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
