/**
 * RED provider/parity contract for combined nightly-E2E tracking.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  CONDITION_MARKER,
  TRACKED_SUITE_LABELS,
  TRACKING_DESTINATIONS,
  finding,
  loadTrackingModule,
} from "../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const TRACKER_REL =
  "typescript/copy-overwrite/scripts/reconcile-nightly-e2e-tracking.mjs";
const TRACKER_ASSETS = Object.freeze([
  TRACKER_REL,
  "typescript/copy-overwrite/scripts/nightly-e2e-tracking-config.mjs",
  "typescript/copy-overwrite/scripts/reconcile-nightly-e2e-tracking-cli.mjs",
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-action.mjs",
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-github-jira.mjs",
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-linear-sentry.mjs",
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-support.mjs",
  "typescript/copy-overwrite/scripts/nightly-e2e-github-tracking.mjs",
]);
const REUSABLE_REL = ".github/workflows/nightly-e2e-tracking.yml";

/** Repository-owned provider protocols that the reconciler must reuse. */
const PROVIDER_PROTOCOLS = Object.freeze({
  github: {
    path: ".github/workflows/create-github-issue-on-failure.yml",
    secret: "PAT",
  },
  sentry: {
    path: ".github/workflows/create-sentry-issue-on-failure.yml",
    secret: "SENTRY_AUTH_TOKEN",
  },
  jira: {
    path: ".github/workflows/create-jira-issue-on-failure.yml",
    secret: "JIRA_API_TOKEN",
  },
  linear: {
    path: ".github/workflows/create-linear-issue-on-failure.yml",
    secret: "LINEAR_API_KEY",
  },
});

/** Provider configuration fixture reused by the executable dispatch test. */
const CONFIG = Object.freeze({
  nightlyE2E: { tracking: { destination: "none" } },
  github: { org: "acme", repo: "widgets" },
  sentry: { org: "acme", project: "widgets" },
  jira: { project: "WID" },
  atlassian: {
    site: "acme.atlassian.net",
    cloudId: "cloud-1",
    email: "ci@acme.test",
  },
  linear: { workspace: "acme", teamKey: "WID" },
});

/**
 * Reads one repository-relative file.
 *
 * @param relative - Repository-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Reads a provider workflow's reusable-call declaration.
 *
 * @param relative - Provider workflow path
 * @returns Inputs and secrets declared by `workflow_call`
 */
function workflowCall(relative: string): {
  readonly inputs: Record<string, unknown>;
  readonly secrets: Record<string, unknown>;
} {
  const parsed = yaml.load(read(relative)) as Record<string, unknown>;
  const on = (parsed.on ?? parsed["true"]) as Record<string, unknown>;
  const call = on.workflow_call as Record<string, unknown>;
  return {
    inputs: call.inputs as Record<string, unknown>,
    secrets: call.secrets as Record<string, unknown>,
  };
}

describe("provider inventory and protocol reuse", () => {
  it("declares all and only the five public destinations", () => {
    const source = read(
      "typescript/copy-overwrite/scripts/nightly-e2e-tracking-config.mjs"
    );
    for (const destination of TRACKING_DESTINATIONS) {
      expect(source).toContain(destination);
    }
    expect(source).not.toMatch(/fallback.*github/i);
  });

  it.each(Object.entries(PROVIDER_PROTOCOLS))(
    "%s extends the parsed repository-owned protocol",
    (destination, protocol) => {
      const source = `${read(REUSABLE_REL)}\n${read(TRACKER_REL)}`;
      const adapter = read(protocol.path);
      const call = workflowCall(protocol.path);
      expect(call.inputs).toHaveProperty("workflow_name");
      for (const input of [
        "tracking_action",
        "tracking_marker",
        "tracking_title",
        "tracking_body",
        "tracking_id",
      ]) {
        expect(call.inputs).toHaveProperty(input);
      }
      expect(call.secrets).toHaveProperty(protocol.secret);
      for (const action of ["create", "refresh", "close"]) {
        expect(adapter).toContain(action);
      }
      expect(source).toContain(path.basename(protocol.path));
      expect(source).toContain(destination);
    }
  );

  it.each(["github", "sentry", "jira", "linear"] as const)(
    "%s builds the executable provider handoff consumed by its job",
    async destination => {
      const module = await loadTrackingModule(REPO_ROOT);
      const config = {
        ...CONFIG,
        nightlyE2E: { tracking: { destination } },
      };
      const settings = module.resolveNightlyTrackingConfig(config);
      const [playwright, maestro] = TRACKED_SUITE_LABELS;
      const plan = module.planCombinedTracking(
        [finding(playwright, "fail"), finding(maestro, "pass")],
        []
      );
      const dispatch = module.buildProviderDispatch(settings, plan);

      expect(dispatch).toMatchObject({
        destination,
        workflow: PROVIDER_PROTOCOLS[destination].path,
        inputs: {
          workflow_name: "Nightly E2E condition",
          tracking_action: "create",
          tracking_marker: CONDITION_MARKER,
          tracking_title: plan.title,
          tracking_body: plan.body,
          tracking_id: "",
        },
        secrets: [PROVIDER_PROTOCOLS[destination].secret],
      });
    }
  );

  it("does not inline a second provider API or credential cascade", () => {
    const source = read(TRACKER_REL);
    const compact = source.replaceAll(/\s/gu, "");
    expect(source).not.toMatch(
      /api\.linear\.app|sentry\.io\/api|atlassian\.net\/rest|api\.github\.com/
    );
    expect(source).toMatch(/adapters\[[^\]]*destination[^\]]*\]/);
    expect(compact).not.toContain("??adapters.github");
    expect(compact).not.toContain("||adapters.github");
  });

  it("materializes pin and unpin in the shipped GitHub adapter", () => {
    const source = read(
      "typescript/copy-overwrite/scripts/nightly-e2e-provider-github-jira.mjs"
    );
    expect(source).toContain("pinIssue(input:");
    expect(source).toContain("unpinIssue(input:");
  });

  it("requires bounded errors without configuration or secret echo", () => {
    const source = read(TRACKER_REL);
    expect(source).toMatch(/4096|MAX_.*DIAGNOSTIC|diagnostic.*bound/i);
    expect(source).toMatch(/redact|secret/i);
    expect(source).toMatch(/requested.*destination|destination.*requested/i);
  });

  it("ships the script through the refreshing TypeScript asset lane", () => {
    const manifest = read("src/core/upstream-evidence-manifest.ts");
    for (const relative of TRACKER_ASSETS) {
      expect(manifest).toContain(relative);
      const mode = fs.statSync(path.join(REPO_ROOT, relative)).mode & 0o777;
      expect(mode).toBe(0o644);
    }
  });

  it("has no coding-agent-specific implementation surface", () => {
    for (const root of [
      "plugins/src/base",
      "plugins/lisa",
      "plugins/lisa-codex",
      "plugins/lisa-cursor",
      "plugins/lisa-opencode",
      "plugins/lisa-agy",
      "plugins/lisa-copilot",
    ]) {
      const candidate = path.join(REPO_ROOT, root, path.basename(TRACKER_REL));
      expect(fs.existsSync(candidate)).toBe(false);
    }
  });
});
