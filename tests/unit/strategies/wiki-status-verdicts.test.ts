/**
 * Verdict-derivation regression coverage for Lisa wiki source freshness reporting.
 *
 * Companion to wiki-status-report-rendering.test.ts — splits out the
 * verdict matrix tests so each file stays under the project max-lines bar.
 * @module tests/unit/strategies/wiki-status-verdicts
 */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWikiFreshnessReport } from "../../../plugins/src/wiki/scripts/wiki-status.mjs";
import {
  FIXTURE_NOW,
  NO_PROJECT_MEMORY_REASON,
  addConnector,
  cleanupWikiFixtures,
  makeWikiFixture,
  readUtf8,
  writeJson,
  writeText,
} from "../../helpers/__fixtures__/wiki-status-fixture";

afterEach(() => {
  cleanupWikiFixtures();
});

describe("wiki-status verdict derivation (#930)", () => {
  it("recommends targeted ingest when enabled connector state or source evidence is absent", () => {
    const fixture = makeWikiFixture();
    addConnector(fixture.configPath, "docs");

    const report = createWikiFreshnessReport({
      configPath: fixture.configPath,
      wikiRoot: fixture.wikiRoot,
      now: new Date(FIXTURE_NOW),
    });

    expect(report.items).toContainEqual(
      expect.objectContaining({
        connector: "docs",
        verdict: "never_ingested",
        nextAction: "Run /lisa-wiki:ingest --source docs.",
      })
    );
  });

  it("derives fresh, stale, never-ingested, skipped, and blocked verdicts from fixture evidence", () => {
    const fixture = makeWikiFixture();
    const oldConnector = "confluence";
    const blockedConnector = "jira";

    addConnector(fixture.configPath, oldConnector);
    addConnector(fixture.configPath, "docs");
    addConnector(fixture.configPath, blockedConnector);
    writeText(
      path.join(
        fixture.wikiRoot,
        `sources/${oldConnector}/2026-05-10-space.md`
      ),
      "# Confluence source\n"
    );
    writeJson(
      path.join(fixture.wikiRoot, `state/${oldConnector}/latest.json`),
      {
        connector: oldConnector,
        ingested_at: "2026-05-10T09:00:00.000Z",
        source_notes: [`wiki/sources/${oldConnector}/2026-05-10-space.md`],
      }
    );
    writeText(
      path.join(fixture.wikiRoot, "log.md"),
      `${readUtf8(path.join(fixture.wikiRoot, "log.md"))}\n## 2026-05-26 - Connector blockers\n\n- Blocked \`${blockedConnector}\` because Atlassian MCP credentials are missing.\n`
    );

    const report = createWikiFreshnessReport({
      configPath: fixture.configPath,
      wikiRoot: fixture.wikiRoot,
      now: new Date(FIXTURE_NOW),
    });

    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ connector: "git", verdict: "fresh" }),
        expect.objectContaining({
          connector: oldConnector,
          verdict: "stale",
          lastObserved: "2026-05-10",
          nextAction: `Run /lisa-wiki:ingest --source ${oldConnector}.`,
        }),
        expect.objectContaining({
          connector: "docs",
          verdict: "never_ingested",
          nextAction: "Run /lisa-wiki:ingest --source docs.",
        }),
        expect.objectContaining({
          connector: "memory",
          verdict: "skipped",
          reason: expect.stringContaining(NO_PROJECT_MEMORY_REASON),
          nextAction:
            "Provide project-scoped memory for this repo, or accept the expected skip.",
        }),
        expect.objectContaining({
          connector: blockedConnector,
          verdict: "blocked",
          reason: expect.stringContaining("Atlassian MCP credentials"),
          nextAction: `Resolve the blocker, then run /lisa-wiki:ingest --source ${blockedConnector}.`,
        }),
      ])
    );
  });
});
