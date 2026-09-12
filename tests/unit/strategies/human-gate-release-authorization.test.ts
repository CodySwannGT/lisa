/** A release's text cannot authorize its own author to clear a human hold. */
import { describe, expect, it } from "vitest";

import {
  classifyPreWorkCandidate,
  classifyReadyCandidate,
  humanGateDischarged,
  humanGateReleases,
  isHumanGated,
  planHumanGateReconciliation,
  planHumanGateRelease,
  planLabelNormalization,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  HUMAN_GATE_SIGNAL,
  evaluateSignal,
} from "../../../plugins/src/base/scripts/qa-signal-lifecycle.mjs";

import {
  BODY,
  LIFECYCLE,
  NEEDED,
  OTHER_RELEASE,
  READY,
  REASON,
  RELEASE,
} from "./human-gate-release-helpers.js";

const TRUSTED_ID = "human-1";
const TRUSTED_IDS = [TRUSTED_ID];
const AUTHOR = { id: TRUSTED_ID, type: "User" };
const COMMENT = { body: RELEASE, author: AUTHOR };
const IDLE = {
  removeHumanNeededLabel: false,
  addReadyLabel: null,
  comment: false,
};

describe("release authorization rejects untrusted comment provenance", () => {
  it.each([
    RELEASE,
    { body: RELEASE },
    { body: RELEASE, author: { name: TRUSTED_ID } },
    { body: RELEASE, authorId: "untrusted", authorized: true },
    { body: RELEASE, author: { id: " " } },
    { body: RELEASE, author: { ...AUTHOR, type: "Bot" } },
    { body: RELEASE, author: { ...AUTHOR, isBot: true } },
    { body: RELEASE, author: { ...AUTHOR, bot: true } },
    { body: RELEASE, author: { ...AUTHOR, accountType: "app" } },
    { body: RELEASE, user: { id: TRUSTED_ID, isBot: true } },
    { body: RELEASE, authorId: TRUSTED_ID, authorType: "Bot" },
    { body: RELEASE, authorId: TRUSTED_ID, authorType: "app" },
    { body: RELEASE, author: { ...AUTHOR, __typename: "Bot" } },
    {
      body: RELEASE,
      user: { id: TRUSTED_ID },
      botActor: { __typename: "ActorBot" },
    },
    { body: RELEASE, user: { id: TRUSTED_ID }, botActor: {} },
  ])(
    "keeps a matching release without trusted human authorship held: %j",
    comment => {
      const input = {
        body: BODY,
        labels: [NEEDED],
        comments: [comment],
        trustedHumanActorIds: TRUSTED_IDS,
        readyLabel: READY,
        lifecycleLabels: LIFECYCLE,
      };
      expect(humanGateReleases(input.comments, TRUSTED_IDS)).toEqual([]);
      expect(humanGateDischarged(input)).toBe(false);
      expect(isHumanGated(input)).toBe(true);
      expect(planHumanGateRelease(input).actions).toEqual(IDLE);
    }
  );

  it.each([{ trustedHumanActorIds: undefined }, { trustedHumanActorIds: [] }])(
    "requires a caller-supplied allowlist: %j",
    ({ trustedHumanActorIds }) => {
      const input = { body: BODY, comments: [COMMENT], trustedHumanActorIds };
      expect(isHumanGated(input)).toBe(true);
      expect(humanGateDischarged(input)).toBe(false);
    }
  );

  it("does not authorize by a case-folded actor ID", () => {
    expect(
      isHumanGated({
        body: BODY,
        comments: [COMMENT],
        trustedHumanActorIds: [TRUSTED_ID.toUpperCase()],
      })
    ).toBe(true);
  });

  it("accepts an explicitly trusted Linear user when botActor is null", () => {
    expect(
      humanGateDischarged({
        body: BODY,
        comments: [{ body: RELEASE, user: { id: TRUSTED_ID }, botActor: null }],
        trustedHumanActorIds: TRUSTED_IDS,
      })
    ).toBe(true);
  });

  it("cannot discharge a second hold through an untrusted comment", () => {
    const body = `${BODY}\n<!-- [lisa-human-gate] reason=legal-review -->`;
    const input = {
      body,
      comments: [COMMENT, { body: OTHER_RELEASE, authorId: "untrusted" }],
      trustedHumanActorIds: TRUSTED_IDS,
    };
    expect(humanGateDischarged(input)).toBe(false);
    expect(planHumanGateRelease(input).actions).toEqual(IDLE);
  });
});

describe("release authorization reaches every promotion path", () => {
  it.each([false, true])(
    "propagates explicit human trust through wrappers: %s",
    trusted => {
      const input = {
        body: BODY,
        labels: [NEEDED],
        comments: [COMMENT],
        trustedHumanActorIds: trusted ? TRUSTED_IDS : [],
        readyLabel: READY,
        lifecycleLabels: LIFECYCLE,
      };
      expect(classifyReadyCandidate(input).claimable).toBe(trusted);
      expect(
        classifyPreWorkCandidate({
          ...input,
          laneType: "unstarted",
          statedBlocker: "",
        }).selectable
      ).toBe(trusted);
      expect(
        planLabelNormalization({ ...input, labels: [] }).actions.addReadyLabel
      ).toBe(trusted ? READY : null);
      expect(planHumanGateReconciliation(input).gated).toBe(!trusted);
      expect(planHumanGateRelease(input).released).toBe(trusted);
      expect(
        evaluateSignal({
          ...input,
          signal: HUMAN_GATE_SIGNAL,
          vendor: "github",
        }).live
      ).toBe(!trusted);
    }
  );

  it.each([
    { authorId: TRUSTED_ID },
    { user: { id: TRUSTED_ID } },
    { author: AUTHOR },
    { author: { accountId: TRUSTED_ID } },
    { author: { id: 123 } },
  ])("accepts stable trusted vendor identity: %j", identity => {
    const comments = [{ body: RELEASE, ...identity }];
    const trustedHumanActorIds = [...TRUSTED_IDS, "123"];
    expect(humanGateReleases(comments, trustedHumanActorIds)).toEqual([REASON]);
    expect(isHumanGated({ body: BODY, comments, trustedHumanActorIds })).toBe(
      false
    );
  });
});
