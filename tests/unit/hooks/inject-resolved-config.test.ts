import { describe, expect, it } from "vitest";

import {
  hookRunner,
  DEVELOPER_IDENTITY,
  LOCAL_CONFIG,
  MAIN_CONFIG,
  partialPluginRoot,
  project,
  write,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";
import { DEFAULT_RUNNER } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { DEFAULT_PROJECT_LEARNINGS_FILE } from "../../../src/core/learnings-location.js";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor, runHook } = hookRunner(process.env);

describe("inject-resolved-config: what the agent is told", () => {
  it("emits the Claude context envelope naming the session-start event", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    const { output } = runHook(root, { hook_event_name: "SubagentStart" });

    expect(output.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
    expect(output.hookSpecificOutput?.additionalContext).toContain(
      "<lisa-resolved-config>"
    );
  });

  it("shows the local override's value, not the committed file's, for an overlapping key", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "jira",
      gates: { runner: "npm run" },
    });
    writeJson(root, LOCAL_CONFIG, {
      tracker: "linear",
      gates: { runner: "bun run" },
    });

    const context = contextFor(root);

    expect(context).toContain("tracker: linear");
    expect(context).not.toContain("tracker: jira");
    expect(context).toContain("gates.runner: bun run");
    expect(context).not.toContain("gates.runner: npm run");
  });

  it("keeps committed siblings a local override does not mention", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      github: { org: "committed-org", repo: "committed-repo" },
    });
    writeJson(root, LOCAL_CONFIG, { github: { repo: "override-repo" } });

    const context = contextFor(root);

    expect(context).toContain("org=committed-org");
    expect(context).toContain("repo=override-repo");
    expect(context).not.toContain("committed-repo");
  });

  it("marks a value the project never declared as a Lisa built-in default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    const context = contextFor(root);

    expect(context).toContain(
      `gates.runner: ${DEFAULT_RUNNER}   [Lisa built-in default`
    );
    expect(context).toContain(
      `learnings.file: ${DEFAULT_PROJECT_LEARNINGS_FILE}   [Lisa built-in default`
    );
  });

  it("leaves a value the project DID declare unmarked", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      gates: { runner: "bun run" },
    });

    const context = contextFor(root);

    expect(context).toContain("gates.runner: bun run");
    expect(context).not.toContain("gates.runner: bun run   [Lisa built-in");
  });

  it("names a required key that has no value and no default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { harness: "claude" });

    const context = contextFor(root);

    expect(context).toContain("tracker: NOT DECLARED");
    expect(context).toContain("deploy.branches: NOT DECLARED");
  });

  it("says so explicitly when the project has no Lisa configuration at all", () => {
    const context = contextFor(project());

    expect(context).toContain("<lisa-resolved-config>");
    expect(context).toContain("No Lisa configuration found");
    expect(context).toContain(MAIN_CONFIG);
    expect(context).toContain(LOCAL_CONFIG);
  });

  it("exits successfully when the project has no Lisa configuration at all", () => {
    expect(runHook(project()).status).toBe(0);
  });
});

describe("inject-resolved-config: identity never reaches the context", () => {
  it("omits a developer identity carried by the local override file", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "jira",
      atlassian: { site: "fixture.atlassian.net" },
    });
    writeJson(root, LOCAL_CONFIG, {
      atlassian: { email: DEVELOPER_IDENTITY },
    });

    const context = contextFor(root);

    // The block must have rendered — otherwise this passes for the wrong
    // reason, on a hook that emitted nothing at all.
    expect(context).toContain("tracker: jira");
    expect(context).toContain("atlassian: site=fixture.atlassian.net");
    expect(context).not.toContain(DEVELOPER_IDENTITY);
    expect(context).not.toContain("email");
  });

  it("records that an identity-shaped key was withheld rather than dropping it silently", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "jira",
      atlassian: { site: "fixture.atlassian.net", email: DEVELOPER_IDENTITY },
    });

    expect(contextFor(root)).toContain("+1 withheld (identity-shaped)");
  });

  it("redacts an identity-shaped VALUE arriving under an innocuous key", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      intake: { contact: DEVELOPER_IDENTITY },
    });

    const context = contextFor(root);

    expect(context).toContain("tracker: github");
    expect(context).not.toContain(DEVELOPER_IDENTITY);
    expect(context).toContain("[redacted]");
  });
});

describe("inject-resolved-config: fail soft", () => {
  it("reports an unreadable config instead of breaking session start", () => {
    const root = project();
    write(root, MAIN_CONFIG, "{ this is not json");

    const { output, status } = runHook(root);
    const context = output.hookSpecificOutput?.additionalContext ?? "";

    expect(status).toBe(0);
    expect(context).toContain("could not be read");
    expect(context).toContain(MAIN_CONFIG);
    // A broken config is NOT an unconfigured project; saying so would hide the
    // very gap this hook exists to surface.
    expect(context).not.toContain("No Lisa configuration found");
  });

  it("reports an unreadable LOCAL override rather than silently serving the committed file", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });
    write(root, LOCAL_CONFIG, "]]not json[[");

    const context = contextFor(root);

    expect(context).toContain("could not be read");
    expect(context).toContain(LOCAL_CONFIG);
  });

  it("emits nothing, successfully, when the renderer is missing from the payload", () => {
    const run = runHook(project(), undefined, partialPluginRoot());

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });
});
