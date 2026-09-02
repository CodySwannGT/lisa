#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Fail closed when a release checkout or packed npm candidate does not bind to
 * one immutable version and commit.
 *
 * Release workflows have two separate state transitions: standard-version
 * writes and pushes the release commit, then npm builds and publishes a tagged
 * checkout. A tag aimed at the pre-release merge let the second transition
 * compile stale generated source and only afterwards rewrite package.json. This
 * checker makes both boundaries executable: `checkout` proves tag/HEAD/commit
 * identity before build, and `pack` proves the exact tarball passed to
 * `npm publish` contains matching package metadata and generated certificate.
 *
 * Projects without Lisa's nightly certificate still receive the generic
 * version/commit/tarball checks. When the source certificate exists, its built
 * and packed counterpart becomes mandatory.
 *
 * `checkout` additionally proves the release commit is reachable from a ref a
 * consumer can resolve. A commit that exists but is referenced by nothing is
 * the one failure with no red signal anywhere: tooling stamps it into consumer
 * workflow pins, and a pinned workflow that cannot be resolved never loads —
 * so it runs zero jobs, fails zero jobs, and its run history is
 * indistinguishable from a healthy one.
 * @module scripts/check-release-package-identity
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  boundedExecFileSync,
  rethrowIfChildTimeout,
} from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const RELEASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TAG_PATTERN = /^[!-~]+$/u;

/**
 * Ref namespaces a consumer can actually resolve.
 *
 * Local branches are excluded on purpose. Measuring reachability over all
 * local refs answers "does this commit exist in my clone", not "can a consumer
 * resolve it", and that difference is what made a 235-version outage read as
 * four versions on the first pass.
 */
const DURABLE_REF_NAMESPACES = Object.freeze(["refs/tags", "refs/remotes"]);

/**
 * Ref prefix that does not count as durable reachability.
 *
 * A `refs/tags/backup/*` tag is a byproduct of a history rewrite, not a
 * release artifact. Measured on this repository, a run of 70 published
 * versions was reachable through exactly one such tag and nothing else —
 * alive only until somebody prunes the backup. A publish whose release commit
 * has no anchor but a backup tag is already the failure, one deletion early.
 */
const BACKUP_TAG_PREFIX = "refs/tags/backup/";
const SOURCE_CERTIFICATE = "src/core/nightly-e2e-guard-behavior-certificate.ts";
const PACKED_CERTIFICATE =
  "package/dist/core/nightly-e2e-guard-behavior-certificate.js";

/** Raise one consistently named fail-closed identity error. */
function mismatch(message) {
  throw new Error(`Release package identity mismatch: ${message}`);
}

/** Return a required CLI option. */
function requiredOption(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) mismatch(`missing required ${name}`);
  return value;
}

/** Resolve one git revision to its immutable commit. */
function gitCommit(root, revision) {
  try {
    return String(
      boundedExecFileSync("git", ["rev-parse", `${revision}^{commit}`], {
        cwd: root,
        encoding: "utf8",
      })
    ).trim();
  } catch {
    mismatch(`could not resolve git revision ${revision}`);
  }
}

/** Parse one JSON file with a release-specific diagnostic. */
function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    mismatch(`${label} is missing or invalid JSON (${filePath})`);
  }
}

/** SHA-256 for an immutable file or member. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * List the durable refs from which one commit is reachable.
 *
 * Fails closed rather than answering "none" when git cannot be asked: an
 * enumeration that did not run is not evidence of an unreachable commit, and
 * conflating the two would turn a busy machine into a failed release.
 */
function durableRefsContaining(root, commit) {
  let output;
  try {
    output = String(
      boundedExecFileSync(
        "git",
        [
          "for-each-ref",
          "--format=%(refname)",
          `--contains=${commit}`,
          ...DURABLE_REF_NAMESPACES,
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 }
      )
    );
  } catch (error) {
    rethrowIfChildTimeout(error);
    mismatch(
      `could not enumerate durable refs containing ${commit} (${error instanceof Error ? error.message : String(error)})`
    );
  }
  return Object.freeze(
    output
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(ref => !ref.startsWith(BACKUP_TAG_PREFIX))
  );
}

/** Read one tar member without extracting paths into the checkout. */
function tarMember(tarballPath, member) {
  try {
    return Buffer.from(
      boundedExecFileSync("tar", ["-xOf", tarballPath, member])
    );
  } catch {
    mismatch(`packed candidate does not contain ${member}`);
  }
}

