/**
 * Resolving the commit a host project's installed Lisa version is pinned at.
 *
 * ## The rule the resolution has to satisfy
 *
 * The SHA handed to a caller must be the commit that the **installed
 * version's tag** points at, so the workflow ref and the `@codyswann/lisa`
 * version in `package.json` describe the same Lisa. Deriving it from `main`'s
 * tip would reintroduce the mutable-ref defect under a new spelling: the pin
 * would look immutable while naming a commit nobody installed.
 *
 * ## Where the answer comes from
 *
 * A published package already carries it. `publish-to-npm.yml` checks the tag
 * out, stamps `lisaReleaseCommit`, and `check-release-package-identity.mjs`
 * refuses to publish unless `tag <tag> resolves <releaseCommit>` — so in every
 * installed copy the stamp IS the tag's commit, proved at release time, with
 * no network call at apply time and no way for the two to drift apart.
 *
 * A source checkout carries no stamp, because its release tag does not exist
 * yet. There the tag is resolved from local git instead: `package.json`'s
 * version in a checkout is the last released version, so `v<version>` is a tag
 * that exists.
 *
 * ## Why there is no third fallback
 *
 * When neither answers, this throws and the caller aborts having changed
 * nothing. It must never fall back to `@main`, and it must never leave a
 * project whose package pin and workflow ref describe different versions —
 * a partial rewrite is worse than no rewrite, because it looks finished.
 *
 * ## Two different "cannot resolve", and they are not the same failure
 *
 * A Lisa that DECLARES a release identity and cannot be resolved to a commit
 * is broken: something rewrote a stamp after publish, and nothing it says
 * about itself can be trusted. That is `"malformed"`, and it stops an apply
 * wherever a caller is involved.
 *
 * A Lisa that declares NO release identity was never released — a working
 * checkout, or a template tree copied somewhere without its history. There is
 * no tag for a caller to name, so pinning is not merely impossible, it is
 * meaningless. That is `"unreleased"`, and it is reported rather than fatal
 * except where refusing to act would silently leave an EXISTING caller
 * mutable. Collapsing the two would make every developer checkout unable to
 * apply Lisa at all.
 * @module core/lisa-release-pin
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ReleasePin } from "./reusable-workflow-pin.js";
import { FULL_COMMIT_SHA } from "./reusable-workflow-pin.js";

const execFileAsync = promisify(execFile);

/** A release tag ref, the only tag shape the release pipeline publishes. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

/**
 * Which kind of "cannot resolve" this is.
 *
 * `"malformed"` — the installed Lisa DECLARES a release identity and it will
 * not resolve. Something rewrote a stamp after publish, so nothing it says
 * about itself can be trusted.
 *
 * `"unreleased"` — it declares none. A working checkout, or a template tree
 * copied without its history. There is no tag for a caller to name, so pinning
 * is meaningless rather than merely blocked.
 */
export type UnresolvableReason = "malformed" | "unreleased";

/**
 * The installed Lisa cannot be resolved to the commit its version tag names.
 *
 * Thrown rather than reported so an apply aborts instead of silently leaving
 * mutable refs in place, which is the fail-open shape this whole subsystem
 * exists to remove. Read `reason` before deciding how far that goes: not every
 * unresolvable pin is a broken installation.
 */
export class UnresolvableReleasePinError extends Error {
  /** Which of the two failures this is; see the module note. */
  readonly reason: UnresolvableReason;

  /**
   * Create the error.
   * @param reason - Broken declared identity, or no identity declared at all
   * @param message - Operator-readable statement of what could not be resolved
   */
  constructor(reason: UnresolvableReason, message: string) {
    super(message);
    this.name = "UnresolvableReleasePinError";
    this.reason = reason;
  }
}

/** Everything the resolver reads, injectable so tests need no network or git. */
export interface ReleasePinDependencies {
  /** Installed Lisa version, from its `package.json`. */
  readonly readVersion: () => string;
  /** `lisaReleaseCommit` stamped at publish, or null in a source checkout. */
  readonly readStampedCommit: () => string | null;
  /** `lisaReleaseTag` stamped at publish, or null in a source checkout. */
  readonly readStampedTag: () => string | null;
  /** Resolve a tag to a commit in the Lisa installation directory. */
  readonly resolveTagCommit: (
    lisaDir: string,
    tag: string
  ) => Promise<string | null>;
}

