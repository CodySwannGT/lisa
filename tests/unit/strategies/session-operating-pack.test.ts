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
 * These rules load on EVERY session for EVERY agent, so the tests pin their
 * structure: each ships as a paired head and body, each head stays within its
 * size budget, retired heads stay indexed, and each reaches the generated
 * agent surfaces. The instructions themselves are guidance and are reviewed,
 * not pinned (#4867).
 *
 * The `plugins/lisa` root is included so a source edit that was never fanned out
 * through `bun run build:plugins` fails here rather than shipping half-delivered.
 */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const OWNERSHIP = "ownership";
const WHEN_TO_STOP = "when-to-stop";
const COMMUNICATION = "communication";
const PRODUCTION_VERIFIABILITY = "production-verifiability";

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

    it("breadcrumbs the eager head to its reference body", () => {
      const eager = eagerOf(root, slug);
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
