/**
 * Shared fixtures for the relayed hold-release tests (CodySwannGT/lisa#5190):
 * one trusted person, one automation account named as a relay, and assertions
 * that every reader of the hold verdict agrees.
 * @module tests/unit/strategies/human-gate-release-relay-helpers
 */
import { expect } from "vitest";

import {
  classifyReadyCandidate,
  humanGateDischarged,
  humanGateReleases,
  isHumanGated,
  planHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

import {
  BODY,
  LIFECYCLE,
  NEEDED,
  READY,
  REASON,
} from "./human-gate-release-helpers.js";

export const PERSON = "human-1";
export const RELAY = "agent-account-9";
export const RELAY_ENTRY = `relay:${RELAY}`;
export const WITH_RELAY = [PERSON, RELAY_ENTRY];
export const MARKER = "[lisa-human-gate-release]";
export const RELAYED = `${MARKER} relayed-for=${PERSON} reason=${REASON}`;
export const DIRECT = `${MARKER} reason=${REASON}`;
export const BOT_RELAY = { id: RELAY, type: "Bot" };

/**
 * A held item with one comment.
 * @param comment - The structured comment
 * @param trusted - The project's list of who may release
 * @returns Input for the hold readers
 */
export function held(comment: unknown, trusted: readonly unknown[]) {
  return {
    body: BODY,
    labels: [NEEDED],
    comments: [comment],
    trustedHumanActorIds: trusted,
    readyLabel: READY,
    lifecycleLabels: LIFECYCLE,
  };
}

/**
 * Assert every reader agrees an item is still held.
 * @param input - Input for the hold readers
 */
export function expectHeld(input: ReturnType<typeof held>): void {
  expect(humanGateReleases(input.comments, input.trustedHumanActorIds)).toEqual(
    []
  );
  expect(humanGateDischarged(input)).toBe(false);
  expect(isHumanGated(input)).toBe(true);
  expect(classifyReadyCandidate(input).claimable).toBe(false);
  expect(planHumanGateRelease(input).released).toBe(false);
}

/**
 * Assert every reader agrees an item's hold is released.
 * @param input - Input for the hold readers
 */
export function expectReleased(input: ReturnType<typeof held>): void {
  expect(humanGateReleases(input.comments, input.trustedHumanActorIds)).toEqual(
    [REASON]
  );
  expect(humanGateDischarged(input)).toBe(true);
  expect(isHumanGated(input)).toBe(false);
  expect(planHumanGateRelease(input).released).toBe(true);
}
