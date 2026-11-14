/**
 * End-to-end integration contract for the dependency-ownership layer (#1891,
 * closing PRD #1741).
 *
 * The five surfaces built by DEP-1..DEP-5 each have their own unit test:
 *
 *   DEP-1 the record scaffold  — tests/unit/templates/dependency-decisions-template.test.ts
 *   DEP-2 the six trust classes — tests/unit/strategies/dependency-trust-classes-rule-pair.test.ts
 *   DEP-3 the duplicate check   — tests/unit/scripts/check-duplicate-versions.test.ts
 *   DEP-4 Lisa's seeded records — tests/unit/templates/lisa-dependency-decisions-seed.test.ts
 *   DEP-5 the internalization kit — tests/unit/strategies/dependency-internalization-kit-rule-pair.test.ts
 *
 * Those five prove each piece is internally consistent. This file walks the two
 * journeys an operator actually meets — adding a dependency, and taking one
 * in-house — asserting that every decision record keeps the nine-field shape
 * and that the duplicate-version detector leaves the manifest as the single
 * edit site for the pin. The prose the rules and skills use to teach the layer
 * is guidance and is reviewed, not pinned (#4867).
 *
 * The fixtures under `tests/fixtures/dependency-ownership/` supply the
 * resulting decision records and the mini host projects the detector runs
 * against.
 *
 * Parity and operator-doc coverage live in the sibling
 * `dependency-ownership-parity.test.ts`.
 *
 * @module tests/unit/strategies/dependency-ownership-integration
 */
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  STRICT_FLAG,
  runDetector,
} from "../scripts/check-duplicate-versions-helpers";
import {
  ADDITION_PROJECT,
  DUPLICATE_CHECK,
  FIELD_LABELS,
  INTERNALIZATION_PROJECT,
  MANIFEST,
  SCAFFOLD,
  SEED,
  byName,
  read,
  readEntries,
  readRecord,
} from "./dependency-ownership-helpers";

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const directory of temporaryRoots) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("the dependency-ownership layer keeps one record shape", () => {
  it("uses the same nine record fields, in order, inside EVERY entry", () => {
    // DEP-1 fixes the shape, DEP-4 dogfoods it, both journeys append to it. One
    // divergent or reordered label makes the section unappendable by script.
    //
    // Validated per ENTRY, not per document: scanning the whole file would let a
    // well-formed first entry mask a later one that dropped or reordered a
    // field, which is precisely the drift this assertion exists to catch.
    const entries = [
      read(SCAFFOLD),
      read(SEED),
      readRecord(ADDITION_PROJECT),
      readRecord(INTERNALIZATION_PROJECT),
    ].flatMap(record => readEntries(record));

    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of entries) {
      let cursor = -1;
      for (const label of FIELD_LABELS) {
        const next = entry.body.indexOf(label, cursor + 1);
        expect(
          next,
          `entry "${entry.heading}": missing or out-of-order field ${label}`
        ).toBeGreaterThan(cursor);
        cursor = next;
      }
    }
  });

  it("keeps Records last in both journey records so entries stay appendable", () => {
    for (const project of [ADDITION_PROJECT, INTERNALIZATION_PROJECT]) {
      const headings: readonly string[] =
        readRecord(project).match(/^## .+$/gmu) ?? [];

      expect(headings[headings.length - 1]).toBe("## Records");
    }
  });
});

describe("scenario 1 — a dependency is ADDED (DEP-1 + DEP-2 + DEP-3 + DEP-4)", () => {
  it("leaves the manifest as the only edit site for the new pin", () => {
    const { code, report } = runDetector(ADDITION_PROJECT, [STRICT_FLAG]);

    expect(code).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.manifests).toEqual([MANIFEST]);
  });

  it("never treats the decision record itself as a policy surface", () => {
    // The record deliberately writes versions down in prose. Scanning it would
    // make honest record-keeping look like drift, so `.lisa/` is skipped and only
    // the workflow and the governed script are read.
    const { report } = runDetector(ADDITION_PROJECT);

    expect(report.summary.files).toBe(2);
    expect(read(DUPLICATE_CHECK)).toContain('".lisa"');
  });

  it("reports the pin the moment someone copies it out of the manifest", () => {
    // The Validation Journey for the tie-together: the addition is acceptable
    // only because there is one edit site. Recreate the second one and the
    // detector names both arms — install pin and toolchain pin.
    const root = mkdtempSync(path.join(tmpdir(), "dep-ownership-"));
    const workflow = path.join(root, ".github/workflows/deploy.yml");
    const script = path.join(root, "scripts/install-payment-client.sh");

    temporaryRoots.push(root);
    cpSync(path.resolve(ADDITION_PROJECT), root, { recursive: true });
    writeFileSync(
      workflow,
      readFileSync(workflow, "utf8").replace(
        `node-version-file: ${MANIFEST}`,
        "node-version: '22.21.1'"
      )
    );
    writeFileSync(
      script,
      readFileSync(script, "utf8").replace(
        'npm install -g "stripe@${STRIPE_VERSION}"',
        "npm install -g stripe@18.5.0"
      )
    );

    const { code, report } = runDetector(root, [STRICT_FLAG]);

    expect(code).toBe(1);
    expect(report.summary.duplicate).toBe(2);
    expect(
      report.findings.map(finding => finding.package).sort(byName)
    ).toEqual(["node", "stripe"]);
    expect(report.findings.map(finding => finding.source).sort(byName)).toEqual(
      ["install-pin", "toolchain-pin"]
    );
  });
});

describe("scenario 2 — a dependency is INTERNALIZED (adds DEP-5)", () => {
  it("leaves no orphan pin behind after the removal", () => {
    const { code, report } = runDetector(INTERNALIZATION_PROJECT, [
      STRICT_FLAG,
    ]);

    expect(code).toBe(0);
    expect(report.findings).toEqual([]);
    expect(read(path.join(INTERNALIZATION_PROJECT, MANIFEST))).not.toContain(
      "slugify"
    );
  });
});
