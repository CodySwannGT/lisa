/**
 * The criterion catalogue is read from the package Lisa runs from.
 *
 * The audit runs in repositories where Lisa was never applied, so nothing in
 * the host repository can be the source of the requirements. These cases pin
 * where the catalogue is found and what the loader hands on
 * (CodySwannGT/lisa#4978).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CATALOGUE_PACKAGE_PATH,
  CRITERION_ANSWERED,
  criterionIdsIn,
  inScopeCriteria,
  loadCriterionCatalogue,
  resolveCataloguePath,
} from "../../../src/controls/catalogue.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const scratch: string[] = [];

/** The fields the loader needs from an in-scope entry, and no others. */
const IN_SCOPE_ENTRY = {
  id: "AC1.1",
  title: "Attribution",
  in_scope: true,
  question: "Is it recorded?",
  answered: "part",
} as const;

/**
 * Write a candidate catalogue to a scratch file.
 * @param document - What the file holds
 * @returns The file's path
 */
function catalogueFile(document: unknown): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-catalogue-"));
  const file = path.join(folder, "catalogue.json");
  scratch.push(folder);
  writeFileSync(file, JSON.stringify(document));
  return file;
}

afterEach(() => {
  scratch.splice(0).forEach(folder => {
    rmSync(folder, { force: true, recursive: true });
  });
});

describe("the criterion catalogue the package ships", () => {
  it("is found beside the package, not in the working directory", () => {
    expect(resolveCataloguePath()).toBe(
      path.join(REPO_ROOT, CATALOGUE_PACKAGE_PATH)
    );
  });

  it("lists every criterion once, with the in-scope ones in order", () => {
    const catalogue = loadCriterionCatalogue();
    const ids = catalogue.criteria.map(criterion => criterion.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(inScopeCriteria(catalogue).map(criterion => criterion.id)).toEqual(
      catalogue.criteria
        .filter(criterion => criterion.in_scope)
        .map(criterion => criterion.id)
    );
    expect(inScopeCriteria(catalogue).length).toBeGreaterThan(0);
  });

  it("gives every in-scope criterion its plain-language question", () => {
    inScopeCriteria(loadCriterionCatalogue()).forEach(criterion => {
      expect(criterion.question.endsWith("?")).toBe(true);
      expect(criterionIdsIn(criterion.question)).toEqual([]);
    });
  });

  it("says where every in-scope criterion is answered: once, or once per part", () => {
    const answered = inScopeCriteria(loadCriterionCatalogue()).map(
      criterion => criterion.answered
    );

    expect(new Set(answered)).toEqual(new Set(CRITERION_ANSWERED));
    expect([...CRITERION_ANSWERED]).toEqual(["repository", "part"]);
  });

  it("keeps keys it does not know, so a later field needs no change here", () => {
    const file = catalogueFile({
      specification: "spec/example.md",
      specification_version: "1",
      level: 1,
      criteria: [
        {
          ...IN_SCOPE_ENTRY,
          kind: "gate",
          minimum_rung: "observed",
          not_applicable_when: "never",
          gates: ["example-gate"],
        },
        { id: "AC9.6", title: "Left out", in_scope: false },
      ],
    });

    expect(inScopeCriteria(loadCriterionCatalogue(file))).toEqual([
      expect.objectContaining({
        id: "AC1.1",
        answered: "part",
        gates: ["example-gate"],
      }),
    ]);
  });

  it.each([
    { name: "a list", document: [] },
    { name: "no criteria", document: { level: 1 } },
    {
      name: "an entry with no id",
      document: { criteria: [{ in_scope: true }] },
    },
    {
      name: "an in-scope entry with no question",
      document: {
        criteria: [{ ...IN_SCOPE_ENTRY, question: undefined }],
      },
    },
    {
      name: "an in-scope entry that does not say where it is answered",
      document: {
        criteria: [{ ...IN_SCOPE_ENTRY, answered: undefined }],
      },
    },
    {
      name: "an in-scope entry answered somewhere other than repository or part",
      document: { criteria: [{ ...IN_SCOPE_ENTRY, answered: "folder" }] },
    },
  ])("refuses $name instead of auditing against it", ({ document }) => {
    expect(() => loadCriterionCatalogue(catalogueFile(document))).toThrow(
      /criterion catalogue/u
    );
  });
});

describe("criterionIdsIn", () => {
  it("finds every form of criterion id", () => {
    expect(criterionIdsIn("See AC5.1, SI2 and UX1; DP3 too.")).toEqual([
      "AC5.1",
      "SI2",
      "UX1",
      "DP3",
    ]);
  });

  it("leaves ordinary words alone", () => {
    expect(
      criterionIdsIn("Run the linter on every commit. ACME, SIM and UX.")
    ).toEqual([]);
  });
});
