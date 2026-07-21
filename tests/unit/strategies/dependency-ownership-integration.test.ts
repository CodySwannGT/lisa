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
 * Those five prove each piece is internally consistent. None of them proves the
 * five are ONE layer. That is what this file is for: the two journeys an
 * operator actually meets — adding a dependency, and taking one in-house —
 * walked across every surface at once, asserting that a class named on a work
 * item resolves in the taxonomy, lands in the record's trust-basis field in the
 * record's own nine-field shape, and leaves the manifest as the single edit site
 * for the pin.
 *
 * Work-item legs REUSE the per-story ticket fixtures rather than duplicating
 * them. The new fixtures under `tests/fixtures/dependency-ownership/` supply
 * only what those tickets did not carry: the resulting decision record and the
 * mini host project the duplicate-version detector runs against.
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
  ADDITION_TICKET,
  BUMP_TICKET,
  DECOMPOSITION,
  DUPLICATE_CHECK,
  FIELD_LABELS,
  INTERNALIZATION_PROJECT,
  INTERNALIZATION_TICKET,
  KIT_CRITERIA,
  MANIFEST,
  OPERATOR_DOC,
  RECORD_PATH,
  SCAFFOLD,
  SEED,
  TRUST_CLASSES,
  TRUST_CLASS_EAGER,
  TRUST_CLASS_REFERENCE,
  byName,
  flat,
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

