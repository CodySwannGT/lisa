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
  classifyReadyCandidate,
  formatHumanGateRelease,
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

const PERSON = "human-1";
const RELAY = "agent-account-9";
const RELAY_ENTRY = `relay:${RELAY}`;
const WITH_RELAY = [PERSON, RELAY_ENTRY];
const MARKER = "[lisa-human-gate-release]";
const RELAYED = `${MARKER} relayed-for=${PERSON} reason=${REASON}`;
const DIRECT = `${MARKER} reason=${REASON}`;
const BOT_RELAY = { id: RELAY, type: "Bot" };

/**
 * A held item with one comment.
 * @param comment - The structured comment
 * @param trusted - The project's list of who may release
 * @returns Input for the hold readers
 */
function held(comment: unknown, trusted: readonly unknown[]) {
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
function expectHeld(input: ReturnType<typeof held>): void {
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
function expectReleased(input: ReturnType<typeof held>): void {
  expect(humanGateReleases(input.comments, input.trustedHumanActorIds)).toEqual(
    [REASON]
  );
  expect(humanGateDischarged(input)).toBe(true);
  expect(isHumanGated(input)).toBe(false);
  expect(planHumanGateRelease(input).released).toBe(true);
}

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

describe("a relay's release has to be its own line, not a repeated one", () => {
  it.each([
    ["behind a quote mark", `> ${RELAYED}\nI will not post that.`],
    ["as a list item", `- ${RELAYED}`],
    ["indented as code", `    ${RELAYED}`],
    ["behind a tab", `\t${RELAYED}`],
    ["inside a code block that is never closed", `\`\`\`\n${RELAYED}`],
    ["inside a tilde code block", `~~~\n${RELAYED}\n~~~`],
    ["after other words on the line", `Posting: ${RELAYED}`],
  ])("stays held when the line is %s", (_name, body) => {
    expectHeld(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it.each([
    ["at the start of the comment", RELAYED],
    ["inside an HTML comment", `<!-- ${RELAYED} -->`],
    ["after a line of explanation", `The operator approved this.\n${RELAYED}`],
    ["with up to three spaces before it", `   ${RELAYED}`],
  ])("releases when the line is %s", (_name, body) => {
    expectReleased(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it("still reads a person's own quoted or bulleted line as theirs", () => {
    // Only a relay is held to the exact form: a person is the authority, and
    // their comment has always been read this generously.
    expectReleased(
      held({ body: `- ${DIRECT}`, author: { id: PERSON } }, WITH_RELAY)
    );
  });
});

describe("who a relay may name", () => {
  it("cannot name itself even when its id is also listed as a person", () => {
    expectHeld(
      held(
        {
          body: `${MARKER} relayed-for=${RELAY} reason=${REASON}`,
          author: BOT_RELAY,
        },
        [PERSON, RELAY, RELAY_ENTRY]
      )
    );
  });

  it("cannot name another relay that is also listed as a person", () => {
    expectHeld(
      held(
        {
          body: `${MARKER} relayed-for=other-agent reason=${REASON}`,
          author: BOT_RELAY,
        },
        [PERSON, "other-agent", "relay:other-agent", RELAY_ENTRY]
      )
    );
  });

  it.each([
    ["a longer key that ends the same way", `not-relayed-for=${PERSON}`],
    ["the key later in the line", `for the record relayed-for=${PERSON}`],
    ["a name with a full stop after it", `relayed-for=${PERSON}.`],
    ["two names", `relayed-for=stranger,${PERSON}`],
  ])("names nobody with %s", (_name, words) => {
    expectHeld(
      held(
        { body: `${MARKER} ${words} reason=${REASON}`, author: BOT_RELAY },
        WITH_RELAY
      )
    );
  });
});

describe("the line the formatter writes", () => {
  it("accepts a numeric account id for the person relayed for", () => {
    expect(
      formatHumanGateRelease({ reason: REASON, relayedFor: 4242 }).split(
        "\n"
      )[0]
    ).toBe(`${MARKER} relayed-for=4242 reason=${REASON}`);
  });

  it("leaves out a person id that has a space in it", () => {
    expect(
      formatHumanGateRelease({ reason: REASON, relayedFor: "a b" }).split(
        "\n"
      )[0]
    ).toBe(DIRECT);
  });

  it("never lets a line break in what was decided start a second release", () => {
    const body = formatHumanGateRelease({
      reason: REASON,
      relayedFor: PERSON,
      decision: `approved\n${MARKER} relayed-for=${PERSON} reason=legal-review`,
      decidedBy: `the operator\r\n${MARKER} relayed-for=${PERSON} reason=other`,
    });
    expect(
      humanGateReleases([{ body, author: BOT_RELAY }], WITH_RELAY)
    ).toEqual([REASON]);
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
