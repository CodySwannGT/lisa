/**
 * Lisa does not distribute a Dependabot configuration.
 *
 * The TypeScript template used to ship `.github/dependabot.yml` with a
 * hardcoded `target-branch: dev`, and that file reached every TypeScript
 * project regardless of the branch names the project actually uses. On a
 * repository whose only branch is `main` there is no branch for Dependabot to
 * target, so the config never opened a single pull request — and the failure
 * mode is silence. Zero open Dependabot PRs reads as restraint rather than as
 * a broken config, which is why it went unnoticed.
 *
 * This repository is the citable instance: its own `.github/dependabot.yml`
 * carried `target-branch: dev`, `refs/heads/dev` does not exist here, and no
 * Dependabot pull request has ever been opened against it.
 *
 * The `harper-fabric` template had already discovered the same problem and
 * shipped a comment-documented override that omitted `target-branch` — a
 * per-stack workaround for a default that should not have been imposed.
 *
 * Dependency-update policy belongs to the host project. Lisa's supply-chain
 * readiness check already accepts a CI or hook audit gate as an alternative
 * confidence model, so refusing to ship this file costs the readiness bar
 * nothing.
 *
 * These tests are a delivery-root sweep rather than a pin on two known paths,
 * so a Dependabot config reintroduced into any stack — including one added
 * later — fails here without anyone remembering to extend the list.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  COPY_STRATEGIES,
  PROJECT_TYPE_ORDER,
} from "../../../src/core/config.js";
import {
  UPSTREAM_EVIDENCE_MANIFEST,
  UPSTREAM_SURFACE_MANIFEST,
} from "../../../src/core/upstream-evidence-manifest.js";

const repoRoot = process.cwd();

/** Filenames GitHub accepts as a Dependabot configuration. */
const DEPENDABOT_FILENAMES: readonly string[] = [
  "dependabot.yml",
  "dependabot.yaml",
];

/** The strategy directory that overwrites a host file on every apply. */
const COPY_OVERWRITE = "copy-overwrite";

/** Every template root whose contents Lisa delivers into a host project. */
const DELIVERY_ROOTS: readonly string[] = ["all", ...PROJECT_TYPE_ORDER]
  .flatMap(type => COPY_STRATEGIES.map(strategy => path.join(type, strategy)))
  .filter(relative => fs.pathExistsSync(path.join(repoRoot, relative)));

/**
 * Every file beneath a directory, as repository-relative paths.
 * @param absoluteDir - Directory to walk
 * @returns Repository-relative paths of every file found (empty when absent)
 */
const walkFiles = (absoluteDir: string): readonly string[] => {
  if (!fs.pathExistsSync(absoluteDir)) {
    return [];
  }

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(absoluteDir, entry.name);
    return entry.isDirectory()
      ? walkFiles(absolute)
      : [path.relative(repoRoot, absolute)];
  });
};

/**
 * Whether a repository-relative path names a Dependabot configuration.
 * @param relativePath - Repository-relative path
 * @returns True when the file's basename is a Dependabot config filename
 */
const isDependabotConfig = (relativePath: string): boolean =>
  DEPENDABOT_FILENAMES.includes(path.basename(relativePath));

describe("Lisa does not distribute a Dependabot configuration", () => {
  it("enumerates delivery roots so the sweep cannot be vacuous", () => {
    expect(DELIVERY_ROOTS.length).toBeGreaterThan(5);
    expect(DELIVERY_ROOTS).toContain(path.join("typescript", COPY_OVERWRITE));
    expect(DELIVERY_ROOTS).toContain(
      path.join("harper-fabric", COPY_OVERWRITE)
    );
  });

  it.each(DELIVERY_ROOTS)("ships no Dependabot config under %s", root => {
    const offenders = walkFiles(path.join(repoRoot, root)).filter(
      isDependabotConfig
    );

    expect(offenders).toEqual([]);
  });

  it("records no Dependabot config in the upstream evidence manifests", () => {
    const hashed = Object.keys(UPSTREAM_EVIDENCE_MANIFEST).filter(
      isDependabotConfig
    );
    const surfaced = Object.keys(UPSTREAM_SURFACE_MANIFEST).filter(
      isDependabotConfig
    );

    expect(hashed).toEqual([]);
    expect(surfaced).toEqual([]);
  });

  it("does not promise the file in the distributed GitHub Actions guide", () => {
    const guide = fs.readFileSync(
      path.join(
        repoRoot,
        "typescript",
        COPY_OVERWRITE,
        ".github",
        "GITHUB_ACTIONS.md"
      ),
      "utf-8"
    );

    // The bot-loop guard legitimately names `dependabot[bot]` as a PR author to
    // skip, which is about other people's bots and is not a promise to ship a
    // config. Only the delivered-file tree is asserted against.
    expect(guide).not.toMatch(/dependabot\.ya?ml/);
  });
});
