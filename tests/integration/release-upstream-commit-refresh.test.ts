/**
 * A release refreshes the commit list `lisa file-upstream` accepts
 * (CodySwannGT/lisa#4960).
 *
 * The list is built into the package and was extended by exactly one command,
 * which nothing ran. So every commit made after the last manual refresh was
 * refused, and an upstream filing that cited recent history could not complete.
 *
 * These cases cut a release in a scratch repository — real `standard-version`,
 * the hook text from `.versionrc`, the shipped generator — and then ask the
 * shipped `file-upstream` command, loaded from that released tree, whether it
 * accepts the commit the release was cut from.
 * @module tests/integration/release-upstream-commit-refresh
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  createReleaseFixture,
  cutRelease,
  EVIDENCE_FILE,
  EVIDENCE_TEXT,
  GENERATOR,
  git,
  listedCommits,
  MANIFEST_PATH,
  publish,
  type ReleaseFixture,
  runNode,
  shippedCommits,
} from "../helpers/upstream-commit-release-fixture.js";

useIoLatencyBudget();

const REFRESH_COMMAND = `node ${GENERATOR} --refresh-public-commits`;
const fixtures: ReleaseFixture[] = [];

/** The released command's entry point. */
type RunFileUpstream = (
  options: { readonly input?: string },
  dependencies: {
    readonly error: (message: string) => void;
    readonly log: (message: string) => void;
    readonly readStdin: () => Promise<string>;
  }
) => Promise<number>;

/** What one `file-upstream` run printed and returned. */
interface FilingOutcome {
  readonly code: number;
  readonly out: string;
  readonly errors: string;
}

/**
 * A fresh scratch repository, removed when the case ends.
 * @returns The fixture
 */
function fixture(): ReleaseFixture {
  const created = createReleaseFixture();
  fixtures.push(created);
  return created;
}

/**
 * Run the `file-upstream` command shipped in a fixture's tree against one
 * commit reference.
 * @param root - Fixture root holding the released package
 * @param commit - Full SHA the filing event cites
 * @returns Exit code and captured streams
 */
async function fileUpstream(
  root: string,
  commit: string
): Promise<FilingOutcome> {
  const moduleUrl = `${
    pathToFileURL(path.join(root, "src/cli/file-upstream-cmd.ts")).href
  }?fixture=${encodeURIComponent(root)}`;
  const imported = (await import(moduleUrl)) as {
    readonly runFileUpstream: RunFileUpstream;
  };
  const out: string[] = [];
  const errors: string[] = [];
  const code = await imported.runFileUpstream(
    {},
    {
      error: message => errors.push(message),
      log: message => out.push(message),
      readStdin: async () =>
        JSON.stringify({
          documentKind: "issue",
          failureClass: "workflow-contract-violation",
          lisaOwnedExcerpts: [{ file: EVIDENCE_FILE, text: EVIDENCE_TEXT }],
          lisaSurface: EVIDENCE_FILE,
          redactedPlaceholders: ["<host-project>"],
          upstreamCommitRefs: [commit],
        }),
    }
  );
  return { code, out: out.join("\n"), errors: errors.join("\n") };
}

afterEach(() => {
  for (const created of fixtures.splice(0)) {
    rmSync(created.root, { force: true, recursive: true });
  }
});

describe("the public-commit list between releases", () => {
  it("stays behind HEAD while the ordinary manifest check passes", () => {
    const { root, commits } = fixture();

    expect(runNode(root, GENERATOR, "--check").status).toBe(0);
    expect(listedCommits(root)).toEqual(
      expect.arrayContaining([commits.first, commits.second])
    );
    expect(listedCommits(root)).not.toContain(commits.tip);
  });
});

describe("cutting a release", () => {
  it("commits a list holding the commit the release was cut from", () => {
    const { root, commits } = fixture();

    const release = cutRelease(root);

    expect(`${release.stdout}${release.stderr}`).toContain("committing");
    expect(release.status).toBe(0);
    expect(git(root, "rev-parse", "HEAD^")).toBe(commits.tip);
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toContain(
      MANIFEST_PATH
    );
    const shipped = shippedCommits(git(root, "show", `HEAD:${MANIFEST_PATH}`));
    expect(shipped).toEqual(expect.arrayContaining(Object.values(commits)));
    // Nothing the hook produced was left out of the release commit, and the
    // released tree still satisfies the ordinary manifest check.
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(runNode(root, GENERATOR, "--check").status).toBe(0);
  });

  it("stops, naming the refresh command, when that commit is not public", () => {
    const { root, commits } = fixture();
    // The tip was never pushed: origin still names the commit before it.
    publish(root, commits.recorded);

    const release = cutRelease(root);

    expect(release.status).not.toBe(0);
    expect(`${release.stdout}${release.stderr}`).toContain(REFRESH_COMMAND);
    expect(`${release.stdout}${release.stderr}`).toContain(commits.tip);
    expect(git(root, "rev-parse", "HEAD")).toBe(commits.tip);
    expect(git(root, "diff", "--cached", "--name-only")).not.toContain(
      MANIFEST_PATH
    );
  });
});

describe("file-upstream in a released package", () => {
  it("accepts the release commit's parent and prints the issue body", async () => {
    const { root, commits } = fixture();
    expect(cutRelease(root).status).toBe(0);

    const filing = await fileUpstream(root, git(root, "rev-parse", "HEAD^"));

    expect(filing.errors).toBe("");
    expect(filing.code).toBe(0);
    expect(filing.out).toContain("[lisa-upstream-attribution]");
    expect(filing.out).toContain(EVIDENCE_TEXT);
    expect(filing.out).toContain(commits.tip);
  });

  it("still rejects a commit no public origin ref reaches", async () => {
    const { root } = fixture();
    git(root, "switch", "--create", "local-only");
    git(root, "commit", "--allow-empty", "-m", "chore: never pushed");
    const unpublished = git(root, "rev-parse", "HEAD");
    git(root, "switch", "main");
    expect(cutRelease(root).status).toBe(0);

    const filing = await fileUpstream(root, unpublished);

    expect(filing.code).not.toBe(0);
    expect(filing.out).toBe("");
    expect(filing.errors).toContain("upstreamCommitRefs");
  });
});
