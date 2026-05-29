/**
 * Unit tests for `collectLisaMcpServers` — the helper that gathers Lisa's MCP
 * servers from the built plugin `.mcp.json` files (base + detected stacks) so
 * `processAgyEmit` can install them into agy's aggregate mcp_config.json. End-
 * to-end check: collected entries → installAgyMcpConfig → agy `serverUrl` shape.
 * @module tests/unit/agy/mcp-collect
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectLisaMcpServers,
  installAgyMcpConfig,
  LISA_MANAGED_MARKER,
} from "../../../src/agy/mcp-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MCP = "mcpServers";
const EXPO_URL = "https://mcp.expo.dev/mcp";

describe("agy/collectLisaMcpServers", () => {
  let tempDir: string;
  let pluginRoot: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pluginRoot = path.join(tempDir, "plugins");
    await fs.ensureDir(pluginRoot);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // Write a plugin's .mcp.json under <pluginRoot>/<pluginName>/.mcp.json.
  const writeMcp = async (pluginName: string, servers: unknown) => {
    await fs.ensureDir(path.join(pluginRoot, pluginName));
    await fs.writeJson(path.join(pluginRoot, pluginName, ".mcp.json"), {
      mcpServers: servers,
    });
  };

  it("returns {} when no plugin ships a .mcp.json", async () => {
    expect(collectLisaMcpServers(pluginRoot, ["typescript"])).toEqual({});
  });

  it("collects base + detected-stack servers (raw Claude shape), merged", async () => {
    await writeMcp("lisa", { core: { command: "core-bin" } });
    await writeMcp("lisa-expo", {
      expo: { type: "http", url: EXPO_URL },
    });
    // A stack that isn't detected must be ignored.
    await writeMcp("lisa-rails", { rails: { command: "rails-mcp" } });

    const merged = collectLisaMcpServers(pluginRoot, ["expo"]);
    expect(merged).toEqual({
      core: { command: "core-bin" },
      expo: { type: "http", url: EXPO_URL },
    });
    expect("rails" in merged).toBe(false);
  });

  it("the later detected stack wins on a server-name collision (base-first merge)", async () => {
    await writeMcp("lisa", { shared: { command: "base-bin" } });
    await writeMcp("lisa-expo", { shared: { command: "expo-bin" } });
    await writeMcp("lisa-rails", { shared: { command: "rails-bin" } });

    // Order is base, then detectedTypes in order → rails spread last wins.
    const merged = collectLisaMcpServers(pluginRoot, ["expo", "rails"]);
    expect(merged.shared).toEqual({ command: "rails-bin" });
  });

  it("is resilient to a malformed .mcp.json (skips it, no crash)", async () => {
    await fs.ensureDir(path.join(pluginRoot, "lisa"));
    await fs.writeFile(
      path.join(pluginRoot, "lisa", ".mcp.json"),
      "{ not valid json ",
      "utf8"
    );
    await writeMcp("lisa-expo", { expo: { type: "http", url: EXPO_URL } });

    let merged: Record<string, unknown> = {};
    expect(() => {
      merged = collectLisaMcpServers(pluginRoot, ["expo"]);
    }).not.toThrow();
    // The broken base file is skipped; the valid stack server still collected.
    expect(merged).toEqual({ expo: { type: "http", url: EXPO_URL } });
  });

  it("feeds installAgyMcpConfig to produce agy serverUrl shape + _lisaManaged", async () => {
    await writeMcp("lisa-expo", {
      expo: { type: "http", url: EXPO_URL },
    });
    const merged = collectLisaMcpServers(pluginRoot, ["expo"]);
    // NOTE: processAgyEmit installs to USER scope (the only path agy auto-loads);
    // here we write to an explicit temp target to exercise the translate-on-write.
    const target = path.join(tempDir, "out-mcp_config.json");
    await installAgyMcpConfig(merged, target);

    const written = (await fs.readJson(target)) as Record<string, unknown>;
    const servers = written[MCP] as Record<string, Record<string, unknown>>;
    expect(servers.expo.serverUrl).toBe(EXPO_URL);
    expect("url" in servers.expo).toBe(false);
    expect("type" in servers.expo).toBe(false);
    expect(servers.expo[LISA_MANAGED_MARKER]).toBe(true);
  });
});
