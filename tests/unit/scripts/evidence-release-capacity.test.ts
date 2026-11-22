/**
 * The roll-over loop that picks a release with room (CodySwannGT/lisa#4838),
 * driven against an in-memory GitHub so its bound and its pin rule are proven
 * without staging 99 releases through the CLI fixture.
 * @module tests/unit/scripts/evidence-release-capacity
 */
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_RELEASE_MAX_OVERFLOW,
  EVIDENCE_RELEASE_NEAR_FULL,
  overflowReleaseTag,
  targetEvidenceRelease,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-github.mjs";
import {
  ensureEvidenceRelease,
  fullReleaseMessage,
} from "../../../all/copy-overwrite/scripts/lib/evidence-release-capacity.mjs";

const ROOT = "repos/acme/code";
const ROTATING = { evidenceRelease: "pr-assets-{YYYY-MM}" };
const NOVEMBER = new Date("2026-11-08T12:00:00Z");
const BASE = "pr-assets-2026-11";

/**
 * An in-memory GitHub holding releases by tag with an asset count each.
 * @param counts - Asset count per existing release tag.
 * @returns The runner, transport, and a log of the releases it created.
 */
function github(counts: Record<string, number>) {
  const releases = new Map(
    Object.entries(counts).map(([tag, count], id) => [tag, { id, count }])
  );
  const created: string[] = [];
  const run = (_command: string, args: string[]) => {
    if (args[0] === "release" && args[1] === "create") {
      created.push(args[2]!);
      releases.set(args[2]!, { id: releases.size, count: 0 });
      return { status: 0, stdout: "", stderr: "" };
    }
    const tag = args[1]!.slice(`${ROOT}/releases/tags/`.length);
    const release = releases.get(tag);
    return release
      ? { status: 0, stdout: JSON.stringify({ id: release.id }), stderr: "" }
      : { status: 1, stdout: "", stderr: "HTTP 404" };
  };
  const transport = {
    root: ROOT,
    repository: "acme/code",
    // A release lookup by tag: null is GitHub's explicit 404 (#4733).
    optionalJson: (path: string) => {
      const release = releases.get(path.slice(`${ROOT}/releases/tags/`.length));
      return release ? { id: release.id } : null;
    },
    json: (path: string) => {
      const id = Number(/releases\/(\d+)\/assets/.exec(path)![1]);
      const found = [...releases.values()].find(row => row.id === id)!;
      return [Array.from({ length: found.count }, (_, index) => ({ index }))];
    },
  };
  return { run, transport, created };
}

/**
 * The loop's outcome: the release it chose, or the refusal it threw.
 * @param counts - Asset count per existing release tag.
 * @param options - Options passed to `ensureEvidenceRelease`.
 * @returns The chosen tag or the refusal, and what was created.
 */
function ensure(
  counts: Record<string, number>,
  options: { policy?: object } & Record<string, unknown> = {}
) {
  const { run, transport, created } = github(counts);
  const { policy = ROTATING, ...rest } = options;
  try {
    const chosen = ensureEvidenceRelease(run, transport, policy, {
      now: NOVEMBER,
      ...rest,
    });
    return { tag: chosen.tag, index: chosen.index, created };
  } catch (error) {
    return { error: error as Error & { category?: string }, created };
  }
}

const FULL = EVIDENCE_RELEASE_NEAR_FULL;
const WRITE_ERROR = "write-error";

