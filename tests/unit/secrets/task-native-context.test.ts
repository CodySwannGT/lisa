/** Native Write is data for the fixed metadata owner; raw tool execution stays denied. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { nativeWrite } from "../../helpers/task-native-context.js";
const roots: string[] = [];
const CONTEXT = ".lisa/work-item-context.md";
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("native private context metadata boundary", () => {
  it.each([
    "path",
    "ref",
    "config",
    "surface",
    "digest",
    "pass",
    "symlink",
    "eas",
    "binding",
  ])("rejects %s substitution without a metadata or source write", mode => {
    const f = taskFixture(true),
      target = path.join(f.root, CONTEXT);
    roots.push(f.root);
    let content = readFileSync(target, "utf8"),
      file = target;
    rmSync(target);
    if (mode === "path") file = path.join(f.root, "source.ts");
    const at = content.indexOf("\n-->\n"),
      header = JSON.parse(
        content.slice("<!-- lisa-required-access:v1\n".length, at)
      );
    if (mode === "ref") header.work_item_ref = "other/project#1";
    if (mode === "config") header.effective_config_sha256 = "bad";
    if (mode === "surface") header.surface = "container";
    if (mode === "digest") header.context_sha256 = "bad";
    if (mode === "pass") header.passed = true;
    content = `<!-- lisa-required-access:v1\n${JSON.stringify(header)}${content.slice(at)}`;
    const sentinel = path.join(f.root, "sentinel");
    writeFileSync(sentinel, "unchanged");
    if (mode === "symlink") symlinkSync(sentinel, target);
    if (mode === "eas")
      writeFileSync(path.join(f.root, ".easignore"), "node_modules\n");
    if (mode === "binding") {
      mkdirSync(path.join(f.root, ".git/lisa"), { recursive: true });
      writeFileSync(
        path.join(f.root, ".git/lisa/work-item.json"),
        JSON.stringify({
          version: 1,
          provider: "github",
          ref: "fixture/project#2",
          branch: null,
        })
      );
    }
    const r = nativeWrite(f, content, file);
    expect(r.guard.status).toBe(2);
    expect(r.rawWrites).toBe(0);
    expect(String(r.guard.stderr)).not.toContain("Context prepared");
    expect(readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
    if (mode !== "symlink") expect(existsSync(target)).toBe(false);
  });
  it("preserves old full body on refresh and never echoes private context content", () => {
    const f = taskFixture(true),
      target = path.join(f.root, CONTEXT);
    roots.push(f.root);
    const content = readFileSync(target, "utf8"),
      r = nativeWrite(f, content);
    expect(r.guard.status).toBe(2);
    expect(r.rawWrites).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(content);
    const altered = `${content}PRIVATE_CREDENTIAL_CANARY`;
    const refused = nativeWrite(f, altered);
    expect(refused.guard.status).toBe(2);
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(
      String(refused.guard.stdout) + String(refused.guard.stderr)
    ).not.toContain("PRIVATE_CREDENTIAL_CANARY");
  });
  it("denies an unqualified Codex apply_patch envelope rather than pretending it is a Write transport", () => {
    const f = taskFixture(true),
      target = path.join(f.root, CONTEXT),
      content = readFileSync(target, "utf8");
    roots.push(f.root);
    rmSync(target);
    const r = boundedSpawnSync({
      label: "actual portable guard with apply_patch payload",
      command: process.execPath,
      args: [path.join(f.plugin, "hooks/task-readiness-guard.mjs")],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        cwd: f.root,
        session_id: "codex-metadata",
        tool_name: "apply_patch",
        tool_input: {
          input: `*** Begin Patch\n*** Add File: ${target}\n${content
            .split("\n")
            .map(l => `+${l}`)
            .join("\n")}\n*** End Patch`,
        },
      }),
    });
    expect(r.status).toBe(2);
    expect(existsSync(target)).toBe(false);
  });
  it("prepares exact ignored context atomically from ONE Write request and denies the redundant raw writer", () => {
    const f = taskFixture(true, true, {
      GITGUARDIAN_API_KEY: "synthetic-value",
    });
    roots.push(f.root);
    const target = path.join(f.root, CONTEXT),
      content = readFileSync(target, "utf8");
    rmSync(target);
    expect(f.run().counters.code).toBe(0);
    const request = {
      hook_event_name: "PreToolUse",
      cwd: f.root,
      session_id: "native-metadata",
      tool_use_id: "metadata-call",
      tool_name: "Write",
      tool_input: { file_path: target, content },
    };
    const r = boundedSpawnSync({
      label: "single native Write metadata request",
      command: "/bin/bash",
      args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify(request),
    });
    let rawWrites = 0;
    if (r.status === 0) {
      writeFileSync(target, content);
      rawWrites++;
    }
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "native-Write-metadata",
        exit: r.status,
        rawWrites,
        context_exists: existsSync(target),
        request_sha256: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
        stdout_sha256: createHash("sha256")
          .update(String(r.stdout))
          .digest("hex"),
        stderr: String(r.stderr),
      })
    );
    expect(r.status).toBe(2);
    expect(rawWrites).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(String(r.stderr)).toContain("Context prepared; run readiness");
    expect(f.run().counters.code).toBe(1);
  });
});
