/**
 * Proof that every generated per-agent port still AGREES with the generator
 * source it is emitted from.
 *
 * Its sibling suite (`hook-registration.test.ts`) asserts PRESENCE: each hook
 * is registered on each surface. Presence is not enough, and the gap is not
 * theoretical — a resolution where the generated ports are correct and the
 * generator SOURCE is not satisfies every presence count, and the next
 * `build:plugins` silently reverts the correct ports back to the wrong base
 * (CodySwannGT/lisa#3809). `check-plugins-sync.sh` enforces the whole-tree form
 * of this at push and in CI by rebuilding and diffing; what it cannot do is
 * tell a LIVE generator-table entry from an inert one, because regeneration
 * reproduces an entry that emits nothing exactly as faithfully as one that
 * emits a hook.
 *
 * So this suite regenerates the Antigravity port — the one surface whose
 * generator keeps its own hook table — and asserts the emitted manifest, not
 * the table.
 * @module tests/unit/plugins/hook-registration-agreement
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  auditHookRegistration,
  REPO_ROOT,
} from "../../../scripts/lib/hook-registration-audit.mjs";

import {
  agyRegisteredScripts,
  dropRegistration,
  materializeFixture,
  regenerateAgyManifest,
  releaseFixtures,
} from "./support/hook-registration-fixture.js";

/** Violation kinds asserted below. */
const SOURCE_REGISTRATION_MISSING = "source-registration-missing";
const PORT_REGISTRATION_MISSING = "port-registration-missing";
const ADAPTER_UNREGISTERED = "adapter-unregistered";

/** Fixture-relative manifests these cases perturb. */
const CLAUDE_MANIFEST = "plugins/lisa/.claude-plugin/plugin.json";
const CODEX_MANIFEST = "plugins/lisa/.codex-plugin/hooks.json";
const AGY_MANIFEST = "plugins/lisa-agy/hooks.json";
const SOURCE_MANIFEST = "plugins/src/base/.claude-plugin/plugin.json";

/** Hooks these cases act on. */
const ISSUE_GUARD = "block-direct-issue-create.sh";
const REGISTERED_GUARD = "block-no-verify.sh";
const AGY_ADAPTER = "block-no-verify.agy.sh";

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

describe("the generated ports agree with their generator source", () => {
  it("fails on a base-wrong / port-right resolution, which a presence count passes", () => {
    // The hole a `grep -c` presence check leaves: the generated ports are
    // correct and the generator SOURCE is not, so every count matches and the
    // next build silently reverts the ports back to the wrong base.
    const root = materializeFixture(tempRoots);
    dropRegistration(path.join(root, SOURCE_MANIFEST), ISSUE_GUARD);

    // Precondition: this really is the base-wrong / port-right shape — every
    // generated port still registers the guard. Without asserting it, the
    // test could be passing for the ordinary "registered nowhere" reason.
    const stillRegistered = [CLAUDE_MANIFEST, CODEX_MANIFEST].filter(manifest =>
      fs.readFileSync(path.join(root, manifest), "utf8").includes(ISSUE_GUARD)
    );
    expect(stillRegistered).toEqual([CLAUDE_MANIFEST, CODEX_MANIFEST]);

    const result = auditHookRegistration(root);
    const found = violationsFor(result, ISSUE_GUARD);
    expect(kindsFor(result, ISSUE_GUARD)).toContain(
      SOURCE_REGISTRATION_MISSING
    );
    expect(found[0]?.detail).toContain("next build drops it");
    // And the ports are NOT accused — the source is where the fix belongs.
    expect(kindsFor(result, ISSUE_GUARD)).not.toContain(
      PORT_REGISTRATION_MISSING
    );
  });

  it("regenerating the Antigravity port reproduces its committed manifest", () => {
    // Rebuild-and-diff, on the one surface whose generator keeps its own hook
    // table. Agreement between artifact and source is the property that
    // survives the next build; presence in the artifact is not.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-agy-regen-"));
    tempRoots.push(outDir);
    const regenerated = regenerateAgyManifest(
      path.join(REPO_ROOT, "plugins", "lisa"),
      path.join(outDir, "agy")
    );
    const committed = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, AGY_MANIFEST), "utf8")
    ) as Record<string, unknown>;
    expect(regenerated).toEqual(committed);
  });

  it("proves each Antigravity table entry is live, not merely present", () => {
    // A table entry that emits nothing is indistinguishable from a live one
    // by reading the table. Only the REGENERATED manifest tells them apart.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-agy-live-"));
    tempRoots.push(outDir);
    const regenerated = regenerateAgyManifest(
      path.join(REPO_ROOT, "plugins", "lisa"),
      path.join(outDir, "agy")
    );
    const emitted = agyRegisteredScripts(regenerated);
    const adapters = fs
      .readdirSync(path.join(REPO_ROOT, "plugins", "lisa", "hooks"))
      .filter(name => name.endsWith(".agy.sh"))
      .sort((a, b) => a.localeCompare(b));
    expect(adapters.length).toBeGreaterThan(0);
    for (const adapter of adapters) {
      expect(emitted.has(adapter)).toBe(true);
    }
  });

  it("fails when a generator table entry goes inert and emits nothing", () => {
    // The composition of break paths 1 and 3: the table entry is still there,
    // but the Claude manifest no longer references its source script, so the
    // generator filters it out and emits no key. The build still succeeds.
    const root = materializeFixture(tempRoots);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-agy-inert-"));
    tempRoots.push(outDir);
    const claudePort = path.join(root, "plugins", "lisa");
    dropRegistration(path.join(root, CLAUDE_MANIFEST), REGISTERED_GUARD);

    const regenerated = regenerateAgyManifest(
      claudePort,
      path.join(outDir, "agy")
    );
    // The table entry for block-no-verify is untouched and now emits nothing.
    expect(agyRegisteredScripts(regenerated).has(AGY_ADAPTER)).toBe(false);

    // Install the regenerated port over the fixture's committed one and the
    // audit refuses it — the adapter ships and is registered nowhere.
    fs.rmSync(path.join(root, AGY_MANIFEST));
    fs.cpSync(
      path.join(outDir, "agy", "hooks.json"),
      path.join(root, AGY_MANIFEST)
    );
    expect(kindsFor(auditHookRegistration(root), AGY_ADAPTER)).toContain(
      ADAPTER_UNREGISTERED
    );
  });
});