describe("ensureEvidenceRelease roll-over", () => {
  it("uses the resolved release while it has room", () => {
    expect(ensure({ [BASE]: FULL - 1 })).toEqual({
      tag: BASE,
      index: 1,
      created: [],
    });
  });

  it("moves past full releases to the next one, creating it", () => {
    expect(ensure({ [BASE]: FULL, [`${BASE}-2`]: 999 })).toEqual({
      tag: `${BASE}-3`,
      index: 3,
      created: [`${BASE}-3`],
    });
  });

  it("starts from a later position after an upload found a release full", () => {
    const outcome = ensure({ [BASE]: 10 }, { from: 2 });
    expect(outcome.tag).toBe(`${BASE}-2`);
  });

  it("refuses once every overflow release is full, and creates nothing", () => {
    const counts = Object.fromEntries(
      Array.from({ length: EVIDENCE_RELEASE_MAX_OVERFLOW }, (_, index) => [
        overflowReleaseTag(BASE, index + 1),
        FULL,
      ])
    );
    const outcome = ensure(counts);
    expect(outcome.error?.category).toBe(WRITE_ERROR);
    expect(outcome.error?.message).toContain(`\`${BASE}-99\``);
    expect(outcome.created).toEqual([]);
  });

  it("names the full release, not a range, when its name is too long for an overflow suffix", () => {
    // 99 characters: `-2` would pass GitHub's 100-character tag limit.
    const long = `r${"x".repeat(98)}`;
    const outcome = ensure({ [long]: FULL + 3 }, { tag: long });
    expect(outcome.error?.category).toBe(WRITE_ERROR);
    expect(outcome.error?.message).toContain(`\`${long}\``);
    expect(outcome.error?.message).toContain(`holds ${FULL + 3} of`);
    expect(outcome.error?.message).toContain("too long");
    expect(outcome.error?.message).not.toContain(`${long}-99`);
    expect(outcome.created).toEqual([]);
  });

  it("refuses a full pinned release without rolling it over", () => {
    const outcome = ensure(
      { "pr-assets-2026-10": FULL },
      { tag: "pr-assets-2026-10", pinned: true }
    );
    expect(outcome.error?.category).toBe(WRITE_ERROR);
    expect(outcome.error?.message).toContain("LISA_EVIDENCE_RELEASE");
    expect(outcome.created).toEqual([]);
  });
});

describe("the advice a full-release refusal gives (#4838)", () => {
  const PRUNE = "node scripts/lisa-evidence-prune.mjs --release";
  const ROTATE = "to a rotating name such as";

  it("leads with pruning, not rotation, when the release already rotates", () => {
    const counts = Object.fromEntries(
      Array.from({ length: EVIDENCE_RELEASE_MAX_OVERFLOW }, (_, index) => [
        overflowReleaseTag(BASE, index + 1),
        FULL,
      ])
    );
    const message = ensure(counts).error?.message ?? "";
    expect(message).toContain(`${PRUNE} ${BASE}`);
    expect(message).not.toContain(ROTATE);
  });

  it("suggests rotation, and pruning, when the configured release is fixed", () => {
    const fixed = "lisa-evidence";
    const counts = Object.fromEntries(
      Array.from({ length: EVIDENCE_RELEASE_MAX_OVERFLOW }, (_, index) => [
        overflowReleaseTag(fixed, index + 1),
        FULL,
      ])
    );
    const message =
      ensure(counts, { policy: { evidenceRelease: fixed } }).error?.message ??
      "";
    expect(message).toContain(ROTATE);
    expect(message).toContain(`${PRUNE} ${fixed}`);
  });

  it("gives the same conditional advice for a single full release", () => {
    const rotating = fullReleaseMessage(BASE, "acme/code", 999, {
      policy: ROTATING,
    });
    expect(rotating).toContain(`${PRUNE} ${BASE}`);
    expect(rotating).not.toContain(ROTATE);
    const legacy = fullReleaseMessage("pr-assets", "acme/code", 999, {
      policy: {},
    });
    expect(legacy).toContain(ROTATE);
    expect(legacy).toContain(`${PRUNE} pr-assets`);
  });
});

describe("targetEvidenceRelease", () => {
  it("refuses a malformed acceptedEvidenceReleases before resolving anything", () => {
    expect(() =>
      targetEvidenceRelease(
        { ...ROTATING, acceptedEvidenceReleases: "pr-assets-old" },
        {},
        NOVEMBER
      )
    ).toThrow(/acceptedEvidenceReleases/);
  });

  it("resolves the configured release when nothing is pinned", () => {
    expect(targetEvidenceRelease(ROTATING, {}, NOVEMBER)).toEqual({
      tag: BASE,
      pinned: false,
    });
  });

  it("returns a validated, trimmed pin and marks it pinned", () => {
    expect(
      targetEvidenceRelease(
        ROTATING,
        { LISA_EVIDENCE_RELEASE: " pr-assets-2026-12 " },
        NOVEMBER
      )
    ).toEqual({ tag: "pr-assets-2026-12", pinned: true });
  });

  it("refuses a pin outside the accepted releases", () => {
    expect(() =>
      targetEvidenceRelease(ROTATING, { LISA_EVIDENCE_RELEASE: "v1.0.0" })
    ).toThrow(/LISA_EVIDENCE_RELEASE/);
  });
});
