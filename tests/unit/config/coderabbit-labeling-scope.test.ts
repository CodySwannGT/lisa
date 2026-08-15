/**
 * The review bot may enrich issues, but never write lifecycle state.
 *
 * `coderabbitai[bot]` stamped `status:done` on brand-new issues five times on
 * 2026-08-15, the fastest at eight seconds, and once directly over an explicit
 * `status:in-progress` a human had applied moments earlier. `status:done` is a
 * TERMINAL role: the work-item gate refuses to bind or validate against a
 * terminal item, so each of those issues blocked its own pull request until
 * somebody stripped the label by hand.
 *
 * The fix is an allowlist rather than a timing threshold, because there is no
 * safe threshold to pick — the label comes from a classifier with no view of
 * whether work happened, so the eight-second case is not a near-miss on a true
 * statement, it is the opposite of one.
 *
 * This test is the guard on the fix. The allowlist is prose in a YAML file that
 * nothing else reads, so without an assertion the entry that reintroduces the
 * defect is a one-line diff nobody would question.
 * @module tests/unit/config/coderabbit-labeling-scope
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const LIFECYCLE_PREFIX = "status:";
/** Roles a bot must never decide, beyond the lifecycle family itself. */
const HUMAN_ONLY_LABELS = ["human-needed"];

const config = parse(readFileSync(path.resolve(".coderabbit.yml"), "utf8")) as {
  issue_enrichment?: {
    labeling?: {
      auto_apply_labels?: boolean;
      labeling_instructions?: { label?: string; instructions?: string }[];
    };
  };
};

const labeling = config.issue_enrichment?.labeling;
const instructions = labeling?.labeling_instructions ?? [];
const allowed = instructions.map(entry => entry.label ?? "");

describe("CodeRabbit issue labeling", () => {
  it("constrains auto-applied labels to an explicit allowlist", () => {
    // The allowlist is what makes every assertion below meaningful. With
    // `auto_apply_labels` on and no instructions, the bot may apply anything,
    // and a test asserting "no status: in the list" would pass against an
    // empty list while the defect ran unchanged.
    expect(labeling?.auto_apply_labels).toBe(true);
    expect(allowed.length).toBeGreaterThan(0);
  });

  it("allowlists no lifecycle label", () => {
    expect(allowed.filter(label => label.startsWith(LIFECYCLE_PREFIX))).toEqual(
      []
    );
  });

  it("allowlists no label that is a human's judgment to make", () => {
    for (const label of HUMAN_ONLY_LABELS) {
      expect(allowed, label).not.toContain(label);
    }
  });

  it("keeps the enrichment that is actually useful", () => {
    // The blunt fix — turning auto-labelling off — would also lose these, and
    // they are the reason the feature is on at all. Asserting they survive
    // stops a future "just disable it" from looking like a clean fix.
    for (const prefix of ["type:", "points:", "component:", "repo:"]) {
      expect(
        allowed.some(label => label.startsWith(prefix)),
        prefix
      ).toBe(true);
    }
  });

  it("gives every allowlisted label an instruction", () => {
    // An entry with no instruction tells the classifier nothing about when the
    // label applies, so it becomes a label applied on vibes — a smaller version
    // of the defect this file exists to prevent.
    const silent = instructions.filter(
      entry => (entry.instructions ?? "").trim().length === 0
    );
    expect(silent.map(entry => entry.label)).toEqual([]);
  });
});
