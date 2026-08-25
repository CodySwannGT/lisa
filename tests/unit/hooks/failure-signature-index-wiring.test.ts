/**
 * Wiring for the failure-signature index: the reader that makes it get read,
 * the gate that stops it rotting, and this repository's own index resolving
 * against live records (CodySwannGT/lisa#3061).
 *
 * The index is worth nothing if the only way to reach it is to go looking for
 * it — that is the defect it exists against. So these tests assert the reader,
 * not merely the data: the PostToolUse hook must be registered, and the hook
 * must actually emit a notice when fed a real failure transcript.
 */
import { describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Fixed, unwriteable interpreter paths — never a PATH lookup. */
const BASH = "/bin/bash";
const NODE = process.execPath;
const HOOK_SH = "plugins/src/base/hooks/failure-signature-index.sh";
const HOOK_MJS = "plugins/src/base/hooks/failure-signature-index.mjs";
const INDEX = "failure-signatures.json";

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/**
 * Parse a repo-relative JSON file.
 * @param relativePath - Repo-relative path
 * @returns Parsed contents
 */
function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

describe("failure-signature index — how it gets read", () => {
  it("is registered as a PostToolUse Bash hook in the base plugin manifest", () => {
    const manifest = readJson(
      "plugins/src/base/.claude-plugin/plugin.json"
    ) as {
      hooks: Record<
        string,
        { matcher: string; hooks: { command: string }[] }[]
      >;
    };
    const bash = manifest.hooks.PostToolUse.filter(
      block => block.matcher === "Bash"
    );
    expect(
      bash.some(block =>
        block.hooks.some(hook =>
          hook.command.includes("failure-signature-index.sh")
        )
      )
    ).toBe(true);
  });

  it("emits the notice when fed a real Bash failure transcript", () => {
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "bun run test" },
      tool_response: {
        stdout: "",
        stderr:
          "Error: ENOENT: no such file or directory, open '/x/dist/configs/vitest/typescript.d.ts'",
      },
    });
    const stdout = boundedExecFileSync({
      label: "failure-signature-index.sh (matching transcript)",
      command: BASH,
      args: [path.join(REPO_ROOT, HOOK_SH)],
      cwd: REPO_ROOT,
      input: payload,
    });
    const emitted = JSON.parse(stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const context = emitted.hookSpecificOutput.additionalContext;
    expect(context).toContain("dist-deleted-under-readers");
    expect(context).toContain("stryker.conf.json:");
    expect(context).toContain("tests/integration/cli-smoke.test.ts:");
  });

  it("emits nothing for a Bash result that matches no known hazard", () => {
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_response: { stdout: "hi", stderr: "" },
    });
    expect(
      boundedExecFileSync({
        label: "failure-signature-index.sh (unmatched transcript)",
        command: BASH,
        args: [path.join(REPO_ROOT, HOOK_SH)],
        cwd: REPO_ROOT,
        input: payload,
      })
    ).toBe("");
  });

  it("declares the check as a push gate and a package script", () => {
    const pkg = readJson("package.json") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:failure-signatures"]).toContain(HOOK_MJS);
    const config = readJson(".lisa.config.json") as {
      gates: Record<string, { push?: { level?: string; run?: string } }>;
    };
    expect(config.gates["x-failure-signature-index"]?.push?.run).toBe(
      "check:failure-signatures"
    );
    expect(config.gates["x-failure-signature-index"]?.push?.level).toBe(
      "required"
    );
  });
});

describe("failure-signature index — this repository's own rows", () => {
  it("resolves every entry against a record that still exists", () => {
    const stdout = boundedExecFileSync({
      label: "failure-signature-index.mjs --check",
      command: NODE,
      args: [path.join(REPO_ROOT, HOOK_MJS), "--check"],
      cwd: REPO_ROOT,
    });
    expect(stdout).toContain(" to a live record");
    expect(stdout.startsWith("failure-signature index: 0 ")).toBe(false);
  });

  it("carries the four hazards #3061 catalogued, each pointing at its record", () => {
    const index = readJson(INDEX) as {
      entries: { id: string; records: { file: string }[] }[];
    };
    const byId = new Map(index.entries.map(entry => [entry.id, entry]));
    for (const id of [
      "dist-deleted-under-readers",
      "sh-is-dash-on-linux",
      "merge-driver-mapped-but-unregistered",
      "terminated-not-failed",
    ]) {
      expect(byId.get(id)?.records.length, id).toBeGreaterThan(0);
    }
  });

  it("names lisa doctor at the .gitattributes symptom site, not only beside the guard", () => {
    // The remedy asked for in #3061's second comment: a person arriving from
    // the effect — conflict markers in a file mapped to a union driver — reads
    // .gitattributes, and must learn there that a control already watches for
    // this. Asserted on the template as well, or host projects keep the gap.
    for (const file of [".gitattributes", "all/copy-contents/.gitattributes"]) {
      expect(read(file), file).toContain("Merge drivers registered?");
    }
  });
});
