/**
 * Shared fixtures for the human-gate release suites (#3852).
 *
 * One work item, one hold, one release, read by three suites — the verdict, the
 * plan, and the reach. Restating the fixture in each would let the three drift
 * into testing three different items, which is the failure mode a shared
 * fixture exists to prevent.
 * @module tests/unit/strategies/human-gate-release-helpers
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HUMAN_GATE_MARKER,
  formatHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

/** The configured marker naming a hold only a person can lift. */
export const NEEDED = "human-needed";

/** The configured build-ready role an intake sweep claims from. */
export const READY = "status:ready";

/** Every configured lifecycle label, the marker included, as a project binds it. */
export const LIFECYCLE = Object.freeze([
  READY,
  "status:in-progress",
  "status:blocked",
  "status:done",
  NEEDED,
]);

/** The question the hold is waiting on, and the key its release must name. */
export const REASON = "pricing-tier";

/** The hold exactly as the vendor writers stamp it. */
export const HOLD_LINE = `<!-- ${HUMAN_GATE_MARKER} reason=${REASON} -->`;

/**
 * A long description, so "the release did not rewrite this" means something.
 *
 * Acceptance criteria in a fence, a validation journey, and a managed usage
 * section — the record an operator would have had to replace wholesale to
 * delete one line of, which is why nobody did and holds accumulated.
 */
export const BODY = [
  "## Problem",
  "",
  "The export button does nothing on the reporting screen.",
  "",
  "## Acceptance criteria",
  "",
  "```gherkin",
  "Scenario: export produces a file",
  "  Given a report",
  "  When the user exports it",
  "  Then a file is downloaded",
  "```",
  "",
  "## Validation journey",
  "",
  "1. Open the report. 2. Export. 3. Observe the file.",
  "",
  `Held for a human product call: ${REASON}.`,
  HOLD_LINE,
  "",
  "## Lisa Usage",
  "",
  "- managed section nobody should have to rewrite to lift a hold",
].join("\n");

/** The recorded decision that discharges {@link HOLD_LINE}. */
export const RELEASE = formatHumanGateRelease({
  reason: REASON,
  decision: "ship it on the mid tier",
  decidedBy: "the product owner",
});

/** A release naming a DIFFERENT hold, which must discharge nothing here. */
export const OTHER_RELEASE = formatHumanGateRelease({ reason: "legal-review" });

/** Ordinary comment traffic, which is neither a hold nor a release. */
export const UNRELATED = "Bumping this — any movement on the pricing question?";

/**
 * Read one skill contract out of a plugin root.
 * @param root - The plugin root, source or generated
 * @param name - The skill directory name
 * @returns The contract text
 */
export const readSkill = (root: string, name: string): string =>
  readFileSync(path.resolve(root, `skills/${name}/SKILL.md`), "utf8");
