/**
 * `spawn` and `resume` on a repo dir whose Claude Code workspace trust has not
 * been accepted (#4448 live-verification defect D4).
 *
 * Claude Code 2.1.296 refuses `claude --bg` there with "Workspace not trusted.
 * Run `claude` in <dir> once and accept the trust prompt, then retry." on
 * stderr and exit 1. That is a one-time setup step, not a worker failure, so
 * the CLI exits 2 (setup) with the exact action, and records nothing.
 * @module tests/unit/session-manager/cli-spawn-trust
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import { readLedgerFile } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const REF = "DEMO-12";

/**
 * The refusal claude 2.1.296 prints for an untrusted workspace.
 * @param dir - Repo dir claude was started in
 * @returns stderr text
 */
const untrusted = (dir: string) =>
  `Workspace not trusted. Run \`claude\` in ${dir} once and accept the trust prompt, then retry.\n`;

describe("spawn in an untrusted workspace", () => {
  it("exits 2 naming the dir and the one-time trust step, recording nothing", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM], {
      env: { STUB_BG_EXIT: "1", STUB_BG_STDERR: untrusted(sandbox.root) },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(sandbox.root);
    expect(result.stderr).toMatch(/run `claude` once in/i);
    expect(result.stderr).toMatch(/accept the trust prompt/i);
    expect(() => readLedgerFile(sandbox)).toThrow();
  });

  it("names the routed child repo dir, where the worker would start", () => {
    const sandbox = makeSandbox({ repos: ["api"] });
    const dir = path.join(sandbox.root, "projects/api");
    const result = runCli(sandbox, ["spawn", REF, "--repo", "api", ...MEM], {
      env: { STUB_BG_EXIT: "1", STUB_BG_STDERR: untrusted(dir) },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(dir);
  });

  it("still exits 1 for any other claude --bg failure", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM], {
      env: { STUB_BG_EXIT: "1", STUB_BG_STDERR: "something else broke\n" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("something else broke");
  });
});

describe("resume in an untrusted workspace", () => {
  it("exits 2 with the same trust step", () => {
    const sandbox = makeSandbox();
    expect(runCli(sandbox, ["spawn", REF, ...MEM]).status).toBe(0);
    const result = runCli(sandbox, ["resume", REF], {
      input: "yes",
      env: { STUB_BG_EXIT: "1", STUB_BG_STDERR: untrusted(sandbox.root) },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/accept the trust prompt/i);
  });
});
