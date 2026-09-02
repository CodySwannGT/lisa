/**
 * @file check-release-package-identity.test.ts
 * @description Executable source, build, and pack identity checks for releases
 * @module tests/unit/scripts/check-release-package-identity.test
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertCheckoutIdentity,
  assertReleaseTag,
  packAndValidateReleaseCandidate,
} from "../../../scripts/check-release-package-identity.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const VERSION = "1.2.3";
const TAG = `v${VERSION}`;
const CERTIFICATE_FILE = "nightly-e2e-guard-behavior-certificate";
const PACKAGE_JSON = "package.json";
const PACKAGE_NAME = "release-fixture";
const GIT = resolveGit();
const roots: string[] = [];

/** Execute git in one disposable fixture and return trimmed stdout. */
function git(root: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd: root,
  }).trim();
}

/**
 * Create a tagged repository whose checked-in package already names VERSION.
 *
 * @param tagName - Ref name under refs/tags to place at the release commit
 * @returns Fixture root and its release commit
 */
function createTaggedFixture(tagName: string = TAG): {
  root: string;
  commit: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-release-identity-"));
  roots.push(root);
  writeFileSync(
    path.join(root, PACKAGE_JSON),
    `${JSON.stringify({ name: PACKAGE_NAME, version: VERSION }, null, 2)}\n`
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "release-test@example.com");
  git(root, "config", "user.name", "Release Test");
  git(root, "add", PACKAGE_JSON);
  git(root, "commit", "-q", "-m", "release fixture");
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "tag", tagName);
  return { root, commit };
}

/**
 * Add the source and built certificate plus publish-only release metadata.
 * @param root - Fixture root
 * @param releaseCommit - Immutable release commit
 * @param certificateVersion - Version encoded in the built certificate
 */
