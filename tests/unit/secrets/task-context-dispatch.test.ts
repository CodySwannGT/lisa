/** Ordinary patches use actual readiness; only context operations enter metadata parsing. */
import { readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import {
  codexContext,
  contextPatch,
} from "../../helpers/task-codex-context.js";
import { nativeWrite } from "../../helpers/task-native-context.js";
const roots: string[] = [],
  CONTEXT = ".lisa/work-item-context.md";
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Owned fixture with a genuine supported capability for the positive control.
 * @param qualified - Inject a supported task API candidate.
 * @returns Installed real wrapper and sources.
 */
function fixture(qualified = true) {
  const f = taskFixture(
    true,
    true,
    qualified ? { GITGUARDIAN_API_KEY: "synthetic-value" } : {}
  );
  const source = path.join(f.root, "source.ts");
  roots.push(f.root);
  writeFileSync(source, "before\n");
  return { ...f, source };
}
describe("ordinary versus private metadata patch dispatch", () => {
  it("does not let a qualified Write alias evade the same canonical metadata selection", () => {
    const f = fixture(),
      target = path.join(f.root, CONTEXT),
      content = readFileSync(target, "utf8"),
      alias = path.join(f.root, "context-alias.md");
    symlinkSync(target, alias);
    const r = nativeWrite(f, content, alias);
    expect(r.guard.status).toBe(2);
    expect(r.rawWrites).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(content);
  });
  it.each(["qualified", "unproved", "no-header"])(
    "routes %s ordinary source patch through the existing readiness decision",
    mode => {
      const f = fixture(mode !== "unproved");
      if (mode === "no-header") rmSync(path.join(f.root, CONTEXT));
      const command = `*** Begin Patch\n*** Update File: ${f.source}\n@@\n-before\n+after\n*** End Patch`,
        r = codexContext(f, command);
      // Exact fixture continuation; no warning/metadata-outcome suppression or patch parser.
      if (r.result.status === 0) writeFileSync(f.source, "after\n");
      expect(r.result.status).toBe(mode === "qualified" ? 0 : 2);
      expect(r.rawPatchEffects).toBe(mode === "qualified" ? 1 : 0);
      expect(readFileSync(f.source, "utf8")).toBe(
        mode === "qualified" ? "after\n" : "before\n"
      );
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `ordinary-patch-${mode}`,
          exit: r.result.status,
          effects: r.rawPatchEffects,
          source_after: readFileSync(f.source, "utf8").trim(),
        })
      );
    }
  );
  it("does not mistake quoted patch documentation inside ordinary added source lines for an operation", () => {
    const f = fixture(),
      context = path.join(f.root, CONTEXT),
      command = `*** Begin Patch\n*** Update File: ${f.source}\n@@\n-before\n+*** Add File: ${context}\n*** End Patch`;
    expect(codexContext(f, command).result.status).toBe(0);
  });
  it.each([
    "relative",
    "normalized",
    "symlink",
    "move",
    "mixed",
    "context-update",
  ])("strictly denies %s metadata on an otherwise qualified task", mode => {
    const f = fixture(),
      target = path.join(f.root, CONTEXT),
      content = readFileSync(target, "utf8"),
      alias = path.join(f.root, "alias.md");
    symlinkSync(target, alias);
    const names: Record<string, string> = {
      relative: CONTEXT,
      normalized: `${f.root}/.lisa/../.lisa/work-item-context.md`,
      symlink: alias,
    };
    const commands: Record<string, string> = {
      move: `*** Begin Patch\n*** Update File: ${f.source}\n*** Move to: ${target}\n@@\n-before\n+after\n*** End Patch`,
      mixed: contextPatch(target, content).replace(
        "*** End Patch",
        `*** Add File: ${f.source}\n+after\n*** End Patch`
      ),
      "context-update": `*** Begin Patch\n*** Update File: ${target}\n@@\n-whole\n+changed\n*** End Patch`,
    };
    const command = commands[mode] ?? contextPatch(names[mode]!, content),
      r = codexContext(f, command);
    expect(r.result.status).toBe(2);
    expect(r.rawPatchEffects).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(readFileSync(f.source, "utf8")).toBe("before\n");
  });
});
