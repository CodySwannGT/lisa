#!/usr/bin/env node
/**
 * render-contract.mjs — render the repo-local contract snapshot from the plugin
 * template + the project's config. Dependency-free.
 *
 * The plugin owns the canonical contract template (templates/llm-wiki-contract.md);
 * this script materializes wiki/schema/llm-wiki-contract.md so the wiki stays
 * readable/maintainable even without the plugin installed. The kernelVersion is
 * read from the built plugin manifest and stamped into the snapshot.
 *
 * Usage: node render-contract.mjs [path-to-config] [--out <path>]
 *   default config: wiki/lisa-wiki.config.json (relative to cwd)
 *   default out:    <wikiRoot>/schema/llm-wiki-contract.md
 * Exit code 0 = rendered, 1 = error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(scriptDir);
const templatePath = path.join(pluginRoot, "templates", "llm-wiki-contract.md");
const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");

const argv = process.argv.slice(2);
const outFlagIdx = argv.indexOf("--out");
let outOverride;
if (outFlagIdx !== -1) {
  outOverride = argv[outFlagIdx + 1];
  if (!outOverride || outOverride.startsWith("--"))
    fail("--out requires a path argument");
}
const configArg = argv.find(
  (a, i) => !a.startsWith("--") && i !== outFlagIdx + 1
);
const configPath = path.resolve(configArg ?? "wiki/lisa-wiki.config.json");

if (!fs.existsSync(templatePath))
  fail(`contract template missing: ${templatePath}`);
if (!fs.existsSync(configPath)) fail(`config not found: ${configPath}`);

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  fail(`config is not valid JSON: ${e.message}`);
}

let kernelVersion = "0.0.0";
try {
  kernelVersion =
    JSON.parse(fs.readFileSync(manifestPath, "utf8")).version ?? kernelVersion;
} catch {
  // manifest may be absent in the src tree before build; leave default.
}

const enabledConnectors = Object.entries(config.connectors ?? {})
  .filter(([, c]) => c && c.enabled)
  .map(([name]) => name);

const subs = {
  org: config.org ?? "",
  displayName: config.displayName ?? config.org ?? "LLM Wiki",
  purpose: config.purpose ?? "(purpose not set — run /setup to define it)",
  mode: config.mode ?? "",
  wikiRoot: config.wikiRoot ?? "wiki",
  kernelVersion,
  schemaVersion: config.schemaVersion ?? "",
  categories: (config.categories ?? []).join(", "),
  connectors: enabledConnectors.length
    ? enabledConnectors.join(", ")
    : "(none enabled)",
  sourceLayout: config.sources?.layout ?? "by-system",
  sourceRetention: config.sourceRetention ?? "sanitized-note-only",
  sensitivityDefault: config.sensitivity?.default ?? "internal",
  prPolicy: config.git?.prPerIngestion
    ? `PR per ingestion to ${config.git?.targetBranch ?? "main"}${config.git?.autoMerge ? " (auto-merge)" : ""}`
    : "no PR per ingestion",
  readmeMode: config.readme?.mode ?? "rich",
  generatedDate: new Date().toISOString().slice(0, 10),
};

let rendered = fs.readFileSync(templatePath, "utf8");
rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, key) =>
  key in subs ? String(subs[key]) : match
);

const leftover = [
  ...new Set([...rendered.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])),
];
if (leftover.length) {
  fail(`unresolved template tokens in contract: ${leftover.join(", ")}`);
}

const outPath = path.resolve(
  outOverride ?? path.join(subs.wikiRoot, "schema", "llm-wiki-contract.md")
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, rendered);
console.log(
  `✓ rendered contract → ${path.relative(process.cwd(), outPath)} (kernelVersion ${kernelVersion})`
);
