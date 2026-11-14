/**
 * Regression coverage for lifecycle-role resolution parity across vendors.
 *
 * The defect: twelve skills inlined `read_role()` and produced eleven distinct
 * implementations. The two that mattered disagreed on whether an unconfigured
 * `review` role means "skip the step" (JIRA's `post-evidence.sh`, `REVIEW=""`)
 * or "use In Review" (`lisa-linear-evidence`, `read_role review "In Review"`).
 *
 * With a default in place, a project cannot express "we have no agent review
 * step" — which is precisely what one downstream project intended. Two issues
 * were moved into a human-only review state as a result.
 * @module tests/unit/strategies/resolve-lifecycle-role
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OPTIONAL_ROLES,
  OUTCOMES,
  REQUIRED_ROLES,
  parseArgs,
  parseConfig,
  readPath,
  resolveRole,
} from "../../../plugins/src/base/scripts/resolve-lifecycle-role.mjs";
import { LINEAR_WORKFLOW_DEFAULTS } from "../../../src/sync/lifecycle-defaults.js";

/**
 * The state the positional fallback actually returned downstream: a human-only
 * review lane no config named, selected because it sat at the lowest board
 * position among the unbound `started` states.
 */
const FALLBACK_STATE = "Awaiting Code Review";

/** A real downstream shape: every role bound EXCEPT `review`. */
const UNSET_REVIEW_CONFIG = {
  linear: {
    workflow: {
      ready: "Ready",
      claimed: "In Progress",
      blocked: "Blocked",
      done: { dev: "On Dev", staging: "ON STG", production: "Done" },
      qa: { queue: "READY FOR QA", certified: "Certified For Release" },
    },
  },
};

describe("R1 — an absent optional role skips, never defaults", () => {
  it("returns empty for an unset `review` instead of inventing one", () => {
    const result = resolveRole({
      role: "review",
      vendor: "linear",
      global: UNSET_REVIEW_CONFIG,
    });

    expect(result.value).toBe("");
    expect(result.outcome).toBe(OUTCOMES.UNSET_OPTIONAL);
  });

  it("says the transition is skipped, not that something failed", () => {
    const result = resolveRole({
      role: "review",
      vendor: "linear",
      global: UNSET_REVIEW_CONFIG,
    });

    expect(result.message).toContain("skipping the review transition");
    expect(result.message).toContain("not an error");
  });

  it("never resolves `review` to the state agents actually landed on", () => {
    const result = resolveRole({
      role: "review",
      vendor: "linear",
      global: UNSET_REVIEW_CONFIG,
    });

    expect(result.value).not.toBe("In Review");
    expect(result.value).not.toBe(FALLBACK_STATE);
  });

  it("treats an unset REQUIRED role as a setup defect", () => {
    const result = resolveRole({ role: "ready", vendor: "linear", global: {} });

    expect(result.outcome).toBe(OUTCOMES.UNSET_REQUIRED);
    expect(result.message).toContain("/lisa:setup:linear");
  });

  it("keeps the two role classes disjoint", () => {
    for (const role of REQUIRED_ROLES)
      expect(OPTIONAL_ROLES).not.toContain(role);
  });
});

describe("R2 — a fallback may inform a read, never supply a write target", () => {
  const forWrite = {
    role: "review",
    vendor: "linear",
    intent: "write" as const,
    fallback: FALLBACK_STATE,
    global: UNSET_REVIEW_CONFIG,
  };

  it("refuses the positional fallback when the caller intends to write", () => {
    const result = resolveRole(forWrite);

    expect(result.value).toBe("");
    expect(result.outcome).toBe(OUTCOMES.FALLBACK_REFUSED);
  });

  it("names the refused state so the report is actionable", () => {
    expect(resolveRole(forWrite).message).toContain(FALLBACK_STATE);
  });

  it("still allows the same fallback for a read", () => {
    const result = resolveRole({ ...forWrite, intent: "read" });

    expect(result.value).toBe(FALLBACK_STATE);
    expect(result.source).toBe("fallback");
  });
});

