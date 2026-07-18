import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
        variables: { LISA_AWS_BOOTSTRAP_JSON: true },
        artifacts: { "scripts/remote-agent-aws-setup.sh": false },
      }
    );

    expect(injected).toContain("window.LISA_REMOTE_ENVIRONMENT");
    expect(injected).toContain('"LISA_AWS_BOOTSTRAP_JSON":true');
    expect(injected).not.toContain("secretAccessKey");
  });
});

describe("inspectRemoteEnvironment", () => {
  it("reports variable presence and project startup artifacts without values", async () => {
    await mkdir(path.join(resources.dir, ".cursor"));
    await writeJson(path.join(resources.dir, ".cursor", "environment.json"), {
      install: "bootstrap",
    });

    const status = inspectRemoteEnvironment(resources.dir, {
      LISA_AWS_BOOTSTRAP_JSON: "sensitive-value",
      LISA_REMOTE_AGENT: "",
    });

    expect(status.variables).toEqual({
      LISA_AWS_BOOTSTRAP_JSON: true,
      LISA_REMOTE_AGENT: false,
      LISA_AWS_DEFAULT_PROFILE: false,
    });
    expect(status.artifacts).toMatchObject({
      ".cursor/environment.json": true,
      "scripts/remote-agent-aws-setup.sh": false,
      ".github/workflows/copilot-setup-steps.yml": false,
    });
    expect(JSON.stringify(status)).not.toContain("sensitive-value");
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

  it("rejects an invalid port", async () => {
    await expect(
      runUi(resources.dir, { port: "not-a-port", sync: false })
    ).rejects.toThrow("Invalid --port value");
  });
});
