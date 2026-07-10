/** Project-scoped Codex MCP configuration regression coverage. */
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { mergeCodexMcpServers } from "../../../src/codex/mcp-installer.js";

const EXPO_MCP_URL = "https://mcp.expo.dev/mcp";
const SENTRY_MCP_URL = "https://mcp.sentry.dev/mcp";

describe("codex/mcp-installer", () => {
  it("adds selected HTTP and stdio servers without plugin delivery", () => {
    const merged = mergeCodexMcpServers("[features]\nhooks = true\n", {
      expo: { type: "http", url: EXPO_MCP_URL },
      local: { command: "bun", args: ["run", "mcp"] },
    });
    const parsed = parseToml(merged) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<
      string,
      Record<string, unknown>
    >;
    expect(servers.expo?.url).toBe(EXPO_MCP_URL);
    expect(servers.local?.command).toBe("bun");
    expect(servers.local?.args).toEqual(["run", "mcp"]);
  });

  it("replaces stale Lisa servers and preserves host servers", () => {
    const first = mergeCodexMcpServers(
      '[mcp_servers.host]\ncommand = "host-mcp"\n',
      { expo: { type: "http", url: EXPO_MCP_URL } }
    );
    const second = mergeCodexMcpServers(first, {
      sentry: { type: "http", url: SENTRY_MCP_URL },
    });
    const parsed = parseToml(second) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, unknown>;
    expect(servers.host).toBeDefined();
    expect(servers.sentry).toBeDefined();
    expect(servers.expo).toBeUndefined();
  });

  it("lets a host-authored server win on a name collision", () => {
    const merged = mergeCodexMcpServers(
      '[mcp_servers.expo]\nurl = "https://host.example/mcp"\n',
      { expo: { type: "http", url: EXPO_MCP_URL } }
    );
    expect(merged).toContain("https://host.example/mcp");
    expect(merged).not.toContain(EXPO_MCP_URL);
  });

  it("is byte-stable on repeated reconciliation", () => {
    const first = mergeCodexMcpServers("", {
      sentry: { type: "http", url: SENTRY_MCP_URL },
    });
    expect(
      mergeCodexMcpServers(first, {
        sentry: { type: "http", url: SENTRY_MCP_URL },
      })
    ).toBe(first);
  });
});
