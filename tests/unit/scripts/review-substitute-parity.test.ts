/**
 * The evidence prover and the merge-path gate decide a substitute the same way
 * (CodySwannGT/lisa#4628).
 *
 * The two programs ship from different template trees, so each carries its own
 * copy of the rule: the marker must be the comment's first line, and its author
 * must hold write access. Two copies drift silently unless something feeds
 * both the same comments and compares the answers. This suite is that
 * something — the five cases from the issue's reproduction, at one head.
 *
 * The gate reads comments as `{body, author}` and the prover reads GitHub's raw
 * `{body, user: {login}}`, so each case is built once and mapped to both
 * shapes. Each author's permission read is modelled once too: a writer, a
 * reader, a read that fails, and a bot that is no collaborator. The gate's
 * reader answers `false` for a failed read (its `fetchWritePermission` catches
 * and fails closed); the prover's answers `null`, which it reports as
 * "permission unreadable". Both must leave the marker uncounted.
 * @module tests/unit/scripts/review-substitute-parity
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  configuredReviewers,
  EVIDENCE_OUTCOMES,
  reviewEvidenceVerdict,
  substituteMarker,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GATE =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const REVIEWER = "CodeRabbit";
const HEAD = "f".repeat(40);

/** What each author's permission read returns. */
const PERMISSION_READS: Record<string, string | Error> = {
  maintainer: "write",
  "drive-by": "read",
  ghost: new Error("gh: HTTP 502"),
  "github-actions[bot]": new Error("gh: HTTP 404 — not a collaborator"),
};

/** The gate's exports this suite calls. */
interface GateModule {
  reviewSubstituteMarker(context: string, sha: string): string;
  substitutesAtHead(
    comments: ReadonlyArray<{ body: string; author: string }>,
    names: readonly string[],
    headSha: string,
    canWrite: (login: string) => boolean
  ): Set<string>;
}

let gate: GateModule;

beforeAll(async () => {
  gate = (await import(
    pathToFileURL(path.join(REPO_ROOT, GATE)).href
  )) as unknown as GateModule;
});

const MARKER = substituteMarker({ context: REVIEWER, sha: HEAD });

/** The five comment cases from the issue's Occurrence Evidence. */
const CASES: ReadonlyArray<
  readonly [label: string, body: string, author: string, counts: boolean]
> = [
  ["a stranger's first-line marker", MARKER, "drive-by", false],
  ["a writer's quoted marker", `Paste this:\n${MARKER}`, "maintainer", false],
  [
    "a writer's first-line marker",
    `${MARKER}\nRead the diff.`,
    "maintainer",
    true,
  ],
  ["an author whose permission is unreadable", MARKER, "ghost", false],
  ["a bot's first-line marker", MARKER, "github-actions[bot]", false],
];

/**
 * Whether one author is a writer, as the prover's reader answers.
 * @param login - The comment author
 * @returns true, false, or null when the read failed
 */
const readPermission = (login: string): boolean | null => {
  const read = PERMISSION_READS[login];
  if (read === undefined || read instanceof Error) return null;
  return ["admin", "maintain", "write"].includes(read);
};

/**
 * The same answer as the gate's `fetchWritePermission` gives it: a failed
 * read is `false`, because that function catches and fails closed.
 * @param login - The comment author
 * @returns Whether the gate treats the login as a writer
 */
const gateReadPermission = (login: string): boolean =>
  readPermission(login) === true;

/**
 * The prover's decision for one comment.
 * @param body - The comment body
 * @param author - Its author
 * @returns Whether the prover counts a substitute
 */
const proverCounts = (body: string, author: string) =>
  reviewEvidenceVerdict({
    reviewers: configuredReviewers({
      gates: {
        "code-review": {
          "pull-request": {
            level: "required",
            await: REVIEWER,
            evidence: { reviewer: true, proof: ["Review completed"] },
          },
        },
      },
    }),
    statuses: [],
    comments: [{ body, user: { login: author } }],
    sha: HEAD,
    canWrite: readPermission,
  }).outcome === EVIDENCE_OUTCOMES.substituted;

/**
 * The gate's decision for one comment.
 * @param body - The comment body
 * @param author - Its author
 * @returns Whether the gate counts a substitute
 */
const gateCounts = (body: string, author: string) =>
  gate
    .substitutesAtHead([{ body, author }], [REVIEWER], HEAD, gateReadPermission)
    .has(REVIEWER);

describe("the prover and the merge-path gate agree on who may substitute", () => {
  it("write the same marker", () => {
    expect(gate.reviewSubstituteMarker(REVIEWER, HEAD)).toBe(MARKER);
  });

  it.each(CASES)("%s", (_label, body, author, counts) => {
    expect(gateCounts(body, author)).toBe(counts);
    expect(proverCounts(body, author)).toBe(counts);
  });
});
