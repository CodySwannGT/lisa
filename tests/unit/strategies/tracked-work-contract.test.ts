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
    expect(command).toMatch(
      /existing.*reference.*specification file.*plain-text/is
    );
  });

  describe.each(TRACK_SKILL_PATHS)("%s", file => {
    it("live-validates or conservatively searches before one create", () => {
      const skill = read(file);

      expect(skill).toContain("lisa-tracker-read");
      expect(skill).toMatch(/exactly one.*high-confidence/is);
      expect(skill).toMatch(/create \*\*exactly one\*\*/i);
      expect(skill).toContain(TRACKER_WRITE);
      expect(skill).toContain("build_ready: true");
      expect(skill).toMatch(/single-repository leaf/i);
    });

    it("claims before persisting and verifies the binding", () => {
      const skill = read(file);
      const claim = skill.indexOf("lisa-tracker-claim <canonical-ref>");
      const bind = skill.indexOf(
        "node scripts/lisa-work-item.mjs bind <canonical-ref>"
      );
      const current = skill.indexOf("node scripts/lisa-work-item.mjs current");

      expect(claim).toBeGreaterThan(-1);
      expect(bind).toBeGreaterThan(claim);
      expect(current).toBeGreaterThan(bind);
      expect(skill).toMatch(/failed\/unverified claim/i);
      expect(skill).toMatch(/stop before durable project work/i);
    });

    it("keeps interrupted work bound and clears only at terminal completion", () => {
      const skill = read(file);

      expect(skill).toContain(CLEAR_BINDING);
      expect(skill).toMatch(/Keep the binding across ordinary interruptions/i);
      expect(skill).toMatch(/only after true terminal completion/i);
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
    expect(dispatcher).toMatch(/claimed role or a later non-terminal role/i);
    expect(dispatcher).toMatch(/assign.*only when unassigned/i);
    expect(dispatcher).toMatch(/post-write read/i);
    expect(dispatcher).toMatch(/fail closed/i);
  });

  it.each(PROVIDERS)(
    "%s claim reuses the build-intake claim contract",
    provider => {
      const skill = read(`${BASE_SKILLS}/lisa-${provider}-claim/SKILL.md`);

      expect(skill).toMatch(/build-intake.*Phase 3b/i);
      expect(skill).toContain("leaf-only-lifecycle");
      expect(skill).toContain("repo-scope-split");
      expect(skill).toMatch(/immediately before mutation/i);
      expect(skill).toMatch(/only if.*unassigned/i);
      expect(skill).toContain("[lisa-tracker-claim]");
      expect(skill).toMatch(/deduped/i);
      expect(skill).toMatch(/again.*Success requires/is);
      expect(skill).toMatch(/claim_outcome: claimed\|reused/);
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
        "node scripts/lisa-work-item.mjs bind <canonical-ref>"
      );
      expect(skill).toMatch(/No project source.*may be created or changed/is);
    });

    it("makes development and PR linkage unconditional", () => {
      const skill = read(file);

      expect(skill).toMatch(/Every Implement run now has a tracker work item/i);
      expect(skill).toMatch(/Missing linkage is a workflow failure/i);
      expect(skill).toContain("node scripts/lisa-work-item.mjs attach-branch");
      expect(skill).toMatch(/mandatory work-item ref/i);
      expect(skill).not.toMatch(/including the work-item ref when one exists/i);
      expect(skill).not.toMatch(/when a work item exists/i);
    });

    it("clears only after terminal completion", () => {
      const skill = read(file);
      const terminal = skill.lastIndexOf("true terminal completion");
      const clear = skill.lastIndexOf(CLEAR_BINDING);

      expect(terminal).toBeGreaterThan(-1);
      expect(clear).toBeGreaterThan(terminal);
      expect(skill).toMatch(
        /Do not clear on an interruption or blocked outcome/i
      );
    });
  });
});

describe("tracked-work rules", () => {
  it.each(["eager", "reference"] as const)(
    "%s rule pins the invariant",
    group => {
      const rule = read(`plugins/src/base/rules/${group}/tracked-work.md`);

      expect(rule).toMatch(/Before.*durable/is);
      expect(rule).toMatch(/exactly one.*leaf/is);
      expect(rule).toContain(TRACKER_WRITE);
      expect(rule).toContain("lisa-tracker-claim");
      expect(rule).toContain("node scripts/lisa-work-item.mjs bind <ref>");
      expect(rule).toContain(CLEAR_BINDING);
      expect(rule).toMatch(/only after.*terminal completion/is);
    }
  );
});
