/**
 * A secret's value never reaches the evidence file, and a run is not lost
 * because a tool showed one.
 *
 * A record keeps what a program did: the arguments it was started with and
 * the end of what it printed. That text is captured, so a value shaped like
 * a credential is taken out, before the excerpt is cut and before anything
 * is written, and a placeholder says what was there.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { describe, expect, it } from "vitest";

import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import {
  echoedCredentialNote,
  recordWithoutSecretValues,
} from "../../../src/controls/evidence-redact.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  EVIDENCE_EXCERPT_LIMIT,
  type EvidenceBatch,
  type EvidenceRecord,
  type EvidenceResultInput,
} from "../../../src/controls/evidence-types.js";
import {
  batchRecords,
  mergedEvidence,
  prepareEvidenceExcerpt,
} from "../../../src/controls/evidence-write.js";
import { scanJsonForCredentials } from "../../../src/controls/secret-scan-json.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import {
  entryServing,
  evidenceOf,
  halfRecord,
  RECORDED_AT,
  registerOf,
  SAMPLE_COMMIT,
} from "./support/evidence-samples.js";

const TOKEN = fakeGithubToken();
const RANDOM = fakeCredential();
const API = "code-style@api";
const PLACEHOLDER = "[REDACTED:GITHUB_TOKEN]";
const REGISTER = registerOf(entryServing(API));
const FOUND = "Found 1 error";
const NAMED = "[REDACTED:SECRET]";

/**
 * One result as a step hands it to the evidence writer.
 * @param change - What differs from a clean rejection
 * @returns The result
 */
function result(
  change: Partial<EvidenceResultInput> = {}
): EvidenceResultInput {
  return {
    entry_id: API,
    moment: "commit",
    rung: "exercised",
    half: "violation",
    result: "held",
    reason: "rejected-as-declared",
    detail: "The check turned this change away.",
    command: ["ruff", "check", "."],
    exit_status: 1,
    started_at: "2026-11-17T11:59:58.000Z",
    completed_at: RECORDED_AT,
    output_excerpt: FOUND,
    output_truncated: false,
    ...change,
  };
}

/**
 * A batch that speaks for the entry at commit.
 * @param results - What it found
 * @returns The batch
 */
function batch(...results: readonly EvidenceResultInput[]): EvidenceBatch {
  return { entries: [API], moments: ["commit"], results };
}

/**
 * The one record a result becomes.
 * @param change - What differs from a clean rejection
 * @returns The record
 */
function written(change: Partial<EvidenceResultInput>): EvidenceRecord {
  const built = batchRecords([batch(result(change))], REGISTER, {
    commit: SAMPLE_COMMIT,
    freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
  });
  const [record] = built.problems === null ? built.records : [];
  if (record === undefined) throw new Error("no record was written");
  return record;
}

describe("what a check printed", () => {
  it("loses a credential-shaped value and keeps the rest", () => {
    const excerpt = prepareEvidenceExcerpt(
      `cloning with ${TOKEN}\n${FOUND}\n`,
      false
    );

    expect(excerpt).toEqual({
      output_excerpt: `cloning with ${PLACEHOLDER}\n${FOUND}\n`,
      output_truncated: false,
    });
  });

  it("loses the value before the excerpt is cut, so a cut never leaves half of one", () => {
    // One long line: the cut would fall in the middle of the value.
    const output = `${TOKEN}${"#".repeat(EVIDENCE_EXCERPT_LIMIT - 20)}`;

    const excerpt = prepareEvidenceExcerpt(output, false);
    const pieces = Array.from({ length: TOKEN.length - 8 }, (_unused, index) =>
      TOKEN.slice(index, index + 8)
    );

    expect(excerpt.output_truncated).toBe(true);
    expect(excerpt.output_excerpt.length).toBeLessThanOrEqual(
      EVIDENCE_EXCERPT_LIMIT
    );
    expect(
      pieces.filter(piece => excerpt.output_excerpt.includes(piece))
    ).toEqual([]);
  });

  it("is left exactly as it was when it holds no such value", () => {
    expect(prepareEvidenceExcerpt(`${FOUND}\n`, false)).toEqual({
      output_excerpt: `${FOUND}\n`,
      output_truncated: false,
    });
  });
});

