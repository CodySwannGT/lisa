/**
 * Resolution of a gate that declares `parts`.
 *
 * A gate with parts resolves to one entry per part at every moment it is
 * declared at, each carrying the folder it covers (`scope`) and the argument
 * list that checks it (`argv`). A gate with no parts must resolve exactly as
 * it did before the key existed — field for field — because every hook and
 * workflow in an installed repository already reads those entries.
 *
 * This file holds a custom gate with parts and the gates beside it. A registry
 * gate with parts, malformed parts and a second prover are in
 * `lisa-gates-parts-resolution-registry.test.ts`.
 * @module tests/unit/controls/lisa-gates-parts-resolution
 */
import { describe, expect, it } from "vitest";

import {
  API_COMMAND,
  API_PART,
  COMMIT,
  ESTABLISHED_KEYS,
  LINT,
  PULL_REQUEST,
  PUSH,
  resolveAt,
  WEB_COMMAND,
  WEB_PART,
} from "./support/lisa-gates-parts-resolution-helpers.js";

describe("resolveMoment on a gate with parts", () => {
  const gates = {
    [LINT]: {
      [COMMIT]: "required",
      [PUSH]: "optional",
      [PULL_REQUEST]: "off",
      parts: [API_PART, WEB_PART],
    },
  };

  it("returns one entry per part, each with its scope and argument list", () => {
    expect(resolveAt(gates, COMMIT)).toEqual([
      {
        id: LINT,
        level: "required",
        mode: "run",
        awaits: null,
        postedBy: null,
        // The project's own `run:` task. A gate with parts names none: what
        // runs is the part's argument list, carried in `argv`.
        declared: null,
        // No task and no `<runner> <task>` string. A part's command is never
        // joined into text, because text is what a shell would be handed.
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "api",
        argv: API_COMMAND,
      },
      {
        id: LINT,
        level: "required",
        mode: "run",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "web",
        argv: WEB_COMMAND,
      },
    ]);
  });

  it("adds scope and argv after the keys every entry already had", () => {
    const [entry] = resolveAt(gates, COMMIT);

    expect(Object.keys(entry ?? {})).toEqual([
      ...ESTABLISHED_KEYS,
      "scope",
      "argv",
    ]);
  });

  it("carries the level declared at each moment", () => {
    expect(resolveAt(gates, PUSH).map(entry => entry.level)).toEqual([
      "optional",
      "optional",
    ]);
  });

  it("returns nothing at a moment the gate is not declared at", () => {
    expect(resolveAt(gates, "post-tool")).toEqual([]);
  });

  it("returns nothing for a moment declared off, unless asked", () => {
    expect(resolveAt(gates, PULL_REQUEST)).toEqual([]);
  });

  it("reports each part of a gate declared off, with nothing to run", () => {
    expect(resolveAt(gates, PULL_REQUEST, true)).toEqual([
      {
        id: LINT,
        level: "off",
        mode: "off",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "api",
        argv: null,
      },
      {
        id: LINT,
        level: "off",
        mode: "off",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "web",
        argv: null,
      },
    ]);
  });

  it("keeps the parts in the order they were declared", () => {
    const reversed = {
      [LINT]: { [COMMIT]: "required", parts: [WEB_PART, API_PART] },
    };

    expect(resolveAt(reversed, COMMIT).map(entry => entry.scope)).toEqual([
      "web",
      "api",
    ]);
  });

  it("hands out a copy of the argument list, never the declaration's own", () => {
    const [entry] = resolveAt(gates, COMMIT);
    entry?.argv?.push("--fix");

    expect(API_COMMAND).toEqual(["go", "vet", "./..."]);
    expect(resolveAt(gates, COMMIT)[0]?.argv).toEqual(API_COMMAND);
  });
});

describe("resolveMoment beside a gate with parts", () => {
  const plain = {
    "code-style": { run: "lint", [COMMIT]: "required" },
    "type-correctness": { [PUSH]: "required" },
  };

  it("resolves a gate with no parts to exactly the keys it always had", () => {
    const mixed = {
      ...plain,
      [LINT]: { [COMMIT]: "required", parts: [API_PART, WEB_PART] },
    };
    const [codeStyle] = resolveAt(mixed, COMMIT);

    expect(codeStyle?.id).toBe("code-style");
    expect(Object.keys(codeStyle ?? {})).toEqual(ESTABLISHED_KEYS);
    expect(codeStyle).toEqual(resolveAt(plain, COMMIT)[0]);
  });

  it("is unchanged by criteria, owner and tier on a gate with no parts", () => {
    const described = {
      "code-style": {
        ...plain["code-style"],
        criteria: ["SI7"],
        owner: "Platform team",
        tier: "advisory",
      },
      "type-correctness": plain["type-correctness"],
    };

    for (const moment of [COMMIT, PUSH]) {
      expect(resolveAt(described, moment)).toEqual(resolveAt(plain, moment));
    }
  });

  it("orders parts among other gates by gate id", () => {
    const mixed = {
      "x-zeta": { run: "zeta", [COMMIT]: "required" },
      [LINT]: { [COMMIT]: "required", parts: [WEB_PART, API_PART] },
      "x-alpha": { run: "alpha", [COMMIT]: "required" },
    };

    expect(
      resolveAt(mixed, COMMIT).map(entry => [entry.id, entry.scope])
    ).toEqual([
      ["x-alpha", undefined],
      [LINT, "web"],
      [LINT, "api"],
      ["x-zeta", undefined],
    ]);
  });
});