describe("the dependency-ownership layer speaks one vocabulary", () => {
  it("uses the same six trust-class names on every surface that defines or teaches them", () => {
    // If any surface spelled a class differently, a work item could name a class
    // the record could never resolve, and the layer would be five documents that
    // merely look related.
    const surfaces = [
      read(TRUST_CLASS_EAGER),
      read(TRUST_CLASS_REFERENCE),
      read(DECOMPOSITION),
      read(OPERATOR_DOC),
    ].map(text => text.toLowerCase());

    for (const surface of surfaces) {
      for (const trustClass of TRUST_CLASSES) {
        expect(surface).toContain(trustClass);
      }
    }
  });

  it("lets every consuming record name only classes the taxonomy defines", () => {
    // The consumers — Lisa's own seeded records and both journey records — carry
    // whatever classes their real dependencies fall into, not all six. What must
    // hold is the other direction: every class they DO name is one of the six.
    const CLASS_CITATION =
      /Trust class(?: after the move)?: \*\*(?<name>[^*]+)\*\*/gu;

    for (const consumer of [
      read(SEED),
      readRecord(ADDITION_PROJECT),
      readRecord(INTERNALIZATION_PROJECT),
    ].map(flat)) {
      const cited = [...consumer.matchAll(CLASS_CITATION)].map(match =>
        (match.groups?.name ?? "").trim()
      );

      expect(cited.length).toBeGreaterThan(0);
      for (const name of cited) {
        expect(TRUST_CLASSES, `undefined trust class: ${name}`).toContain(name);
      }
    }
  });

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

  it("routes every surface to the same record path", () => {
    for (const surface of [
      read("plugins/src/base/rules/eager/dependency-decision-records.md"),
      read("plugins/src/base/rules/reference/dependency-decision-records.md"),
      read(TRUST_CLASS_EAGER),
      read(DECOMPOSITION),
      read(ADDITION_TICKET),
      read(OPERATOR_DOC),
    ]) {
      expect(surface).toContain(RECORD_PATH);
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
  const ticket = read(ADDITION_TICKET);
  const entries = readEntries(readRecord(ADDITION_PROJECT));
  const entry = entries[0];

  it("produces exactly one record entry, for the package the work item added", () => {
    expect(entries).toHaveLength(1);
    expect(entry?.heading).toBe("stripe");
    expect(entry?.body).toContain("`stripe` (Node SDK) `18.5.0`");
    // The ticket's second acceptance criterion is what this entry discharges.
    expect(ticket).toContain("naming its trust class");
  });

  it("names a trust class the taxonomy actually defines", () => {
    const declared = /\*\*Trust class:\*\* (?<name>.+)/u.exec(ticket)?.groups
      ?.name;

    expect(declared).toBe("runtime-critical service client");
    expect(TRUST_CLASSES).toContain(declared);
    expect(read(TRUST_CLASS_REFERENCE)).toContain(declared ?? "");
  });

  it("resolves the record's trust basis to the class the work item named", () => {
    expect(entry?.body).toContain(
      "Trust class: **runtime-critical service client**"
    );
    expect(entry?.body).toContain(
      "Human review is triggered by any version change"
    );
  });

  it("marks detection evidence as an open gap instead of claiming a check that does not exist", () => {
    // The fixture project ships no test that exercises the payment client, so a
    // record naming one would be a false claim — the exact failure this layer
    // exists to prevent. An honest `_Not yet decided_` is the correct entry.
    expect(entry?.body).toContain(
      "**What would catch a bad update (detection evidence):** `_Not yet decided_`"
    );
    expect(entry?.body).toContain("**Class requirement not currently met:**");
    // Only the detection field defers. The other eight are answered, so the gap
    // is a specific missing check rather than an unwritten record.
    expect(entry?.body.split("_Not yet decided_").length - 1).toBe(1);
  });

  it("treats that gap as an escalation, because this class forbids blind trust", () => {
    // The taxonomy's rule for this class: "nothing would catch it" is a
    // rejection, not a disclosure. The record has to say which of the two it is.
    expect(entry?.body).toContain("this line is an escalation, not a to-do");
    expect(read(TRUST_CLASS_REFERENCE)).toContain(
      '"Nothing would catch it" is not an acceptable answer in this class'
    );
  });

  it("keeps the install-only script from posing as detection evidence", () => {
    // The script derives the pin and installs it. Naming it a smoke test in the
    // workflow would put a claim in the pipeline that the record would inherit.
    const script = read(
      path.join(ADDITION_PROJECT, "scripts/install-payment-client.sh")
    );
    const workflow = read(
      path.join(ADDITION_PROJECT, ".github/workflows/deploy.yml")
    );

    expect(script).toContain("It INSTALLS and nothing more.");
    expect(workflow).toContain(
      "Install the payment client at the manifest's pinned version"
    );
    expect(workflow).not.toContain("Smoke-test");
    // The record names the script only to explain what it does NOT prove.
    expect(entry?.body).toContain("asserts nothing about behavior");
  });

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

  it("does NOT inherit the confidence-rebuild kit, because ownership did not move", () => {
    // The negative half of the tie: an addition is not an internalization, and
    // over-applying the kit is a real failure rather than harmless caution.
    for (const criterion of KIT_CRITERIA) {
      expect(ticket).not.toContain(`Scenario: ${criterion}`);
    }
    expect(entry?.body).not.toContain("confidence-rebuild kit");
  });

  it("reads coherently against Lisa's own seeded records", () => {
    // DEP-4 is the dogfood proof. Both open the trust basis by naming the class,
    // so an operator who learned to read one can read the other.
    expect(read(SEED)).toContain(
      "Each **trust basis** field opens by naming the dependency's trust class"
    );
    expect(read(SEED)).toContain("Trust class: **");
    expect(entry?.body).toContain("Trust class: **");
  });
});

describe("scenario 2 — a dependency is INTERNALIZED (adds DEP-5)", () => {
  const ticket = read(INTERNALIZATION_TICKET);
  const entries = readEntries(readRecord(INTERNALIZATION_PROJECT));
  const entry = entries[0];

  it("carries all seven kit criteria on the work item, and nothing else", () => {
    for (const criterion of KIT_CRITERIA) {
      expect(ticket).toContain(`Scenario: ${criterion} --`);
    }
    expect(ticket.split("Scenario:").length - 1).toBe(KIT_CRITERIA.length);
  });

  it("moves the dependency into the in-house trust class the taxonomy defines", () => {
    const declared = /\*\*Trust class after the move:\*\* (?<name>[^—\n]+)/u
      .exec(ticket)
      ?.groups?.name?.trim();

    expect(declared).toBe("thin wrapper suitable for in-house ownership");
    expect(TRUST_CLASSES).toContain(declared);
    expect(entry?.body).toContain(
      "Trust class after the move: **thin wrapper suitable for in-house ownership**"
    );
  });

  it("retires the record entry in place instead of deleting it", () => {
    // Deleting it would delete the reason we once trusted the dependency and the
    // conditions for going back — the two things a later reader needs most.
    expect(entries).toHaveLength(1);
    expect(entry?.heading).toBe(
      "slugify (retired — capability moved in-house 2026-07-21)"
    );
    expect(entry?.body).toContain("We no longer do.");
    expect(entry?.body).toContain("removed from the manifest in this change");
  });

  it("records the kit's rollback target so the revert stays real", () => {
    // The kit's seventh evidence type is worthless if the version to roll back to
    // lives only in a pull request nobody will find again.
    expect(flat(ticket)).toContain(
      "Then we reinstall slugify at the pinned version"
    );
    expect(entry?.body).toContain("`slugify` `1.6.6`");
    expect(entry?.body).toContain("one-commit revert");
  });

  it("carries the kit's conformance evidence into the record's detection field", () => {
    expect(entry?.body).toContain("scripts/verify-slugs.sh");
    expect(entry?.body).toContain("negative fixtures");
    expect(entry?.body).toContain(
      'the trust question moved from "is upstream trustworthy?" to "did we actually rebuild what upstream did?"'
    );
  });

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

  it("keeps an ordinary version bump out of the kit — the negative control", () => {
    const bump = read(BUMP_TICKET);

    expect(bump).toContain("**Move:** none. Version bump only.");
    expect(flat(bump)).toContain(
      "the confidence-rebuild kit does **not** apply"
    );
    for (const criterion of KIT_CRITERIA) {
      expect(bump).not.toContain(`Scenario: ${criterion}`);
    }
  });

  it("is wired into planning by the same skill that classifies additions", () => {
    const skill = read(DECOMPOSITION);

    expect(skill).toContain("### 4.5. Classify Any New Material Dependency");
    expect(skill).toContain(
      "### 4.6. Inherit the Confidence-Rebuild Kit When Ownership Moves In-House"
    );
    expect(skill.indexOf("### 4.5.")).toBeLessThan(skill.indexOf("### 4.6."));
  });
});
