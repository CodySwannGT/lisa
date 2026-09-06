/**
 * The ALLOW side of an observer-only role (issue #3475).
 *
 * "Observer-only" was defined entirely by what it must not do, and the proof
 * prescribed for it — `iam:PassRole` and a production mutation must return
 * `AccessDenied` — tests only the deny side. **A role that can read nothing at
 * all passes that check perfectly.** So the read surface of a headless verifier
 * was discovered by `AccessDenied`, one action at a time, at verification time:
 * three consecutive incidents in one consumer, each a read the role's own
 * purpose obviously implied, each granted a ticket and a deploy later.
 *
 * The cases below are the missing half. `refuses a role that can read nothing`
 * is the one that matters: it is the assertion that fails when the definition
 * is violated, and without it every other case here could pass against a role
 * with no permissions whatsoever.
 *
 * The deny side is asserted too, and for a specific reason. `AccessDenied` is
 * what an unassumed role, a misconfigured profile and a correctly-scoped
 * observer all return, so a boundary check that runs before identity is bound
 * passes on a credential that reached the wrong account entirely. The ordering
 * case pins that the account assertion runs first.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED — the
 * surface names and probe strings below are written out rather than parsed back
 * out of the script under test, so a table edited in the script fails these
 * rather than silently redefining what they assert.
 *
 * @module tests/unit/strategies/remote-agent-aws-observer-reads
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REMOTE_SETUP_SCRIPT_PATH,
  removeTemporaryDirectories,
  runBootstrap,
  workstation,
} from "./support/remote-agent-aws-harness.js";

/** The account both stages resolve to; irrelevant to the reads themselves. */
const ACCOUNT = "111111111111";

/** The observer stage the contract names, and the one these cases probe. */
const OBSERVER_STAGE = "production";

/** The profile that stage is written as, under the namespace below. */
const OBSERVER_PROFILE = "acme-agent-production";

/** A namespace, supplied explicitly so no case depends on a git remote. */
const NAMESPACE = "acme";

/** The three probes named individually below as well as inside the table. */
const EC2_PROBE = "ec2 describe-instances";
const ALARMS_PROBE = "cloudwatch describe-alarms";
const PIPELINES_PROBE = "codepipeline list-pipelines";

/**
 * Every surface the observer contract requires, and the read that proves it.
 *
 * Hardcoded, and deliberately the whole list rather than a sample: this IS the
 * definition of "observer-only" on the allow side, and a test that checked only
 * a couple of rows would let the list be quietly narrowed back to the services
 * one stack happens to deploy — which is how the original policy came to be
 * missing instance, alarm and pipeline reads at the same time.
 */
const SURFACES: readonly (readonly [string, string])[] = [
  ["deployment stacks", "cloudformation describe-stacks"],
  ["compute inventory", EC2_PROBE],
  ["alarm state", ALARMS_PROBE],
  ["delivery pipelines", PIPELINES_PROBE],
  ["builds", "codebuild list-projects"],
  ["functions", "lambda list-functions"],
  ["logs", "logs describe-log-groups"],
  ["http endpoints", "apigateway get-rest-apis"],
  ["queues", "sqs list-queues"],
  ["workflows", "stepfunctions list-state-machines"],
];

/** The three reads whose absence caused the incidents this issue was filed on. */
const INCIDENT_PROBES: readonly string[] = [
  EC2_PROBE,
  ALARMS_PROBE,
  PIPELINES_PROBE,
];

/**
 * A bundle with one repair stage and one observer stage.
 * @param observer - Explicit `observer` flag, or undefined to let it derive
 * @returns The bundle, double-encoded the way the real emission is
 */
function bundle(observer?: boolean): string {
  const production: Record<string, unknown> = {
    roleArn: `arn:aws:iam::${ACCOUNT}:role/RemoteAgent`,
    region: "us-west-2",
  };
  if (observer !== undefined) production.observer = observer;
  return JSON.stringify({
    accessKeyId: "AKIATEST",
    secretAccessKey: "test-secret",
    externalId: "external-id",
    roleName: "RemoteAgent",
    profiles: JSON.stringify({
      dev: {
        roleArn: `arn:aws:iam::${ACCOUNT}:role/RemoteAgent`,
        region: "us-east-1",
      },
      [OBSERVER_STAGE]: production,
    }),
  });
}

/**
 * Run the bootstrap with the observer read check armed.
 * @param overrides - Fake-CLI behaviour and any extra variables
 * @returns The completed process
 */
function runWithObserverCheck(
  overrides: Readonly<Record<string, string>> = {}
): ReturnType<typeof runBootstrap> {
  return runBootstrap({
    workstation: workstation(),
    environment: {
      LISA_AWS_BOOTSTRAP_JSON: bundle(),
      LISA_AWS_PROFILE_NAMESPACE: NAMESPACE,
      LISA_AWS_VERIFY_OBSERVER_READS: "1",
      FAKE_AWS_ALLOW_READS: "1",
      ...overrides,
    },
  });
}

