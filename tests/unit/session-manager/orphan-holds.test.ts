/**
 * The hold half of the session manager's sweep (CodySwannGT/lisa#4722).
 *
 * Holds an agent may decide used to sit in the queue until someone noticed.
 * The sweep lifts them through the shared lift planner with a `Decision:`
 * line, and gathers the rest, the truly-human holds, into one operator list
 * whose fingerprint does not depend on the order holds arrive in.
 * @module tests/unit/session-manager/orphan-holds
 */
import { describe, expect, it } from "vitest";

import { HUMAN_GATE_LIFTED_MARKER } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  CREDENTIAL,
  READY,
  TOPIC,
  heldBody,
  hold,
  plan,
  ref,
} from "./support/orphan-fixtures.js";

describe("holds", () => {
  it("lifts a hold an agent may decide, with a Decision line on every comment", () => {
    const result = plan({ holds: [hold(1, { body: heldBody(TOPIC) })] });
    expect(result.holds.lift).toHaveLength(1);
    const lift = result.holds.lift[0];
    expect(lift?.ref).toBe(ref(1));
    expect(lift?.decision).toMatch(/^Decision: /);
    expect(lift?.actions).toEqual({
      removeHumanNeededLabel: true,
      addReadyLabel: null,
    });
    expect(lift?.comments).toHaveLength(1);
    const lines = lift?.comments[0]?.split("\n") ?? [];
    expect(lines[0]).toBe(`${HUMAN_GATE_LIFTED_MARKER} reason=${TOPIC}`);
    expect(lines.at(-1)).toBe(lift?.decision);
    expect(result.holds.keep).toEqual([]);
  });

  it("skips a hold already lifted, so a lift is posted once", () => {
    const first = plan({ holds: [hold(1, { body: heldBody(TOPIC) })] });
    const comments = (first.holds.lift[0]?.comments ?? []).map(body => ({
      body,
    }));
    const again = plan({
      holds: [hold(1, { body: heldBody(TOPIC), labels: [READY], comments })],
    });
    expect(again.holds.lift).toEqual([]);
    expect(again.holds.keep).toEqual([]);
    expect(again.skipped).toEqual([{ ref: ref(1), reason: "already-lifted" }]);
  });

  it("keeps a hold only a person can act on, saying what the act is", () => {
    const result = plan({ holds: [hold(1)] });
    expect(result.holds.lift).toEqual([]);
    expect(result.holds.keep).toEqual([
      { ref: ref(1), reason: expect.stringContaining("stripe api key") },
    ]);
    expect(result.holds.keep[0]?.reason).toContain("credential");
  });

  it("keeps a label-only hold as 'no stated reason'", () => {
    const result = plan({ holds: [hold(1, { body: "No marker here." })] });
    expect(result.holds.keep).toEqual([
      { ref: ref(1), reason: "no stated reason" },
    ]);
  });

  it("skips a hold a trusted person already released", () => {
    const result = plan(
      {
        holds: [
          hold(1, {
            labels: [READY],
            comments: [
              {
                body: `[lisa-human-gate-release] reason=${CREDENTIAL}\nKey added.`,
                author: { id: "op-1" },
              },
            ],
          }),
        ],
      },
      { trustedAuthorIds: ["op-1"] }
    );
    expect(result.holds.keep).toEqual([]);
    expect(result.holds.digest.text).toBe("");
  });
});

describe("the operator digest", () => {
  it("is one plain list of the truly-human holds, one line per item", () => {
    const result = plan({
      holds: [hold(2), hold(1, { body: "No marker here." })],
    });
    const lines = result.holds.digest.text.split("\n");
    expect(lines.slice(1)).toEqual([
      `${ref(1)}: no stated reason`,
      expect.stringMatching(new RegExp(`^${ref(2)}: stripe api key`)),
    ]);
    expect(lines[0]).toMatch(/2/);
    expect(result.holds.digest.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has the same fingerprint whatever order the holds arrive in", () => {
    const a = plan({ holds: [hold(1), hold(2, { body: "x" })] });
    const b = plan({ holds: [hold(2, { body: "x" }), hold(1)] });
    expect(a.holds.digest.fingerprint).toBe(b.holds.digest.fingerprint);
    expect(a.holds.digest.text).toBe(b.holds.digest.text);
  });

  it("changes fingerprint when a hold's reason changes", () => {
    const a = plan({ holds: [hold(1)] });
    const b = plan({ holds: [hold(1, { body: "x" })] });
    expect(a.holds.digest.fingerprint).not.toBe(b.holds.digest.fingerprint);
  });

  it("is empty, with a null fingerprint, when nothing is truly human", () => {
    const result = plan({ holds: [] });
    expect(result.holds.digest).toEqual({
      fingerprint: null,
      text: "",
      changed: false,
    });
  });

  it("reports changed only when the fingerprint differs from the stored one", () => {
    const first = plan({ holds: [hold(1)] });
    expect(first.holds.digest.changed).toBe(true);
    const same = plan(
      { holds: [hold(1)] },
      { previousDigest: first.holds.digest.fingerprint }
    );
    expect(same.holds.digest.changed).toBe(false);
    const cleared = plan(
      { holds: [] },
      { previousDigest: first.holds.digest.fingerprint }
    );
    expect(cleared.holds.digest.changed).toBe(true);
  });
});
