/**
 * An attest run whose check shows a credential keeps its result and writes
 * no secret.
 *
 * The check here prints a token every time it runs, the way a tool echoes
 * the credential it was given. The proof still passes and is still written
 * down; the value is taken out before the evidence is written, so the
 * digest, the register and the verdict are all computed from text that
 * never held it. The same holds for a verdict computed from an evidence
 * file someone edited, and the last check before any of the three files is
 * written refuses content that still holds one.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeControlFile } from "../../../src/controls/control-files.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { scanJsonForCredentials } from "../../../src/controls/secret-scan-json.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkVerdict,
  evidenceIn,
  record,
  textOf,
  verdictIn,
  WRITTEN_FILES,
} from "./support/attest-record-run.js";
import { findingRecord } from "./support/evidence-samples.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";
import { of, verdictOf } from "./support/verdict-run.js";

/** The random part of the token the check prints. */
const BODY = fakeCredential(36);
/** The token as the check prints it. It is never an argument of the check. */
const TOKEN = ["gh", "p_", BODY].join("");
const PLACEHOLDER = "[REDACTED:GITHUB_TOKEN]";
const ENTRY = "code-style@.";
const roots: string[] = [];

/**
 * A working check that also prints a token, put together when it runs.
 * @returns The check, as an argument list that holds no token
 */
function echoing(): readonly string[] {
  const [node = "", flag = "", script = ""] = checks(F_NONE_SOURCE);
  const shown = `console.log('signed in as ci with ' + ['gh', 'p_', '${BODY}'].join(''));`;
  return [node, flag, `${shown} ${script}`];
}

/**
 * Make an empty folder that is removed after the case.
 * @returns Its path
 */
function emptyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-secret-write-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  removeCopies();
  removeFixtures();
  roots.splice(0).forEach(root => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("an attest run whose check prints a credential", () => {
  it("keeps its result, writes no secret, and tells the operator", async () => {
    const where = setting(provedGates([{ command: echoing() }]));

    const recorded = await record(where);
    const lines = recorded.problems === null ? recorded.lines : [];
    const evidence = evidenceIn(where.repoPath);

    expect(recorded.problems).toBeNull();
    expect(evidence.records.map(each => [each.half, each.result])).toEqual([
      ["clean", "held"],
      ["violation", "held"],
    ]);
    expect(evidence.records.map(each => each.output_excerpt)).toEqual([
      expect.stringContaining(`signed in as ci with ${PLACEHOLDER}`),
      expect.stringContaining(`signed in as ci with ${PLACEHOLDER}`),
    ]);
    WRITTEN_FILES.forEach(file => {
      expect(textOf(where.repoPath, file)).not.toContain(TOKEN);
      expect(
        scanJsonForCredentials(JSON.parse(textOf(where.repoPath, file)))
      ).toEqual([]);
    });
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^Something shaped like a credential was in what 2 checks printed or were started with: the violation result for ${ENTRY.replace(".", "\\.")} at commit \\(a GitHub token\\); the clean result`,
          "u"
        )
      )
    );
  });

  it("computes the digest from the evidence as written, so the verdict still checks out", async () => {
    const where = setting(provedGates([{ command: echoing() }]));
    await record(where);

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(of(verdictIn(where.repoPath)).verdict).toBe("conforming");
  });
});

describe("a verdict computed from evidence that holds a credential", () => {
  it("does not copy the value into its sentences", () => {
    const edited = findingRecord("AC1.1", "not-applicable", {
      detail: `The repository deploys nothing; it signs in with ${TOKEN}.`,
    });

    const verdict = of(verdictOf([], [edited]), "AC1.1");

    expect(verdict.fact).toBe(
      `The repository deploys nothing; it signs in with ${PLACEHOLDER}.`
    );
    expect(JSON.stringify(verdict)).not.toContain(TOKEN);
  });
});

describe("the last check before one of the three files is written", () => {
  it("refuses content that holds something shaped like a credential, and writes nothing", async () => {
    const root = emptyRoot();
    const text = `${JSON.stringify({ records: [{ scope: TOKEN }] }, null, 2)}\n`;

    const written = await writeControlFile(root, EVIDENCE_PATH, text);

    expect(written.problem).toBe(
      `${EVIDENCE_PATH} was not written, because it would hold something shaped like a credential at records[0].scope: a GitHub token. The value is not repeated here. Take the value out of what this file is written from and write the name it goes by instead, then run this again.`
    );
    expect(existsSync(path.join(root, EVIDENCE_PATH))).toBe(false);
  });

  it("writes content that holds none", async () => {
    const root = emptyRoot();
    const text = '{\n  "result": "conforming"\n}\n';

    const written = await writeControlFile(root, VERDICT_PATH, text);

    expect(written).toEqual({ problem: null, wrote: true });
    expect(readFileSync(path.join(root, VERDICT_PATH), "utf8")).toBe(text);
  });
});
