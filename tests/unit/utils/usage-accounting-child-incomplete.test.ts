/**
 * A child run with no token total (unavailable telemetry) leaves a child rollup
 * partial, exactly as a measured subset does, so the rollup must say so
 * instead of storing the sum of only the known runs (CodySwannGT/lisa#4955).
 * @module tests/unit/utils/usage-accounting-child-incomplete
 */
import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  type LisaUsageChildArtifact,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
import { ARTIFACT_DOCUMENT, makeEntry } from "./usage-accounting-fixtures.js";

const CHILD_REF_ONE = "github:issue:900";
const CHILD_REF_TWO = "github:issue:901";
const CHILD_ENTRY_SHARED = "shared-child";
const CHILD_ENTRY_UNIQUE = "unique-child";
const FLOW_VERIFY = "lisa-verify";

describe("usage-accounting child rollup completeness", () => {
  it("marks child tokens incomplete when a child run has no token total", () => {
    const known = makeEntry({
      artifactRef: CHILD_REF_ONE,
      entryId: CHILD_ENTRY_SHARED,
      flow: FLOW_VERIFY,
      runId: "run-known",
      totalTokens: 80,
    });
    const unavailable = makeEntry({
      artifactRef: CHILD_REF_TWO,
      entryId: CHILD_ENTRY_UNIQUE,
      flow: FLOW_VERIFY,
      runId: "run-unavailable",
      source: "unavailable",
      totalTokens: null,
    });
    const childArtifacts: readonly LisaUsageChildArtifact[] = [
      { artifactRef: CHILD_REF_ONE, entries: [known] },
      { artifactRef: CHILD_REF_TWO, entries: [unavailable] },
    ];
    const direct = makeEntry({ entryId: "entry-1", runId: "run-1" });

    const rollup = createLisaUsageRollup([direct], null, childArtifacts);
    const parsed = parseLisaUsageSection(
      upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
        entries: [direct],
        childArtifacts,
      })
    );

    expect(rollup.childTokensIncomplete).toBe(true);
    expect(rollup.childTokens).toBe(null);
    expect(parsed.rollup?.childTokensIncomplete).toBe(true);
    expect(parsed.rollup?.totalTokens).toBe(null);
  });
});