describe("config precedence", () => {
  it("prefers the local override over the committed file", () => {
    const result = resolveRole({
      role: "claimed",
      vendor: "linear",
      local: { linear: { workflow: { claimed: "Doing" } } },
      global: UNSET_REVIEW_CONFIG,
    });

    expect(result.value).toBe("Doing");
    expect(result.source).toBe("local");
  });

  it("falls through an empty-string local value rather than honouring it", () => {
    const result = resolveRole({
      role: "claimed",
      vendor: "linear",
      local: { linear: { workflow: { claimed: "" } } },
      global: UNSET_REVIEW_CONFIG,
    });

    expect(result.value).toBe("In Progress");
    expect(result.source).toBe("global");
  });

  it("resolves the env-keyed `done` map by rung", () => {
    const staging = resolveRole({
      role: "done",
      vendor: "linear",
      env: "staging",
      global: UNSET_REVIEW_CONFIG,
    });

    expect(staging.value).toBe("ON STG");
  });
});

describe("GitHub PRD role namespace", () => {
  const config = {
    github: {
      labels: {
        build: { ready: "build-ready" },
        prd: { draft: "prd-draft", ready: "prd-ready" },
      },
    },
  };

  it("resolves PRD roles from github.labels.prd, not the build map", () => {
    expect(
      resolveRole({ role: "prd.ready", vendor: "github", global: config }).value
    ).toBe("prd-ready");
  });

  it("treats every named PRD role as required", () => {
    const result = resolveRole({
      role: "prd.verified",
      vendor: "github",
      global: config,
    });
    expect(result.outcome).toBe(OUTCOMES.UNSET_REQUIRED);
    expect(result.message).toContain("github.labels.prd.verified");
  });
});

describe("every vendor answers the same way", () => {
  it.each(["jira", "linear", "github"])(
    "skips an unset review on %s",
    vendor => {
      const result = resolveRole({ role: "review", vendor, global: {} });

      expect(result.outcome).toBe(OUTCOMES.UNSET_OPTIONAL);
      expect(result.value).toBe("");
    }
  );

  it("rejects a vendor it does not know instead of guessing a root", () => {
    const result = resolveRole({ role: "ready", vendor: "trello", global: {} });

    expect(result.outcome).toBe(OUTCOMES.UNSET_REQUIRED);
    expect(result.message).toContain("Unknown vendor");
  });
});

describe("the Linear default map no longer seeds a review state", () => {
  it("omits `review`, so `lisa sync` cannot write it back into a project config", () => {
    expect(LINEAR_WORKFLOW_DEFAULTS).not.toHaveProperty("review");
  });

  it("still binds every required role", () => {
    for (const role of REQUIRED_ROLES)
      expect(LINEAR_WORKFLOW_DEFAULTS).toHaveProperty(role);
  });
});

describe("argument and config parsing", () => {
  it("accepts both --key=value and --key value", () => {
    expect(parseArgs(["--role=review", "--vendor", "linear"])).toMatchObject({
      role: "review",
      vendor: "linear",
    });
  });

  it("treats a missing config file as absent rather than fatal", () => {
    expect(parseConfig("/nonexistent/.lisa.config.json")).toEqual({
      value: undefined,
      error: undefined,
    });
  });

  it("reports malformed JSON instead of silently masking the committed file", () => {
    // Written at runtime rather than committed: a deliberately-broken .json
    // fixture in the tree is parsed by ESLint too, and fails the lint gate on a
    // file whose whole purpose is to be unparseable.
    const dir = mkdtempSync(join(tmpdir(), "lisa-role-"));
    const file = join(dir, "malformed.json");
    writeFileSync(file, '{ "linear": { "workflow": { "ready": "Ready",\n');

    try {
      expect(parseConfig(file).error).toContain("not valid JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for a path that runs off the end of the object", () => {
    expect(readPath({ a: { b: 1 } }, "a.b.c")).toBeUndefined();
  });
});
