import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contract tests for the session operating pack — the always-loaded rules that
 * shape how an unattended Lisa session works.
 *
 * The 2026-11 rewrite merged nine older heads into four: `ownership` (was
 * do-it-now + upstream-to-lisa), `when-to-stop` (was settled-decisions +
 * not-blocked-just-waiting + tool-access-gate), `communication` (was
 * report-actionability + session-status-updates), and the new
 * `production-verifiability`. The retired heads keep their reference bodies,
 * reachable from the rule index, so skills that cite them by slug still resolve.
 *
 * These rules load on EVERY session for EVERY agent, so the tests pin the
 * instruction each exists to give, the instructions deliberately removed, and
 * the fact that each reaches the generated agent surfaces.
 *
 * The `plugins/lisa` root is included so a source edit that was never fanned out
 * through `bun run build:plugins` fails here rather than shipping half-delivered.
 */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const OWNERSHIP = "ownership";
const WHEN_TO_STOP = "when-to-stop";
const COMMUNICATION = "communication";
const PRODUCTION_VERIFIABILITY = "production-verifiability";

/** Rules the pack modifies rather than introduces. */
const WIKI_KNOWLEDGE_SOURCE = "wiki-knowledge-source";
const FALSIFIABLE_CHECKS = "falsifiable-checks";

const PACK_SLUGS = [
  OWNERSHIP,
  WHEN_TO_STOP,
  COMMUNICATION,
  PRODUCTION_VERIFIABILITY,
] as const;

/** Heads retired from the eager tier whose reference bodies must stay indexed. */
const RETIRED_HEADS = [
  "do-it-now",
  "upstream-to-lisa",
  "settled-decisions",
  "not-blocked-just-waiting",
  "tool-access-gate",
  "report-actionability",
  "session-status-updates",
  "local-ci-first",
  "intent-routing",
  "tracked-work",
  "stale-state-claims",
  "measurement-integrity",
  "integration-access-layer",
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
      expect(eager).toContain(`(../reference/${slug}.md)`);
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

  describe.each(RETIRED_HEADS)("retired head %s", slug => {
    it("no longer loads eagerly but stays reachable from the index", () => {
      expect(existsSync(path.resolve(root, `rules/eager/${slug}.md`))).toBe(
        false
      );
      expect(existsSync(path.resolve(root, `rules/reference/${slug}.md`))).toBe(
        true
      );
      expect(eagerOf(root, "00-rule-index")).toContain(`reference/${slug}.md`);
    });
  });

  it("ownership is bounded to code the change touches or depends on", () => {
    const eager = eagerOf(root, OWNERSHIP);
    expect(eager).toContain("owner and long-term maintainer");
    expect(eager).toContain("touches or depends on");
    expect(eager).toContain("Also fixed");
    expect(eager).toContain("build-ready ticket");
    expect(eager).toContain("upstream on Lisa");
  });

  it("when-to-stop names exactly three reasons and the flow's own exit", () => {
    const eager = eagerOf(root, WHEN_TO_STOP);
    expect(eager).toContain("Missing access");
    expect(eager).toContain("Product ambiguity");
    expect(eager).toContain("dangerous operation");
    expect(eager).toContain("blocked or needs-human exit");
    expect(eager).toContain("need no approval");
  });

  it("when-to-stop no longer prescribes timed polling", () => {
    // Claude Code notifies on background completion; a fixed 5-minute poll
    // contradicted the harness and wasted turns.
    for (const text of [
      eagerOf(root, WHEN_TO_STOP),
      referenceOf(root, "not-blocked-just-waiting"),
    ])
      expect(text).not.toMatch(/every (5|five) minutes/i);
  });

  it("when-to-stop keeps the standing-rulings re-read at the escalation boundary", () => {
    expect(eagerOf(root, WHEN_TO_STOP)).toContain("re-read `AGENTS.md`");
    expect(referenceOf(root, WHEN_TO_STOP)).toContain("## Standing rulings");
  });

  it("communication writes for a low-context reader and accounts for scope", () => {
    const eager = eagerOf(root, COMMUNICATION);
    expect(eager).toContain("may not be technical");
    expect(eager).toContain("recommendation");
    expect(eager).toMatch(/6 findings: 3 fixed/);
  });

  it("communication dropped the close line and the hard sentence cap", () => {
    for (const text of [
      eagerOf(root, COMMUNICATION),
      referenceOf(root, "session-status-updates"),
    ]) {
      expect(text).not.toContain("Safe to close");
      expect(text).not.toMatch(/20 words/);
    }
  });

  it("production-verifiability is tool-neutral and names the PR sections", () => {
    const eager = eagerOf(root, PRODUCTION_VERIFIABILITY);
    expect(eager).toContain("How we'll know it works in production");
    expect(eager).toContain("How to undo");
    expect(eager).toContain("wherever it sends data");
    for (const vendor of ["Sentry", "CloudWatch", "Datadog", "PostHog"])
      expect(eager).not.toContain(vendor);
  });

  it("wiki-knowledge-source is query-on-demand, not consult-first", () => {
    const eager = eagerOf(root, WIKI_KNOWLEDGE_SOURCE);
    expect(eager).toContain("Do not load the wiki at session start");
    expect(eager).not.toContain("Consult the wiki first");
    expect(eager).not.toContain("authoritative answer");
  });

  it("wiki-knowledge-source names the required knowledge role, not an optional install", () => {
    // The rule ships in base while lisa-wiki-query ships in the wiki plugin.
    // That stopped dangling when the wiki became the required `knowledge`
    // role's default backend: every project now installs the query skill, so
    // the rule no longer needs an applicability escape hatch or a bootstrap.
    for (const text of [
      eagerOf(root, WIKI_KNOWLEDGE_SOURCE),
      referenceOf(root, WIKI_KNOWLEDGE_SOURCE),
    ]) {
      expect(text).toContain("`knowledge` role");
      expect(text).not.toContain("lisa-wiki-install");
      expect(text).not.toContain("mirror");
    }
  });

  it("falsifiable-checks keeps the inert-guard reading", () => {
    // The full contract lives in tests/unit/strategies/falsifiable-checks-rule.test.ts.
    const eager = eagerOf(root, FALSIFIABLE_CHECKS);
    expect(eager).toContain("Zero failures means the guard is inert");
  });

  it("falsifiable-checks forbids narrating a red state that was never run", () => {
    expect(eagerOf(root, FALSIFIABLE_CHECKS)).toContain(
      "Do not narrate a failing state you did not run"
    );
    expect(referenceOf(root, FALSIFIABLE_CHECKS)).toContain(
      "detached-HEAD worktree"
    );
  });

  it("empirical-inquiry requires establishing branch position before a diff", () => {
    const eager = eagerOf(root, "empirical-inquiry");
    expect(eager).toContain("git rev-list --count HEAD..origin/");
  });

  it("config-resolution points at the secrets contract without copying it", () => {
    const eager = eagerOf(root, "config-resolution");
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
