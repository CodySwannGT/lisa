/**
 * Tests for the rename hint on a stale mapping.
 *
 * Renaming a test is ONE edit that produces TWO findings — a stale mapping and
 * an undisclosed title — and neither of them says the word rename. These cases
 * pin the hint that joins them, and, more importantly, the four ways it must
 * refuse to speak: across files, over a deletion, over a file with nothing
 * unaccounted, and over a title carrying the delimiter the message joins with.
 */
import { describe, expect, it } from "vitest";

import {
  HEALTHY_FEATURES,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_ID,
  HOME_SPEC,
  MAPPING_FILE,
  codes,
  healthyMapping,
  healthyProject,
  makeProject,
  messages,
  runGate,
} from "./bdd/support";

/** The stale-evidence defect code, named once. */
const MAPPING_EVIDENCE = "mapping-evidence";

/** A second spec file, so cross-file pairing has something to pair WITH. */
const OTHER_SPEC = "e2e/other.spec.ts";

/** A title that exists only in the other file; it must never be offered. */
const STRANGER = "a title belonging to another file entirely";

/**
 * Render a spec file declaring one test per title.
 * @param titles - Test titles, each embedded verbatim.
 * @returns Spec source.
 */
function specSource(titles: readonly string[]): string {
  return titles.map(title => `test(${JSON.stringify(title)}, () => {});`).join(
    "\n"
  );
}

describe("rename hint on a stale mapping", () => {
  it("names the one unaccounted title in the same file", () => {
    const renamed = "renders the landing page for a signed-in visitor";
    const root = healthyProject({}, { files: { [HOME_SPEC]: specSource([renamed]) } });
    const found = messages(runGate(root), MAPPING_EVIDENCE);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(JSON.stringify(renamed));
  });

  it("offers every candidate rather than guessing one", () => {
    const first = "renders the landing page header";
    const second = "renders the landing page footer";
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: specSource([first, second]) } }
    );
    const message = messages(runGate(root), MAPPING_EVIDENCE)[0] ?? "";
    expect(message).toContain(JSON.stringify(first));
    expect(message).toContain(JSON.stringify(second));
  });

  it("quotes each candidate whole, so one containing the delimiter stays recoverable", () => {
    const commas = "renders a, b and c";
    const plain = "renders d";
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: specSource([commas, plain]) } }
    );
    const message = messages(runGate(root), MAPPING_EVIDENCE)[0] ?? "";
    expect(message).toContain(
      `${JSON.stringify(commas)}, ${JSON.stringify(plain)}`
    );
  });

  it("escapes a candidate's own quote characters", () => {
    const quoted = 'renders "d"';
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: `test('${quoted}', () => {});\n` } }
    );
    const message = messages(runGate(root), MAPPING_EVIDENCE)[0] ?? "";
    expect(message).toContain(JSON.stringify(quoted));
    expect(message).toContain('\\"');
  });

  it("never pairs a stale mapping with a title from a different file", () => {
    const root = healthyProject(
      {},
      {
        files: {
          [HOME_SPEC]: "export const noTestsHere = 1;\n",
          [OTHER_SPEC]: specSource([STRANGER]),
        },
      }
    );
    const run = runGate(root);
    expect(codes(run)).toContain("spec-undisclosed");
    const message = messages(run, MAPPING_EVIDENCE)[0] ?? "";
    expect(message).not.toContain(STRANGER);
    expect(message).toBe(
      `coverage-map.mappings[0] ${HOME_ID}: ${HOME_SPEC} no longer contains ${JSON.stringify(HOME_EVIDENCE)}`
    );
  });

  it("reports a deleted file as the deletion it is, with no candidate", () => {
    const root = makeProject({
      map: HEALTHY_MAP,
      features: HEALTHY_FEATURES,
      files: { [OTHER_SPEC]: specSource([STRANGER]) },
    });
    const run = runGate(root);
    expect(codes(run)).toContain(MAPPING_FILE);
    const message = messages(run, MAPPING_FILE)[0] ?? "";
    expect(message).not.toContain(STRANGER);
    expect(message).not.toContain("rename");
  });

  it("never offers a rename to a mapping that declared no evidence at all", () => {
    const root = healthyProject(
      { mappings: [{ ...healthyMapping(), evidence: "" }] },
      { files: { [HOME_SPEC]: specSource(["a title nothing accounts for"]) } }
    );
    const message = messages(runGate(root), MAPPING_EVIDENCE)[0] ?? "";
    expect(message).toContain("declares no evidence string");
    expect(message).not.toContain("rename");
  });

  it("leaves the finding unchanged when the file has nothing unaccounted", () => {
    const excluded = "a deliberately unmapped test";
    const root = healthyProject(
      {
        exclusions: [
          {
            file: HOME_SPEC,
            evidence: excluded,
            reason: "asserts a fixture, not a product behavior",
          },
        ],
      },
      { files: { [HOME_SPEC]: specSource([excluded]) } }
    );
    expect(messages(runGate(root), MAPPING_EVIDENCE)[0]).toBe(
      `coverage-map.mappings[0] ${HOME_ID}: ${HOME_SPEC} no longer contains ${JSON.stringify(HOME_EVIDENCE)}`
    );
  });

  it("changes no verdict: a renamed test still fails and still counts as uncovered", () => {
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: specSource(["renders the landing page, eventually"]) } }
    );
    const run = runGate(root);
    expect(run.status).toBe(1);
    expect(codes(run)).toContain(MAPPING_EVIDENCE);
    expect(codes(run)).toContain("spec-undisclosed");
    expect(run.envelope.summary.traceabilityCovered).toBe(0);
    expect(run.envelope.summary.traceabilityTotal).toBe(1);
  });
});