afterEach(removeTemporaryDirectories);

describe("an observer-only role is proved on the allow side", () => {
  it("refuses a role that can read nothing", () => {
    // THE control. A deny-side-only proof passes against this role, which is
    // the whole defect: a verifier that can read nothing is indistinguishable
    // from one that can, right up until it is asked to verify something.
    const denied = SURFACES.map(([, probe]) => probe).join(",");
    const result = runWithObserverCheck({ FAKE_AWS_DENY: denied });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "cannot read the surfaces an observer exists to read"
    );
  });

  it("accepts a role that can read every surface", () => {
    const result = runWithObserverCheck();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("remote-agent-aws-setup: ready");
  });

  it("names every denied surface at once, not the first", () => {
    // An operator repairing a policy wants the whole list. Reporting one at a
    // time is precisely how this consumer paid for three tickets and three
    // deploys to grant three read actions.
    const result = runWithObserverCheck({
      FAKE_AWS_DENY: INCIDENT_PROBES.join(","),
    });

    expect(result.status).not.toBe(0);
    for (const probe of INCIDENT_PROBES) {
      expect(result.stderr).toContain(`aws ${probe}\` was denied`);
    }
  });

  it("says which question each denied surface leaves unanswerable", () => {
    // A denial that names only an action tells an operator what to paste into a
    // policy. Naming the question tells them whether they should.
    const result = runWithObserverCheck({
      FAKE_AWS_DENY: ALARMS_PROBE,
    });

    expect(result.stderr).toContain(
      "is anything alarming right now, and since when"
    );
  });

  it("does not report a pass when the service could not be reached", () => {
    // An unreachable endpoint says nothing about the policy. Folding it into
    // "denied" would send someone to widen a policy that was already correct;
    // folding it into "allowed" would be a green from a check that never ran.
    const result = runWithObserverCheck({
      FAKE_AWS_UNREACHABLE: ALARMS_PROBE,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "could not be checked against the observer read surface"
    );
    expect(result.stderr).toContain("did not return an authorization answer");
    expect(result.stderr).not.toContain(
      "cannot read the surfaces an observer exists to read"
    );
  });

  it("leaves a repair stage alone", () => {
    // dev and staging may repair; only production and shared are observers.
    // Probing a repair profile would fail a role that is behaving correctly.
    const result = runWithObserverCheck({
      FAKE_AWS_DENY: SURFACES.map(([, probe]) => probe).join(","),
      LISA_AWS_BOOTSTRAP_JSON: bundle(false),
    });

    expect(result.status).toBe(0);
  });

  it("stays off unless it is asked for", () => {
    // Opt-in, matching LISA_AWS_VERIFY_ALL_PROFILES. Without the flag a role
    // that can read nothing still bootstraps, which is the pre-existing
    // behaviour and the reason this check has to be run deliberately.
    const result = runBootstrap({
      workstation: workstation(),
      environment: {
        LISA_AWS_BOOTSTRAP_JSON: bundle(),
        LISA_AWS_PROFILE_NAMESPACE: NAMESPACE,
        FAKE_AWS_DENY: SURFACES.map(([, probe]) => probe).join(","),
      },
    });

    expect(result.status).toBe(0);
  });

  it("probes the observer profile, not the default one", () => {
    const result = runWithObserverCheck({
      FAKE_AWS_DENY: EC2_PROBE,
    });

    expect(result.stderr).toContain(OBSERVER_PROFILE);
    expect(result.stderr).toContain(`stage ${OBSERVER_STAGE}`);
  });
});

describe("the observer read surface is stated once", () => {
  const script = readFileSync(path.resolve(REMOTE_SETUP_SCRIPT_PATH), "utf8");
  const guide = readFileSync(path.resolve("docs/remote-agent-aws.md"), "utf8");

  it("carries every surface in the shipped script", () => {
    for (const [surface, probe] of SURFACES) {
      expect(script).toContain(`${surface}\t${probe}\t`);
    }
  });

  it("covers the three reads whose absence caused the incidents", () => {
    // Instance discovery, alarm reads and pipeline definition reads. None
    // appeared in the shipped starter policy, because that policy enumerated
    // the services one stack deployed rather than what a verifier must read.
    for (const probe of INCIDENT_PROBES) {
      expect(script).toContain(probe);
    }
  });

  it("does not let the contract and the check disagree", () => {
    // Two places state what an observer may read — the document a human reads
    // and the table the script executes. They can drift, and a document that
    // promises a read the check does not exercise is exactly the gap this issue
    // is about, one level up.
    for (const [, probe] of SURFACES) {
      expect(guide).toContain(probe);
    }
  });

  it("grants no write anywhere in the surface", () => {
    // The asymmetry that makes widening the allow side safe: every probe is a
    // read. A mutating verb here would turn a proof into a provisioning step.
    for (const [, probe] of SURFACES) {
      const operation = probe.split(" ")[1] ?? "";
      expect(operation).toMatch(/^(describe|list|get)-/u);
    }
  });
});