describe("a record made from a result that shows a credential", () => {
  it("has the value taken out of its output, its arguments and its sentence", () => {
    const record = written({
      result: "unknown",
      reason: "not-started",
      detail: `The check could not be started: spawn deploy --token ${RANDOM} ENOENT.`,
      command: [
        "deploy",
        "--token",
        RANDOM,
        `--url=https://ci:${RANDOM}@x.invalid`,
      ],
      output_excerpt: `fatal: bad credentials ${TOKEN}`,
    });

    expect(record.detail).toBe(
      `The check could not be started: spawn deploy --token ${NAMED} ENOENT.`
    );
    expect(record.command).toEqual([
      "deploy",
      "--token",
      NAMED,
      "--url=https://[REDACTED:URL_CREDENTIALS]@x.invalid",
    ]);
    expect(record.output_excerpt).toBe(`fatal: bad credentials ${PLACEHOLDER}`);
    expect(JSON.stringify(record)).not.toContain(TOKEN);
    expect(JSON.stringify(record)).not.toContain(RANDOM);
  });

  it("is still a record the evidence file accepts, with nothing left to find", () => {
    const document = evidenceOf(written({ output_excerpt: `saw ${TOKEN}` }));

    expect(parseEvidenceDocument(document).problems).toBeNull();
    expect(scanJsonForCredentials(document)).toEqual([]);
  });

  it("keeps its identity: what it is about is not rewritten", () => {
    const record = written({ output_excerpt: `saw ${TOKEN}` });

    expect(record.id).toBe(`${API}/commit/violation/SI7`);
    expect(record.commit).toBe(SAMPLE_COMMIT);
    expect(record.exit_status).toBe(1);
  });

  it("is the same object when it holds nothing to take out", () => {
    const record = halfRecord(API, "violation");

    expect(recordWithoutSecretValues(record)).toBe(record);
  });
});

describe("a record an earlier run left in the file", () => {
  it("has the value taken out when it is kept", () => {
    const earlier = halfRecord(API, "violation", "SI7", {
      output_excerpt: `saw ${TOKEN}`,
      command: ["deploy", "--password", RANDOM],
    });

    const kept = mergedEvidence({
      earlier: [earlier],
      register: REGISTER,
      batches: [],
      records: [],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.output_excerpt).toBe(`saw ${PLACEHOLDER}`);
    expect(kept[0]?.command).toEqual(["deploy", "--password", NAMED]);
  });
});

describe("what the operator is told", () => {
  it("is nothing when no check showed a credential", () => {
    expect(echoedCredentialNote([batch(result())])).toBeNull();
  });

  it("names the result and the shape, and never the value", () => {
    const note = echoedCredentialNote([
      batch(result({ output_excerpt: `saw ${TOKEN}` })),
    ]);

    expect(note).toBe(
      `Something shaped like a credential was in what a check printed or was started with: the violation result for ${API} at commit (a GitHub token). Each value was taken out before anything was written and is not kept anywhere; a placeholder marks where it was. Find out why the check shows it, and replace the credential if it is a real one.`
    );
    expect(note).not.toContain(TOKEN);
  });

  it("counts the checks when more than one showed one", () => {
    const note = echoedCredentialNote([
      batch(
        result({ output_excerpt: `saw ${TOKEN}` }),
        result({ half: "clean", command: ["deploy", "--token", RANDOM] })
      ),
    ]);

    expect(note).toContain("in what 2 checks printed or were started with");
    expect(note).toContain(`the clean result for ${API} at commit`);
    expect(note).not.toContain(RANDOM);
  });
});
