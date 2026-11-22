/**
 * Comparing a committed control register with the one its declaration
 * produces.
 *
 * The comparison has to name something a person can find in the file. These
 * cases are the committed files that cannot be matched entry by entry: one
 * that is not a register at all, and entries that carry no identifier or
 * share one (CodySwannGT/lisa#4983).
 */
import { describe, expect, it } from "vitest";

import { serializeControlRegister } from "../../../src/controls/register.js";
import { controlRegisterDrift } from "../../../src/controls/register-drift.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "../../../src/controls/register-types.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { BARE_ENTRY, ENTRY } from "./support/register-samples.js";

const EXPECTED: ControlRegister = {
  schema_version: 1,
  entries: [ENTRY, { ...BARE_ENTRY, id: "code-style@web", scope: "web" }],
};

/**
 * Compare a hand-written file with the expected register.
 * @param document - What the committed file holds
 * @returns One line per difference
 */
function driftOf(document: unknown): readonly string[] {
  return controlRegisterDrift(
    `${JSON.stringify(document, null, 2)}\n`,
    EXPECTED
  );
}

describe("comparing a committed register", () => {
  it("finds nothing in the file the generator writes", () => {
    expect(
      controlRegisterDrift(serializeControlRegister(EXPECTED), EXPECTED)
    ).toEqual([]);
  });

  it.each([
    ["a list", []],
    ["an object with no entries", { schema_version: 1 }],
    ["entries that are not a list", { schema_version: 1, entries: {} }],
    ["nothing", null],
  ])("says %s is not a control register", (_what, document) => {
    expect(driftOf(document)).toEqual([
      `${CONTROL_REGISTER_PATH} is not a control register: it has no list of entries.`,
    ]);
  });

  it("points at an entry with no id by its place in the file", () => {
    const { id: _id, ...unnamed } = ENTRY;

    expect(
      driftOf({ ...EXPECTED, entries: [unnamed, EXPECTED.entries[1]] })
    ).toEqual([
      `Entry number 1 in ${CONTROL_REGISTER_PATH} has no id, so it cannot be matched to a gate.`,
      `The entry "code-style@api" is missing from ${CONTROL_REGISTER_PATH}: the gates declaration produces it.`,
    ]);
  });

  it("reports an id that appears twice, once", () => {
    expect(
      driftOf({ ...EXPECTED, entries: [...EXPECTED.entries, ENTRY, ENTRY] })
    ).toEqual([
      `The entry "code-style@api" appears more than once in ${CONTROL_REGISTER_PATH}.`,
    ]);
  });

  it("names the mismatched entry without quoting credential-shaped identifiers", () => {
    const token = fakeGithubToken();
    const drift = driftOf({
      ...EXPECTED,
      entries: [...EXPECTED.entries, { ...ENTRY, id: `code-style@${token}` }],
    }).join("\n");

    expect(drift).toContain('The entry "code-style@[REDACTED:GITHUB_TOKEN]"');
    expect(drift).toContain(CONTROL_REGISTER_PATH);
    expect(drift).not.toContain(token);
  });

  it("names a field that was removed from an entry", () => {
    const { proof: _proof, ...withoutProof } = ENTRY;

    expect(
      driftOf({ ...EXPECTED, entries: [withoutProof, EXPECTED.entries[1]] })
    ).toEqual([
      `The entry "code-style@api" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: proof differs.`,
    ]);
  });

  it("does not report a difference in the order of an entry's keys as a difference in the entry", () => {
    const reordered = Object.fromEntries(Object.entries(ENTRY).reverse());

    expect(
      driftOf({ ...EXPECTED, entries: [reordered, EXPECTED.entries[1]] })
    ).toEqual([
      `Every entry in ${CONTROL_REGISTER_PATH} matches the gates declaration, but the file's spacing or the order of its keys is not what is generated.`,
    ]);
  });
});
