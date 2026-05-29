#!/usr/bin/env node
/**
 * mcp-doctor.mjs — inspect-and-report MCP wiring for the wiki's MCP connectors.
 * Dependency-free. Print-only: it never edits .mcp.json / .codex/config.toml or any
 * auth file — it reports PASS/MISSING and prints setup snippets for the user to apply.
 *
 * Usage: node mcp-doctor.mjs [--config <p>] [--repo <dir>]
 * Exit 0 always (advisory). Used by /setup --doctor and /doctor group D.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./_wiki-lib.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : d;
};
const repo = path.resolve(opt("--repo", "."));
const { config } = loadConfig(opt("--config"));

// Connectors that require an MCP server, and the server name to look for.
const MCP_CONNECTORS = {
  jira: "atlassian",
  confluence: "atlassian",
  notion: "notion",
};

const mcpJsonPath = path.join(repo, ".mcp.json");
const codexTomlPath = path.join(repo, ".codex", "config.toml");
const mcpJson = fs.existsSync(mcpJsonPath)
  ? fs.readFileSync(mcpJsonPath, "utf8")
  : "";
const codexToml = fs.existsSync(codexTomlPath)
  ? fs.readFileSync(codexTomlPath, "utf8")
  : "";

const enabled = Object.entries(config?.connectors ?? {}).filter(
  ([name, c]) => c?.enabled && name in MCP_CONNECTORS
);

if (enabled.length === 0) {
  console.log(
    "mcp-doctor: no MCP-backed connectors enabled — nothing to check."
  );
  process.exit(0);
}

let missing = 0;
for (const [name] of enabled) {
  const server = MCP_CONNECTORS[name];
  const inClaude = mcpJson.includes(`"${server}"`);
  const inCodex = codexToml.includes(`[mcp_servers.${server}]`);
  const status = inClaude || inCodex ? "PASS" : "MISSING";
  if (status === "MISSING") missing += 1;
  console.log(
    `${status === "PASS" ? "✓" : "⚠"} ${name} → MCP server "${server}": Claude=${inClaude ? "yes" : "no"} Codex=${inCodex ? "yes" : "no"}`
  );
  if (status === "MISSING") {
    console.log(
      `    Add to .mcp.json:        { "mcpServers": { "${server}": { ... } } }`
    );
    console.log(`    Add to .codex/config.toml: [mcp_servers.${server}]`);
    console.log(
      `    Then authenticate per the ${server} MCP instructions (project-owned auth).`
    );
  }
}

console.log(
  `\nmcp-doctor: ${enabled.length - missing}/${enabled.length} MCP connector(s) wired${missing ? ` — ${missing} MISSING (connector disabled until wired)` : ""}.`
);
