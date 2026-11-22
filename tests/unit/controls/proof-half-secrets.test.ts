/**
 * What a half keeps of a check's output holds no part of a secret, however
 * long the output is.
 *
 * A half keeps the end of what its check printed. If the cut were made
 * first, it could fall inside a secret: a private key would lose the line
 * that marks its start and keep its body, and a token would lose the prefix
 * that makes it recognisable. So every value is taken out of the whole
 * output, and only then is the end kept.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file.
 */
import { describe, expect, it } from "vitest";

import { echoedCredentialNote } from "../../../src/controls/evidence-redact.js";
import { EVIDENCE_EXCERPT_LIMIT } from "../../../src/controls/evidence-types.js";
import {
  prepareEvidenceExcerpt,
  proofHalfResult,
} from "../../../src/controls/evidence-write.js";
import {
  OUTPUT_EXCERPT_LIMIT,
  runHalf,
} from "../../../src/controls/proof-half-run.js";
import type { RunnableProof } from "../../../src/controls/proof-plan.js";
import type {
  ProofHalfResult,
  ProofWorkspace,
} from "../../../src/controls/proof-types.js";
import { redactCredentials } from "../../../src/controls/secret-scan.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { entryServing } from "./support/evidence-samples.js";
import { steppingClock } from "./support/proof-run.js";

const ENTRY = "code-style@api";
const FOUND = "Found 1 error";
const KEY_PLACEHOLDER = "[REDACTED:PRIVATE_KEY]";
const DASHES = "-".repeat(5);
const KEY_LABEL = ["PRIVATE", "KEY"].join(" ");
const KEY_START = `${DASHES}BEGIN ${KEY_LABEL}${DASHES}`;
const KEY_END = `${DASHES}END ${KEY_LABEL}${DASHES}`;
const KEY_BODY = [
  fakeCredential(64, 7),
  fakeCredential(64, 9),
  `${fakeCredential(42, 21)}==`,
];

/**
 * The body of a key as long as a large one is: with the lines around it,
 * longer than everything a half keeps of an output.
 */
const LONG_KEY_BODY = Array.from({ length: 61 }, (_unused, index) =>
  fakeCredential(64, 7 + index * 2)
);
const TOKEN = fakeGithubToken();

/**
 * Run one half whose check prints the given output and fails as declared.
 * @param output - Everything the check printed
 * @returns What the half kept
 */
async function halfPrinting(output: string): Promise<ProofHalfResult> {
  const workspace: ProofWorkspace = {
    root: "/nowhere/workspace",
    apply: () => ({ problem: null }),
    trigger: ({ mechanism }) => ({
      command: [...mechanism.argv],
      cwd: "/nowhere/workspace",
      code: 1,
      output,
    }),
    restore: () => ({ problem: null }),
  };
  const proof: RunnableProof = {
    run: true,
    entry: entryServing(ENTRY),
    moment: "commit",
    mechanism: { kind: "command", argv: ["lint"] },
    timeLimitSeconds: 60,
    shape: [FOUND],
    patches: {
      violation: { file: "v.patch", text: "v" },
      clean: { file: "c.patch", text: "c" },
    },
  };
  const ran = await runHalf(
    proof,
    "violation",
    {
      workspace,
      clock: steppingClock(),
      judge: () => ({ verdict: "failed", declared: true, matched: [FOUND] }),
    },
    null
  );
  return ran.result;
}

/**
 * The pieces of a value that would give it away if any were kept.
 * @param value - The value
 * @returns Every run of eight characters in it
 */
function piecesOf(value: string): readonly string[] {
  return Array.from({ length: value.length - 7 }, (_unused, index) =>
    value.slice(index, index + 8)
  );
}

