/**
 * Contract tests for issue #1783's session-side tracked-work invariant.
 *
 * Base is the sole authored source. `build:plugins` fans base skills into the
 * Claude/OpenCode, Codex, Cursor, Antigravity, and Copilot artifacts below; all
 * shipped Implement surfaces must retain the same resolve -> claim -> bind gate.
 * @module tests/unit/strategies/tracked-work-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BASE_SKILLS = "plugins/src/base/skills";
const IMPLEMENT_PATHS = [
  `${BASE_SKILLS}/lisa-implement/SKILL.md`,
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
] as const;
const TRACK_SKILL_PATHS = [
  `${BASE_SKILLS}/lisa-track/SKILL.md`,
  "plugins/lisa/skills/lisa-track/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-track/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-track/SKILL.md",
  "plugins/lisa-agy/skills/lisa-track/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-track/SKILL.md",
] as const;
const PROVIDERS = ["github", "jira", "linear"] as const;
const TRACKER_WRITE = "lisa-tracker-write";
const CLEAR_BINDING = "node scripts/lisa-work-item.mjs clear";
const CONFIG_RULE_PATHS = [
  "plugins/src/base/rules/reference/config-resolution.md",
  "plugins/lisa/rules/reference/config-resolution.md",
  "plugins/lisa-cursor/rules/config-resolution-reference.mdc",
  "plugins/lisa-copilot/rules/reference/config-resolution.md",
] as const;

const read = (file: string): string => readFileSync(path.resolve(file), "utf8");

describe("public lisa-track entry point", () => {
  it("ships a public command backed by lisa-track", () => {
    const command = read("plugins/src/base/commands/track.md");

    expect(command).toContain("/lisa-track");
  });

  describe.each(TRACK_SKILL_PATHS)("%s", file => {
    it("live-validates or conservatively searches before one create", () => {
      const skill = read(file);

      expect(skill).toContain("lisa-tracker-read");
      expect(skill).toContain(TRACKER_WRITE);
      expect(skill).toContain("build_ready: true");
    });

    it("claims before persisting and verifies the binding", () => {
      const skill = read(file);
      const claim = skill.indexOf("lisa-tracker-claim <canonical-ref>");
      // `link`, not `bind`: the two spellings do the same work, but harnesses
      // that scan an argv for string-evaluating shell builtins refuse the bare
      // token `bind`, which made this documented step unrunnable inside an
      // isolated worktree. The docs must teach the spelling that always runs.
      const persist = skill.indexOf(
        "node scripts/lisa-work-item.mjs link <canonical-ref>"
      );
      const current = skill.indexOf("node scripts/lisa-work-item.mjs current");

      expect(claim).toBeGreaterThan(-1);
      expect(persist).toBeGreaterThan(claim);
      expect(current).toBeGreaterThan(persist);
    });

    it("keeps interrupted work bound and clears only at terminal completion", () => {
      const skill = read(file);

      expect(skill).toContain(CLEAR_BINDING);
    });
  });
});

describe("vendor-neutral tracker claim", () => {
  const dispatcher = read(`${BASE_SKILLS}/lisa-tracker-claim/SKILL.md`);

  it("dispatches all configured providers without inventing a default", () => {
    for (const provider of PROVIDERS) {
      expect(dispatcher).toContain(
        `\`${provider}\` -> invoke \`lisa-${provider}-claim\``
      );
    }
    expect(dispatcher).toContain("No tracker configured in .lisa.config.json");
    expect(dispatcher).not.toContain("default: jira");
  });

  it("requires a live leaf, idempotent claim, and post-write proof", () => {
    expect(dispatcher).toContain("leaf-only-lifecycle");
    expect(dispatcher).toContain("repo-scope-split");
  });

  it.each(PROVIDERS)(
    "%s claim reuses the build-intake claim contract",
    provider => {
      const skill = read(`${BASE_SKILLS}/lisa-${provider}-claim/SKILL.md`);
      expect(skill).toContain("leaf-only-lifecycle");
      expect(skill).toContain("repo-scope-split");
      expect(skill).toContain("[lisa-tracker-claim]");
    }
  );

  it.each(CONFIG_RULE_PATHS)(
    "%s maps the claim dispatcher for every provider",
    file => {
      const rule = read(file);

      expect(rule).toMatch(
        /lisa-tracker-claim.*lisa-jira-claim.*lisa-github-claim.*lisa-linear-claim/
      );
    }
  );
});

describe("Implement tracked-work gate", () => {
  describe.each(IMPLEMENT_PATHS)("%s", file => {
    it("makes resolve-create-claim-bind mandatory before durable work", () => {
      const skill = read(file);

      expect(skill).toContain("lisa-track $ARGUMENTS");
      expect(skill).toContain("lisa-tracker-read");
      expect(skill).toContain(TRACKER_WRITE);
      expect(skill).toContain("lisa-tracker-claim <canonical-ref>");
      expect(skill).toContain(
        "node scripts/lisa-work-item.mjs link <canonical-ref>"
      );
    });

    it("makes development and PR linkage unconditional", () => {
      const skill = read(file);
      expect(skill).toContain("node scripts/lisa-work-item.mjs attach-branch");
    });

    it("clears only after terminal completion", () => {
      const skill = read(file);
      const terminal = skill.lastIndexOf("true terminal completion");
      const clear = skill.lastIndexOf(CLEAR_BINDING);

      expect(terminal).toBeGreaterThan(-1);
      expect(clear).toBeGreaterThan(terminal);
    });
  });
});

describe("the work-item guard reads no OS keychain", () => {
  // The rung this pins removed read as a fallback and was, on the machines that
  // ran it, the SOLE Linear token source — the two environment variables above
  // it were unset. It also regenerated itself: an agent blocked by the hook
  // opened the guard, found the keychain call, and adopted the deprecated path.
  // Three did so in one day, which is why the assertion is on the shipped bytes
  // and not only on behaviour. The service name is deliberately reconstructed
  // rather than written as a literal, so this file does not reintroduce the
  // string it exists to keep out.
  const DEPRECATED_ENTRY = ["lisa", "linear"].join("-");

  it.each([
    "all/copy-overwrite/scripts/lisa-work-item.mjs",
    "scripts/lisa-work-item.mjs",
  ])("%s consults no keychain", file => {
    const source = read(file);

    expect(source).not.toContain("find-generic-password");
    expect(source).not.toContain(DEPRECATED_ENTRY);
  });
});

describe("tracked-work rules", () => {
  // The eager head was retired in the 2026-11 eager-tier cut: lisa-track and
  // the hooks enforce the binding, and the contract lives in the reference body.
  it.each(["reference"] as const)("%s rule pins the invariant", group => {
    const rule = read(`plugins/src/base/rules/${group}/tracked-work.md`);
    expect(rule).toContain(TRACKER_WRITE);
    expect(rule).toContain("lisa-tracker-claim");
    expect(rule).toContain("node scripts/lisa-work-item.mjs link <ref>");
    expect(rule).toContain(CLEAR_BINDING);
  });
});
