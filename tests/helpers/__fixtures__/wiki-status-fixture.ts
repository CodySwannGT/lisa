/**
 * Shared fixture helpers for wiki-status report tests.
 * @module tests/helpers/__fixtures__/wiki-status-fixture
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

export const READ_ONLY_INGEST = "read-only-ingest";
export const FIXTURE_NOW = "2026-05-26T12:00:00.000Z";
export const FIXTURE_DATE = "2026-05-25";
export const GIT_SOURCE_NOTE =
  "wiki/sources/git/2026-05-25-lisa-monorepo-git.md";
export const ROLES_SOURCE_NOTE = "wiki/sources/roles/2026-05-25-roles.md";
export const NO_PROJECT_MEMORY_REASON =
  "no provably project-scoped memory directory";
export const NO_ACTION_NEEDED = "No action needed.";
export const WIKI_LOG_PATH = "wiki/log.md";

const tempRoots: string[] = [];

export const readUtf8 = (filePath: string): string =>
  readFileSync(filePath, "utf8");

export const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeText = (filePath: string, value: string): void => {
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

export const listFiles = (root: string): string[] => {
  const files: string[] = [];
  appendFiles(root, root, files);
  return files.sort((a, b) => a.localeCompare(b));
};

/**
 * Build a minimal wiki fixture with fresh git/roles sources and skipped memory.
 * @returns Fixture root paths.
 */
export function makeWikiFixture(): {
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

## ${FIXTURE_DATE} - Full connector ingest

- Ingested \`git\` into \`${GIT_SOURCE_NOTE}\` and \`roles\` into \`${ROLES_SOURCE_NOTE}\`.
- Skipped \`memory\` because ${NO_PROJECT_MEMORY_REASON} was available for this repository in the current runtime.
`
  );
  writeText(path.join(wikiRoot, GIT_SOURCE_NOTE), "# Git source\n");
  writeText(path.join(wikiRoot, ROLES_SOURCE_NOTE), "# Roles source\n");
  writeJson(path.join(wikiRoot, "state/git/latest.json"), {
    connector: "git",
    ingested_at: `${FIXTURE_DATE}T12:00:00.000Z`,
    source_notes: [GIT_SOURCE_NOTE],
  });
  writeJson(path.join(wikiRoot, "state/roles/latest.json"), {
    connector: "roles",
    ingested_at: `${FIXTURE_DATE}T12:00:00.000Z`,
    source_notes: [ROLES_SOURCE_NOTE],
  });

  return { root, wikiRoot, configPath };
}

/**
 * Add a read-only connector to the fixture config.
 * @param configPath Fixture config file path.
 * @param connector Connector key to enable.
 * @param connectorConfig Connector configuration override.
 */
export function addConnector(
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

/**
 * Remove every fixture root created during this test run.
 */
export function cleanupWikiFixtures(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}
