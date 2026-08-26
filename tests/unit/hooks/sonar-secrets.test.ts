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
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { withoutOwnershipHeader } from "../../../scripts/materialize-copy-overwrite.mjs";
import {
  BASH,
  FINDING,
  HOOK_RUN_BUDGET_MS,
  PROMPT_EVENT,
  SHIPPED,
  SOURCE,
  assertResolverDelivered,
  checkoutWithResolver,
  projectWithResolver,
  removeStubLinuxMktempRoots,
  run,
  stubLinuxMktemp,
  stubSonar,
  waitForStubLinuxMktempRoot,
} from "./support/sonar-secrets-fixtures.js";

// Spawns `/bin/bash` against the real generated shim. Failed 4 of 12 full-suite
// runs measured at load ~115 with 38 agent worktrees present, without being
// touched by the change under test. Appears independently in both failure sets
// collected for CodySwannGT/lisa#2490.
useIoLatencyBudget();

describe("the shipped wrapper", () => {
  it("is byte-identical to the reviewed original", () => {
    // Copies rot. The guards beside it get the same assertion for the same
    // reason: synced by the build, pinned by a test.
    //
    // Minus the ownership header, which the build stamps on as it materializes
    // the copy (#2547) — the shipped file is a copy-overwrite asset and has to
    // say so, while the source here is the file maintainers edit and must not.
    // Stripped with the generator's own function so the two cannot disagree.
    expect(withoutOwnershipHeader(readFileSync(SHIPPED, "utf8"), SHIPPED)).toBe(
      readFileSync(SOURCE, "utf8")
    );
  });
});

describe("what the wrapper does with the CLI's verdict", () => {
  it("passes a real finding through, so it still blocks", () => {
    const result = run({
      bin: stubSonar(FINDING),
      projectDir: projectWithResolver("a-token"),
    });

    assertResolverDelivered(result);
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

    assertResolverDelivered(result);
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
    expect(code).toContain(
      'mktemp -d "${TMPDIR:-/tmp}/lisa-sonar-resolver.XXXXXXXX"'
    );
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
    const bin = stubSonar("");
    const allocatedRoots = stubLinuxMktemp(bin);

    const child = spawn(BASH, [SOURCE, PROMPT_EVENT], {
      detached: true,
      env: {
        ...process.env,
        PATH: [bin, process.env.PATH].join(path.delimiter),
        CLAUDE_PROJECT_DIR: slow,
        LISA_SONAR_RESOLVER_TIMEOUT_S: "30",
      },
    });

    let roots: readonly string[] = [];
    try {
      child.stdin.end(JSON.stringify({ prompt: "hello" }));
      // Await the allocation event itself. A fixed delay can expire before the
      // resolver starts under concurrent suite load, while a blocking sleep
      // would hold Node's event loop and prevent `stdin.end` from flushing.
      roots = await waitForStubLinuxMktempRoot(allocatedRoots);
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatch(
        new RegExp(`${path.sep}lisa-sonar-resolver\\.[A-Za-z0-9]{8}$`, "u")
      );
      expect(roots.every(root => existsSync(root))).toBe(true);
      if (child.pid === undefined) throw new Error("Sonar hook has no PID");
      const closed = new Promise<void>(resolve =>
        child.once("close", () => resolve())
      );
      // The Linux failure occurred when the suite supervisor drained the whole
      // descendant group. Killing only the outer shell lets its command-
      // substitution child finish normally and hides the interrupted root.
      process.kill(-child.pid, "SIGKILL");
      await closed;

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
      expect(roots.every(root => existsSync(root))).toBe(true);
    } finally {
      if (
        child.pid !== undefined &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        }
      }
      roots = allocatedRoots();
      removeStubLinuxMktempRoots(roots);
    }
    expect(roots.every(root => !existsSync(root))).toBe(true);
  });
});

describe("when the wrapper must stand aside", () => {
  it("exits quietly when the CLI is not installed", () => {
    // An empty PATH entry and nothing inherited: `command -v sonar` fails.
    // The payload is larger than a pipe buffer so an implementation that tries
    // to drain with external `cat` fails deterministically: `cat` disappears
    // with PATH, the child exits 0, and the parent's write receives EPIPE.
    const result = boundedSpawnSync({
      label: "the sonar hook wrapper with no CLI on PATH",
      command: BASH,
      args: [SOURCE, PROMPT_EVENT],
      baseMs: HOOK_RUN_BUDGET_MS,
      input: "x".repeat(1024 * 1024),
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
    const result = boundedSpawnSync({
      label: "the sonar hook wrapper with no event name",
      command: BASH,
      args: [SOURCE],
      baseMs: HOOK_RUN_BUDGET_MS,
      input: "{}",
    });

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });
});
