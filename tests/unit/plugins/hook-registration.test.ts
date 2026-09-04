/**
 * Proof that every shipped hook script is actually registered to run.
 *
 * The class of defect: not a guard whose logic fails to bite, but a guard that
 * is never invoked. A mangled guard fails loudly; an unregistered one is silent
 * by construction, because until this suite nothing in the tree asked the
 * question (CodySwannGT/lisa#3809).
 *
 * The control case passes trivially — the baseline is clean — so a suite that
 * only asserted the control would prove nothing. Every arm below is therefore
 * paired with a BITE case that removes one registration from a real copy of the
 * tree and asserts the audit goes red naming that hook and that surface, and
 * the un-perturbed clone is asserted green first so a bite can never be read
 * off a fixture that was already broken.
 * @module tests/unit/plugins/hook-registration
 */
import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  auditHookRegistration,
  classifyHookFile,
  formatAudit,
  REPO_ROOT,
} from "../../../scripts/lib/hook-registration-audit.mjs";

import {
  addPreToolUseRegistration,
  dropRegistration,
  materializeFixture,
  releaseFixtures,
} from "./support/hook-registration-fixture.js";

/** Violation kinds asserted below. */
const UNREGISTERED_ENTRY_POINT = "unregistered-entry-point";
const PORT_REGISTRATION_MISSING = "port-registration-missing";
const SOURCE_REGISTRATION_MISSING = "source-registration-missing";
const ADAPTER_UNREGISTERED = "adapter-unregistered";

/** Fixture-relative paths the bite cases perturb. */
const CODEX_MANIFEST = "plugins/lisa/.codex-plugin/hooks.json";
const CLAUDE_MANIFEST = "plugins/lisa/.claude-plugin/plugin.json";
const AGY_MANIFEST = "plugins/lisa-agy/hooks.json";
const SOURCE_MANIFEST = "plugins/src/base/.claude-plugin/plugin.json";
const SOURCE_HOOKS = "plugins/src/base/hooks";

/** A real registered guard, and a hook name that exists nowhere. */
const REGISTERED_GUARD = "block-no-verify.sh";
const NEW_HOOK = "block-nothing-at-all.sh";
const AGY_ADAPTER = "block-no-verify.agy.sh";
const HOST_NAME_ADAPTER = "block-host-name-leak.agy.sh";
const ISSUE_GUARD = "block-direct-issue-create.sh";
const CLAUDE_ONLY_HOOK = "enforce-team-first.sh";
const TRIVIAL_HOOK_BODY = "#!/usr/bin/env bash\nexit 0\n";

/** Per-test temp roots, removed after each test. */
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

afterAll(() => {
  releaseFixtures();
});

/**
 * The violations naming one hook.
 * @param result An audit result.
 * @param hook Hook basename to filter on.
 * @returns Every violation whose subject is that hook.
 */
function violationsFor(
  result: ReturnType<typeof auditHookRegistration>,
  hook: string
): ReturnType<typeof auditHookRegistration>["violations"] {
  return result.violations.filter(violation => violation.hook === hook);
}

/**
 * The violation kinds recorded against one hook.
 * @param result An audit result.
 * @param hook Hook basename to filter on.
 * @returns The `kind` of each violation naming that hook.
 */
function kindsFor(
  result: ReturnType<typeof auditHookRegistration>,
  hook: string
): string[] {
  return violationsFor(result, hook).map(violation => violation.kind);
}

/**
 * Which agent reads a manifest, from its path.
 * @param manifest Repository-relative manifest path.
 * @returns The agent slug.
 */
function agentOf(manifest: string): string {
  if (manifest.includes(".codex-plugin")) return "codex";
  if (manifest.includes("-agy/")) return "agy";
  if (manifest.includes("-cursor/")) return "cursor";
  if (manifest.includes("-copilot/")) return "copilot";
  return "claude";
}

