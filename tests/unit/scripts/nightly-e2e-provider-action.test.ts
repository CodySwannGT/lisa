/**
 * RED executable contract for the provider action shipped to host projects.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONDITION_MARKER,
  TRACKED_SUITE_LABELS,
  finding,
  loadProviderActionModule,
  type ProviderTransport,
  type ProviderTransportRequest,
} from "../../helpers/nightly-e2e-tracking-harness.js";
import {
  ACTIONS,
  PROVIDERS,
  hostileProviderPayload,
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

const LIFECYCLE = PROVIDERS.flatMap(destination =>
  ACTIONS.map(action => ({ destination, action }))
);

/** Build two matching GitHub trackers around the exact written identity. */
function duplicateGithubAuthority(): unknown {
  return [
    { number: 42, node_id: "tracker-1", body: CONDITION_MARKER },
    { number: 43, node_id: "duplicate", body: CONDITION_MARKER },
  ];
}

describe("shipped provider action", () => {
  it.each(LIFECYCLE)(
    "$destination $action uses the common state machine and exact readback",
    async ({ destination, action }) => {
      const module = await loadProviderActionModule(REPO_ROOT);
      const fixture = providerTransportFixture(destination, action);
      const result = await module.runProviderAction({
        config: providerConfig(destination),
        findings: action === "close" ? GREEN : RED,
        env: providerEnv(),
        request: fixture.request,
      });

      expect(result).toMatchObject({ destination, action });
      const operations = fixture.calls.map(call => call.operation);
      expect(operations[0]).toBe("list");
      expect(operations).toContain(action);
      expect(operations.at(-1)).toBe("readback");
      expect(fixture.calls.at(-1)?.url).not.toBe("");
    }
  );

  it.each(ACTIONS)(
    "Linear %s rejects success false before readback",
    async action => {
      const module = await loadProviderActionModule(REPO_ROOT);
      const fixture = providerTransportFixture("linear", action);
      const request: ProviderTransport = async current => {
        if (current.operation === action) {
          const key = action === "create" ? "issueCreate" : "issueUpdate";
          return { data: { [key]: { success: false } } };
        }
        return fixture.request(current);
      };

      await expect(
        module.runProviderAction({
          config: providerConfig("linear"),
          findings: action === "close" ? GREEN : RED,
          env: providerEnv(),
          request,
        })
      ).rejects.toThrow(/linear.*(create|refresh|close).*refused|success/i);
      expect(fixture.calls.map(call => call.operation)).not.toContain(
        "readback"
      );
    }
  );

  it.each(LIFECYCLE)(
    "$destination $action transport failure is bounded and terminal",
    async ({ destination, action }) => {
      const module = await loadProviderActionModule(REPO_ROOT);
      const fixture = providerTransportFixture(destination, action);
      const calls: ProviderTransportRequest[] = [];
      const request: ProviderTransport = async current => {
        calls.push(current);
        if (current.operation === action) {
          throw new Error(
            `HTTP 503 ${providerEnv().PROVIDER_TOKEN}${"x".repeat(9000)}`
          );
        }
        return fixture.request(current);
      };
      let message = "";

      try {
        await module.runProviderAction({
          config: providerConfig(destination),
          findings: action === "close" ? GREEN : RED,
          env: providerEnv(),
          request,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(calls.map(call => call.operation)).toContain(action);
      expect(calls.at(-1)?.operation).toBe(action);
      expect(message).toContain(destination);
      expect(message).toContain(action);
      expect(message).toContain("HTTP 503");
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).not.toContain("TRACKING_PROVIDER_SECRET_SENTINEL");
      expect(calls.map(call => call.operation)).not.toContain("readback");
    }
  );

  it.each(PROVIDERS)(
    "%s refuses a hostile post-write authority snapshot",
    async destination => {
      const module = await loadProviderActionModule(REPO_ROOT);
      const fixture = providerTransportFixture(destination, "create");
      const calls: ProviderTransportRequest[] = [];
      const request: ProviderTransport = async current => {
        calls.push(current);
        if (current.operation === "readback") {
          return hostileProviderPayload(destination);
        }
        return fixture.request(current);
      };

      await expect(
        module.runProviderAction({
          config: providerConfig(destination),
          findings: RED,
          env: providerEnv(),
          request,
        })
      ).rejects.toThrow(/readback|authority|identity|malformed/i);
      expect(calls.map(call => call.operation)).toEqual(
        destination === "sentry"
          ? ["list", "create", "create", "readback"]
          : ["list", "create", "readback"]
      );
      expect(calls.map(call => call.operation)).not.toContain("pin");
    }
  );

  it.each([
    {
      boundary: "create",
      action: "create",
      duplicateAt: 1,
      operations: ["list", "create", "readback"],
    },
    {
      boundary: "refresh",
      action: "refresh",
      duplicateAt: 1,
      operations: ["list", "refresh", "readback"],
    },
    {
      boundary: "pin",
      action: "create",
      duplicateAt: 2,
      operations: ["list", "create", "readback", "pin", "readback"],
    },
    {
      boundary: "close",
      action: "close",
      duplicateAt: 1,
      operations: ["list", "unpin", "close", "readback"],
    },
  ] as const)(
    "GitHub $boundary terminates on an exact plus duplicate readback",
    async ({ boundary, action, duplicateAt, operations }) => {
      const module = await loadProviderActionModule(REPO_ROOT);
      const fixture = providerTransportFixture("github", action);
      const calls: ProviderTransportRequest[] = [];
      let readbacks = 0;
      const request: ProviderTransport = async current => {
        calls.push(current);
        if (current.operation === "readback") {
          readbacks += 1;
          if (readbacks === duplicateAt) return duplicateGithubAuthority();
        }
        return fixture.request(current);
      };

      await expect(
        module.runProviderAction({
          config: providerConfig("github"),
          findings: action === "close" ? GREEN : RED,
          env: providerEnv(),
          request,
        })
      ).rejects.toThrow(
        new RegExp(
          `github destination ${boundary} failed: readback.*authority`,
          "i"
        )
      );
      expect(calls.map(call => call.operation)).toEqual(operations);
    }
  );
});