/**
 * Resolve a tag to its commit using the git repository at `lisaDir`.
 *
 * Returns null for every failure — an absent tag, a directory that is not a
 * repository, git not being installed. The caller turns null into an abort, so
 * nothing here has to distinguish the reasons; what matters is that it never
 * returns a value it did not read from git.
 * @param lisaDir - Lisa installation directory
 * @param tag - Release tag to resolve
 * @returns Full commit SHA, or null when the tag does not resolve here
 */
export async function resolveTagCommitFromGit(
  lisaDir: string,
  tag: string
): Promise<string | null> {
  const resolved = await execFileAsync(
    "git",
    ["-C", lisaDir, "rev-parse", "--verify", "--quiet", `${tag}^{commit}`],
    { encoding: "utf8" }
  ).catch(() => null);
  const sha = resolved?.stdout.trim().toLowerCase() ?? "";
  return FULL_COMMIT_SHA.test(sha) ? sha : null;
}

/**
 * Choose the tag the installed version claims, refusing a stamp that disagrees.
 *
 * A published package stamps both the version and the tag, and the release
 * pipeline proves they match. If an installed copy shows them disagreeing,
 * something rewrote one of them after publish and neither can be trusted to
 * name the code the project is running.
 * @param version - Installed Lisa version
 * @param stampedTag - Tag stamped at publish, when present
 * @returns The release tag to resolve
 * @throws {UnresolvableReleasePinError} When the stamped tag is malformed or disagrees
 */
function releaseTagFor(version: string, stampedTag: string | null): string {
  const expected = `v${version}`;
  if (stampedTag === null) return expected;
  if (!RELEASE_TAG.test(stampedTag)) {
    throw new UnresolvableReleasePinError(
      "malformed",
      `the installed Lisa stamps release tag ${JSON.stringify(stampedTag)}, which is not a release tag. ` +
        "Refusing to pin a workflow at a ref derived from it."
    );
  }
  if (stampedTag !== expected) {
    throw new UnresolvableReleasePinError(
      "malformed",
      `the installed Lisa is version ${version} but stamps release tag ${stampedTag}. ` +
        "Pinning either one would give this project a workflow ref and a package pin that " +
        "describe different releases, so nothing is written."
    );
  }
  return expected;
}

/**
 * Resolve the pin every reusable-workflow caller in a project must carry.
 * @param lisaDir - Lisa installation directory, used for the checkout fallback
 * @param deps - Injectable readers
 * @returns The version and the 40-character commit its tag resolves to
 * @throws {UnresolvableReleasePinError} When the tag resolves to no commit
 */
export async function resolveReleasePin(
  lisaDir: string,
  deps: ReleasePinDependencies
): Promise<ReleasePin> {
  const version = deps.readVersion();
  const tag = releaseTagFor(version, deps.readStampedTag());

  const stamped = deps.readStampedCommit();
  if (stamped !== null) {
    const sha = stamped.trim().toLowerCase();
    if (!FULL_COMMIT_SHA.test(sha)) {
      throw new UnresolvableReleasePinError(
        "malformed",
        `the installed Lisa stamps release commit ${JSON.stringify(stamped)}, which is not a ` +
          "full 40-character commit SHA. A short or malformed SHA is ambiguous and several " +
          "GitHub APIs answer it with an empty result, so it is refused rather than written."
      );
    }
    return { sha, version };
  }

  const fromGit = await deps.resolveTagCommit(lisaDir, tag);
  if (fromGit !== null) return { sha: fromGit, version };

  throw new UnresolvableReleasePinError(
    "unreleased",
    `cannot resolve Lisa ${tag} to a commit: the installed package carries no release-commit ` +
      `stamp and ${tag} is not a tag in ${lisaDir}. Every reusable-workflow ref has been left ` +
      "exactly as it was — pinning some callers and not others, or falling back to a branch, " +
      "would leave this project's workflow refs describing a different Lisa than its package pin."
  );
}
