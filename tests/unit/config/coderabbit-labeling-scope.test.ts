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
 * On 2026-11-01 the same reasoning was extended to `type:` and `points:`
 * (CodySwannGT/lisa#4617). Lisa's issue writer sets both itself, so the bot's
 * guess overwrote a decision that had already been made, after nearly every
 * create or edit and usually within a minute.
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

// The protected families live in one module, shared with the `lisa doctor`
// check that reads a HOST's config, so the two cannot drift (#4633).
import {
  DEFAULT_HUMAN_ONLY_LABELS as HUMAN_ONLY_LABELS,
  evaluateCoderabbitLabeling,
  LIFECYCLE_LABEL_PREFIX as LIFECYCLE_PREFIX,
  WRITER_OWNED_LABEL_PREFIXES as WRITER_OWNED_PREFIXES,
} from "../../../src/core/coderabbit-labeling.js";

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

  it("allowlists no type or points label", () => {
    // Lisa's issue writer sets the type and the points itself when it files an
    // item, and build intake and the validator read the type from that one
    // label, so a bot's guess here is a conflict rather than enrichment. On
    // 2026-11-01 it put `type:Bug` on a Story, `type:Story` on a Sub-task and
    // `points:8` on an Epic, each within two minutes of the write, and
    // `type:Spike` was never listed, so any type it gave a Spike was wrong
    // (#4617). Compared case-insensitively because GitHub matches label names
    // that way, so `Type:Bug` would still land as `type:Bug`.
    expect(
      allowed.filter(label =>
        WRITER_OWNED_PREFIXES.some(prefix =>
          label.toLowerCase().startsWith(prefix)
        )
      )
    ).toEqual([]);
  });

  it("keeps the enrichment that is actually useful", () => {
    // The blunt fix — turning auto-labelling off — would also lose these, and
    // they are the reason the feature is on at all. Asserting they survive
    // stops a future "just disable it" from looking like a clean fix.
    for (const prefix of ["component:", "repo:"]) {
      expect(
        allowed.some(label => label.startsWith(prefix)),
        prefix
      ).toBe(true);
    }
  });

  it("passes the same evaluation lisa doctor runs on a host's config", () => {
    expect(evaluateCoderabbitLabeling(config)).toEqual({
      safe: true,
      reason: "allowlisted",
    });
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
