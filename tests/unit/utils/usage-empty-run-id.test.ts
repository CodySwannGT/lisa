import { execFileSync } from "node:child_process";
import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  upsertLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const ENTRY_ID = "owned-usage-entry";
const DOCUMENT = "# Owned artifact\n\nKeep this description.\n";
const FOLLOWING = "## Following section\n\nKeep this content too.\n";
const FORMATS = ["canonical", "released-middle-field"] as const;
const MALFORMED_NUMBER = "invalid-count-from-stored-ledger";

/**
 * Build valid accounting input with deliberately unknown measurements.
 * @param runId Actual or deliberately absent stable run identifier.
 * @param entryId Stable identifier for this accounting row.
 * @returns A complete valid usage input.
 */
function entry(runId: string, entryId = ENTRY_ID): LisaUsageEntry {
  return {
    artifactRef: "github:example/project#1",
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId,
    flow: "lisa-verify",
    inputTokens: null,
    measuredSubsetTokens: null,
    model: "unavailable",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "openai",
    reasoningTokens: null,
    runId,
    source: "unavailable",
    totalTokens: null,
  };
}

/**
 * Render through the public writer; emulate the documented released layout.
 * @param runId Run identifier to preserve exactly.
 * @param format The released token shape to exercise.
 * @returns A real writer-produced ledger in the selected compatible layout.
 */
function ledger(runId: string, format: (typeof FORMATS)[number]): string {
  const input = entry(runId);
  const rendered = upsertLisaUsageSection(DOCUMENT, {
    entries: [input],
    rollup: createLisaUsageRollup([input]),
  });
  return format === "canonical"
    ? rendered
    : rendered.replace(
        "total_tokens=null cost=",
        "total_tokens=null measured_subset_tokens=null cost="
      );
}

