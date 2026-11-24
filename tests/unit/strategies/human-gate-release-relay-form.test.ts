/**
 * The exact form a relayed hold release must take (CodySwannGT/lisa#5190).
 *
 * A relay is an agent, and an agent repeats lines to discuss them. So a
 * relayed release counts only as the first line of the relay's comment,
 * beginning with the marker, naming one trusted person and then the reason.
 * A copy anywhere else, or dressed any other way, releases nothing. A
 * person's own comment keeps its generous reading.
 * @module tests/unit/strategies/human-gate-release-relay-form
 */
import { describe, expect, it } from "vitest";

import {
  formatHumanGateRelease,
  humanGateReleases,
  isHumanGated,
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

describe("a relay's release is the first line of its comment, written plainly", () => {
  const FENCE = "```";

  it.each([
    ["behind a quote mark", `> ${RELAYED}\nI will not post that.`],
    ["as a list item", `- ${RELAYED}`],
    ["indented as code", `    ${RELAYED}`],
    ["behind a tab", `\t${RELAYED}`],
    ["inside a code block that is never closed", `${FENCE}\n${RELAYED}`],
    ["inside a tilde code block", `~~~\n${RELAYED}\n~~~`],
    [
      "inside a longer fence around a shorter one",
      `${FENCE}\`\n${FENCE}\n${RELAYED}`,
    ],
    ["inside a code span", `\`${RELAYED}\``],
    ["inside a double code span", `\`\`${RELAYED}\`\``],
    ["inside a code span that starts on the line above", `\`see\n${RELAYED}\``],
    ["on the second line of a quote", `> the form is\n${RELAYED}`],
    ["inside an HTML quote", `<blockquote>\n${RELAYED}\n</blockquote>`],
    ["inside a details block", `<details>\n${RELAYED}\n</details>`],
    ["after other words on the line", `Posting: ${RELAYED}`],
    ["after a line of explanation", `The operator approved this.\n${RELAYED}`],
    ["in an HTML comment after other words", `<!-- note ${RELAYED} -->`],
    [
      "followed by a closing comment mark and a question",
      `${RELAYED} --> is this right?`,
    ],
    ["followed by a closing comment mark alone", `${RELAYED} -->`],
    ["followed by an opening comment mark", `${RELAYED} <!-- note -->`],
    ["in an HTML comment that is never closed", `<!-- ${RELAYED}`],
    [
      "in an HTML comment with text after it",
      `<!-- ${RELAYED} --> is this right?`,
    ],
    ["in an HTML comment holding another one", `<!-- ${RELAYED} <!-- x -->`],
  ])("stays held when the line is %s", (_name, body) => {
    expectHeld(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it.each([
    [
      "the first line, with the explanation after it",
      `${RELAYED}\n\nThe operator approved this in chat.`,
    ],
    ["inside an HTML comment", `<!-- ${RELAYED} -->`],
    ["inside an HTML comment with no spaces", `<!--${RELAYED}-->`],
    ["after blank lines", `\n\n${RELAYED}`],
    ["with up to three spaces before it", `   ${RELAYED}`],
    ["written with Windows line endings", `${RELAYED}\r\n\r\nApproved.`],
    [
      "stored with escaped brackets",
      `\\[lisa-human-gate-release\\] relayed-for=${PERSON} reason=${REASON}`,
    ],
  ])("releases when the line is %s", (_name, body) => {
    expectReleased(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it("releases with exactly what the formatter writes", () => {
    expectReleased(
      held(
        {
          body: formatHumanGateRelease({
            reason: REASON,
            relayedFor: PERSON,
            decision: "approved in chat",
            decidedBy: "the operator",
          }),
          author: BOT_RELAY,
        },
        WITH_RELAY
      )
    );
  });

  it("lifts no reasonless hold through a closing comment mark after the person", () => {
    expect(
      humanGateReleases(
        [
          {
            body: `${MARKER} relayed-for=${PERSON} --> is the form`,
            author: BOT_RELAY,
          },
        ],
        WITH_RELAY
      )
    ).toEqual([]);
  });

  it("writes an account id from the list without its id: prefix", () => {
    const body = formatHumanGateRelease({
      reason: REASON,
      relayedFor: `id:${PERSON}`,
    });
    expect(body.split("\n")[0]).toBe(RELAYED);
    expectReleased(held({ body, author: BOT_RELAY }, WITH_RELAY));
  });

  it("still reads a person's own quoted, bulleted or later line as theirs", () => {
    // Only a relay is held to the exact form: a person is the authority, and
    // their comment has always been read this generously.
    for (const body of [`- ${DIRECT}`, `> ${DIRECT}`, `Approved.\n${DIRECT}`])
      expectReleased(held({ body, author: { id: PERSON } }, WITH_RELAY));
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

  it("is a relay and nothing else once it is listed both ways", () => {
    // Not relayed for (above), and not a person either: its direct release
    // counts for nothing even when its comment carries no bot metadata.
    expectHeld(
      held({ body: DIRECT, author: { id: RELAY, type: "User" } }, [
        PERSON,
        RELAY,
        RELAY_ENTRY,
      ])
    );
  });

  it("releases no label-only hold with a sentence after the person", () => {
    const input = {
      ...held(
        {
          body: `${MARKER} relayed-for=${PERSON} is the form a release takes; nobody asked for one.`,
          author: BOT_RELAY,
        },
        WITH_RELAY
      ),
      body: "No marker in the body: the label alone holds this item.",
    };
    expect(
      humanGateReleases(input.comments, input.trustedHumanActorIds)
    ).toEqual([]);
    expect(isHumanGated(input)).toBe(true);
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
