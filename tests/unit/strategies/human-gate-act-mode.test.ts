/**
 * `humanGate.mode` decides which acts are human gates (CodySwannGT/lisa#4687).
 *
 * An agent performs every act it has access to perform. Under the default
 * `access-only` mode a gate is valid only for an act the agent genuinely lacks
 * access to; the acts Lisa used to reserve for a person — a compliance
 * judgement, naming an accountable person, promoting a learning — are
 * decisions the agent makes and records. `strict` restores them. These suites
 * pin both modes on the real config-resolution path: the writer-side CLI
 * reading `.lisa.config.json` and `.lisa.config.local.json`.
 * @module tests/unit/strategies/human-gate-act-mode
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  DECIDE_AND_RECORD,
  DEFAULT_HUMAN_GATE_MODE,
  HUMAN_GATE_MODES,
  classifyHumanGateReason,
  main,
  resolveHumanGateMode,
  resolveHumanGatePolicy,
} from "../../../plugins/src/base/scripts/human-gate-act.mjs";

const ACCESS_ONLY = "access-only";
const STRICT_MODE = "strict";
const STRICT = { mode: STRICT_MODE } as const;
const LISA_POLICY = "lisa-policy";
const COMPLIANCE = "compliance-signoff";
const ACCOUNTABLE = "accountable-person";
const HIPAA = "HIPAA compliance sign-off";
const NAME_OWNER = "name an accountable person";
const PROMOTION = "a human decides whether this knowledge is promoted";

describe("classifyHumanGateReason under each humanGate.mode", () => {
  it.each([
    [HIPAA, COMPLIANCE],
    ["legal must review the new terms of service page", COMPLIANCE],
    ["GDPR review of the new data flow", COMPLIANCE],
    [NAME_OWNER, ACCOUNTABLE],
    ["name an accountable person for the data processor", ACCOUNTABLE],
    ["an owner or approver who answers for the result", ACCOUNTABLE],
    [PROMOTION, LISA_POLICY],
    [
      "a human decides whether this knowledge is promoted, demoted, or retired",
      LISA_POLICY,
    ],
    [
      "exploratory finding — product significance is a human product call",
      LISA_POLICY,
    ],
    ["a human approves the proposed harness intervention", LISA_POLICY],
    ["retire the nightly automation", LISA_POLICY],
    ["operator prioritization of the coverage backlog", LISA_POLICY],
  ])(
    "treats the legacy gate %j as a decision by default, and as %s under strict",
    (reason, act) => {
      const access = classifyHumanGateReason(reason);
      expect(access.valid).toBe(false);
      expect(access.remedy).toBe(DECIDE_AND_RECORD);
      const strict = classifyHumanGateReason(reason, STRICT);
      expect(strict.valid).toBe(true);
      expect(strict.act).toBe(act);
    }
  );

  // The authorship rule is not an access gate, but it holds in both modes:
  // a surface declared human-authored receives no automated writes, so a
  // change to one waits on the person who authors it.
  it.each([
    "a person edits .agents/rules/README.md, which is declared human-authored, so no agent may write it",
    "a person edits .claude/rules/PROJECT_RULES.md, which is declared human-authored, so no agent may write it",
    "promote this learning into AGENTS.md, a human-authored file",
    "a change to a human-authored surface",
  ])("holds %j in both modes as a human-authored surface", reason => {
    for (const options of [{}, STRICT]) {
      const verdict = classifyHumanGateReason(reason, options);
      expect(verdict.valid).toBe(true);
      expect(verdict.act).toBe("human-authored-surface");
      expect(verdict.label).toBe(
        "edit a file the project says only people write"
      );
    }
  });

  it("does not read a slug about human-authored docs as the authorship hold", () => {
    expect(classifyHumanGateReason("human-authored-docs-layout").valid).toBe(
      false
    );
  });

  it("reads the mode case- and whitespace-insensitively", () => {
    expect(classifyHumanGateReason(HIPAA, { mode: " Strict " }).valid).toBe(
      true
    );
  });

  it("reads an unknown mode as the default, never as strict", () => {
    expect(classifyHumanGateReason(HIPAA, { mode: "strcit" }).valid).toBe(
      false
    );
    expect(classifyHumanGateReason(NAME_OWNER, { mode: 1 }).valid).toBe(false);
  });

  it("lets humanOnly widen the gate in both modes", () => {
    for (const mode of HUMAN_GATE_MODES) {
      expect(
        classifyHumanGateReason("pricing-tier-change", {
          humanOnly: ["pricing"],
          mode,
        }).act
      ).toBe("project-policy");
    }
  });
});

describe("the writer-side CLI under each humanGate.mode", () => {
  const run = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      write: text => out.push(text),
      error: text => err.push(text),
    });
    return { code, out: out.join(""), err: err.join("") };
  };
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-human-gate-mode-"));
  afterAll(() => rmSync(dir, { force: true, recursive: true }));
  const fixture = (name: string, content: unknown): string => {
    const file = path.join(dir, name);
    writeFileSync(file, JSON.stringify(content));
    return file;
  };
  const accessConfig = fixture("config.json", {});
  const strictConfig = fixture("strict.json", {
    humanGate: { mode: STRICT_MODE },
  });
  const localAccess = fixture("access.local.json", {
    humanGate: { mode: ACCESS_ONLY },
  });
  const badConfig = fixture("bad-mode.json", {
    humanGate: { mode: "lenient" },
  });
  const noLocal = path.join(dir, "missing.local.json");
  const check = (reason: string, config: string, local = noLocal) =>
    run(["check", "--reason", reason, "--config", config, "--local", local]);

  it.each([
    [HIPAA, 1, 0],
    [NAME_OWNER, 1, 0],
    [PROMOTION, 1, 0],
    ["interactive OAuth login", 0, 0],
    ["create an API key in the vendor console", 0, 0],
    ["spend money", 0, 0],
    ["sign the BAA", 0, 0],
  ])(
    "classifies %j with exit %i by default and %i under strict",
    (reason, byDefault, strict) => {
      const access = check(reason, accessConfig);
      expect(access.code).toBe(byDefault);
      expect(JSON.parse(access.out).mode).toBe(ACCESS_ONLY);
      const held = check(reason, strictConfig);
      expect(held.code).toBe(strict);
      expect(JSON.parse(held.out).mode).toBe(STRICT_MODE);
    }
  );

  it("lets a local mode replace the global one", () => {
    const result = check(NAME_OWNER, strictConfig, localAccess);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).mode).toBe(ACCESS_ONLY);
  });

  it("degrades an invalid mode to the default and reports it", () => {
    const result = check(NAME_OWNER, badConfig);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).mode).toBe(DEFAULT_HUMAN_GATE_MODE);
    expect(result.err).toContain('"lenient"');
    expect(result.err).toContain("humanGate.mode");
  });

  it("prints the resolved policy a sweep passes on", () => {
    const result = run([
      "policy",
      "--config",
      strictConfig,
      "--local",
      noLocal,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      mode: STRICT_MODE,
      humanOnly: [],
    });
  });

  it("resolves the whole policy from local then global config", () => {
    expect(DEFAULT_HUMAN_GATE_MODE).toBe(ACCESS_ONLY);
    expect(resolveHumanGateMode(undefined, undefined)).toEqual({
      mode: ACCESS_ONLY,
    });
    expect(
      resolveHumanGateMode(undefined, { humanGate: { mode: STRICT_MODE } })
    ).toEqual({ mode: STRICT_MODE });
    expect(
      resolveHumanGateMode(
        { humanGate: { mode: ACCESS_ONLY } },
        { humanGate: { mode: STRICT_MODE } }
      )
    ).toEqual({ mode: ACCESS_ONLY });
    expect(
      resolveHumanGateMode(undefined, { humanGate: { mode: " STRICT " } })
    ).toEqual({ mode: STRICT_MODE });
    expect(
      resolveHumanGateMode(undefined, { humanGate: { mode: "strcit" } })
    ).toEqual({ mode: ACCESS_ONLY, rejected: '"strcit"' });
    // An invalid local value must not hide a valid global strict.
    expect(
      resolveHumanGateMode(
        { humanGate: { mode: "strcit" } },
        { humanGate: { mode: STRICT_MODE } }
      )
    ).toEqual({ mode: STRICT_MODE, rejected: '"strcit"' });
    expect(
      resolveHumanGatePolicy(
        { humanGate: { humanOnly: ["hiring"] } },
        { humanGate: { mode: STRICT_MODE, humanOnly: ["pricing"] } }
      )
    ).toEqual({ mode: STRICT_MODE, humanOnly: ["hiring"] });
  });
});
