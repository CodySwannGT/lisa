/**
 * The map from required status context to the gate that produces it.
 *
 * Split from the comparator's own suite along the seam the source modules
 * split on. Everything here is about DERIVATION — which contexts a registry
 * gate can post, what an await gate's own signal name is, and which of a
 * gate's former labels are genuinely dead. No verdict is asserted anywhere in
 * this file; that is the comparator's suite.
 *
 * The assertion that carries the most weight is the last kind: a label one
 * gate was renamed away from, which a DIFFERENT gate now posts as its current
 * label, is not retired. Something posts that string every run, so requiring
 * it is not a permanent wait, and reporting it would tell an operator to
 * delete a requirement that works.
 * @module tests/unit/core/gate-context-owners
 */
import { describe, expect, it } from "vitest";

import {
  contextOwners,
  type MergeContextRegistry,
} from "../../../src/core/gate-context-owners.js";

const WORKFLOW = "🔍 Quality Checks";
const LINT = `${WORKFLOW} / 🧹 Lint`;
const REQUIRED = "required";
const NOT_DECLARED = "not-declared";
const LINT_LABEL = "🧹 Lint";
const REVIEW_LABEL = "🤖 Code Review";
const PULL_REQUEST = "pull-request";

/** A registry with two gates and a resolver that honours the gates block. */
const REGISTRY: MergeContextRegistry = {
  REGISTRY: {
    lint: { label: LINT_LABEL, moments: [PULL_REQUEST, "push"] },
    "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
  },
  resolveMoment: ({ gates }) =>
    Object.entries(gates).flatMap(([id, value]) => {
      const level = (value as Record<string, unknown>)["pull-request"];
      const awaits = (value as Record<string, unknown>)["await"];
      return typeof level === "string"
        ? [
            {
              id,
              level,
              mode: typeof awaits === "string" ? "await" : "run",
              awaits: typeof awaits === "string" ? awaits : null,
            },
          ]
        : [];
    }),
  momentFamily: moment => moment,
};

/** The same registry, with `lint` recorded as renamed away from `🧽 Lint`. */
const RENAMED_REGISTRY: MergeContextRegistry = {
  ...REGISTRY,
  REGISTRY: {
    lint: {
      label: LINT_LABEL,
      moments: [PULL_REQUEST, "push"],
      previousLabels: ["🧽 Lint"],
    },
    "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
  },
};

describe("contextOwners", () => {
  it("owns a context for every registry gate, declared or not", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: {},
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)).toEqual({
      gateId: "lint",
      declaration: NOT_DECLARED,
      legalAtMerge: true,
      retired: null,
    });
    expect(map.get(`${WORKFLOW} / 🤖 Code Review`)?.declaration).toBe(
      NOT_DECLARED
    );
  });

  it("owns the awaited signal's own name for an await gate", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: {
        "code-review": { "pull-request": REQUIRED, await: "CodeRabbit" },
      },
      workflowName: WORKFLOW,
    });

    expect(map.get("CodeRabbit")).toEqual({
      gateId: "code-review",
      declaration: REQUIRED,
      legalAtMerge: true,
      retired: null,
    });
  });

  it("owns a retired label the registry records, alongside the current one", () => {
    const map = contextOwners({
      registry: RENAMED_REGISTRY,
      gates: { lint: { "pull-request": REQUIRED } },
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)?.retired).toBeNull();
    expect(map.get(`${WORKFLOW} / 🧽 Lint`)).toEqual({
      gateId: "lint",
      declaration: REQUIRED,
      legalAtMerge: true,
      retired: { label: "🧽 Lint", replacement: LINT },
    });
  });

  it("does not treat a retired label another gate now posts as retired", () => {
    // `🤖 Code Review` is `code-review`'s CURRENT label here, and also listed
    // as a label `lint` was renamed away from. Something posts that string
    // every run, so requiring it is not a permanent wait — flagging it would
    // tell an operator to delete a requirement that works.
    const reused: MergeContextRegistry = {
      ...RENAMED_REGISTRY,
      REGISTRY: {
        lint: {
          label: LINT_LABEL,
          moments: [PULL_REQUEST],
          previousLabels: [REVIEW_LABEL],
        },
        "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
      },
    };

    expect(
      contextOwners({
        registry: reused,
        gates: {},
        workflowName: WORKFLOW,
      }).get(`${WORKFLOW} / 🤖 Code Review`)?.retired
    ).toBeNull();
  });

  it("treats a level Lisa does not know as undeclared rather than as a claim", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: { lint: { "pull-request": "mandatory" } },
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)?.declaration).toBe(NOT_DECLARED);
  });

  it("compares nothing rather than throwing when the gates block will not resolve", () => {
    const throwing: MergeContextRegistry = {
      ...REGISTRY,
      resolveMoment: () => {
        throw new Error("unknown moment key");
      },
    };

    expect(
      contextOwners({
        registry: throwing,
        gates: {},
        workflowName: WORKFLOW,
      }).get(LINT)?.declaration
    ).toBe(NOT_DECLARED);
  });
});
