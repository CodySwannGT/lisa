/**
 * Nothing shaped like a credential is accepted in a probe.
 *
 * A probe records a request that was sent with a credential and an error that
 * came back from it, which is exactly where a token gets copied into a report
 * by accident. The check refuses the obvious shapes at that one place, and
 * says which field without repeating what it found there.
 *
 * What counts as a credential's shape is decided by the scanner every control
 * command shares, so a probe is held to the same rule as the rest of the
 * report, the register and the evidence: a long random-looking string is
 * refused only beside a name that says it is a secret, and a commit hash on
 * its own is not (CodySwannGT/lisa#4999).
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import { PROBE_SECRETS_RULE } from "../../../src/controls/audit-report-rules/probe-secrets.js";
import {
  fakeCredential,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
  type SampleProbe,
} from "../../helpers/audit-probes.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { fakeGithubToken, fakeHex } from "../../helpers/fake-credentials.js";
import { violationsOf } from "./audit-report-facts.js";

const TOKEN = fakeCredential();
const HOST = "example.invalid";
const SCHEME = "https:";
const NOT_REPEATED = "The value is not repeated here.";
const USER = "deploy";

/**
 * A web address with a user name and password in front of the host.
 * @param userinfo - What stands before the `@`
 * @param scheme - The address's scheme, with its colon
 * @returns The address
 */
function addressWith(userinfo: string, scheme: string = SCHEME): string {
  return `${scheme}//${userinfo}@${HOST}/example/widgets.git`;
}

/**
 * What the rule says about a report holding one probe.
 * @param probe - The probe
 * @returns The rule's violations
 */
function found(probe: SampleProbe): readonly { readonly message: string }[] {
  return violationsOf(
    withProbes(waitingOn(completeAuditReport()), [probe])
  ).filter(violation => violation.rule === PROBE_SECRETS_RULE);
}

/**
 * The one message the rule is expected to give.
 * @param field - The probe field it is about
 * @param shape - What the value is shaped like
 * @returns The message
 */
function refusal(field: string, shape: string): string {
  return `Probe number 1 in the list holds something shaped like a credential in its "${field}": ${shape}. Take the value out and write the name it goes by instead. ${NOT_REPEATED}`;
}

/** A web address that carries the made-up credential as a password. */
const WITH_PASSWORD = addressWith([USER, TOKEN].join(":"));

const ADDRESS_SHAPE = "a web address with a user name or password in it";
const HEADER_SHAPE = "the value of an authorization header";
const NAMED_SHAPE =
  "a long random-looking value beside a name such as token, secret or password";
const TEXT_FIELDS = [
  ["request"],
  ["observed_error"],
  ["system"],
  ["access_needed"],
] as const;

describe("the made-up credential these cases use", () => {
  it("is built when the test runs and mixes digits, capitals and small letters", () => {
    expect(TOKEN).toHaveLength(40);
    expect(TOKEN).toMatch(/\d/u);
    expect(TOKEN).toMatch(/[A-Z]/u);
    expect(TOKEN).toMatch(/[a-z]/u);
    expect(fakeCredential(40, 3)).not.toBe(TOKEN);
  });
});

