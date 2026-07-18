import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLisaVersionProbe,
  findUiHtml,
  injectLiveConfig,
  inspectRemoteEnvironment,
  runUi,
} from "../../../src/cli/ui-cmd.js";
import { writeJson } from "../../../src/utils/index.js";

/** Holder for per-test temp resources. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-cmd-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (resources.server !== undefined) {
    await new Promise(resolve => resources.server?.close(resolve));
    resources.server = undefined;
  }
  await rm(resources.dir, { recursive: true, force: true });
});

describe("injectLiveConfig", () => {
  it("injects the config before the closing body tag", () => {
    const html = "<body><script>run();</script>\n</body>";

    const injected = injectLiveConfig(html, { tracker: "jira" });

    expect(injected).toContain('window.LISA_LIVE_CONFIG = {"tracker":"jira"}');
    expect(injected.indexOf("LISA_LIVE_CONFIG")).toBeGreaterThan(
      injected.indexOf("run();")
    );
  });

  it("escapes closing script sequences inside config values", () => {
    const injected = injectLiveConfig("</body>", {
      note: "</script><script>alert(1)</script>",
    });

    expect(injected).not.toContain("</script><script>alert(1)");
    expect(injected).toContain("<\\/script>");
  });

  it("injects boolean-only remote environment status", () => {
    const injected = injectLiveConfig(
      "</body>",
      { harness: "codex" },
      {
        projectTypes: ["cdk"],
        variables: [
          {
            name: "LISA_AWS_BOOTSTRAP_JSON",
            reason: "AWS access",
            source: "Project type: CDK",
            secret: true,
            set: true,
          },
        ],
        startupScripts: [],
      }
    );

    expect(injected).toContain("window.LISA_REMOTE_ENVIRONMENT");
    expect(injected).toContain('"name":"LISA_AWS_BOOTSTRAP_JSON"');
    expect(injected).toContain('"set":true');
    expect(injected).not.toContain("secretAccessKey");
  });
});

describe("inspectRemoteEnvironment", () => {
  it("detects only integrations required by the current project", async () => {
    await writeJson(path.join(resources.dir, "package.json"), {
      dependencies: { expo: "latest", "@jam.dev/sdk": "latest" },
    });
    await writeFile(
      path.join(resources.dir, ".env.example"),
      "AWS_PROFILE=gemini-dev-v2\n"
    );
    await mkdir(path.join(resources.dir, "scripts"));
    await writeFile(
      path.join(resources.dir, "scripts", "claude-remote-setup.sh"),
      '[ -n "${JAM_PAT:-}" ] && jam auth login --token\n'
    );

    const status = await inspectRemoteEnvironment(
      resources.dir,
      { tracker: "jira", source: "notion" },
      { JAM_PAT: "sensitive-value" }
    );

    expect(status.projectTypes).toEqual(["typescript", "expo"]);
    expect(status.variables.map(variable => variable.name)).toEqual([
      "JIRA_API_TOKEN",
      "JIRA_SERVER",
      "JIRA_LOGIN",
      "JIRA_PROJECT",
      "NOTION_API_TOKEN",
      "JAM_PAT",
      "LISA_AWS_BOOTSTRAP_JSON",
    ]);
    expect(
      status.variables.find(variable => variable.name === "JAM_PAT")
    ).toMatchObject({ set: true, source: "Integration: @jam.dev" });
    expect(status.startupScripts).toContainEqual({
      agent: "claude",
      artifact: "scripts/claude-remote-setup.sh",
      installed: true,
    });
    expect(status.startupScripts).toContainEqual({
      agent: "codex",
      installed: false,
    });
    expect(JSON.stringify(status)).not.toContain("sensitive-value");
  });

  it("does not require AWS merely because Lisa ships the reusable AWS setup", async () => {
    await writeJson(path.join(resources.dir, "package.json"), {
      name: "@codyswann/lisa",
      devDependencies: { typescript: "latest" },
    });
    await mkdir(path.join(resources.dir, "scripts"));
    await writeFile(
      path.join(resources.dir, "scripts", "remote-agent-aws-setup.sh"),
      "#!/usr/bin/env bash\n"
    );
    await writeFile(
      path.join(resources.dir, "scripts", "claude-remote-setup.sh"),
      "# AWS when this routine needs it: LISA_AWS_BOOTSTRAP_JSON\n"
    );

    const status = await inspectRemoteEnvironment(
      resources.dir,
      { tracker: "github", source: "github" },
      { GH_TOKEN: "configured" }
    );

    expect(status.variables).toEqual([
      {
        name: "GH_TOKEN",
        reason: "GitHub CLI access for the active tracker or PRD source",
        source: "Lisa config: GitHub",
        secret: true,
        set: true,
      },
    ]);
  });

  it("uses the project manifest for project-owned requirements and startup scripts", async () => {
    await mkdir(path.join(resources.dir, ".lisa"));
    await mkdir(path.join(resources.dir, "scripts"));
    await writeFile(
      path.join(resources.dir, "scripts", "codex-remote-setup.sh"),
      "#!/usr/bin/env bash\n"
    );
    await writeJson(
      path.join(resources.dir, ".lisa", "remote-environment.json"),
      {
        variables: [
          {
            name: "PROJECT_API_TOKEN",
            reason: "Project-specific service",
            secret: true,
            required: true,
          },
          { name: "DORMANT_TOKEN", required: false },
        ],
        startupScripts: {
          codex: "scripts/codex-remote-setup.sh",
          agy: "../../outside-project.sh",
        },
      }
    );

    const status = await inspectRemoteEnvironment(resources.dir, {}, {});

    expect(status.variables.map(variable => variable.name)).toEqual([
      "PROJECT_API_TOKEN",
    ]);
    expect(status.startupScripts).toContainEqual({
      agent: "codex",
      artifact: "scripts/codex-remote-setup.sh",
      installed: true,
    });
    expect(status.startupScripts).toContainEqual({
      agent: "agy",
      installed: false,
    });
    expect(JSON.stringify(status.startupScripts)).not.toContain(
      "outside-project.sh"
    );
  });
});

describe("findUiHtml", () => {
  it("locates the packaged ui/index.html from the source tree", () => {
    const htmlPath = findUiHtml(
      path.dirname(new URL(import.meta.url).pathname)
    );

    expect(htmlPath.endsWith(path.join("ui", "index.html"))).toBe(true);
  });

  it("throws when no ui/index.html exists above the start directory", () => {
    expect(() => findUiHtml(resources.dir)).toThrow(
      "Unable to locate the packaged ui/index.html"
    );
  });
});

describe("runUi", () => {
  it("serves the console with the project's live config injected", async () => {
    await writeJson(path.join(resources.dir, ".lisa.config.json"), {
      tracker: "linear",
      linear: { workspace: "acme", teamKey: "ENG" },
    });

    resources.server = await runUi(resources.dir, { port: "0", sync: false });

    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"tracker":"linear"');
    expect(body).toContain("Lisa Console");
    expect(body).toContain("window.LISA_REMOTE_ENVIRONMENT");
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  it("registers the lisa-version probe in the default status snapshot", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          createLisaVersionProbe({
            runUpdateCheck: vi.fn(async () => ({
              current: "2.200.0",
              latest: "2.200.0",
              isOutdated: false,
            })),
          }),
        ],
      }
    );

    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const snapshot = (await response.json()) as {
      probes: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(snapshot.probes["lisa-version"]).toEqual({
      state: "value",
      value: { current: "2.200.0", latest: "2.200.0", outdated: false },
    });
  });

  it("includes lisa-version and deploy-pipeline-stages among default probes", async () => {
    resources.server = await runUi(resources.dir, { port: "0", sync: false });

    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const snapshot = (await response.json()) as {
      probes: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(snapshot.probes).toHaveProperty("github-auth");
    expect(snapshot.probes).toHaveProperty("lisa-version");
    expect(snapshot.probes).toHaveProperty("deploy-pipeline-stages");
  });

  it("rejects an invalid port", async () => {
    await expect(
      runUi(resources.dir, { port: "not-a-port", sync: false })
    ).rejects.toThrow("Invalid --port value");
  });
});