describe("hook registration audit", () => {
  describe("classification", () => {
    it("separates the three kinds of file that live in a hooks directory", () => {
      expect(classifyHookFile(REGISTERED_GUARD)).toBe("entry-point");
      expect(classifyHookFile(AGY_ADAPTER)).toBe("adapter");
      expect(classifyHookFile("block-host-name-leak.mjs")).toBe("support");
      expect(classifyHookFile("parity-safety-net-heredoc.py")).toBe("support");
      expect(classifyHookFile("hooks.json")).toBe("manifest");
    });
  });

  describe("the live repository", () => {
    it("registers every shipped hook", () => {
      const result = auditHookRegistration(REPO_ROOT);
      expect(formatAudit(result)).toContain(
        "Every shipped hook is registered."
      );
      expect(result.violations).toEqual([]);
    });

    it("enumerates every port and reaches all five agent surfaces", () => {
      const result = auditHookRegistration(REPO_ROOT);
      const ports = fs
        .readdirSync(path.join(REPO_ROOT, "plugins"), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== "src");
      expect(result.scanned.ports).toBe(ports.length);
      // A count is only evidence of completeness when it is taken against the
      // directory listing AND every agent surface is represented: the ticket's
      // own first scan read one plugin directory and reported four orphans that
      // were registered in another port's manifest.
      const agents = [...new Set(result.surfaces.map(agentOf))].sort((a, b) =>
        a.localeCompare(b)
      );
      expect(agents).toEqual(["agy", "claude", "codex", "copilot", "cursor"]);
      expect(result.scanned.entryPoints).toBeGreaterThan(0);
      expect(result.scanned.adapters).toBeGreaterThan(0);
      expect(result.scanned.supportModules).toBeGreaterThan(0);
    });
  });

  describe("it bites", () => {
    it("is green on the un-perturbed fixture", () => {
      const result = auditHookRegistration(materializeFixture(tempRoots));
      expect(result.violations).toEqual([]);
    });

    it("fails when a generated port loses an entry its source still has", () => {
      const root = materializeFixture(tempRoots);
      dropRegistration(path.join(root, CODEX_MANIFEST), REGISTERED_GUARD);
      const result = auditHookRegistration(root);
      const found = violationsFor(result, REGISTERED_GUARD);
      expect(kindsFor(result, REGISTERED_GUARD)).toContain(
        PORT_REGISTRATION_MISSING
      );
      expect(found[0]?.surface).toContain(".codex-plugin/hooks.json");
    });

    it("fails when the source manifest drops one member of a matcher array", () => {
      const root = materializeFixture(tempRoots);
      dropRegistration(path.join(root, SOURCE_MANIFEST), ISSUE_GUARD);
      expect(kindsFor(auditHookRegistration(root), ISSUE_GUARD)).toContain(
        SOURCE_REGISTRATION_MISSING
      );
    });

    it("fails when the Antigravity generator's table omits an adapter", () => {
      const root = materializeFixture(tempRoots);
      dropRegistration(path.join(root, AGY_MANIFEST), HOST_NAME_ADAPTER);
      const result = auditHookRegistration(root);
      const found = violationsFor(result, HOST_NAME_ADAPTER);
      expect(kindsFor(result, HOST_NAME_ADAPTER)).toContain(
        ADAPTER_UNREGISTERED
      );
      expect(found[0]?.detail).toContain("generate-agy-plugin-artifacts.mjs");
    });

    it("fails when a manifest registers a script the port does not ship", () => {
      const root = materializeFixture(tempRoots);
      fs.rmSync(path.join(root, "plugins/lisa/hooks", REGISTERED_GUARD));
      expect(kindsFor(auditHookRegistration(root), REGISTERED_GUARD)).toContain(
        "registered-but-missing"
      );
    });

    it("fails when a brand-new entry point is added and never registered", () => {
      const root = materializeFixture(tempRoots);
      fs.writeFileSync(
        path.join(root, SOURCE_HOOKS, NEW_HOOK),
        TRIVIAL_HOOK_BODY
      );
      expect(kindsFor(auditHookRegistration(root), NEW_HOOK)).toEqual([
        UNREGISTERED_ENTRY_POINT,
      ]);
    });

    it("still flags a new entry point that only its own adapter delegates to", () => {
      // An adapter calling the canonical guard is the registered path working,
      // not evidence the guard is a library. Counting it would exempt every
      // guard that has an Antigravity port — which is all six of them.
      const root = materializeFixture(tempRoots);
      const hooks = path.join(root, SOURCE_HOOKS);
      fs.writeFileSync(path.join(hooks, NEW_HOOK), TRIVIAL_HOOK_BODY);
      fs.writeFileSync(
        path.join(hooks, "block-nothing-at-all.agy.sh"),
        `#!/usr/bin/env bash\nexec bash "$DIR/${NEW_HOOK}"\n`
      );
      expect(kindsFor(auditHookRegistration(root), NEW_HOOK)).toEqual([
        UNREGISTERED_ENTRY_POINT,
      ]);
    });

    it("still flags a new entry point a sibling only names in a comment", () => {
      const root = materializeFixture(tempRoots);
      const hooks = path.join(root, SOURCE_HOOKS);
      fs.writeFileSync(path.join(hooks, NEW_HOOK), TRIVIAL_HOOK_BODY);
      fs.appendFileSync(
        path.join(hooks, REGISTERED_GUARD),
        `\n# See "$LISA_HOOK_DIR/${NEW_HOOK}" for the sibling rule.\n`
      );
      expect(kindsFor(auditHookRegistration(root), NEW_HOOK)).toEqual([
        UNREGISTERED_ENTRY_POINT,
      ]);
    });

    it("still flags a new entry point a sibling names as prose, not as a path", () => {
      // A guard's refusal text cites sibling guards by bare name on ordinary
      // executable lines inside a heredoc. Only the path form — a leading
      // separator — is an invocation; matching the bare name would exempt the
      // guards that get quoted the most.
      const root = materializeFixture(tempRoots);
      const hooks = path.join(root, SOURCE_HOOKS);
      fs.writeFileSync(path.join(hooks, NEW_HOOK), TRIVIAL_HOOK_BODY);
      fs.appendFileSync(
        path.join(hooks, REGISTERED_GUARD),
        `\nprintf "%s\\n" "see ${NEW_HOOK} for the sibling rule"\n`
      );
      expect(kindsFor(auditHookRegistration(root), NEW_HOOK)).toEqual([
        UNREGISTERED_ENTRY_POINT,
      ]);
    });

    it("fails when a surface registers a hook its own ship list excludes", () => {
      // The ship-list declaration is what exempts a deliberately unshipped
      // script from the registration requirement, so it has to be checked in
      // the other direction too — otherwise declaring a hook unshipped is a
      // silent way to stop this audit looking at it.
      const root = materializeFixture(tempRoots);
      addPreToolUseRegistration(
        path.join(root, CODEX_MANIFEST),
        CLAUDE_ONLY_HOOK
      );
      const result = auditHookRegistration(root);
      const found = violationsFor(result, CLAUDE_ONLY_HOOK);
      expect(kindsFor(result, CLAUDE_ONLY_HOOK)).toContain(
        "ship-list-contradiction"
      );
      expect(found[0]?.detail).toContain("unshipped for codex");
    });

    it("fails when a new support module is added that no sibling invokes", () => {
      const root = materializeFixture(tempRoots);
      fs.writeFileSync(
        path.join(root, SOURCE_HOOKS, "nobody-calls-this.mjs"),
        "export const unused = true;\n"
      );
      expect(
        kindsFor(auditHookRegistration(root), "nobody-calls-this.mjs")
      ).toEqual(["support-module-orphan"]);
    });

    it("fails when an Antigravity adapter leaks into another agent's manifest", () => {
      const root = materializeFixture(tempRoots);
      addPreToolUseRegistration(path.join(root, CLAUDE_MANIFEST), AGY_ADAPTER);
      expect(kindsFor(auditHookRegistration(root), AGY_ADAPTER)).toContain(
        "adapter-off-surface"
      );
    });
  });

  describe("what it does not fire on", () => {
    it("leaves support modules and shell libraries alone", () => {
      const result = auditHookRegistration(REPO_ROOT);
      for (const hook of [
        "block-host-name-leak.mjs",
        "inject-resolved-config.mjs",
        "parity-safety-net-heredoc.py",
        "lisa-edit-gate.sh",
      ]) {
        expect(violationsFor(result, hook)).toEqual([]);
      }
    });

    it("does not demand an Antigravity adapter appear in the Claude manifest", () => {
      const claude = fs.readFileSync(
        path.join(REPO_ROOT, CLAUDE_MANIFEST),
        "utf8"
      );
      expect(claude).not.toContain(".agy.sh");
      expect(
        violationsFor(auditHookRegistration(REPO_ROOT), AGY_ADAPTER)
      ).toEqual([]);
    });
  });
});
