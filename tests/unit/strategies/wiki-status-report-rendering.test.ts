/**
 * Regression coverage for Lisa wiki source freshness reporting.
 *
 * Issue #930 adds the deterministic report renderer that future command and
 * skill surfaces can call without mutating the wiki.
 * @module tests/unit/strategies/wiki-status-report-rendering
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWikiFreshnessReport,
  parseWikiSourceFreshness,
  renderWikiFreshnessReport,
} from "../../../plugins/src/wiki/scripts/wiki-status.mjs";
import {
  FIXTURE_DATE,
  FIXTURE_NOW,
  GIT_SOURCE_NOTE,
  NO_ACTION_NEEDED,
  NO_PROJECT_MEMORY_REASON,
  READ_ONLY_INGEST,
  WIKI_LOG_PATH,
  cleanupWikiFixtures,
  listFiles,
  makeWikiFixture,
  readUtf8,
} from "../../helpers/__fixtures__/wiki-status-fixture";

const SOURCE_PLUGIN_ROOT = path.resolve("plugins/src/wiki");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa-wiki");
const SOURCE_STATUS_SCRIPT = path.resolve(
  SOURCE_PLUGIN_ROOT,
  "scripts/wiki-status.mjs"
);
const GIT_BIN = "/usr/bin/git";
const CLEAN_GIT_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(CLEAN_GIT_ENV)) {
  if (key.startsWith("GIT_")) delete CLEAN_GIT_ENV[key];
}

afterEach(() => {
  cleanupWikiFixtures();
});

describe("wiki-status report rendering (#930)", () => {
  it("parses structured connector freshness records without mutating wiki files", () => {
    const fixture = makeWikiFixture();
    const before = listFiles(fixture.root);

    const parsed = parseWikiSourceFreshness({
      configPath: fixture.configPath,
      wikiRoot: fixture.wikiRoot,
      now: new Date(FIXTURE_NOW),
    });

    expect(parsed.configPath).toBe(fixture.configPath);
    expect(parsed.wikiRoot).toBe(fixture.wikiRoot);
    expect(parsed.connectors).toContainEqual(
      expect.objectContaining({
        connector: "git",
        sideEffects: READ_ONLY_INGEST,
        verdict: "fresh",
        evidencePaths: expect.arrayContaining([
          GIT_SOURCE_NOTE,
          "wiki/state/git/latest.json",
          WIKI_LOG_PATH,
        ]),
        lastObservedDate: FIXTURE_DATE,
        reason: "",
        nextAction: NO_ACTION_NEEDED,
      })
    );
    expect(parsed.connectors).toContainEqual(
      expect.objectContaining({
        connector: "memory",
        verdict: "skipped",
        evidencePaths: [WIKI_LOG_PATH],
        lastObservedDate: FIXTURE_DATE,
        reason: expect.stringContaining(NO_PROJECT_MEMORY_REASON),
      })
    );
    expect(listFiles(fixture.root)).toEqual(before);
  });

  it("reports fresh and skipped connectors with evidence paths and targeted actions", () => {
    const fixture = makeWikiFixture();
    const before = listFiles(fixture.root);

    const report = createWikiFreshnessReport({
      configPath: fixture.configPath,
      wikiRoot: fixture.wikiRoot,
      now: new Date(FIXTURE_NOW),
    });
    const text = renderWikiFreshnessReport(report);

    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connector: "git",
          verdict: "fresh",
          nextAction: NO_ACTION_NEEDED,
        }),
        expect.objectContaining({
          connector: "roles",
          verdict: "fresh",
          nextAction: NO_ACTION_NEEDED,
        }),
        expect.objectContaining({
          connector: "memory",
          verdict: "skipped",
          nextAction:
            "Provide project-scoped memory for this repo, or accept the expected skip.",
        }),
      ])
    );
    expect(text).toContain(`| git | fresh | ${FIXTURE_DATE} |`);
    expect(text).toContain(GIT_SOURCE_NOTE);
    expect(text).toContain(NO_PROJECT_MEMORY_REASON);
    expect(text).toContain(
      "Integrity follow-up: run /lisa-wiki:lint separately"
    );
    expect(listFiles(fixture.root)).toEqual(before);
  });

  it("renders from a git worktree without changing git status porcelain output (#932)", () => {
    const fixture = makeWikiFixture();
    execFileSync(GIT_BIN, ["-C", fixture.root, "init"], {
      env: CLEAN_GIT_ENV,
      stdio: "ignore",
    });
    const beforeStatus = execFileSync(
      GIT_BIN,
      ["-C", fixture.root, "status", "--porcelain"],
      { encoding: "utf8", env: CLEAN_GIT_ENV }
    );
    const beforeFiles = listFiles(fixture.root);

    const output = execFileSync(
      process.execPath,
      [
        SOURCE_STATUS_SCRIPT,
        "--config",
        fixture.configPath,
        "--wiki",
        fixture.wikiRoot,
      ],
      { cwd: fixture.root, encoding: "utf8" }
    );

    const afterStatus = execFileSync(
      GIT_BIN,
      ["-C", fixture.root, "status", "--porcelain"],
      { encoding: "utf8", env: CLEAN_GIT_ENV }
    );
    expect(output).toContain("# Lisa wiki source freshness");
    expect(afterStatus).toBe(beforeStatus);
    expect(listFiles(fixture.root)).toEqual(beforeFiles);
  });
});

describe("wiki-status source/generated parity (#930)", () => {
  it("keeps the distributed status script in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", "wiki-status.mjs"))
    ).toBe(
      readUtf8(path.join(SOURCE_PLUGIN_ROOT, "scripts", "wiki-status.mjs"))
    );
  });
});