/** Create the one npm archive whose bytes will be published. */
function createCandidateArchive(root, packDestination) {
  mkdirSync(packDestination, { recursive: true });
  if (readdirSync(packDestination).length !== 0) {
    mismatch(`pack destination must be empty (${packDestination})`);
  }
  try {
    return String(
      boundedExecFileSync(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--silent",
          "--pack-destination",
          packDestination,
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 }
      )
    );
  } catch (error) {
    mismatch(
      `npm pack failed before publication (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

/** Extract the one workspace package version certified by generated bytes. */
function certificateVersion(bytes, label) {
  const match = String(bytes).match(
    /workspace package @codyswann\/lisa@([^\s"'()]+)\s*\(/u
  );
  if (!match?.[1]) mismatch(`${label} has no workspace package provenance`);
  return match[1];
}

/** Require a valid immutable release commit spelling. */
export function assertReleaseCommit(releaseCommit) {
  if (!RELEASE_COMMIT_PATTERN.test(releaseCommit)) {
    mismatch(
      `release commit must be 40 lowercase hexadecimal characters; got ${JSON.stringify(releaseCommit)}`
    );
  }
  return releaseCommit;
}

/**
 * Require a release tag that a consumer can be pinned at.
 *
 * The one spelling refused outright is a bare commit SHA. Stamping a commit is
 * the defect this check exists to close: the object survives a history rewrite
 * but its reachability does not, and a caller pinned at an orphaned SHA never
 * loads — zero jobs, so zero failures, so nothing red anywhere. Tag NAMING is
 * otherwise left to the calling project, which is free to use its own prefix.
 * @param {string} tag Release tag supplied by the publishing workflow
 * @returns {string} The validated tag
 */
export function assertReleaseTag(tag) {
  if (typeof tag !== "string" || tag === "") {
    mismatch(
      `release tag must be a non-empty string; got ${JSON.stringify(tag)}`
    );
  }
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    mismatch(
      `release tag must be printable non-whitespace characters; got ${JSON.stringify(tag)}`
    );
  }
  if (RELEASE_COMMIT_PATTERN.test(tag.toLowerCase())) {
    mismatch(
      `release tag ${JSON.stringify(tag)} is a bare commit SHA; a consumer pinned at a commit stops loading the workflow the moment history moves, so publish must stamp a tag ref`
    );
  }
  return tag;
}

/**
 * Prove that the checked-out tag and HEAD name the supplied release commit,
 * and that the commit is reachable from a ref a consumer can resolve.
 * @param {{root: string, releaseCommit: string, tag: string}} input Identity input
 * @returns {{headCommit: string, tagCommit: string, releaseCommit: string, durableRefs: readonly string[]}}
 */
export function assertCheckoutIdentity({ root, releaseCommit, tag }) {
  const validatedReleaseCommit = assertReleaseCommit(releaseCommit);
  const headCommit = gitCommit(root, "HEAD");
  if (headCommit !== validatedReleaseCommit) {
    mismatch(
      `HEAD ${headCommit} does not match release commit ${validatedReleaseCommit}`
    );
  }
  const tagCommit = gitCommit(root, tag);
  if (tagCommit !== validatedReleaseCommit) {
    mismatch(
      `tag ${tag} resolves ${tagCommit}, expected ${validatedReleaseCommit}`
    );
  }
  const durableRefs = durableRefsContaining(root, validatedReleaseCommit);
  if (durableRefs.length === 0) {
    mismatch(
      `release commit ${validatedReleaseCommit} is reachable from no durable ref (${DURABLE_REF_NAMESPACES.join(", ")}, excluding ${BACKUP_TAG_PREFIX}*). ` +
        "Publishing it would stamp a pin that resolves to nothing in every consumer that installs this version, and a caller whose pin does not resolve reports no failure at all. " +
        `Push a release tag at ${validatedReleaseCommit} and re-run, or re-cut the release from a commit that is on the published branch.`
    );
  }
  return Object.freeze({
    headCommit,
    tagCommit,
    releaseCommit: validatedReleaseCommit,
    durableRefs,
  });
}

/**
 * Pack and validate the exact candidate later passed to npm publish.
 * @param {{root: string, version: string, releaseCommit: string, tag: string, packDestination: string}} input Candidate input
 * @returns {{version: string, releaseCommit: string, releaseTag: string, certificateVersion: string|null, tarballPath: string, tarballSha256: string, certificateMemberSha256: string|null}}
 */
export function packAndValidateReleaseCandidate({
  root,
  version,
  releaseCommit,
  tag,
  packDestination,
}) {
  const validatedReleaseCommit = assertReleaseCommit(releaseCommit);
  const validatedTag = assertReleaseTag(tag);
  const packageJson = readJson(path.join(root, "package.json"), "package.json");
  if (packageJson.version !== version) {
    mismatch(
      `package.json version ${JSON.stringify(packageJson.version)} expected ${version}`
    );
  }
  if (packageJson.lisaReleaseCommit !== validatedReleaseCommit) {
    mismatch(
      `package.json lisaReleaseCommit ${JSON.stringify(packageJson.lisaReleaseCommit)} expected ${validatedReleaseCommit}`
    );
  }
  if (packageJson.gitHead !== validatedReleaseCommit) {
    mismatch(
      `package.json gitHead ${JSON.stringify(packageJson.gitHead)} expected ${validatedReleaseCommit}`
    );
  }
  if (packageJson.lisaReleaseTag !== validatedTag) {
    mismatch(
      `package.json lisaReleaseTag ${JSON.stringify(packageJson.lisaReleaseTag)} expected ${validatedTag}`
    );
  }

  const sourceCertificatePath = path.join(root, SOURCE_CERTIFICATE);
  const hasCertificate = existsSync(sourceCertificatePath);
  if (hasCertificate) {
    const sourceVersion = certificateVersion(
      readFileSync(sourceCertificatePath),
      "source certificate"
    );
    if (sourceVersion !== version) {
      mismatch(
        `source certificate names ${sourceVersion}, expected ${version}`
      );
    }
  }

  const packOutput = createCandidateArchive(root, packDestination);
  const candidates = readdirSync(packDestination).filter(file =>
    file.endsWith(".tgz")
  );
  if (candidates.length !== 1) {
    mismatch("npm pack did not report exactly one candidate tarball");
  }
  const reportedCandidate = packOutput
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1);
  if (path.basename(reportedCandidate ?? "") !== candidates[0]) {
    mismatch(
      `npm pack reported ${JSON.stringify(reportedCandidate)}, wrote ${JSON.stringify(candidates[0])}`
    );
  }

  const tarballPath = path.resolve(packDestination, candidates[0]);
  const tarballBytes = readFileSync(tarballPath);
  const packedPackage = JSON.parse(
    String(tarMember(tarballPath, "package/package.json"))
  );
  if (packedPackage.version !== version) {
    mismatch(
      `packed package version ${JSON.stringify(packedPackage.version)} expected ${version}`
    );
  }
  if (packedPackage.lisaReleaseCommit !== validatedReleaseCommit) {
    mismatch(
      `packed lisaReleaseCommit ${JSON.stringify(packedPackage.lisaReleaseCommit)} expected ${validatedReleaseCommit}`
    );
  }
  if (packedPackage.gitHead !== validatedReleaseCommit) {
    mismatch(
      `packed gitHead ${JSON.stringify(packedPackage.gitHead)} expected ${validatedReleaseCommit}`
    );
  }
  if (packedPackage.lisaReleaseTag !== validatedTag) {
    mismatch(
      `packed lisaReleaseTag ${JSON.stringify(packedPackage.lisaReleaseTag)} expected ${validatedTag}`
    );
  }

  let packedCertificateVersion = null;
  let certificateMemberSha256 = null;
  if (hasCertificate) {
    const member = tarMember(tarballPath, PACKED_CERTIFICATE);
    packedCertificateVersion = certificateVersion(member, "packed certificate");
    if (packedCertificateVersion !== version) {
      mismatch(
        `packed certificate names ${packedCertificateVersion}, expected ${version} at release commit ${validatedReleaseCommit} (${PACKED_CERTIFICATE})`
      );
    }
    certificateMemberSha256 = sha256(member);
  }

  return Object.freeze({
    version,
    releaseCommit: validatedReleaseCommit,
    releaseTag: validatedTag,
    certificateVersion: packedCertificateVersion,
    tarballPath,
    tarballSha256: sha256(tarballBytes),
    certificateMemberSha256,
  });
}

/** Append validated tarball identity to a GitHub Actions step output. */
function writeGithubOutput(result, outputPath) {
  if (!outputPath) return;
  if (result.tarballPath.includes("\n") || result.tarballPath.includes("\r")) {
    mismatch("candidate tarball path contains a line break");
  }
  appendFileSync(
    outputPath,
    [
      `tarball=${result.tarballPath}`,
      `tarball_sha256=${result.tarballSha256}`,
      `certificate_member_sha256=${result.certificateMemberSha256 ?? "not-applicable"}`,
      "",
    ].join("\n")
  );
}

/** Execute the checkout or pack CLI boundary. */
export function runReleasePackageIdentityCli(
  argv,
  { root = process.cwd(), githubOutput = process.env.GITHUB_OUTPUT } = {}
) {
  const [mode, ...options] = argv;
  if (mode === "checkout") {
    const result = assertCheckoutIdentity({
      root,
      releaseCommit: requiredOption(options, "--release-commit"),
      tag: requiredOption(options, "--tag"),
    });
    process.stdout.write(
      `RELEASE_CHECKOUT_IDENTITY_OK ${JSON.stringify(result)}\n`
    );
    return 0;
  }
  if (mode === "pack") {
    const result = packAndValidateReleaseCandidate({
      root,
      version: requiredOption(options, "--version"),
      releaseCommit: requiredOption(options, "--release-commit"),
      tag: requiredOption(options, "--tag"),
      packDestination: requiredOption(options, "--pack-destination"),
    });
    writeGithubOutput(result, githubOutput);
    process.stdout.write(
      `RELEASE_PACKAGE_IDENTITY_OK ${JSON.stringify(result)}\n`
    );
    return 0;
  }
  mismatch("expected mode checkout or pack");
}

if (invokedAsScript(import.meta.url)) {
  try {
    process.exitCode = runReleasePackageIdentityCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
