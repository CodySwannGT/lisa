/**
 * Built-in lifecycle role → name maps for each tracker vendor.
 *
 * Extracted from `sync/registry` so the vendor rationale below has room to be
 * stated where the values live, rather than compressed to fit a file-length
 * budget in the registry.
 * @module sync/lifecycle-defaults
 */

import type { JsonValue } from "./json-path.js";

/**
 * GitHub's build lifecycle, expressed as LABELS.
 *
 * Labels are not a preference here — GitHub Issues has no workflow-state field
 * at all (only open/closed), so a label is the only lane available. Contrast
 * {@link LINEAR_WORKFLOW_DEFAULTS}, which must NOT be modelled on this.
 */
export const BUILD_LABEL_DEFAULTS = {
  ready: "status:ready",
  claimed: "status:in-progress",
  blocked: "status:blocked",
  human_needed: "human-needed",
  done: {
    dev: "status:on-dev",
    staging: "status:on-stg",
    production: "status:done",
  },
} as const;

/**
 * Linear's build lifecycle, expressed as native workflow STATES — mirroring
 * `jira.workflow`, not `github.labels`.
 *
 * Linear Issues carry first-class states with a machine-readable `type`
 * (`backlog` / `unstarted` / `started` / `completed` / `canceled`), which is
 * exactly the shape JIRA statuses have. Modelling Linear on the GitHub adapter
 * (this map used to be `{...BUILD_LABEL_DEFAULTS}`) left TWO writers on one
 * lifecycle: Linear's own git automations move `state` on merge while Lisa
 * moved only labels, so the two disagreed permanently on any merge that did not
 * run through a Lisa flow — and `On Dev` / `On Stg` could never appear on a
 * board, cycle or insight, because Linear groups by state.
 *
 * The historical objection was that per-team state NAMES vary and get renamed.
 * That is equally true of the JIRA statuses Lisa keys on regardless, and Linear
 * additionally exposes the rename-proof `type` discriminator the lifecycle
 * skills already use for terminal detection. Names live in config, so a rename
 * is a one-key override.
 *
 * A stock Linear team ships `Todo`, `In Progress`, `In Review` and `Done` but
 * NOT `Blocked`, `On Dev` or `On Stg`. `lisa-setup-linear` resolves each role
 * and offers to create what is missing; it never invents a name silently. The
 * env rungs must be typed `started`, never `completed` — see the
 * `config-resolution` rule.
 */
export const LINEAR_WORKFLOW_DEFAULTS: JsonValue = {
  ready: "Todo",
  claimed: "In Progress",
  review: "In Review",
  blocked: "Blocked",
  done: { dev: "On Dev", staging: "On Stg", production: "Done" },
};

/**
 * The PRD lifecycle, expressed as labels on every vendor that hosts PRDs as
 * issues or projects. On Linear this stays label-driven even though the build
 * lane did not: a PRD is a Linear PROJECT, and Projects carry their own status
 * object rather than Issue workflow states.
 */
export const PRD_LABEL_DEFAULTS: JsonValue = {
  draft: "prd-draft",
  ready: "prd-ready",
  in_review: "prd-in-review",
  blocked: "prd-blocked",
  ticketed: "prd-ticketed",
  shipped: "prd-shipped",
  verified: "prd-verified",
  sentinel: "prd-intake-feedback",
};
