/** Executable RED contract for shipped GitHub pin lifecycle mutations. */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  TRACKED_SUITE_LABELS,
  finding,
  loadProviderActionModule,
  type ProviderTransport,
  type ProviderTransportRequest,
} from "../../helpers/nightly-e2e-tracking-harness.js";
import {
  providerConfig,
  providerEnv,
  providerTransportFixture,
} from "../../helpers/nightly-e2e-provider-action-fixture.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const [PLAYWRIGHT, MAESTRO] = TRACKED_SUITE_LABELS;
const RED = [finding(PLAYWRIGHT, "fail"), finding(MAESTRO, "pass")];
const GREEN = [finding(PLAYWRIGHT, "pass"), finding(MAESTRO, "pass")];
const TRACKER_ID = "tracker-1";
const TOKEN = "TRACKING_PROVIDER_SECRET_SENTINEL";

const PIN_PROTOCOLS = [
  {
    operation: "pin",
    action: "create",
    findings: RED,
    mutation: "pinIssue",
    operations: ["list", "create", "readback", "pin", "readback"],
  },
  {
    operation: "unpin",
    action: "close",
    findings: GREEN,
    mutation: "unpinIssue",
    operations: ["list", "unpin", "close", "readback"],
  },
] as const;

/** One exact shipped GitHub pin or unpin protocol. */
type PinProtocol = (typeof PIN_PROTOCOLS)[number];

/** One GraphQL success-envelope authority failure. */
type FailureShape = "errors" | "missing identity" | "wrong identity";

const PIN_FAILURES = PIN_PROTOCOLS.flatMap(protocol =>
  (["errors", "missing identity", "wrong identity"] as const).map(shape => ({
    ...protocol,
    shape,
  }))
);

/** Build the exact GitHub GraphQL mutation for one pin lifecycle boundary. */
function expectedQuery(protocol: PinProtocol): string {
  return (
    `mutation($id:ID!){${protocol.mutation}` +
    `(input:{issueId:$id}){issue{id}}}`
  );
}

/** Build a provider response with explicit returned-identity authority. */
function graphqlResponse(protocol: PinProtocol, shape?: FailureShape): unknown {
  if (shape === "errors") {
    return { errors: [{ message: `denied ${TOKEN}` }] };
  }
  const id = shape === "wrong identity" ? "foreign" : TRACKER_ID;
  const issue = shape === "missing identity" ? null : { id };
  return { data: { [protocol.mutation]: { issue } } };
}

/** Run the real provider action with one controlled GraphQL response. */
async function runGithub(
  protocol: PinProtocol,
  response: unknown
): Promise<{
  readonly calls: ProviderTransportRequest[];
  readonly result: unknown;
}> {
  const fixture = providerTransportFixture("github", protocol.action);
  const calls: ProviderTransportRequest[] = [];
  const request: ProviderTransport = async current => {
    calls.push(current);
    if (current.operation === protocol.operation) return response;
    return fixture.request(current);
  };
  const module = await loadProviderActionModule(REPO_ROOT);
  const result = await module.runProviderAction({
    config: providerConfig("github"),
    findings: protocol.findings,
    env: providerEnv(),
    request,
  });
  return { calls, result };
}

/** Read and validate the JSON GraphQL request body. */
function graphqlBody(call: ProviderTransportRequest): unknown {
  const body = call.options?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(String(body));
}

describe("shipped GitHub pin lifecycle protocol", () => {
  it.each(PIN_PROTOCOLS)(
    "$operation sends exact authenticated GraphQL and completes in order",
    async protocol => {
      const { calls, result } = await runGithub(
        protocol,
        graphqlResponse(protocol)
      );
      const graphql = calls.find(call => call.operation === protocol.operation);

      expect(graphql?.url).toBe("https://api.github.com/graphql");
      expect(graphql?.options?.method).toBe("POST");
      expect(graphql?.options?.headers).toHaveProperty(
        "Authorization",
        `Bearer ${TOKEN}`
      );
      expect(graphqlBody(graphql as ProviderTransportRequest)).toEqual({
        query: expectedQuery(protocol),
        variables: { id: TRACKER_ID },
      });
      expect(String(graphql?.options?.body)).not.toContain(TOKEN);
      expect(calls.map(call => call.operation)).toEqual(protocol.operations);
      expect(result).toMatchObject({
        destination: "github",
        action: protocol.action,
      });
    }
  );

  it.each(PIN_FAILURES)(
    "$operation refuses $shape and performs no later lifecycle action",
    async protocol => {
      let error: unknown;
      const calls: ProviderTransportRequest[] = [];
      const fixture = providerTransportFixture("github", protocol.action);
      const request: ProviderTransport = async current => {
        calls.push(current);
        if (current.operation === protocol.operation) {
          return graphqlResponse(protocol, protocol.shape);
        }
        return fixture.request(current);
      };
      const module = await loadProviderActionModule(REPO_ROOT);

      try {
        await module.runProviderAction({
          config: providerConfig("github"),
          findings: protocol.findings,
          env: providerEnv(),
          request,
        });
      } catch (caught) {
        error = caught;
      }

      const prefix =
        protocol.operation === "pin"
          ? ["list", "create", "readback", "pin"]
          : ["list", "unpin"];
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe(
        `Requested github destination ${protocol.operation} failed: refused`
      );
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).not.toContain(TOKEN);
      expect(calls.map(call => call.operation)).toEqual(prefix);
    }
  );
});