function preparePackFixture(
  root: string,
  releaseCommit: string,
  certificateVersion: string
): void {
  mkdirSync(path.join(root, "src", "core"), { recursive: true });
  mkdirSync(path.join(root, "dist", "core"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "core", `${CERTIFICATE_FILE}.ts`),
    `export const provenance = "workspace package @codyswann/lisa@${VERSION} (fixture)";\n`
  );
  writeFileSync(
    path.join(root, "dist", "core", `${CERTIFICATE_FILE}.js`),
    [
      `export const packageVersions = Object.freeze(["${certificateVersion}"]);`,
      `export const provenances = Object.freeze(["workspace package @codyswann/lisa@${certificateVersion} (fixture)"]);`,
      "",
    ].join("\n")
  );
  writeFileSync(
    path.join(root, PACKAGE_JSON),
    `${JSON.stringify(
      {
        name: PACKAGE_NAME,
        version: VERSION,
        lisaReleaseCommit: releaseCommit,
        lisaReleaseTag: TAG,
        gitHead: releaseCommit,
        scripts: { prepare: "node -e \"console.log('prepare-noise')\"" },
        files: ["dist"],
      },
      null,
      2
    )}\n`
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("release package identity", () => {
  it("accepts only a 40-hex release commit matching both HEAD and the tag", () => {
    const { root, commit } = createTaggedFixture();

    expect(
      assertCheckoutIdentity({ root, releaseCommit: commit, tag: TAG })
    ).toMatchObject({
      headCommit: commit,
      tagCommit: commit,
      durableRefs: [`refs/tags/${TAG}`],
    });
    expect(() =>
      assertCheckoutIdentity({ root, releaseCommit: "missing", tag: TAG })
    ).toThrow(/40 lowercase hexadecimal/u);
    expect(() =>
      assertCheckoutIdentity({
        root,
        releaseCommit: "0".repeat(40),
        tag: TAG,
      })
    ).toThrow(/HEAD.*does not match release commit/u);
  });

  it("rejects a tag that targets another commit after HEAD identity passes", () => {
    const { root, commit: taggedCommit } = createTaggedFixture();
    writeFileSync(
      path.join(root, PACKAGE_JSON),
      `${JSON.stringify(
        { name: PACKAGE_NAME, version: VERSION, release: true },
        null,
        2
      )}\n`
    );
    git(root, "add", PACKAGE_JSON);
    git(root, "commit", "-q", "-m", "release head");
    const releaseCommit = git(root, "rev-parse", "HEAD");

    expect(releaseCommit).not.toBe(taggedCommit);
    expect(() =>
      assertCheckoutIdentity({ root, releaseCommit, tag: TAG })
    ).toThrow(
      new RegExp(
        `tag v1\\.2\\.3 resolves ${taggedCommit}, expected ${releaseCommit}`,
        "u"
      )
    );
  });

  it("rejects a built and packed certificate from the prior version", () => {
    const { root, commit } = createTaggedFixture();
    preparePackFixture(root, commit, "1.2.2");

    expect(() =>
      packAndValidateReleaseCandidate({
        root,
        version: VERSION,
        releaseCommit: commit,
        tag: TAG,
        packDestination: path.join(root, "packed"),
      })
    ).toThrow(
      new RegExp(
        `packed certificate.*1\\.2\\.2.*expected 1\\.2\\.3.*${commit}.*${CERTIFICATE_FILE}`,
        "u"
      )
    );
  });

  it("rejects a package whose npm gitHead is not the release commit", () => {
    const { root, commit } = createTaggedFixture();
    preparePackFixture(root, commit, VERSION);
    const packagePath = path.join(root, PACKAGE_JSON);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.gitHead = "0".repeat(40);
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() =>
      packAndValidateReleaseCandidate({
        root,
        version: VERSION,
        releaseCommit: commit,
        tag: TAG,
        packDestination: path.join(root, "packed"),
      })
    ).toThrow(/package\.json gitHead.*expected/u);
  });

  it("rejects a release commit reachable from no durable ref", () => {
    // The commit is real, HEAD is on it, and a tag points at it — every shape
    // check passes. Its only anchor is a backup tag from a history rewrite,
    // which is the state a consumer cannot resolve: the pin is well formed and
    // names nothing, so the caller runs zero jobs and reports zero failures.
    const backupTag = "backup/pre-rewrite/v1.2.3";
    const { root, commit } = createTaggedFixture(backupTag);

    expect(git(root, "rev-parse", `${backupTag}^{commit}`)).toBe(commit);
    expect(() =>
      assertCheckoutIdentity({ root, releaseCommit: commit, tag: backupTag })
    ).toThrow(
      new RegExp(
        `release commit ${commit} is reachable from no durable ref.*Push a release tag`,
        "su"
      )
    );
  });

  it("accepts a release commit anchored by a real release tag", () => {
    const { root, commit } = createTaggedFixture();

    expect(
      assertCheckoutIdentity({ root, releaseCommit: commit, tag: TAG })
        .durableRefs
    ).toContain(`refs/tags/${TAG}`);
  });

  it("refuses a release tag spelled as a bare commit SHA", () => {
    expect(() => assertReleaseTag("0".repeat(40))).toThrow(
      /is a bare commit SHA.*publish must stamp a tag ref/su
    );
    expect(() => assertReleaseTag("")).toThrow(/non-empty string/u);
    expect(() => assertReleaseTag("v1.2.3 ")).toThrow(
      /printable non-whitespace/u
    );
    expect(assertReleaseTag(TAG)).toBe(TAG);
  });

  it("rejects a package that stamps no release tag for consumers to pin", () => {
    const { root, commit } = createTaggedFixture();
    preparePackFixture(root, commit, VERSION);
    const packagePath = path.join(root, PACKAGE_JSON);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    delete packageJson.lisaReleaseTag;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() =>
      packAndValidateReleaseCandidate({
        root,
        version: VERSION,
        releaseCommit: commit,
        tag: TAG,
        packDestination: path.join(root, "packed"),
      })
    ).toThrow(/package\.json lisaReleaseTag undefined expected v1\.2\.3/u);
  });

  it("rejects a package whose stamped release tag names another release", () => {
    const { root, commit } = createTaggedFixture();
    preparePackFixture(root, commit, VERSION);
    const packagePath = path.join(root, PACKAGE_JSON);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.lisaReleaseTag = "v9.9.9";
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() =>
      packAndValidateReleaseCandidate({
        root,
        version: VERSION,
        releaseCommit: commit,
        tag: TAG,
        packDestination: path.join(root, "packed"),
      })
    ).toThrow(/lisaReleaseTag "v9\.9\.9" expected v1\.2\.3/u);
  });

  it("packs one coherent candidate and reports immutable digests", () => {
    const { root, commit } = createTaggedFixture();
    preparePackFixture(root, commit, VERSION);

    const result = packAndValidateReleaseCandidate({
      root,
      version: VERSION,
      releaseCommit: commit,
      tag: TAG,
      packDestination: path.join(root, "packed"),
    });

    expect(result).toMatchObject({
      version: VERSION,
      releaseCommit: commit,
      releaseTag: TAG,
      certificateVersion: VERSION,
      tarballSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      certificateMemberSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(readFileSync(result.tarballPath)).not.toHaveLength(0);
  });
});
