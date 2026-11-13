/**
 * A human gate names an act an agent cannot perform (CodySwannGT/lisa#4658).
 *
 * The contract used to define a gate as "a human product call is pending", and
 * almost any open choice reads as one — so plain decisions were held for a
 * person who then answered "you decide". These suites pin the narrowed
 * definition at the writer end: the check that refuses a topic-only reason.
 * The sweep that lifts old invalid holds is covered in `human-gate-lift`;
 * the `humanGate.mode` split (CodySwannGT/lisa#4687) in `human-gate-act-mode`.
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
const UNREACHABLE = "unreachable-system";
const EXTERNAL_ACCOUNT = "external-account";
const LEGAL = "legal-signoff";
const SPEND = "spend";
const AWS_ROOT = "aws-root-credential";
const PERSON_ONLY = "person-only-account";
const OPERATOR_HOLD = "operator-hold";
const STRICT = { mode: "strict" } as const;

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
    "payments-page-naming",
    "hardware-sku-naming",
    "no-access-error-copy",
    "buy-button-color",
    "monitoring-dashboard-spend-split",
    "gdpr-banner-placement",
    "regulatory-report-format",
    "hipaa-logging-approach",
    "legal-entity-field",
    "soc2-evidence-folder-structure",
    "contract-test-framework-pick",
    "hardware-acceleration-flag",
    "physical-units-conversion",
    "spend-dashboard-triage",
    "fee-label-copy",
    "choose the fee label",
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
    ["approve spending $200/month on a paid plan", SPEND],
    ["open a vendor account with the SMS provider", EXTERNAL_ACCOUNT],
    ["flash firmware on the physical device", UNREACHABLE],
    ["a vendor or provider account in the company's name", EXTERNAL_ACCOUNT],
    ["granting an access the agent lacks", UNREACHABLE],
    ["CloudWatch read access the agent does not have", UNREACHABLE],
    ["a person must give the agent Sentry access", UNREACHABLE],
    ["CloudWatch tool access", UNREACHABLE],
    ["the Stripe API key for the payments dashboard", CREDENTIAL],
    ["the production database password for the migration", CREDENTIAL],
    ["plug in the physical test device for the UI run", UNREACHABLE],
    [
      "a person with admin rights must add the bot to the workspace",
      UNREACHABLE,
    ],
    ["the client must sign the BAA", LEGAL],
    ["sign the BAA", LEGAL],
    ["sign the DPA with the analytics vendor", LEGAL],
    ["accept the license agreement on behalf of the company", LEGAL],
    ["interactive OAuth login", CREDENTIAL],
    ["complete the interactive SSO login for the vendor portal", CREDENTIAL],
    ["create an API key in the vendor console", CREDENTIAL],
    ["spend money", SPEND],
    ["approve the protected deployment to production", PERSON_ONLY],
    [
      "the required reviewer must approve the production environment",
      PERSON_ONLY,
    ],
    ["an account only a person holds", PERSON_ONLY],
    ["a hold the operator explicitly asked for", OPERATOR_HOLD],
    [
      "Coverage work explicitly held for operator prioritization",
      OPERATOR_HOLD,
    ],
  ])("accepts %j as the act %s", (reason, act) => {
    for (const options of [{}, STRICT]) {
      const verdict = classifyHumanGateReason(reason, options);
      expect(verdict.valid).toBe(true);
      expect(verdict.act).toBe(act);
      expect(verdict.remedy).toBeNull();
    }
  });

  // A secret is never a topic: a credential keyword wins over the topic veto,
  // even in a slug. A writer that accepts one of these keeps today's
  // behaviour (a held item); refusing a real credential gate would not.
  it.each([
    "secrets-manager-migration-design",
    "credential-rotation-policy",
    "api-keys-table-pagination",
    "credential-storage-strategy",
    "secrets-manager-adoption",
    "password-reset-email-template",
  ])("lets a secret keyword win over the topic veto for %j", reason => {
    expect(classifyHumanGateReason(reason).act).toBe(CREDENTIAL);
  });

  // Known writer false-accepts, pinned so a change in either direction is
  // deliberate: an act verb sits inside the slug.
  it.each([
    ["payment-approval-flow-design", SPEND],
    ["open-account-settings-page-design", EXTERNAL_ACCOUNT],
  ])("still accepts %j (act verb in a topic slug)", (reason, act) => {
    expect(classifyHumanGateReason(reason).act).toBe(act);
  });

  it.each([
    ["the operator's 2FA code for the AWS console migration", CREDENTIAL],
    ["someone must buy the domain for the docs site", SPEND],
    [
      "a person with admin rights must add the bot to the Slack workspace",
      UNREACHABLE,
    ],
    ["add the bot to the workspace", UNREACHABLE],
    ["grant admin to the deploy role", UNREACHABLE],
    [
      "a person must add the deploy key to the GitHub repo settings page",
      CREDENTIAL,
    ],
    ["someone must pay the Apple developer fee", SPEND],
    ["pay registration fee", SPEND],
    ["pay $49 fee", SPEND],
    ["a person must physically reboot the office router", UNREACHABLE],
    ["invite the agent's bot user to the Linear workspace", UNREACHABLE],
  ])("accepts the real act %j", (reason, act) => {
    expect(classifyHumanGateReason(reason).act).toBe(act);
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
        "Held for a person to complete a login or supply a credential only a person holds: the AWS root credential.",
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

  it.each([
    [["check", "--reason", "--config", "x"]],
    [["check", "--reason=", "--config", "x"]],
    [["check", "--reason", "   "]],
    [["check", "--reason", AWS_ROOT, "--config"]],
    [["check", "--reason", AWS_ROOT, "--local="]],
  ])("exits 2, not 1, when an operand is missing: %j", argv => {
    expect(run(argv).code).toBe(2);
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
