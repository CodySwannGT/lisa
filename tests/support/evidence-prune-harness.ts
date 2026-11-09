/**
 * Shared fixtures for the evidence-prune suites: a disposable project, a seeded
 * evidence release covering every rule, and a CLI runner that captures output
 * (CodySwannGT/lisa#4720).
 * @module tests/support/evidence-prune-harness
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main } from "../../all/copy-overwrite/scripts/lisa-evidence-prune.mjs";
import { fakeGitHub, sha256 } from "./evidence-prune-fake-gh.js";

export const NOW = new Date("2026-11-20T00:00:00Z");
export const RELEASE = "pr-assets";
export const ARCHIVE = "pr-assets-archive-2026-11";
export const OLD = "2026-10-01T00:00:00Z";
export const RECORD_AT = "2026-11-10T00:00:00Z";
export const NEARLY_FULL = `Archive release ${ARCHIVE} is nearly full (950 of GitHub's 1000-file limit); re-run next month or pass --archive-release <name>.`;
export const APPLY = "--apply";
export const JSON_FLAG = "--json";
export const STALE = "stale.txt";
export const MONTHLY = "pr-assets-2026-11";
export const ROTATING = "pr-assets-{YYYY-MM}";
export const RECORD_NAME = `completion-ab12-r1-${"c".repeat(64)}.json`;

/** The fake GitHub type every suite drives. */
export type FakeGitHub = ReturnType<typeof fakeGitHub>;

const directories: string[] = [];

/** Remove every project directory created since the last cleanup. */
export function cleanupProjects(): void {
  directories.splice(0).forEach(dir => rmSync(dir, { recursive: true }));
}

/**
 * A disposable project directory holding a `.lisa.config.json`.
 * @param config - The Lisa config to write.
 * @returns The directory path.
 */
export function project(config: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "evidence-prune-"));
  directories.push(dir);
  writeFileSync(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({ github: { org: "acme", repo: "code" }, ...config })
  );
  return dir;
}

/**
 * A completion record body pinning the given asset ids and sha256 digests.
 * @param ids - Asset ids the record names.
 * @param digests - sha256 digests the record names.
 * @returns The record's JSON text.
 */
export function recordBody(ids: number[], digests: string[] = []): string {
  return JSON.stringify({
    evidence: [
      ...ids.map(id => ({ asset_id: id })),
      ...digests.map(digest => ({ nested: { sha256: digest } })),
    ],
    supersedes: "d".repeat(64),
  });
}

/**
 * A release with every kind of file the rules distinguish: one pinned by
 * asset id, one by sha256, the record itself, one superseded stale file, one
 * uploaded after the newest record, and one younger than 14 days.
 * @param gh - The fake GitHub to seed.
 * @param tag - The evidence release tag.
 * @returns The seeded assets by role.
 */
export function seed(gh: FakeGitHub, tag = RELEASE) {
  const byId = gh.addAsset(tag, "screenshot-by-id.png", OLD);
  const bySha = gh.addAsset(tag, "log-by-sha.txt", OLD);
  const stale = gh.addAsset(tag, STALE, OLD);
  const afterRecord = gh.addAsset(
    tag,
    "after-record.txt",
    "2026-11-15T00:00:00Z"
  );
  const young = gh.addAsset(tag, "young.txt", "2026-11-08T00:00:00Z");
  const record = gh.addAsset(
    tag,
    RECORD_NAME,
    RECORD_AT,
    recordBody([byId.id], [sha256(bySha.bytes)])
  );
  return { byId, bySha, stale, afterRecord, young, record };
}

/**
 * Run the CLI once, capturing what it printed.
 * @param gh - The fake GitHub.
 * @param args - CLI arguments.
 * @param cwd - The project directory.
 * @returns Exit code and captured output.
 */
export async function prune(
  gh: FakeGitHub,
  args: string[] = [],
  cwd = project()
) {
  const lines: string[] = [];
  const code = await main(args, {
    run: gh.run,
    now: NOW,
    cwd,
    env: {},
    out: (line: string) => lines.push(line),
  });
  return { code, output: lines.join("\n") };
}
