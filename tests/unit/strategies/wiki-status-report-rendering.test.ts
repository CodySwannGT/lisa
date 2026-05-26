/**
 * Regression coverage for Lisa wiki source freshness reporting.
 *
 * Issue #930 adds the deterministic report renderer that future command and
 * skill surfaces can call without mutating the wiki.
 * @module tests/unit/strategies/wiki-status-report-rendering
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWikiFreshnessReport,
  renderWikiFreshnessReport,
} from "../../../plugins/src/wiki/scripts/wiki-status.mjs";

const SOURCE_PLUGIN_ROOT = path.resolve("plugins/src/wiki");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa-wiki");
const READ_ONLY_INGEST = "read-only-ingest";
const FIXTURE_NOW = "2026-05-26T12:00:00.000Z";

const tempRoots: string[] = [];

const readUtf8 = (filePath: string): string => readFileSync(filePath, "utf8");

const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeText = (filePath: string, value: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

const appendFiles = (root: string, current: string, files: string[]): void => {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) appendFiles(root, fullPath, files);
    if (entry.isFile()) files.push(path.relative(root, fullPath));
  }
};

const listFiles = (root: string): string[] => {
  const files: string[] = [];
  appendFiles(root, root, files);
  return files.sort((a, b) => a.localeCompare(b));
};

/**
 * Build a minimal wiki fixture with fresh git/roles sources and skipped memory.
 * @returns Fixture root paths.
 */
function makeWikiFixture(): {
  root: string;
  wikiRoot: string;
  configPath: string;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-wiki-status-"));
  const wikiRoot = path.join(root, "wiki");
  const configPath = path.join(wikiRoot, "lisa-wiki.config.json");
  tempRoots.push(root);

  writeJson(configPath, {
    schemaVersion: "1.0.0",
    org: "Lisa",
    mode: "embedded",
    wikiRoot,
    categories: ["projects"],
    connectors: {
      git: { enabled: true, sideEffects: READ_ONLY_INGEST },
      memory: { enabled: true, sideEffects: READ_ONLY_INGEST },
      roles: { enabled: true, sideEffects: READ_ONLY_INGEST },
    },
  });
  writeText(
    path.join(wikiRoot, "log.md"),
    `# Lisa Wiki Log

## 2026-05-25 - Full connector ingest

- Ingested \`git\` into \`wiki/sources/git/2026-05-25-lisa-monorepo-git.md\` and \`roles\` into \`wiki/sources/roles/2026-05-25-roles.md\`.
- Skipped \`memory\` because no provably project-scoped memory directory was available for this repository in the current runtime.
`
  );
  writeText(
    path.join(wikiRoot, "sources/git/2026-05-25-lisa-monorepo-git.md"),
    "# Git source\n"
  );
  writeText(
    path.join(wikiRoot, "sources/roles/2026-05-25-roles.md"),
    "# Roles source\n"
  );
  writeJson(path.join(wikiRoot, "state/git/latest.json"), {
    connector: "git",
    ingested_at: "2026-05-25T12:00:00.000Z",
    source_notes: ["wiki/sources/git/2026-05-25-lisa-monorepo-git.md"],
  });
  writeJson(path.join(wikiRoot, "state/roles/latest.json"), {
    connector: "roles",
    ingested_at: "2026-05-25T12:00:00.000Z",
    source_notes: ["wiki/sources/roles/2026-05-25-roles.md"],
  });

  return { root, wikiRoot, configPath };
}

/**
 * Add a read-only connector to the fixture config.
 * @param configPath Fixture config file path.
 * @param connector Connector key to enable.
 * @param connectorConfig Connector configuration override.
 */
function addConnector(
  configPath: string,
  connector: string,
  connectorConfig: Record<string, unknown> = {
    enabled: true,
    sideEffects: READ_ONLY_INGEST,
  }
): void {
  const config = JSON.parse(readUtf8(configPath)) as {
    connectors: Record<string, unknown>;
  };
  config.connectors[connector] = connectorConfig;
  writeJson(configPath, config);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("wiki-status report rendering (#930)", () => {
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
          nextAction: "No action needed.",
        }),
        expect.objectContaining({
          connector: "roles",
          verdict: "fresh",
          nextAction: "No action needed.",
        }),
        expect.objectContaining({
          connector: "memory",
          verdict: "skipped",
          nextAction:
            "Provide project-scoped memory for this repo, or accept the expected skip.",
        }),
      ])
    );
    expect(text).toContain("| git | fresh | 2026-05-25 |");
    expect(text).toContain("wiki/sources/git/2026-05-25-lisa-monorepo-git.md");
    expect(text).toContain("no provably project-scoped memory directory");
    expect(text).toContain(
      "Integrity follow-up: run /lisa-wiki:lint separately"
    );
    expect(listFiles(fixture.root)).toEqual(before);
  });

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
          reason: expect.stringContaining(
            "no provably project-scoped memory directory"
          ),
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

describe("wiki-status source/generated parity (#930)", () => {
  it("keeps the distributed status script in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", "wiki-status.mjs"))
    ).toBe(
      readUtf8(path.join(SOURCE_PLUGIN_ROOT, "scripts", "wiki-status.mjs"))
    );
  });
});
