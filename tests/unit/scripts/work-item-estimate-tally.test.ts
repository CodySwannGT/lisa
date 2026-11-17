/**
 * The completion tally (CodySwannGT/lisa#4956): the actual tokens and dollar
 * cost from the usage ledger, shown beside the estimate, and the done-phase
 * gate that requires them when `workItem.estimate.required` holds.
 * @module tests/unit/scripts/work-item-estimate-tally
 */
import { describe, expect, it } from "vitest";

import { primarySpecProjection } from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import { resolveEstimateConfig } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import { checkEstimate } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-check.mjs";
import {
  ledgerActual,
  tallyEstimate,
} from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-tally.mjs";
import { upsertLisaUsageSection } from "../../../src/utils/usage-accounting.js";
import {
  ESTIMATE_ON,
  finishedItem,
  PLAIN_BODY,
  usageEntry,
} from "../../support/work-item-estimate-fixtures.js";

const OFF = resolveEstimateConfig({
  workItem: { estimate: { required: false } },
});
const spent = finishedItem(2_000_000, 4_000_000, [
  usageEntry("implement", 2_000_000, 8),
  usageEntry("verify", 1_000_000, 4),
]);

describe("tally", () => {
  it("shows the ledger total beside the estimate", () => {
    const tallied = tallyEstimate(spent);
    expect(tallied).toContain("| Actual | 3M | $12.00 USD | — |");
    expect(tallied).toMatch(/\| Estimate \| 2M–4M \|/);
    expect(tallied).toContain(
      "Actual: the Lisa Usage ledger total over 2 usage entries (source: observed); 1x the estimate's midpoint."
    );
    expect(tallied).toContain(
      "<!-- lisa:estimate-actual tokens=3000000 cost=12 currency=USD sources=observed entries=2 ratio=1 -->"
    );
  });

  it("records unavailable telemetry as unknown, never as zero", () => {
    const tallied = tallyEstimate(
      finishedItem(1000, 2000, [usageEntry("verify", null)])
    );
    expect(tallied).toContain("| Actual | unknown | unknown | — |");
    expect(tallied).toContain("(source: unavailable)");
    expect(ledgerActual([tallied])).toMatchObject({
      tokens: null,
      cost: null,
    });
  });

  it("keeps a measured subset's total unknown", () => {
    const body = upsertLisaUsageSection(finishedItem(1000, 2000, []), {
      entries: [
        {
          ...usageEntry("plan", null),
          source: "measured-subset",
          measuredSubsetTokens: 500,
        },
      ],
    });
    expect(ledgerActual([body])?.tokens).toBe(null);
  });

  it("shows an honest row when no estimate was recorded before work", () => {
    const body = upsertLisaUsageSection(PLAIN_BODY, {
      entries: [usageEntry("verify", 10)],
    });
    const tallied = tallyEstimate(body);
    expect(tallied).toContain("| Estimate | none recorded | — | — |");
    expect(tallied).toContain("| Actual | 10 |");
  });

  it("reads the ledger from a comment when the body has none", () => {
    const comment = upsertLisaUsageSection("", {
      entries: [usageEntry("verify", 5_000)],
    });
    const body = finishedItem(1000, 2000, []);
    expect(tallyEstimate(body, [body, comment])).toContain("| Actual | 5k |");
  });

  it("refuses to tally without a usage entry", () => {
    expect(() => tallyEstimate(PLAIN_BODY)).toThrow(/No Lisa Usage entry/);
  });

  it("rewrites the tally in place", () => {
    const twice = tallyEstimate(tallyEstimate(spent));
    expect(twice).toBe(tallyEstimate(spent));
    expect(twice.match(/lisa:estimate-actual/g)).toHaveLength(1);
  });
});

describe("gate S21 at done time", () => {
  it("passes once the actual is tallied", () => {
    expect(checkEstimate(tallyEstimate(spent), ESTIMATE_ON, "done")).toEqual({
      verdict: "PASS",
      lines: ["The actual tokens and cost are tallied beside the estimate."],
    });
  });

  it("fails an item with no usage entry, naming it", () => {
    const result = checkEstimate(PLAIN_BODY, ESTIMATE_ON, "done");
    expect(result.verdict).toBe("FAIL");
    expect(result.lines[0]).toMatch(
      /No Lisa Usage entry is recorded on this item\. It cannot reach done without one/
    );
  });

  it("fails an item whose actual has not been tallied", () => {
    expect(checkEstimate(spent, ESTIMATE_ON, "done").lines[0]).toMatch(
      /does not yet show the actual/
    );
  });

  it("fails a stale tally after more usage was recorded", () => {
    const stale = upsertLisaUsageSection(tallyEstimate(spent), {
      entries: [usageEntry("fix", 500_000, 2)],
    });
    const result = checkEstimate(stale, ESTIMATE_ON, "done");
    expect(result.verdict).toBe("FAIL");
    expect(result.lines[0]).toMatch(/tally is stale/);
  });

  it("is N/A when the requirement is off", () => {
    expect(checkEstimate(PLAIN_BODY, OFF, "done").verdict).toBe("N/A");
  });
});

describe("completion proof specification digest", () => {
  it("ignores the machine-written estimate and tally", () => {
    // The blank line that separated the spec from the section stays.
    const spec = "## Context\n\nFix the thing.\n\n";
    expect(primarySpecProjection(tallyEstimate(spent))).toBe(
      primarySpecProjection(spent)
    );
    expect(primarySpecProjection(finishedItem(1000, 2000, []))).toBe(spec);
  });

  it("still counts prose a person adds inside the section", () => {
    const edited = finishedItem(1000, 2000, []).replace(
      "Basis:",
      "Also cover the admin screen.\n\nBasis:"
    );
    expect(primarySpecProjection(edited)).toContain(
      "Also cover the admin screen."
    );
  });

  it("refuses duplicate estimate sections as ambiguous", () => {
    const one = finishedItem(1000, 2000, []);
    expect(() =>
      primarySpecProjection(
        `${one}\n${one.slice(one.indexOf("## Lisa Estimate"))}`
      )
    ).toThrow(/Duplicate token-estimate sections/);
  });
});