describe("allowed empty run IDs", () => {
  it.each(FORMATS)("round-trips empty IDs in %s accounting", format => {
    const document = ledger("", format);
    expect(document).toContain("run_id= provider=");
    expect(parseLisaUsageSection(document).entries).toStrictEqual([entry("")]);
    expect(
      verifyLisaUsageSectionIntegrity(document, { entryIds: [ENTRY_ID] })
    ).toStrictEqual({ ok: true, issues: [] });
    const rewritten = upsertLisaUsageSection(document, {
      entries: [entry("")],
      rollup: createLisaUsageRollup([entry("")]),
    });
    expect(parseLisaUsageSection(rewritten).entries).toStrictEqual([entry("")]);
    expect(verifyLisaUsageSectionIntegrity(rewritten).ok).toBe(true);
  });

  it.each(["run-1", "null", "run with spaces / ü & %"])(
    "preserves the exact nonempty run ID %j in both layouts",
    runId => {
      for (const format of FORMATS) {
        const document = ledger(runId, format);
        expect(parseLisaUsageSection(document).entries[0]?.runId).toBe(runId);
        expect(verifyLisaUsageSectionIntegrity(document).ok).toBe(true);
      }
    }
  );

  it("keeps mixed ledger membership, unknown metrics and surrounding sections", () => {
    const entries = [entry(""), entry("named-run", "owned-second-entry")];
    const first = upsertLisaUsageSection(DOCUMENT, {
      entries,
      rollup: createLisaUsageRollup(entries),
    });
    const withFollowing = `${first}\n${FOLLOWING}`;
    const rewritten = upsertLisaUsageSection(withFollowing, {
      entries,
      rollup: createLisaUsageRollup(entries),
    });
    const parsed = parseLisaUsageSection(rewritten);
    expect(parsed.entries).toStrictEqual(entries);
    expect(parsed.rollup?.directEntryIds).toStrictEqual(
      entries.map(input => input.entryId)
    );
    expect(parsed.rollup?.totalTokens).toBeNull();
    expect(parsed.rollup?.totalCost).toBeNull();
    expect(rewritten.startsWith(DOCUMENT)).toBe(true);
    expect(rewritten.endsWith(FOLLOWING)).toBe(true);
    expect(
      upsertLisaUsageSection(rewritten, {
        entries,
        rollup: createLisaUsageRollup(entries),
      })
    ).toBe(rewritten);
  });

  it.each([DOCUMENT, ""])(
    "preserves following-section bytes across named-ID rewrites: prefix %j",
    prefix => {
      const input = entry("named-run");
      const document = `${upsertLisaUsageSection(prefix, {
        entries: [input],
      })}\n${FOLLOWING}`;
      const rewritten = upsertLisaUsageSection(document, {
        entries: [input],
      });
      expect(rewritten.endsWith(FOLLOWING)).toBe(true);
      expect(upsertLisaUsageSection(rewritten, { entries: [input] })).toBe(
        rewritten
      );
    }
  );

  it("works through standalone Node readers without application dist", () => {
    const parser = new URL(
      "../../../all/copy-overwrite/scripts/lib/usage-ledger.mjs",
      import.meta.url
    );
    const integrity = new URL(
      "../../../all/copy-overwrite/scripts/lib/usage-ledger-integrity.mjs",
      import.meta.url
    );
    const script = `
      import fs from "node:fs";
      import { parseLisaUsageSection } from ${JSON.stringify(parser.href)};
      import { verifyLisaUsageSectionIntegrity } from ${JSON.stringify(integrity.href)};
      const document = fs.readFileSync(0, "utf8");
      console.log(JSON.stringify({
        entries: parseLisaUsageSection(document).entries,
        integrity: verifyLisaUsageSectionIntegrity(document)
      }));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8", input: ledger("", "canonical") }
    );
    expect(JSON.parse(output)).toStrictEqual({
      entries: [entry("")],
      integrity: { ok: true, issues: [] },
    });
  });
});

const MALFORMED = [
  ["absent run field", (text: string) => text.replace("run_id=valid-run ", "")],
  [
    "empty provider",
    (text: string) => text.replace("provider=openai", "provider="),
  ],
  [
    "invalid number",
    (text: string) =>
      text.replace("input_tokens=null", `input_tokens=${MALFORMED_NUMBER}`),
  ],
  [
    "invalid effectiveness extension",
    (text: string) =>
      `${text}\n<!-- lisa:usage-effectiveness entry_id=${ENTRY_ID} data=%7B -->\n`,
  ],
] as const;
const MALFORMED_BY_FORMAT = FORMATS.flatMap(format =>
  MALFORMED.map(([name, corrupt]) => ({ format, name, corrupt }))
);

describe("malformed accounting integrity", () => {
  it.each(MALFORMED_BY_FORMAT)(
    "$format reports $name without weakening direct parsing",
    ({ format, corrupt }) => {
      const document = corrupt(ledger("valid-run", format));
      expect(() => parseLisaUsageSection(document)).toThrow();
      for (const expected of [undefined, { entryIds: ["z-last", ENTRY_ID] }]) {
        const result = verifyLisaUsageSectionIntegrity(document, expected);
        expect(result.ok).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]?.code).toBe("malformed-usage-section");
        expect(result.issues[0]?.entryIds).toStrictEqual(
          expected ? [ENTRY_ID, "z-last"] : []
        );
        expect(result.issues[0]?.message).toMatch(/repair/i);
        expect(result.issues[0]?.message).not.toContain(document);
        expect(result.issues[0]?.message).not.toContain("<!-- lisa:usage-");
        expect(result.issues[0]?.message).not.toContain(MALFORMED_NUMBER);
        expect(expected?.entryIds).toStrictEqual(
          expected ? ["z-last", ENTRY_ID] : undefined
        );
      }
    }
  );

  it("retains the existing missing-section outcomes", () => {
    expect(verifyLisaUsageSectionIntegrity(DOCUMENT)).toStrictEqual({
      ok: true,
      issues: [],
    });
    const result = verifyLisaUsageSectionIntegrity(DOCUMENT, {
      entryIds: [ENTRY_ID],
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("missing-section");
    expect(result.issues[0]?.entryIds).toStrictEqual([ENTRY_ID]);
  });
});