describe("a probe that holds something shaped like a credential", () => {
  it.each(TEXT_FIELDS)(
    "is refused for a web address with a password in its %s",
    field => {
      const probe = unreachableProbe({
        [field]: `git ls-remote ${WITH_PASSWORD}`,
      });

      expect(found(probe).map(violation => violation.message)).toEqual([
        refusal(field, ADDRESS_SHAPE),
      ]);
    }
  );

  it("is refused for a web address with a token in place of the user name", () => {
    const probe = unreachableProbe({
      observed_error: `fatal: unable to access '${addressWith(TOKEN)}'`,
    });

    expect(found(probe).map(violation => violation.message)).toEqual([
      refusal("observed_error", ADDRESS_SHAPE),
    ]);
  });

  it.each([
    [
      "a header as curl takes it",
      (token: string) =>
        `curl -H "Authorization: Bearer ${token}" ${SCHEME}//${HOST}/api`,
    ],
    [
      "a header in lower case",
      (token: string) => `authorization: token ${token}`,
    ],
    [
      "a header written with an equals sign",
      (token: string) => `Authorization=${token}`,
    ],
    [
      "a bearer token with no header name",
      (token: string) => `sent with Bearer ${token}`,
    ],
    [
      "a basic credential with no header name",
      (token: string) => `sent with Basic ${token}`,
    ],
  ])("is refused for %s", (_name, write) => {
    const probe = unreachableProbe({ observed_error: write(TOKEN) });

    expect(found(probe).map(violation => violation.message)).toEqual([
      refusal("observed_error", HEADER_SHAPE),
    ]);
  });

  it.each(TEXT_FIELDS)(
    "is refused for a long random-looking value beside a name that says it is a secret, in its %s",
    field => {
      const probe = unreachableProbe({
        [field]: `GET ${SCHEME}//${HOST}/api/projects?api_key=${TOKEN}`,
      });

      expect(found(probe).map(violation => violation.message)).toEqual([
        refusal(field, NAMED_SHAPE),
      ]);
    }
  );

  it("is refused for a token only a provider issues, wherever it stands", () => {
    const probe = unreachableProbe({
      observed_error: `remote: invalid credentials ${fakeGithubToken()}`,
    });

    expect(found(probe).map(violation => violation.message)).toEqual([
      refusal("observed_error", "a GitHub token"),
    ]);
  });

  it("never repeats what it found", () => {
    const probe = reachableProbe({
      request: `curl -H "Authorization: Bearer ${TOKEN}" ${WITH_PASSWORD}`,
    });
    const said = found(probe)
      .map(violation => violation.message)
      .join("\n");

    expect(found(probe).map(violation => violation.message)).toEqual([
      refusal("request", ADDRESS_SHAPE),
      refusal("request", HEADER_SHAPE),
    ]);
    expect(said).not.toContain(TOKEN);
    expect(said).not.toContain(TOKEN.slice(0, 8));
    expect(said).not.toContain(USER);
    expect(said).not.toContain(HOST);
  });
});

describe("a probe that names things without showing them", () => {
  it.each([
    [
      "a plain read",
      "GET repos/example/widgets/rulesets; GET repos/example/widgets",
    ],
    [
      "a read that asks for a page size, as the merge-protection read does",
      "GET repos/example/widgets/rulesets?per_page=100; GET repos/example/widgets/rulesets/7; GET repos/example/widgets",
    ],
    [
      "the name of a secret",
      "GET /api/0/projects/ with the token named SENTRY_AUTH_TOKEN",
    ],
    ["a placeholder", `curl ${SCHEME}//${HOST}/api/projects?key=<token>`],
    ["an ssh address", `git ls-remote ssh://git@${HOST}/example/widgets.git`],
    ["the short ssh form", `git ls-remote git@${HOST}:example/widgets.git`],
    [
      "a long folder name",
      "GET repos/example/a-very-long-repository-name-with-2-services/rulesets",
    ],
    [
      "a long word with a number in it",
      "GET repos/example/widgets/requiredStatusChecksPolicyVersion2ForBranches",
    ],
    ["a commit hash", `GET repos/example/widgets/commits/${fakeHex()}/status`],
    [
      "a long random-looking string with no name beside it",
      `GET repos/example/widgets/check-runs/${TOKEN}`,
    ],
  ])("accepts %s as a request", (_name, request) => {
    expect(found(reachableProbe({ request }))).toEqual([]);
  });

  it.each([
    [
      "an error that mentions signing in",
      "HTTP 401: Requires authentication. Basic authentication is not supported.",
    ],
    [
      "an error with a long request id",
      `HTTP 500 (request ${fakeCredential(32, 5)})`,
    ],
    [
      "an error that says authorization failed",
      "Authorization failed for this account",
    ],
  ])("accepts %s as an observed error", (_name, observed) => {
    expect(found(unreachableProbe({ observed_error: observed }))).toEqual([]);
  });
});
