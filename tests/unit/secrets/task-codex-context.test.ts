/** Documented Codex command-string envelope; real before verdict controls raw patch effects. */
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
import {
  codexContext,
  contextPatch,
} from "../../helpers/task-codex-context.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { requirementsContext } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";
const roots: string[] = [],
  CONTEXT = ".lisa/work-item-context.md";
const BODY_REPLACEMENT = "body-replacement";
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("documented Codex private metadata command envelope", () => {
  it.each([
    "path",
    "multi",
    "update",
    "delete",
    "move",
    "hunk",
    "framing",
    "suffix",
    "header",
    "ref",
    "config",
    "surface",
    "binding",
    "eas",
    "symlink",
    "ignore",
    BODY_REPLACEMENT,
  ])("refuses %s without raw patch or metadata effects", mode => {
    const f = taskFixture(true);
    roots.push(f.root);
    const target = path.join(f.root, CONTEXT),
      original = readFileSync(target, "utf8");
    let content = original;
    if (mode !== BODY_REPLACEMENT) rmSync(target);
    const at = content.indexOf("\n-->\n"),
      parsed = JSON.parse(
        content.slice("<!-- lisa-required-access:v1\n".length, at)
      );
    const changes: Record<string, object> = {
      header: { passed: true },
      ref: { work_item_ref: "other/project#1" },
      config: { effective_config_sha256: "bad" },
      surface: { surface: "container" },
    };
    const header = { ...parsed, ...changes[mode] };
    content = `<!-- lisa-required-access:v1\n${JSON.stringify(header)}${content.slice(at)}`;
    if (mode === BODY_REPLACEMENT)
      content = requirementsContext(
        readConfig(f.root),
        "fixture/project#1",
        "github",
        header.required_access,
        "Different complete body\n"
      );
    let command = contextPatch(target, content);
    const commands: Record<string, string> = {
      path: contextPatch(path.join(f.root, "source.ts"), content),
      multi: command.replace(
        "*** End Patch",
        "*** Add File: source.ts\n+forbidden\n*** End Patch"
      ),
      update: command.replace("*** Add File:", "*** Update File:"),
      delete: command.replace("*** Add File:", "*** Delete File:"),
      move: command.replace(
        "*** End Patch",
        "*** Move to: source.ts\n*** End Patch"
      ),
      hunk: command.replace("+<!--", "@@\n+<!--"),
      framing: command.replace("*** Begin Patch", "*** Begin Patch\r"),
      suffix: `${command}\ntouch source.ts`,
    };
    command = commands[mode] ?? command;
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
    if (mode === "eas")
      writeFileSync(path.join(f.root, ".easignore"), "node_modules\n");
    const sentinel = path.join(f.root, "sentinel");
    writeFileSync(sentinel, "unchanged");
    if (mode === "symlink") symlinkSync(sentinel, target);
    if (mode === "ignore") {
      rmSync(path.join(f.root, ".gitignore"));
      const exclude = path.join(f.root, ".git/info/exclude");
      rmSync(exclude, { force: true });
      symlinkSync(sentinel, exclude);
    }
    const r = codexContext(f, command);
    expect(r.result.status).toBe(2);
    expect(r.rawPatchEffects).toBe(0);
    expect(String(r.result.stderr)).not.toContain("Context prepared");
    expect(readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
    if (mode === BODY_REPLACEMENT)
      expect(readFileSync(target, "utf8")).toBe(original);
    else if (mode !== "symlink") expect(existsSync(target)).toBe(false);
  });
  it("preserves exact LF/CRLF/Unicode body bytes, refreshes identical content, and never echoes the private data", () => {
    const f = taskFixture(true);
    roots.push(f.root);
    const target = path.join(f.root, CONTEXT),
      original = readFileSync(target, "utf8"),
      at = original.indexOf("\n-->\n"),
      header = JSON.parse(
        original.slice("<!-- lisa-required-access:v1\n".length, at)
      );
    rmSync(target);
    const body =
      "Whole private body\r\nUnicode Ω and literal $(touch source.ts)\nPRIVATE_CONTEXT_CANARY\n\n";
    const content = requirementsContext(
        readConfig(f.root),
        "fixture/project#1",
        "github",
        header.required_access,
        body
      ),
      command = contextPatch(target, content);
    for (const patch of [command, `${command}\n`]) {
      const r = codexContext(f, patch);
      expect(r.result.status).toBe(2);
      expect(r.rawPatchEffects).toBe(0);
      expect(String(r.result.stderr)).toContain("Context prepared");
      expect(String(r.result.stdout) + String(r.result.stderr)).not.toContain(
        "PRIVATE_CONTEXT_CANARY"
      );
      expect(readFileSync(target, "utf8")).toBe(content);
    }
    expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
  });
  it("prepares ONE exact Add File through the atomic owner while denying the raw patch", () => {
    const f = taskFixture(true, true, {
      GITGUARDIAN_API_KEY: "synthetic-value",
    });
    roots.push(f.root);
    const target = path.join(f.root, CONTEXT),
      content = readFileSync(target, "utf8");
    rmSync(target);
    const command = `*** Begin Patch\n*** Add File: ${target}\n${content
      .slice(0, -1)
      .split("\n")
      .map(l => `+${l}`)
      .join("\n")}\n*** End Patch`;
    const request = {
      cwd: f.root,
      session_id: "codex-context",
      tool_use_id: "patch-call",
      tool_name: "apply_patch",
      tool_input: { command },
    };
    const r = boundedSpawnSync({
      label: "documented Codex before command envelope",
      command: process.execPath,
      args: [path.join(f.plugin, "hooks/task-readiness-guard.mjs")],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify(request),
    });
    if (r.status === 0) writeFileSync(target, content);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "codex-command-context",
        exit: r.status,
        rawPatchEffects: r.status === 0 ? 1 : 0,
        context_exists: existsSync(target),
        input_sha256: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
        stderr: String(r.stderr),
      })
    );
    expect(r.status).toBe(2);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(String(r.stderr)).toContain("Context prepared; run readiness");
    expect(f.run().counters.code).toBe(1);
  });
});
