/**
 * Contract tests for repo-agnostic workstation bootstrap.
 *
 * The setup-local-env command cannot run until a project exists because it
 * reads `.lisa.config.json`. Workstation bootstrap is the lower layer: it can
 * detect the agent fleet and universal tools before clone, and it keeps vendor
 * installers visibly separate from pinned archive installs.
 * @module tests/unit/secrets/workstation-bootstrap
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseArgs,
  plan,
  run,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation-bootstrap.mjs";

/** Result shape returned by the fake command probe. */
type ProbeResult = { present: boolean; version: string | null };

const absent = (): ProbeResult => ({ present: false, version: null });

/** Shared fake remote-env helper surface used by command tests. */
const fakeEnv = {
  currentPlatform: () => "darwin-arm64",
  ensureBinDir: () => `${process.cwd()}/.lisa-test-bin`,
  installTool: vi.fn(),
  probe: absent,
  planToolchain: (
    tools: { install: Array<{ name: string; version: string }> },
    probe: (name: string) => ProbeResult
  ) =>
    tools.install.map(tool => {
      const found = probe(tool.name);
      return found.present
        ? {
            name: tool.name,
            action: "newer",
            reason: `${tool.name} ${found.version} is already on PATH`,
            tool,
          }
        : {
            name: tool.name,
            action: "install",
            reason: `${tool.name} ${tool.version} not installed`,
            tool,
          };
    }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("argument parsing", () => {
  it("narrows the agent fleet without affecting universal tooling", () => {
    expect(parseArgs(["--agents=claude,codex", "--yes"])).toMatchObject({
      yes: true,
      agents: ["claude", "codex"],
    });
  });
});

describe("planning", () => {
  it("runs without a repository manifest", async () => {
    const result = await plan({}, { env: fakeEnv });

    expect(result.agents.map((row: { name: string }) => row.name)).toContain(
      "claude"
    );
    expect(result.universal.map((row: { name: string }) => row.name)).toEqual(
      expect.arrayContaining(["gh", "bws", "aws", "sonar"])
    );
  });

  it("keeps vendor installers distinct from pinned archive installs", async () => {
    const result = await plan({ agents: ["claude"] }, { env: fakeEnv });

    expect(result.agents[0]).toMatchObject({
      kind: "vendor",
      action: "install",
    });
    const gh = result.universal.find(
      (row: { name: string }) => row.name === "gh"
    );
    expect(gh).toMatchObject({ name: "gh", action: "install" });
    expect(gh).not.toHaveProperty("kind", "vendor");
  });

  it("leaves an already-current pinned tool alone during planning", async () => {
    const result = await plan(
      { agents: ["claude"] },
      {
        env: fakeEnv,
        probe: (name: string) =>
          name === "gh"
            ? { present: true, version: "2.90.0" }
            : name === "claude"
              ? { present: true, version: "2.1.221" }
              : absent(),
      }
    );

    const gh = result.universal.find(
      (row: { name: string }) => row.name === "gh"
    );
    expect(gh).toMatchObject({ name: "gh", action: "newer" });
    expect(gh?.action).not.toBe("install");
  });

  it("leaves existing tools alone regardless of install source", async () => {
    const result = await plan(
      { agents: ["claude"] },
      {
        env: fakeEnv,
        probe: (name: string) =>
          name === "claude" ? { present: true, version: "2.1.221" } : absent(),
      }
    );

    expect(result.agents[0]).toMatchObject({
      action: "present",
      reason: "claude 2.1.221",
    });
  });
});

describe("execution", () => {
  it("does not install without --yes", async () => {
    const exec = vi.fn();
    const installTool = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const code = await run({}, { env: { ...fakeEnv, installTool }, exec });

    expect(code).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(installTool).not.toHaveBeenCalled();
    expect(log.mock.calls.map(call => String(call[0])).join("\n")).toContain(
      "Nothing was installed"
    );
  });

  it("executes vendor and pinned installers only with --yes", async () => {
    const exec = vi.fn();
    const installTool = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(
      { yes: true, agents: ["claude"] },
      { env: { ...fakeEnv, installTool }, exec }
    );

    expect(exec).toHaveBeenCalledWith(
      "bash",
      ["-lc", "curl -fsSL https://claude.ai/install.sh | bash"],
      { stdio: "inherit" }
    );
    expect(installTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "gh" }),
      expect.any(String)
    );
  });

  it("does not touch the filesystem in --yes --dry-run", async () => {
    const exec = vi.fn();
    const installTool = vi.fn();
    const ensureBinDir = vi.fn(() => `${process.cwd()}/.lisa-test-bin`);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const code = await run(
      { yes: true, dryRun: true, agents: ["claude"] },
      { env: { ...fakeEnv, installTool, ensureBinDir }, exec }
    );

    expect(code).toBe(0);
    expect(ensureBinDir).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(installTool).not.toHaveBeenCalled();
  });

  it("prints json without installing", async () => {
    const exec = vi.fn();
    const installTool = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run({ json: true }, { env: { ...fakeEnv, installTool }, exec });

    expect(log).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(exec).not.toHaveBeenCalled();
    expect(installTool).not.toHaveBeenCalled();
    expect(printed).toMatchObject({
      platform: "darwin-arm64",
    });
    expect(Array.isArray(printed.agents)).toBe(true);
    expect(printed.agents.length).toBeGreaterThan(0);
    expect(Array.isArray(printed.universal)).toBe(true);
    expect(printed.universal.length).toBeGreaterThan(0);
  });
});
