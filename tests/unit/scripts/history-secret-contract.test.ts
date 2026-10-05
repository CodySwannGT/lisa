/**
 * @file history-secret-contract.test.ts
 * @description Malformed inputs and missing tooling must never become scanner success.
 * @module tests/history-secrets
 */
import { describe, expect, it } from "vitest";
import {
  parsePush,
  eventPairs,
} from "../../../all/copy-overwrite/scripts/lib/history-secret-git.mjs";
import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
const oid = "a".repeat(40);
const zero = "0".repeat(40);
describe("required introduced history contract", () => {
  it("accepts all actual records and legitimate Unicode/plus refs", () => {
    expect(
      parsePush(
        `refs/heads/café+one ${oid} refs/heads/café+one ${zero}\nrefs/heads/two ${oid} refs/heads/two ${oid}\n`,
        40
      )
    ).toHaveLength(2);
    expect(parsePush("", 40)).toEqual([]);
    expect(parsePush(`(delete) ${zero} refs/heads/one ${oid}\n`, 40)).toEqual([
      { before: oid, after: zero },
    ]);
  });
  it("rejects every malformed record without echoing its content", () => {
    for (const input of [
      "private payload\n",
      `refs/heads/one ${oid} refs/heads/one short\n`,
      `refs/heads/one ${oid} refs/heads/one ${zero}\n\n`,
      `refs/heads/../one ${oid} refs/heads/one ${zero}\n`,
    ])
      expect(() => parsePush(input, 40)).toThrow(/Malformed/u);
  });
  it("uses actual event IDs and deletion semantics", () => {
    expect(
      eventPairs(
        { pull_request: { base: { sha: zero }, head: { sha: oid } } },
        "pull_request",
        40
      )
    ).toEqual([{ before: zero, after: oid }]);
    expect(
      eventPairs({ before: oid, after: zero, deleted: true }, "push", 40)
    ).toEqual([{ before: oid, after: zero }]);
    expect(() => eventPairs({}, "workflow_dispatch", 40)).toThrow(/actual/u);
  });
  it("refuses absent, malformed and inconsistent supplied deletion IDs", () => {
    for (const after of [undefined, "private payload", oid])
      expect(() =>
        eventPairs({ before: oid, after, deleted: true }, "push", 40)
      ).toThrow(/event/u);
    expect(() =>
      eventPairs({ before: "bad", after: zero, deleted: true }, "push", 40)
    ).toThrow(/Malformed/u);
    expect(eventPairs({ before: oid, after: oid }, "push", 40)).toEqual([
      { before: oid, after: oid },
    ]);
  });
  it("resolves only the new manifest-free owned facade and preserves unrelated choices", () => {
    const gates = {
      "introduced-history-credential-leakage": {
        push: "required",
        "pull-request": "required",
      },
      "credential-leakage": { "pull-request": "off" },
    };
    for (const moment of ["push", "pull-request"])
      expect(
        resolveMoment({ gates, moment, scripts: null }).find(
          (entry: { id: string }) =>
            entry.id === "introduced-history-credential-leakage"
        )
      ).toMatchObject({ level: "required", mode: "builtin", command: null });
    expect(
      resolveMoment({
        gates,
        moment: "pull-request",
        scripts: null,
        includeOff: true,
      }).find((entry: { id: string }) => entry.id === "credential-leakage")
    ).toMatchObject({ level: "off" });
  });
});
