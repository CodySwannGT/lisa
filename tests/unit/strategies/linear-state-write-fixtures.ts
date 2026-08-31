/**
 * Shared fixtures for the Linear state-write guard suites (#3356).
 *
 * Extracted so the resolution cases and the fake-request-sink cases can live in
 * separate files without either restating the board they are judged against. A
 * second copy of this catalog is a second thing to keep in step, and the two
 * suites only mean anything if they are talking about the same board.
 *
 * Every identifier here is invented. The SHAPE is the real one: a claimed lane,
 * a blocked lane, and two review-shaped lanes the configuration deliberately
 * omits — which is the arrangement the occurrence was observed on.
 * @module tests/unit/strategies/linear-state-write-fixtures
 */
import { join } from "node:path";

/** The guard under test, at its authored source path. */
export const GUARD = join(
  process.cwd(),
  "plugins/src/base/scripts/linear-state-write-target.mjs"
);

/** Linear's own machine-readable state type for an in-flight lane. */
export const STARTED = "started";

/** The configured `claimed` state name, and the id it must resolve to. */
export const CLAIMED_NAME = "In Progress";
export const CLAIMED_ID = "st-claimed";

/** A review-shaped lane the configuration deliberately never names. */
export const UNCONFIGURED_REVIEW_ID = "st-human-review";

/** The team's workflow-state catalog. */
export const TEAM_STATES = [
  { id: "st-backlog", name: "Triage", type: "backlog", position: -2400 },
  { id: "st-ready", name: "Ready", type: "unstarted", position: -2100 },
  { id: "st-blocked", name: "Blocked", type: STARTED, position: -1989.26 },
  { id: CLAIMED_ID, name: CLAIMED_NAME, type: STARTED, position: -1478.5 },
  {
    id: UNCONFIGURED_REVIEW_ID,
    name: "Awaiting Code Review",
    type: STARTED,
    position: -1209.69,
  },
  { id: "st-human-qa", name: "Peer Check", type: STARTED, position: -1079.7 },
  { id: "st-done", name: "Done", type: "completed", position: 900 },
];

/** A project that binds every required role and deliberately binds no `review`. */
export const CONFIG = {
  linear: {
    workspace: "example-workspace",
    teamKey: "EXM",
    workflow: {
      ready: "Ready",
      claimed: CLAIMED_NAME,
      blocked: "Blocked",
      done: { dev: "On Dev", staging: "On Stg", production: "Done" },
    },
  },
};
