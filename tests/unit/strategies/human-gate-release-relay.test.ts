/**
 * A project can name an automation account that may relay a trusted person's
 * hold release (CodySwannGT/lisa#5190).
 *
 * The default is unchanged: a release from an automation account counts for
 * nothing. Only when the project lists that account as `relay:<id>` does a
 * release it posts count, and then only when the line names, before the reason,
 * a person who is themselves a trusted releaser. Every reader of the hold
 * verdict goes through the same helper, so each case is asserted on the helper
 * and on the planners that sit on it.
 * @module tests/unit/strategies/human-gate-release-relay
 */
import { describe, expect, it } from "vitest";

import {
  formatHumanGateRelease,
  humanGateDischarged,
  humanGateReleases,
  isHumanGated,
  planHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

import { REASON } from "./human-gate-release-helpers.js";
import {
  BOT_RELAY,
  DIRECT,
  MARKER,
  PERSON,
  RELAY,
  RELAY_ENTRY,
  RELAYED,
  WITH_RELAY,
  expectHeld,
  expectReleased,
  held,
} from "./human-gate-release-relay-helpers.js";

describe("the default stays strict", () => {
  it("ignores an automation account's release when no relay is named", () => {
    expectHeld(held({ body: RELAYED, author: BOT_RELAY }, [PERSON]));
    expectHeld(held({ body: DIRECT, author: BOT_RELAY }, [PERSON]));
  });

  it("still ignores a bot whose id is listed as a person", () => {
    expectHeld(held({ body: DIRECT, author: BOT_RELAY }, [PERSON, RELAY]));
  });
});

describe("a configured relay", () => {
  it.each([
    ["a bot by type", { body: RELAYED, author: BOT_RELAY }],
    ["a bot by flag", { body: RELAYED, author: { id: RELAY, isBot: true } }],
    [
      "an app account",
      { body: RELAYED, author: { id: RELAY, accountType: "app" } },
    ],
    [
      "a tracker bot actor",
      { body: RELAYED, user: { id: RELAY }, botActor: {} },
    ],
    [
      "a normalized author id",
      { body: RELAYED, authorId: RELAY, authorType: "Bot" },
    ],
    [
      "an ordinary user account",
      { body: RELAYED, author: { id: RELAY, type: "User" } },
    ],
  ])("releases a hold for a named trusted person, as %s", (_name, comment) => {
    expectReleased(held(comment, WITH_RELAY));
  });

  it("releases with the line the formatter writes", () => {
    const body = formatHumanGateRelease({
      reason: REASON,
      relayedFor: PERSON,
      decidedBy: "the operator, in chat",
    });
    expect(body.split("\n")[0]).toBe(RELAYED);
    expectReleased(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it("cannot release on nobody's behalf", () => {
    expectHeld(held({ body: DIRECT, author: BOT_RELAY }, WITH_RELAY));
  });

  it("cannot relay for someone who is not a trusted releaser", () => {
    expectHeld(
      held(
        {
          body: `${MARKER} relayed-for=stranger-7 reason=${REASON}`,
          author: BOT_RELAY,
        },
        WITH_RELAY
      )
    );
  });

  it("cannot relay for itself", () => {
    expectHeld(
      held(
        {
          body: `${MARKER} relayed-for=${RELAY} reason=${REASON}`,
          author: BOT_RELAY,
        },
        WITH_RELAY
      )
    );
  });

  it("must match the hold's reason", () => {
    // The release is authorized, and it is for a different hold: it is
    // recorded under its own reason and lifts nothing here.
    const input = held(
      {
        body: `${MARKER} relayed-for=${PERSON} reason=legal-review`,
        author: BOT_RELAY,
      },
      WITH_RELAY
    );
    expect(
      humanGateReleases(input.comments, input.trustedHumanActorIds)
    ).toEqual(["legal-review"]);
    expect(humanGateDischarged(input)).toBe(false);
    expect(isHumanGated(input)).toBe(true);
    expect(planHumanGateRelease(input).released).toBe(false);
  });

  it("is not honored when the person is named after the reason", () => {
    // Everything after `reason=` is the reason, so this names a reason nobody
    // declared. It must never be read as a release of the real one.
    expectHeld(
      held(
        {
          body: `${MARKER} reason=${REASON} relayed-for=${PERSON}`,
          author: BOT_RELAY,
        },
        WITH_RELAY
      )
    );
  });

  it("has to be the configured account", () => {
    expectHeld(
      held(
        { body: RELAYED, author: { id: "another-bot", type: "Bot" } },
        WITH_RELAY
      )
    );
    expectHeld(held({ body: RELAYED, author: { name: RELAY } }, WITH_RELAY));
    expectHeld(held(RELAYED, WITH_RELAY));
  });

  it("does not count when the release is only quoted", () => {
    expectHeld(held({ body: `\`${RELAYED}\``, author: BOT_RELAY }, WITH_RELAY));
  });
});

describe("a relay is not a person", () => {
  it("names nobody a release can be relayed for when it is the only entry", () => {
    expectHeld(held({ body: RELAYED, author: BOT_RELAY }, [RELAY_ENTRY]));
  });

  it("is never itself a trusted person", () => {
    expectHeld(
      held({ body: DIRECT, author: { id: RELAY, type: "User" } }, WITH_RELAY)
    );
    expectHeld(
      held(
        { body: DIRECT, author: { id: RELAY_ENTRY, type: "User" } },
        WITH_RELAY
      )
    );
  });
});

describe("a person's own release is unaffected", () => {
  it("still releases directly beside a configured relay", () => {
    expectReleased(
      held({ body: DIRECT, author: { id: PERSON, type: "User" } }, WITH_RELAY)
    );
  });

  it("still releases when a person writes the relayed form themselves", () => {
    expectReleased(
      held({ body: RELAYED, author: { id: PERSON, type: "User" } }, WITH_RELAY)
    );
  });
});
