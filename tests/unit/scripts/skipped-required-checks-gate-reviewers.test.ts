/**
 * The vacuity checker reads a project's third-party reviewer from the gates
 * config too, so the gates config is where a reviewer is declared
 * (CodySwannGT/lisa#4914).
 *
 * `check-skipped-required-checks.mjs` ships in the typescript template and
 * reads `.github/required-checks.json` `evidence_bearing_checks`. The review
 * evidence prover ships in `all/` and reads `.lisa.config.json` gates
 * (CodySwannGT/lisa#4909). Before this, a project that switched vendors in
 * the gates config left the vacuity checker examining the old one.
 * @module tests/unit/scripts/skipped-required-checks-gate-reviewers
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { configuredReviewers } from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";
import {
  classifyCheckDescription,
  DESCRIPTION_VERDICTS,
  loadDeclaration as loadUntypedDeclaration,
} from "../../../typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const leases: string[] = [];
const BASE = {
  required_contexts: [],
  workflows: [".github/workflows/ci.yml"],
  skip_job_declarations: {},
};

/** The part of a loaded declaration these cases read. */
interface LoadedDeclaration {
  evidence_bearing_checks: Record<string, Record<string, unknown>>;
}

/**
 * Load a project's declaration, typed for the fields these cases read.
 * @param root - The project root
 * @returns The loaded declaration
 */
function loadDeclaration(root: string): LoadedDeclaration {
  return loadUntypedDeclaration(root) as unknown as LoadedDeclaration;
}

/**
 * Write a project with a required-checks declaration and, optionally, a
 * `.lisa.config.json`.
 * @param declaration - The `.github/required-checks.json` body
 * @param gates - The `gates` block, or undefined for no `.lisa.config.json`
 * @returns The project root
 */
function project(
  declaration: Record<string, unknown>,
  gates?: Record<string, unknown>
): string {
  const root = mkdtempSync(join(tmpdir(), "skipreq-gate-reviewers-"));
  leases.push(root);
  mkdirSync(join(root, ".github"), { recursive: true });
  writeFileSync(
    join(root, ".github/required-checks.json"),
    JSON.stringify(declaration)
  );
  if (gates !== undefined) {
    writeFileSync(join(root, ".lisa.config.json"), JSON.stringify({ gates }));
  }
  return root;
}

/**
 * A pull-request reviewer gate.
 * @param context - The awaited context
 * @param evidence - Extra evidence keys
 * @returns The gate
 */
function reviewerGate(
  context: string,
  evidence: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    "pull-request": {
      level: "required",
      await: context,
      evidence: { reviewer: true, proof: ["Review completed"], ...evidence },
    },
  };
}

afterEach(() => {
  for (const root of leases.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("gates-config reviewers are evidence-bearing (#4914)", () => {
  it("adds a reviewer declared only in the gates config", () => {
    const root = project(BASE, { "code-review": reviewerGate("Greptile") });
    const declaration = loadDeclaration(root);
    expect(Object.keys(declaration.evidence_bearing_checks)).toEqual([
      "Greptile",
    ]);
  });

  it("carries the gate's proof and no_work phrases into classification", () => {
    const root = project(BASE, {
      "code-review": reviewerGate("Greptile", {
        proof: ["Looks good"],
        no_work: ["paused"],
      }),
    });
    const vocabulary = loadDeclaration(root).evidence_bearing_checks.Greptile;
    expect(classifyCheckDescription("Looks good", vocabulary)).toBe(
      DESCRIPTION_VERDICTS.proved
    );
    expect(classifyCheckDescription("Review paused", vocabulary)).toBe(
      DESCRIPTION_VERDICTS.noWork
    );
  });

  it("leaves a declaration without .lisa.config.json unchanged", () => {
    const declared = {
      ...BASE,
      evidence_bearing_checks: { CodeRabbit: {} },
    };
    expect(loadDeclaration(project(declared))).toEqual(declared);
  });

  it("leaves a declaration unchanged when no gate is a reviewer", () => {
    const root = project(BASE, {
      runner: "npm",
      "credential-leakage": {
        "pull-request": { level: "required", await: "GitGuardian" },
      },
      "code-review": { push: "off" },
    });
    expect(loadDeclaration(root)).toEqual(BASE);
  });

  it("keeps evidence_bearing_checks entries beside the gate's reviewer", () => {
    const root = project(
      { ...BASE, evidence_bearing_checks: { CodeRabbit: {} } },
      { "code-review": reviewerGate("Greptile") }
    );
    expect(
      Object.keys(loadDeclaration(root).evidence_bearing_checks).sort(
        (left, right) => left.localeCompare(right)
      )
    ).toEqual(["CodeRabbit", "Greptile"]);
  });

  it("unions the phrases when both declare the same check", () => {
    const root = project(
      {
        ...BASE,
        evidence_bearing_checks: {
          CodeRabbit: { proof: ["A"], no_work: ["x"] },
        },
      },
      {
        "code-review": reviewerGate("CodeRabbit", {
          proof: ["B"],
          no_work: ["y"],
        }),
      }
    );
    expect(loadDeclaration(root).evidence_bearing_checks.CodeRabbit).toEqual({
      proof: ["A", "B"],
      no_work: ["x", "y"],
    });
  });

  it("does not add a reviewer proven by its own submitted review", () => {
    const root = project(BASE, {
      "code-review": reviewerGate("Some Reviewer", {
        review_by: "some-reviewer[bot]",
      }),
    });
    expect(loadDeclaration(root)).toEqual(BASE);
  });

  it("refuses an evidence-bearing registration deferral for a gate reviewer", () => {
    const root = project(
      {
        ...BASE,
        required_contexts: ["Greptile"],
        registration_deferred: { Greptile: "slow" },
      },
      { "code-review": reviewerGate("Greptile") }
    );
    expect(() => loadDeclaration(root)).toThrow(/evidence-bearing/);
  });

  it("refuses a .lisa.config.json that does not parse", () => {
    const root = project(BASE);
    writeFileSync(join(root, ".lisa.config.json"), "{ not json");
    expect(() => loadDeclaration(root)).toThrow(/\.lisa\.config\.json/);
  });

  it("names the same reviewers as the evidence prover, minus review_by gates", () => {
    const gates = {
      "code-review": reviewerGate("CodeRabbit"),
      "second-review": reviewerGate("Greptile"),
      "third-review": reviewerGate("Reviewed By Hand", {
        review_by: "a-bot[bot]",
      }),
      "credential-leakage": {
        "pull-request": { level: "required", await: "GitGuardian" },
      },
    };
    const expected = configuredReviewers({ gates })
      .filter(reviewer => reviewer.reviewBy === undefined)
      .map(reviewer => reviewer.context)
      .sort((left, right) => left.localeCompare(right));
    const root = project(BASE, gates);
    expect(
      Object.keys(loadDeclaration(root).evidence_bearing_checks).sort(
        (left, right) => left.localeCompare(right)
      )
    ).toEqual(expected);
  });
});

describe("shipped required-checks seeds (#4914)", () => {
  const root = resolve(import.meta.dirname, "../../..");
  it.each(["typescript", "expo", "nestjs"])(
    "%s still names CodeRabbit, because no reviewer gate is seeded",
    stack => {
      const seed = JSON.parse(
        readFileSync(
          join(root, stack, "create-only/.github/required-checks.json"),
          "utf8"
        )
      );
      expect(seed.evidence_bearing_checks).toEqual({ CodeRabbit: {} });
      expect(seed._readme.join("\n")).toContain("CodySwannGT/lisa#4914");
    }
  );
});