describe("a half whose check printed a private key longer than what is kept", () => {
  // The line that starts the key falls before the part a half keeps, and
  // the end of the key's body and its last line fall inside the part the
  // evidence file keeps.
  const output = `${[KEY_START, ...LONG_KEY_BODY, KEY_END].join("\n")}\n${FOUND}\n`;

  it("keeps none of the key's lines", async () => {
    const half = await halfPrinting(output);

    expect(output.length).toBeGreaterThan(
      OUTPUT_EXCERPT_LIMIT + KEY_START.length
    );
    expect(
      LONG_KEY_BODY.filter(line => half.output_excerpt.includes(line))
    ).toEqual([]);
    // With the key gone, everything else the check printed fits.
    expect(half.output_excerpt).toBe(`${KEY_PLACEHOLDER}\n${FOUND}\n`);
    expect(half.output_truncated).toBe(false);
    expect(half.outcome).toBe("rejected");
  });

  it("gives the evidence file an excerpt with none of the key's lines", async () => {
    const half = await halfPrinting(output);
    const written = prepareEvidenceExcerpt(
      proofHalfResult(half).output_excerpt,
      half.output_truncated
    );

    expect(written.output_excerpt.length).toBeLessThanOrEqual(
      EVIDENCE_EXCERPT_LIMIT
    );
    expect(
      LONG_KEY_BODY.filter(line => written.output_excerpt.includes(line))
    ).toEqual([]);
    expect(written.output_excerpt).not.toContain(KEY_END);
  });
});

describe("a half whose check printed a token the cut would fall inside", () => {
  it("keeps no piece of the token", async () => {
    // One long line: the cut falls half-way through the token.
    const half = await halfPrinting(
      `${TOKEN}${"#".repeat(OUTPUT_EXCERPT_LIMIT - TOKEN.length / 2)}`
    );

    expect(half.output_truncated).toBe(true);
    expect(half.output_excerpt.length).toBeLessThanOrEqual(
      OUTPUT_EXCERPT_LIMIT
    );
    expect(
      piecesOf(TOKEN).filter(piece => half.output_excerpt.includes(piece))
    ).toEqual([]);
  });

  it("keeps a placeholder where a token stood in a short output, and none of it in the lines that matched", async () => {
    const half = await halfPrinting(`signed in with ${TOKEN}\n${FOUND}\n`);

    expect(half.output_excerpt).toBe(
      `signed in with [REDACTED:GITHUB_TOKEN]\n${FOUND}\n`
    );
    expect(JSON.stringify(half)).not.toContain(TOKEN);
  });

  it("still tells the operator a check showed a credential", async () => {
    const half = await halfPrinting(`signed in with ${TOKEN}\n${FOUND}\n`);

    const note = echoedCredentialNote([
      {
        entries: [ENTRY],
        moments: ["commit"],
        results: [proofHalfResult(half)],
      },
    ]);

    expect(note).toContain(
      `the violation result for ${ENTRY} at commit (a GitHub token)`
    );
    expect(note).not.toContain(TOKEN);
  });
});

describe("output that begins part-way through a private key", () => {
  it("loses the key's body and its last line when the first line is gone", () => {
    const redacted = redactCredentials(
      `${KEY_BODY.join("\n")}\n${KEY_END}\n${FOUND}\n`
    );

    expect(redacted.kinds).toEqual(["PRIVATE_KEY"]);
    expect(redacted.text).toBe(`${KEY_PLACEHOLDER}\n${FOUND}\n`);
  });

  it("loses only the lines that are the key's, not the output before them", () => {
    const redacted = redactCredentials(
      `writing the key to disk\n${KEY_BODY.join("\r\n")}\r\n${KEY_END}\n`
    );

    expect(redacted.text).toBe(`writing the key to disk\n${KEY_PLACEHOLDER}\n`);
  });

  it("loses the lines of a key that was printed indented", () => {
    const redacted = redactCredentials(
      `key: |\n${[...KEY_BODY, KEY_END].map(line => `    ${line}`).join("\n")}\nnext: 1\n`
    );

    expect(redacted.text).toBe(`key: |\n${KEY_PLACEHOLDER}\nnext: 1\n`);
  });

  it("takes a whole key out once, as before", () => {
    const redacted = redactCredentials(
      `${[KEY_START, ...KEY_BODY, KEY_END].join("\n")}\n${FOUND}\n`
    );

    expect(redacted.kinds).toEqual(["PRIVATE_KEY"]);
    expect(redacted.text).toBe(`${KEY_PLACEHOLDER}\n${FOUND}\n`);
  });

  it("changes nothing when run on its own output", () => {
    const once = redactCredentials(`${KEY_BODY.join("\n")}\n${KEY_END}\n`);

    expect(redactCredentials(once.text)).toEqual({
      text: once.text,
      kinds: [],
    });
  });
});
