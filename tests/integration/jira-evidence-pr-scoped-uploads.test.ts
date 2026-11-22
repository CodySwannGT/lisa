/**
 * Two pull requests' Jira evidence must both survive in the shared release.
 *
 * `post-evidence.sh` uploads into the one `pr-assets` release every pull
 * request shares. It used to upload each file under its bare name with
 * `--clobber`, so PR 102's `01-search-step-desktop.png` deleted PR 101's, and
 * PR 101's description silently showed PR 102's screenshot
 * (CodySwannGT/lisa#4639). These cases run the three source scripts, unmodified,
 * against a `gh` stub that keeps a real release directory, and assert the
 * names, the contents, and the refusals the fix promises.
 * @module tests/integration/jira-evidence-pr-scoped-uploads
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  DESCRIPTION_UPDATED,
  HEALTH,
  RELEASE,
  SHOT,
  SOURCES,
  cleanupRuns,
  prepareRepository,
  runFor,
} from "./support/jira-evidence-run.js";
import {
  recordedUploads,
  releaseAsset,
  releaseAssets,
} from "./support/recording-gh-stub.js";

afterEach(cleanupRuns);

describe.each(SOURCES)("pull-request-scoped evidence uploads: %s", script => {
  it("keeps both pull requests' same-named evidence", () => {
    const repo = prepareRepository();

    expect(runFor(repo, script, "101").status).toBe(0);
    expect(runFor(repo, script, "102").status).toBe(0);

    expect(releaseAssets(repo.state)).toEqual([
      `pr-101-${HEALTH}`,
      `pr-101-${SHOT}`,
      `pr-102-${HEALTH}`,
      `pr-102-${SHOT}`,
    ]);
    expect(releaseAsset(repo.state, `pr-101-${SHOT}`)).toBe("101\n");
    expect(releaseAsset(repo.state, `pr-102-${SHOT}`)).toBe("102\n");
  });

  it("records only pull-request-scoped upload names", () => {
    const repo = prepareRepository();
    runFor(repo, script, "101");
    runFor(repo, script, "102");

    const uploads = recordedUploads(repo.state);
    expect(uploads).toHaveLength(4);
    for (const line of uploads) {
      expect(line).toMatch(/\/pr-10[12]-01-[a-z-]+\.(png|json) /);
      expect(line).not.toMatch(new RegExp(`/(${SHOT}|${HEALTH}) `));
    }
  });

  it("replaces only its own pull request's evidence on a re-run", () => {
    const repo = prepareRepository();
    runFor(repo, script, "101");
    runFor(repo, script, "102");

    expect(runFor(repo, script, "101", { tag: "rerun" }).status).toBe(0);

    expect(releaseAsset(repo.state, `pr-101-${SHOT}`)).toBe("rerun\n");
    expect(releaseAsset(repo.state, `pr-102-${SHOT}`)).toBe("102\n");
    expect(releaseAssets(repo.state)).toHaveLength(4);
  });

  it.each(["0", "-1", "abc", "1.5", "", "01"])(
    "refuses pull request number %j before any upload",
    pr => {
      const repo = prepareRepository();
      const result = runFor(repo, script, pr);

      expect(result.status).not.toBe(0);
      expect(recordedUploads(repo.state)).toEqual([]);
    }
  );

  it("fails naming an asset missing from the release after upload", () => {
    const repo = prepareRepository();
    const missing = `pr-101-${SHOT}`;
    const result = runFor(repo, script, "101", { drop: missing });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(missing);
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("refuses an evidence name GitHub would rewrite, before any upload", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      files: ["01-search step-desktop.png", HEALTH],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("01-search step-desktop.png");
    expect(result.stderr).toContain("Rename it");
    expect(recordedUploads(repo.state)).toEqual([]);
  });
});

describe.each(SOURCES)("description links match the release: %s", script => {
  it.each([
    ["a bare name", `${RELEASE}/${SHOT}`],
    ["another pull request's name", `${RELEASE}/pr-102-${SHOT}`],
  ])("fails naming a description link to %s", (_kind, link) => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: `## Evidence\n\n![Shot](${link})\n`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(link.slice(link.indexOf("releases/")));
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("accepts a description linking only this pull request's assets", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: `## Evidence\n\n![Shot](${RELEASE}/pr-101-${SHOT})\n`,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });

  it("fails naming a link to a stale asset an earlier run left behind", () => {
    const repo = prepareRepository();
    const stale = `${RELEASE}/pr-101-${SHOT}`;
    expect(runFor(repo, script, "101").status).toBe(0);

    const result = runFor(repo, script, "101", {
      tag: "rerun",
      files: [HEALTH],
      commentMd: `## Evidence\n\n![Shot](${stale})\n`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(stale);
    expect(result.stderr).toContain("did not upload");
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("ignores a release URL quoted as plain text in inlined evidence", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: [
        "## Evidence",
        "",
        "```text",
        "fetched releases/download/pr-assets/foo.txt",
        "```",
        "",
      ].join("\n"),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });

  it("checks links against the resolved release, not a literal pr-assets", () => {
    // #4692 lets the release rotate; the link check must follow RELEASE_TAG.
    const rotated =
      "https://github.com/org/repo/releases/download/pr-assets-2026-10";
    const repo = prepareRepository();
    const bare = runFor(repo, script, "101", {
      release: "pr-assets-2026-10",
      commentMd: `![Shot](${rotated}/${SHOT})\n`,
    });
    const scoped = runFor(repo, script, "101", {
      tag: "scoped",
      release: "pr-assets-2026-10",
      commentMd: `![Shot](${rotated}/pr-101-${SHOT})\n`,
    });

    expect(bare.status).not.toBe(0);
    expect(bare.stderr).toContain(`pr-assets-2026-10/${SHOT}`);
    expect(scoped.status, scoped.stderr).toBe(0);
  });
});
