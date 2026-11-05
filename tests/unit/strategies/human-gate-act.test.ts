/**
 * A human gate names an act an agent cannot perform (CodySwannGT/lisa#4658).
 *
 * The contract used to define a gate as "a human product call is pending", and
 * almost any open choice reads as one — so plain decisions were held for a
 * person who then answered "you decide". These suites pin the narrowed
 * definition at the writer end: the check that refuses a topic-only reason.
 * The sweep that lifts old invalid holds is covered in `human-gate-lift`.
 * @module tests/unit/strategies/human-gate-act
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  DECIDE_AND_RECORD,
  classifyHumanGateReason,
  formatHumanGateHold,
  main,
  resolveHumanOnly,
} from "../../../plugins/src/base/scripts/human-gate-act.mjs";

const CREDENTIAL = "credential";
const LISA_POLICY = "lisa-policy";
const UNREACHABLE = "unreachable-system";
const AWS_ROOT = "aws-root-credential";

describe("classifyHumanGateReason", () => {
  it.each([
    "role-split-triage",
    "session-manager-dispatch",
    "tenancy-audit-triage",
    "design decision",
    "which name to use for the reviewer role",
    "a human product call is pending",
    "compliance-dashboard-triage",
    "legal-page-copy-triage",
    "contract-renewal-dispatch",
    "secrets-manager-migration-design",
    "payments-page-naming",
    "oauth-provider-choice",
    "hardware-sku-naming",
    "no-access-error-copy",
    "buy-button-color",
    "monitoring-dashboard-spend-split",
    "credential-rotation-policy",
    "gdpr-banner-placement",
    "api-keys-table-pagination",
  ])("refuses the topic-only reason %j and names decide-and-record", reason => {
    const verdict = classifyHumanGateReason(reason);
    expect(verdict.valid).toBe(false);
    expect(verdict.remedy).toBe(DECIDE_AND_RECORD);
    expect(verdict.remedy).toContain("Decide and record");
    expect(verdict.remedy).toContain("build_ready: true");
  });

  it.each([
    ["needs the production API key only the founder holds", CREDENTIAL],
    [AWS_ROOT, CREDENTIAL],
    ["approve spending $200/month on a paid plan", "spend"],
    ["open a vendor account with the SMS provider", "external-account"],
    ["HIPAA compliance sign-off", "legal-signoff"],
    ["name an accountable person for the data processor", "accountable-person"],
    ["flash firmware on the physical device", UNREACHABLE],
    [
      "exploratory finding — product significance is a human product call",
      LISA_POLICY,
    ],
    ["a human approves the proposed harness intervention", LISA_POLICY],
    [
      "a human decides whether this knowledge is promoted, demoted, or retired",
      LISA_POLICY,
    ],
    ["a vendor or provider account in the company's name", "external-account"],
    ["an owner or approver who answers for the result", "accountable-person"],
    ["granting an access the agent lacks", UNREACHABLE],
    ["CloudWatch read access the agent does not have", UNREACHABLE],
    ["a person must give the agent Sentry access", UNREACHABLE],
    ["CloudWatch tool access", UNREACHABLE],
    ["a hold the operator explicitly asked for", LISA_POLICY],
    ["Coverage work explicitly held for operator prioritization", LISA_POLICY],
    ["the Stripe API key for the payments dashboard", CREDENTIAL],
    ["the production database password for the migration", CREDENTIAL],
    ["plug in the physical test device for the UI run", UNREACHABLE],
    [
      "a person with admin rights must add the bot to the workspace",
      UNREACHABLE,
    ],
    ["the client must sign the BAA", "legal-signoff"],
  ])("accepts %j as the act %s", (reason, act) => {
    const verdict = classifyHumanGateReason(reason);
    expect(verdict.valid).toBe(true);
    expect(verdict.act).toBe(act);
    expect(verdict.remedy).toBeNull();
  });

  it("lets a project widen the gate with a declared human-only class", () => {
    expect(classifyHumanGateReason("pricing-tier-change").valid).toBe(false);
    const verdict = classifyHumanGateReason("pricing-tier-change", {
      humanOnly: ["pricing"],
    });
    expect(verdict.valid).toBe(true);
    expect(verdict.act).toBe("project-policy");
    expect(verdict.label).toContain("pricing");
  });

  it("matches a declared class on word boundaries only", () => {
    expect(
      classifyHumanGateReason("repricing-cache", { humanOnly: ["pricing"] })
        .valid
    ).toBe(false);
  });
});

describe("formatHumanGateHold", () => {
  it("names the required act in the visible line", () => {
    const { label } = classifyHumanGateReason(AWS_ROOT);
    expect(
      formatHumanGateHold({
        reason: "the AWS root credential",
        slug: AWS_ROOT,
        label,
      })
    ).toBe(
      [
        "Held for a person to supply a credential only a person holds: the AWS root credential.",
        "<!-- [lisa-human-gate] reason=aws-root-credential -->",
      ].join("\n")
    );
  });
});

describe("the writer-side CLI", () => {
  const run = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      write: text => out.push(text),
      error: text => err.push(text),
    });
    return { code, out: out.join(""), err: err.join("") };
  };
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-human-gate-act-"));
  afterAll(() => rmSync(dir, { force: true, recursive: true }));
  const config = path.join(dir, "config.json");
  const local = path.join(dir, "missing.local.json");
  writeFileSync(
    config,
    JSON.stringify({ humanGate: { humanOnly: ["pricing"] } })
  );

  it("refuses a topic-only reason with exit 1", () => {
    const result = run([
      "check",
      "--reason",
      "role-split-triage",
      "--config",
      config,
      "--local",
      local,
    ]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).remedy).toContain("Decide and record");
  });

  it("accepts a credential with exit 0", () => {
    const result = run([
      "check",
      "--reason",
      "staging database password",
      "--config",
      config,
      "--local",
      local,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).act).toBe(CREDENTIAL);
  });

  it("reads the project's widened gate from config", () => {
    const result = run([
      "check",
      "--reason=pricing-tier",
      `--config=${config}`,
      `--local=${local}`,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).act).toBe("project-policy");
  });

  it("exits 2 on a usage error", () => {
    expect(run(["check"]).code).toBe(2);
  });

  it("lets a local override replace the global classes", () => {
    expect(
      resolveHumanOnly(
        { humanGate: { humanOnly: ["hiring"] } },
        { humanGate: { humanOnly: ["pricing"] } }
      )
    ).toEqual(["hiring"]);
    expect(resolveHumanOnly(undefined, undefined)).toEqual([]);
  });
});
