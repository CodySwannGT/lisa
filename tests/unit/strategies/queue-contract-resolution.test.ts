/**
 * Regression coverage for queue-status contract resolution.
 *
 * Issue #822 adds the shared queue-contract resolver that queue-status can use
 * to stay aligned with the same repo/source/tracker defaults as intake and
 * repair-intake, without inventing a second source of truth.
 * @module tests/unit/strategies/queue-contract-resolution
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveBuildLifecycleRoles,
  resolveCurrentRepo,
  resolvePrdLifecycleRoles,
  resolveQueueContract,
} from "../../../plugins/src/base/scripts/queue-contract-resolution.mjs";

describe("queue contract resolution (#822)", () => {
  it("resolves self-hosted GitHub queue defaults from the shared contract", () => {
    const contract = resolveQueueContract({
      config: {
        tracker: "github",
        github: {
          org: "CodySwannGT",
          repo: "lisa",
        },
      },
    });

    expect(contract.currentRepo).toBe("lisa");
    expect(contract.source).toBe("github");
    expect(contract.tracker).toBe("github");
    expect(contract.prdQueue).toMatchObject({
      vendor: "github",
      kind: "labels",
      argument: "github intake_mode=prd",
      roles: {
        ready: "prd-ready",
        in_review: "prd-in-review",
        blocked: "prd-blocked",
        ticketed: "prd-ticketed",
        shipped: "prd-shipped",
        verified: "prd-verified",
      },
      rollup: {
        closeOnShipped: false,
      },
    });
    expect(contract.buildQueue).toMatchObject({
      vendor: "github",
      kind: "labels",
      argument: "github intake_mode=build",
      roles: {
        ready: "status:ready",
        claimed: "status:in-progress",
        blocked: "status:blocked",
        done: {
          dev: "status:on-dev",
          staging: "status:on-stg",
          production: "status:done",
        },
      },
    });
  });

  it("resolves mixed notion/jira queues with explicit overrides and repo override precedence", () => {
    const contract = resolveQueueContract({
      config: {
        repo: "frontend-v2",
        tracker: "jira",
        source: "notion",
        jira: {
          project: "FE",
          workflow: {
            ready: "Queued",
            claimed: "Working",
            review: "Review",
            blocked: "Needs Help",
            done: "Done",
          },
        },
        notion: {
          prdDatabaseId: "db-123",
          statusProperty: "Lifecycle",
          values: {
            ready: "Ready to Plan",
            in_review: "Planning",
          },
        },
        github: {
          org: "Acme",
          repo: "platform-monorepo",
        },
      },
      gitRemoteUrl: "git@github.com:Acme/platform-monorepo.git",
    });

    expect(contract.currentRepo).toBe("frontend-v2");
    expect(contract.source).toBe("notion");
    expect(contract.tracker).toBe("jira");
    expect(contract.prdQueue).toMatchObject({
      vendor: "notion",
      kind: "status",
      argument: "db-123",
      statusProperty: "Lifecycle",
      roles: {
        draft: "Draft",
        ready: "Ready to Plan",
        in_review: "Planning",
        blocked: "Blocked",
        ticketed: "Ticketed",
        shipped: "Shipped",
        verified: "Verified",
      },
    });
    expect(contract.buildQueue).toMatchObject({
      vendor: "jira",
      kind: "workflow",
      argument: "FE",
      roles: {
        ready: "Queued",
        claimed: "Working",
        review: "Review",
        blocked: "Needs Help",
        done: "Done",
      },
    });
  });

  it("falls back to the git remote basename when config does not carry repo identity", () => {
    expect(
      resolveCurrentRepo({
        config: { tracker: "jira", source: "confluence" },
        gitRemoteUrl: "git@github.com:Acme/customer-portal.git",
      })
    ).toBe("customer-portal");
  });

  it("fails loudly for unsupported PRD sources instead of inventing queue semantics", () => {
    expect(() =>
      resolvePrdLifecycleRoles({
        source: "jira",
      })
    ).toThrow(/not a supported Lisa PRD source/i);
  });

  it("keeps the distributed resolver artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/queue-contract-resolution.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/queue-contract-resolution.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });

  it("keeps vendor defaults explicit when only lifecycle-role readers are used directly", () => {
    expect(
      resolveBuildLifecycleRoles({
        tracker: "linear",
      })
    ).toMatchObject({
      vendor: "linear",
      roles: {
        ready: "status:ready",
        claimed: "status:in-progress",
        review: "status:code-review",
        blocked: "status:blocked",
        done: {
          dev: "status:on-dev",
          staging: "status:on-stg",
          production: "status:done",
        },
      },
    });
  });
});
