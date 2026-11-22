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
  checksSettled,
  classifyCheckDescription,
  decodingVocabulary,
  DESCRIPTION_VERDICTS,
  evaluateVacuousChecks,
  fetchSettledChecks,
  loadDeclaration as loadUntypedDeclaration,
  vacuityRefusal,
} from "../../../typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const leases: string[] = [];
const REVIEW_BY_CONTEXT = "Some Reviewer";
const REVIEW_BY_LOGIN = "some-reviewer[bot]";
const REVIEW_COMPLETED = "Review completed";
const BASE = {
  required_contexts: [],
  workflows: [".github/workflows/ci.yml"],
  skip_job_declarations: {},
};

/** The part of a loaded declaration these cases read. */
interface LoadedDeclaration {
  evidence_bearing_checks: Record<string, Record<string, unknown>>;
  review_by_checks?: Record<string, Record<string, unknown>>;
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
      evidence: { reviewer: true, proof: [REVIEW_COMPLETED], ...evidence },
    },
  };
}

/**
 * Sort context names for comparison.
 * @param names - Context names
 * @returns The names, sorted
 */
function sorted(names: string[]): string[] {
  return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * The reviewer contexts the evidence prover reads from these gates.
 * @param gates - The `gates` block
 * @returns Sorted contexts
 */
function namedByProver(gates: Record<string, unknown>): string[] {
  return sorted(
    configuredReviewers({ gates }).map(reviewer => reviewer.context)
  );
}

/**
 * The reviewer contexts this guard reads from these gates, either set.
 * @param gates - The `gates` block
 * @returns Sorted contexts
 */
function namedByGuard(gates: Record<string, unknown>): string[] {
  const declaration = loadDeclaration(project(BASE, gates));
  return sorted([
    ...Object.keys(declaration.evidence_bearing_checks ?? {}),
    ...Object.keys(declaration.review_by_checks ?? {}),
  ]);
}

/**
 * The review_by reviewer contexts the evidence prover reads from these gates.
 * @param gates - The `gates` block
 * @returns Sorted contexts
 */
function reviewByByProver(gates: Record<string, unknown>): string[] {
  return sorted(
    configuredReviewers({ gates })
      .filter(reviewer => reviewer.reviewBy !== undefined)
      .map(reviewer => reviewer.context)
  );
}

/**
 * The review_by reviewer contexts this guard reads from these gates.
 * @param gates - The `gates` block
 * @returns Sorted contexts
 */
function reviewByByGuard(gates: Record<string, unknown>): string[] {
  return sorted(
    Object.keys(loadDeclaration(project(BASE, gates)).review_by_checks ?? {})
  );
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

  it("keeps a review_by reviewer out of evidence_bearing_checks", () => {
    const root = project(BASE, {
      "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
        review_by: REVIEW_BY_LOGIN,
      }),
    });
    const declaration = loadDeclaration(root);
    expect(declaration.evidence_bearing_checks).toBeUndefined();
    expect(Object.keys(declaration.review_by_checks ?? {})).toEqual([
      REVIEW_BY_CONTEXT,
    ]);
  });

  it("examines a review_by reviewer's check when it reports a hollow green", () => {
    const root = project(BASE, {
      "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
        review_by: REVIEW_BY_LOGIN,
      }),
    });
    const { violations } = evaluateVacuousChecks(loadDeclaration(root), [
      {
        name: REVIEW_BY_CONTEXT,
        state: "SUCCESS",
        description: "Review skipped",
      },
    ]);
    expect(violations).toEqual([
      expect.objectContaining({ kind: "vacuous_required_check" }),
    ]);
  });

  it("reports nothing for a review_by reviewer that posted no check", () => {
    const root = project(BASE, {
      "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
        review_by: REVIEW_BY_LOGIN,
      }),
    });
    const declaration = loadDeclaration(root);
    expect(evaluateVacuousChecks(declaration, []).violations).toEqual([]);
    expect(checksSettled(declaration, [])).toBe(true);
  });

  it("waits for a review_by reviewer's check that is still pending", () => {
    const root = project(BASE, {
      "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
        review_by: REVIEW_BY_LOGIN,
      }),
    });
    expect(
      checksSettled(loadDeclaration(root), [
        { name: REVIEW_BY_CONTEXT, state: "PENDING", bucket: "pending" },
      ])
    ).toBe(false);
  });

  it("still refuses a malformed declared proof beside a gate's valid one", () => {
    const root = project(
      {
        ...BASE,
        evidence_bearing_checks: { CodeRabbit: { proof: REVIEW_COMPLETED } },
      },
      { "code-review": reviewerGate("CodeRabbit") }
    );
    expect(() => loadDeclaration(root)).toThrow(
      /evidence_bearing_checks\.CodeRabbit\.proof/
    );
  });

  it("still refuses a declared null entry that a gate also names", () => {
    const root = project(
      { ...BASE, evidence_bearing_checks: { CodeRabbit: null } },
      { "code-review": reviewerGate("CodeRabbit") }
    );
    expect(() => loadDeclaration(root)).toThrow(
      /CodeRabbit.*must be an object/
    );
  });

  it.each([
    ["a string", REVIEW_COMPLETED],
    ["a non-string phrase", [7]],
    ["a whitespace-only phrase", ["  "]],
  ])("names the gates config when a gate's proof is %s", (_label, proof) => {
    const root = project(BASE, {
      "code-review": reviewerGate("Greptile", { proof }),
    });
    expect(() => loadDeclaration(root)).toThrow(
      /\.lisa\.config\.json.*gates\.code-review\.pull-request\.evidence\.proof/
    );
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

  it("treats a review_by gate pinned by posted_by as evidence-bearing", () => {
    const gates = {
      "code-review": {
        "pull-request": {
          ...(reviewerGate(REVIEW_BY_CONTEXT, { review_by: REVIEW_BY_LOGIN })[
            "pull-request"
          ] as Record<string, unknown>),
          posted_by: 12_345,
        },
      },
    };
    const declaration = loadDeclaration(project(BASE, gates));
    expect(Object.keys(declaration.evidence_bearing_checks)).toEqual([
      REVIEW_BY_CONTEXT,
    ]);
    expect(declaration.review_by_checks).toBeUndefined();
    expect(reviewByByGuard(gates)).toEqual(reviewByByProver(gates));
  });

  it("splits review_by reviewers from the rest as the evidence prover does", () => {
    const gates = {
      "code-review": reviewerGate("CodeRabbit"),
      "third-review": reviewerGate("Reviewed By Hand", {
        review_by: "a-bot[bot]",
      }),
      "pinned-review": {
        "pull-request": {
          await: "Pinned",
          posted_by: 7,
          evidence: { reviewer: true, review_by: "pinned[bot]" },
        },
      },
    };
    expect(reviewByByGuard(gates)).toEqual(reviewByByProver(gates));
  });

  it("reads a review_by gate's phrases on a name evidence_bearing_checks declares", () => {
    const root = project(
      { ...BASE, evidence_bearing_checks: { CodeRabbit: { proof: ["A"] } } },
      {
        "code-review": reviewerGate("CodeRabbit", {
          review_by: REVIEW_BY_LOGIN,
          proof: ["B"],
          no_work: ["y"],
        }),
      }
    );
    const declaration = loadDeclaration(root);
    expect(declaration.evidence_bearing_checks.CodeRabbit).toEqual({
      proof: ["A", "B"],
      no_work: ["y"],
    });
    expect(declaration.review_by_checks).toBeUndefined();
  });

  it("reads a review_by gate's phrases on a name a check gate also awaits", () => {
    const root = project(BASE, {
      "code-review": reviewerGate("Greptile", { proof: ["A"] }),
      "second-review": reviewerGate("Greptile", {
        review_by: REVIEW_BY_LOGIN,
        proof: ["B"],
      }),
    });
    const declaration = loadDeclaration(root);
    expect(declaration.evidence_bearing_checks.Greptile).toEqual({
      proof: ["A", "B"],
    });
    expect(declaration.review_by_checks).toBeUndefined();
  });

  it("does not refuse the vacuity arm when only review_by reviewers are declared", () => {
    const root = project(BASE, {
      "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
        review_by: REVIEW_BY_LOGIN,
      }),
    });
    expect(
      vacuityRefusal({
        declaration: loadDeclaration(root),
        pr: "1",
        checks: [{ name: "build", state: "SUCCESS" }],
      })
    ).toBeNull();
  });

  it("keeps the settle loop waiting while a review_by reviewer's check is pending", () => {
    const root = project(
      { ...BASE, evidence_bearing_checks: { CodeRabbit: {} } },
      {
        "code-review": reviewerGate(REVIEW_BY_CONTEXT, {
          review_by: REVIEW_BY_LOGIN,
        }),
      }
    );
    const done = {
      name: "CodeRabbit",
      state: "SUCCESS",
      bucket: "pass",
      description: REVIEW_COMPLETED,
    };
    const reads = [
      [done, { name: REVIEW_BY_CONTEXT, state: "PENDING", bucket: "pending" }],
      [
        done,
        {
          name: REVIEW_BY_CONTEXT,
          state: "SUCCESS",
          bucket: "pass",
          description: REVIEW_COMPLETED,
        },
      ],
    ];
    let clock = 0;
    let polls = 0;
    const result = fetchSettledChecks(loadDeclaration(root), "1", undefined, {
      timeoutSeconds: 300,
      intervalSeconds: 15,
      now: () => clock,
      sleep: (ms: number) => {
        clock += ms;
      },
      headSha: () => "a".repeat(40),
      fetch: () => {
        const roster = reads[Math.min(polls, reads.length - 1)];
        polls += 1;
        return roster;
      },
    }) as unknown as {
      settled: boolean;
      evidence: { expired: boolean; line: string };
    };
    expect(polls).toBe(2);
    expect(result.settled).toBe(true);
    expect(result.evidence.expired).toBe(false);
    expect(result.evidence.line).toMatch(/^Review evidence settled/);
  });

  it("names the same reviewers as the evidence prover", () => {
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
    expect(namedByGuard(gates)).toEqual(namedByProver(gates));
  });

  it.each([
    ["a null gate", { "code-review": null }],
    ["an array gate", { "code-review": [reviewerGate("CodeRabbit")] }],
    [
      "an array pull-request entry",
      { "code-review": { "pull-request": [{ await: "CodeRabbit" }] } },
    ],
    [
      "a non-string await",
      {
        "code-review": {
          "pull-request": { await: 7, evidence: { reviewer: true } },
        },
      },
    ],
    [
      "a whitespace-only await",
      {
        "code-review": {
          "pull-request": { await: "  ", evidence: { reviewer: true } },
        },
      },
    ],
  ])("agrees with the evidence prover on %s", (_label, malformed) => {
    const gates = { ...malformed, "second-review": reviewerGate("Greptile") };
    expect(namedByGuard(gates)).toEqual(namedByProver(gates));
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
      const readme = seed._readme.join("\n");
      expect(readme).toContain("CodySwannGT/lisa#4914");
      expect(readme).not.toContain("posts no check");
      expect(readme).toContain("`evidence.review_by`");
    }
  );
});

describe("a review_by run is decoded with its gate's phrases (#4917 review)", () => {
  const GATE = "Greptile";
  it("carries a review_by gate's no-work phrases into decoding", () => {
    const vocabulary = decodingVocabulary({
      evidence_bearing_checks: {},
      review_by_checks: { [GATE]: { no_work: ["Skipped: draft"] } },
    });
    expect(vocabulary[GATE]).toEqual({ no_work: ["Skipped: draft"] });
  });

  it("unions phrases for a name in both sets", () => {
    const vocabulary = decodingVocabulary({
      evidence_bearing_checks: { [GATE]: { proof: ["Done"] } },
      review_by_checks: { [GATE]: { no_work: ["Paused"] } },
    });
    expect(vocabulary[GATE]).toEqual({ proof: ["Done"], no_work: ["Paused"] });
  });
});
