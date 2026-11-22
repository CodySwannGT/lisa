/**
 * Linear normalizes Markdown on storage, so the canonical `## Lisa Usage`
 * section is read back with its italic note as `*…*` instead of `_…_` and its
 * table alignment row as `| -- | -- | -- | -- | -- |` instead of
 * `| --- | --- | --- | ---: | ---: |`. The completion spec projection must treat
 * those normalized boilerplate lines exactly like the canonical ones; otherwise
 * they are hashed into `spec_sha256` and any later rollup refresh invalidates an
 * already-accepted completion proof (CodySwannGT/lisa#4690; same family as
 * #4670). Genuinely unknown prose and rows inside the section must still count.
 */
import { describe, expect, it } from "vitest";

import { usageSpecRemainder } from "../../../all/copy-overwrite/scripts/lib/completion-proof-projection.mjs";
import {
  primarySpecProjection,
  sha256,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import {
  upsertLisaUsageSection,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

/** The direct entry whose tokens a rollup refresh rewrites. */
const IMPLEMENT_ID = "implement-1";
/** Linear's re-serialized table alignment row. */
const LINEAR_ALIGNMENT = "| -- | -- | -- | -- | -- |";
/** Start of the canonical table header, used as an insertion anchor. */
const HEADER_PREFIX = "| Flow | Source |";

const SPEC = [
  "## Summary",
  "",
  "Export the ledger as CSV.",
  "",
  "## Acceptance Criteria",
  "",
  "- The export command writes one row per entry.",
  "",
].join("\n");

/** A direct usage entry; `entryId` and tokens vary to force a rollup refresh. */
function entry(
  entryId: string,
  totalTokens: number | null,
  model = "synthetic-fixture"
): LisaUsageEntry {
  return {
    artifactRef: "linear:acme/ENG-1",
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId,
    flow: "lisa-implement",
    inputTokens: null,
    model,
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "fixture",
    reasoningTokens: null,
    runId: `run-${entryId}`,
    source: "unavailable",
    totalTokens,
  };
}

/** Rewrite the two boilerplate lines (and the empty-row italics) as Linear stores them. */
function storedByLinear(body: string): string {
  return body
    .replace(
      /^_(This section is managed by Lisa\.[^\n]*)_$/m,
      (_match, text: string) => `*${text}*`
    )
    .replace(/^\| --- \| --- \| --- \| ---: \| ---: \|$/m, LINEAR_ALIGNMENT)
    .replace(
      "| _No direct entries recorded_ |",
      "| *No direct entries recorded* |"
    );
}

const digest = (body: string): string =>
  sha256(Buffer.from(primarySpecProjection(body)));

describe("completion spec projection ignores Linear-normalized usage boilerplate (#4690)", () => {
  const empty = upsertLisaUsageSection(SPEC, { entries: [] });
  const withEntry = upsertLisaUsageSection(SPEC, {
    entries: [entry(IMPLEMENT_ID, 1200)],
  });

  it("the stored fixtures really are the normalized forms from the reproduction", () => {
    const stored = storedByLinear(empty);
    expect(stored).toContain("*This section is managed by Lisa.");
    expect(stored).toContain(LINEAR_ALIGNMENT);
    expect(stored).toContain("| *No direct entries recorded* |");
    expect(stored).not.toContain("| --- |");
  });

  it.each([
    ["no direct entries", empty],
    ["one direct entry", withEntry],
  ])(
    "hashes the Linear-stored body like the canonical body (%s)",
    (_name, body) => {
      expect(digest(storedByLinear(body))).toBe(digest(body));
    }
  );

  it("a canonical rollup refresh of the stored section does not change spec_sha256", () => {
    const stored = storedByLinear(withEntry);
    const accepted = digest(stored);
    const refreshed = upsertLisaUsageSection(stored, {
      entries: [entry(IMPLEMENT_ID, 1500), entry("verify-2", 300)],
    });
    expect(refreshed).not.toBe(withEntry);
    expect(refreshed).toContain("| --- | --- | --- | ---: | ---: |");
    expect(digest(refreshed)).toBe(accepted);
    expect(digest(storedByLinear(refreshed))).toBe(accepted);
  });

  it.each([
    "*New delivery requirement inside the usage section.*",
    "| -- | -- | -- | -- |",
    "| -- | -- | -- | -- | -- | -- |",
    "| -- | x- | -- | -- | -- |",
    "| *Some other italic row* | | | | |",
  ])("still hashes unknown content inside the section: %j", extra => {
    const stored = storedByLinear(empty);
    const altered = stored.replace(
      HEADER_PREFIX,
      `${extra}\n\n| Flow | Source |`
    );
    expect(
      usageSpecRemainder(altered.slice(altered.indexOf("## Lisa Usage")))
    ).toContain(extra);
    expect(digest(altered)).not.toBe(digest(stored));
  });

  it("drops a colon-aligned Linear-form separator row", () => {
    const stored = storedByLinear(empty).replace(
      LINEAR_ALIGNMENT,
      "| :-- | --: | -- | --: | --: |"
    );
    expect(stored).toContain("| :-- | --: | -- | --: | --: |");
    expect(digest(stored)).toBe(digest(empty));
  });

  it("folds one layer of Linear-escaped punctuation in the note", () => {
    const escaped = empty.replace(
      /^_(This section is managed by Lisa\.[^\n]*)_$/m,
      (_match, text: string) => `\\_${text.replaceAll(".", "\\.")}\\_`
    );
    expect(escaped).toContain(String.raw`\_This section is managed by Lisa\.`);
    expect(digest(escaped)).toBe(digest(empty));
  });

  it("folds Linear-escaped underscores in a generated entry row", () => {
    const canonical = upsertLisaUsageSection(SPEC, {
      entries: [entry(IMPLEMENT_ID, 1200, "gpt_5")],
    });
    const escaped = canonical.replace(
      "| fixture/gpt_5 |",
      String.raw`| fixture/gpt\_5 |`
    );
    expect(escaped).toContain(String.raw`fixture/gpt\_5`);
    expect(digest(escaped)).toBe(digest(canonical));
    expect(digest(storedByLinear(escaped))).toBe(digest(canonical));
  });

  it("still hashes an escaped unknown line", () => {
    const stored = storedByLinear(empty);
    const extra = String.raw`\*New delivery requirement\_kept\*`;
    const altered = stored.replace(
      HEADER_PREFIX,
      `${extra}\n\n| Flow | Source |`
    );
    expect(digest(altered)).not.toBe(digest(stored));
  });

  it("still changes the digest when a specification sentence is edited", () => {
    const stored = storedByLinear(withEntry);
    const edited = stored.replace("one row per entry", "two rows per entry");
    expect(digest(edited)).not.toBe(digest(stored));
  });
});
