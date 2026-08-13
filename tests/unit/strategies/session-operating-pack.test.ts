import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contract tests for the WU-B session-operating pack.
 *
 * The pack encodes operating rules that came from observed agent misbehaviour:
 * burning CI as a debugger, idling on a callback that never arrives, jargon-heavy
 * status updates, and deferring in-scope work. Because these rules load on EVERY
 * session for EVERY agent, the tests pin two things that are easy to lose: the
 * exact instruction each rule exists to give, and the fact that it reaches all
 * generated agent surfaces (rather than only the source tree).
 *
 * The `plugins/lisa` root is included so a source edit that was never fanned out
 * through `bun run build:plugins` fails here rather than shipping half-delivered.
 */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const LOCAL_CI_FIRST = "local-ci-first";
const NOT_BLOCKED = "not-blocked-just-waiting";
const STATUS_UPDATES = "session-status-updates";
const DO_IT_NOW = "do-it-now";
const LEARNINGS_LADDER = "learnings-ladder";

/** Rules the pack modifies rather than introduces. */
const WIKI_KNOWLEDGE_SOURCE = "wiki-knowledge-source";
const FALSIFIABLE_CHECKS = "falsifiable-checks";

const PACK_SLUGS = [
  LOCAL_CI_FIRST,
  NOT_BLOCKED,
  STATUS_UPDATES,
  DO_IT_NOW,
  LEARNINGS_LADDER,
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

const eagerOf = (root: string, slug: string): string =>
  read(root, `rules/eager/${slug}.md`);

const referenceOf = (root: string, slug: string): string =>
  read(root, `rules/reference/${slug}.md`);

describe.each(ROOTS)("session operating pack in %s", root => {
  describe.each(PACK_SLUGS)("%s", slug => {
    it("ships as a paired eager head and reference body", () => {
      expect(existsSync(path.resolve(root, `rules/eager/${slug}.md`))).toBe(
        true
      );
      expect(existsSync(path.resolve(root, `rules/reference/${slug}.md`))).toBe(
        true
      );
    });

    it("marks the eager head load-bearing and breadcrumbs to the body", () => {
      const eager = eagerOf(root, slug);
      expect(eager).toMatch(/^# .+ \(load-bearing\)$/m);
      expect(eager).toContain(
        `[reference/${slug}.md](../reference/${slug}.md)`
      );
    });

    it("keeps the eager head short enough to load every session", () => {
      // Brevity is the feature: this pack is paid for on every session start on
      // every agent. The reference body is where detail belongs.
      const eager = eagerOf(root, slug);
      expect(eager.split("\n").length).toBeLessThanOrEqual(24);
      expect(eager.length).toBeGreaterThan(400);
    });

    it("carries a reference body with real prose", () => {
      expect(referenceOf(root, slug).length).toBeGreaterThan(1200);
    });
  });

  it("local-ci-first tells the agent to reproduce CI e2e failures locally", () => {
    const eager = eagerOf(root, LOCAL_CI_FIRST);
    expect(eager).toContain("CI Is Not a Debugger");
    expect(eager).toContain("reproduce it locally with the same configuration");
    expect(eager).toContain(
      "Reconstruct the invocation from the workflow file"
    );
    expect(eager).toContain("Never push a speculative fix");
  });

  it("not-blocked-just-waiting covers polling, blocked, and parallel phases", () => {
    const eager = eagerOf(root, NOT_BLOCKED);
    expect(eager).toContain("roughly every 5 minutes");
    expect(eager).toContain("Blocked means you physically cannot proceed");
    expect(eager).toContain("not sequential unless the user said so");
  });

  it("not-blocked-just-waiting leaves the factory human_needed vocabulary alone", () => {
    // The tracker lifecycle vocabulary is a separate, stricter contract. This
    // rule governs session stuckness only; conflating the two would let a
    // session downgrade a genuine tracker blocker to "just waiting".
    const eager = eagerOf(root, NOT_BLOCKED);
    expect(eager).toContain("human_needed");
    expect(eager).toContain("lisa-repair-intake");
    expect(eager).toMatch(/stricter, unchanged/);
  });

  it("session-status-updates fixes the three-part shape and plain language", () => {
    const eager = eagerOf(root, STATUS_UPDATES);
    expect(eager).toContain(
      "what changed, what's blocked, and what needs a decision"
    );
    expect(eager).toContain("non-technical");
    expect(eager).toContain("recommendation");
    expect(eager).toContain("ramifications");
  });

  it("session-status-updates requires the safe-to-close line verbatim", () => {
    const eager = eagerOf(root, STATUS_UPDATES);
    expect(eager).toContain("`Safe to close: yes/no — <reason>`");
  });

  it("do-it-now forbids deferring work the factory is allowed to do", () => {
    const eager = eagerOf(root, DO_IT_NOW);
    expect(eager).toContain("exterior human gate");
    expect(eager).toContain(
      '"I\'ll get to that later" is not an acceptable close'
    );
  });

  it("learnings-ladder names all six rungs and the host rules path", () => {
    const eager = eagerOf(root, LEARNINGS_LADDER);
    for (const rung of [
      "EXECUTABLE-CONTROL",
      "EAGER-RULE",
      "SKILL",
      "WIKI",
      "KEEP-IN-LEDGER",
      "RETIRE",
    ])
      expect(eager).toContain(rung);
    expect(eager).toContain(".agents/rules/");
  });

  it("learnings-ladder routes promotion through the gardener, not the session", () => {
    const eager = eagerOf(root, LEARNINGS_LADDER);
    expect(eager).toContain("/lisa:learnings:audit");
    expect(eager).toContain("lisa-persist-learning");
  });

  it("wiki-knowledge-source is query-on-demand, not consult-first", () => {
    const eager = eagerOf(root, WIKI_KNOWLEDGE_SOURCE);
    expect(eager).toContain("Do not load the wiki at session start");
    expect(eager).not.toContain("Consult the wiki first");
    expect(eager).not.toContain("authoritative answer");
  });

  it("wiki-knowledge-source does not dangle when the wiki plugin is absent", () => {
    // The packaging bug: the rule ships in base while lisa-wiki-query ships only
    // in the wiki plugin, so a base-only project got a rule pointing at a skill
    // it does not have. The rule now disqualifies itself on the same condition
    // that gates the plugin's installation, and names the base-shipped recovery.
    for (const text of [
      eagerOf(root, WIKI_KNOWLEDGE_SOURCE),
      referenceOf(root, WIKI_KNOWLEDGE_SOURCE),
    ]) {
      expect(text).toContain("lisa-wiki.config.json");
      expect(text).toContain("lisa-wiki-install");
    }
  });

  it("falsifiable-checks keeps the mutation-proof cardinality yardstick", () => {
    // Was `toContain("exactly one")` until #2489 corrected the reading: exactly
    // one is one of two load-bearing outcomes, not the requirement. The full
    // contract lives in tests/unit/strategies/falsifiable-checks-rule.test.ts.
    const eager = eagerOf(root, FALSIFIABLE_CHECKS);
    expect(eager).toContain("Exactly one, or several all named for the same");
  });

  it("falsifiable-checks forbids narrating a red state that was never run", () => {
    const eager = eagerOf(root, FALSIFIABLE_CHECKS);
    expect(eager).toContain("detached-HEAD worktree");
  });

  it("empirical-inquiry requires establishing branch position before a diff", () => {
    const eager = eagerOf(root, "empirical-inquiry");
    expect(eager).toContain("git rev-list --count HEAD..origin/");
  });

  it("integration-access-layer points at the secrets contract without copying it", () => {
    const eager = eagerOf(root, "integration-access-layer");
    expect(eager).toContain("lisa-secrets-access");
    // A second copy of the note format would drift from the real contract.
    expect(eager).not.toContain("tool:");
  });
});

describe("session operating pack fan-out", () => {
  it.each(PACK_SLUGS)("%s reaches the copilot surface", slug => {
    expect(
      existsSync(path.resolve("plugins/lisa-copilot", `rules/eager/${slug}.md`))
    ).toBe(true);
    expect(
      existsSync(
        path.resolve("plugins/lisa-copilot", `rules/reference/${slug}.md`)
      )
    ).toBe(true);
  });

  it.each(PACK_SLUGS)("%s reaches the cursor surface as .mdc pair", slug => {
    expect(
      existsSync(path.resolve("plugins/lisa-cursor", `rules/${slug}.mdc`))
    ).toBe(true);
    expect(
      existsSync(
        path.resolve("plugins/lisa-cursor", `rules/${slug}-reference.mdc`)
      )
    ).toBe(true);
  });

  it("does not reach agy, whose no-eager-rules exception stands", () => {
    // Accepted gap, recorded in wiki/decisions/2026-08-12-agent-neutral-host-rules-path.md
    // section 5: agy's plugin hooks do not fire headless, so it receives the
    // canonical AGENTS.md pointer instead of an injected rules tree. Asserted
    // rather than "fixed" so the divergence stays visible.
    expect(existsSync(path.resolve("plugins/lisa-agy", "rules"))).toBe(false);
  });
});
