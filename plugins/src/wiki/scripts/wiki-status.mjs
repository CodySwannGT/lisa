#!/usr/bin/env node
/**
 * wiki-status.mjs — read-only Lisa wiki source freshness report.
 *
 * Usage: node wiki-status.mjs [--wiki <wikiRoot>] [--config <path>] [--json]
 * Exit 0 = report rendered. Missing wiki/config are represented in the report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, walkFiles } from "./_wiki-lib.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_DAYS = 7;

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};

function relToCwd(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function normalizeWikiPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function parseDate(value) {
  if (!value || typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function newestDate(values) {
  return values
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function enabledConnectors(config) {
  const connectors = config?.connectors ?? {};
  return Object.entries(connectors)
    .filter(([, connectorConfig]) => connectorConfig?.enabled !== false)
    .filter(
      ([, connectorConfig]) => connectorConfig?.sideEffects !== "external-write"
    )
    .map(([name, connectorConfig]) => ({
      name,
      sideEffects: connectorConfig?.sideEffects ?? "unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function logSections(logText) {
  const lines = logText.split("\n");
  const sections = [];
  let current;

  for (const line of lines) {
    const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})(?:\s+-\s+(.*))?$/);
    if (heading) {
      if (current) sections.push(current);
      current = {
        date: heading[1],
        title: heading[2] ?? "",
        lines: [line],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (current) sections.push(current);
  return sections;
}

function connectorLogFacts(logText, connectorName) {
  const sections = logSections(logText);
  const escaped = connectorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = new RegExp(`\`${escaped}\``, "i");
  const bare = new RegExp(`\\b${escaped}\\b`, "i");

  for (const section of [...sections].reverse()) {
    const lines = section.lines.filter(
      line => quoted.test(line) || bare.test(line)
    );
    if (lines.length === 0) continue;

    const lower = lines.join("\n").toLowerCase();
    const status = lower.includes("skipped")
      ? "skipped"
      : lower.includes("blocked") || lower.includes("failed")
        ? "blocked"
        : lower.includes("ingested") || lower.includes("refreshed")
          ? "ingested"
          : "observed";

    return {
      date: section.date,
      status,
      reason: lines.map(line => line.replace(/^-\s*/, "").trim()).join(" "),
    };
  }

  return undefined;
}

function stateFacts(wikiRoot, connectorName) {
  const stateDir = path.join(wikiRoot, "state", connectorName);
  const files = walkFiles(stateDir, { ext: ".json" });
  const states = files
    .map(filePath => ({ filePath, data: readJsonSafe(filePath) }))
    .filter(item => item.data);
  const dated = states
    .map(item => ({
      ...item,
      date:
        parseDate(item.data.ingested_at) ??
        parseDate(item.data.cursor?.lastIngest) ??
        parseDate(item.data.updated_at),
    }))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const latest = dated[0] ?? states[0];
  const sourceNotes = new Set();

  for (const item of states) {
    const notes = item.data.source_notes ?? item.data.sourceNotes ?? [];
    if (Array.isArray(notes)) {
      for (const note of notes) {
        if (typeof note === "string") sourceNotes.add(normalizeWikiPath(note));
      }
    }
    if (typeof item.data.source_note === "string") {
      sourceNotes.add(normalizeWikiPath(item.data.source_note));
    }
  }

  return {
    stateFiles: files.map(filePath => relToCwd(filePath)),
    latestObservedAt: latest?.date?.toISOString() ?? latest?.data?.ingested_at,
    sourceNotes: [...sourceNotes],
  };
}

function sourceFacts(wikiRoot, connectorName, configuredSourceNotes) {
  const sourceDir = path.join(wikiRoot, "sources", connectorName);
  const markdownFiles = walkFiles(sourceDir, { ext: ".md" }).map(relToCwd);
  const wikiParent = path.dirname(wikiRoot);
  const sourceNoteExists = note =>
    fs.existsSync(path.resolve(note)) ||
    fs.existsSync(path.resolve(wikiParent, note));
  const existingConfigured = configuredSourceNotes.filter(note =>
    sourceNoteExists(note)
  );

  return {
    sourceNotes:
      existingConfigured.length > 0
        ? existingConfigured
        : markdownFiles.map(normalizeWikiPath),
  };
}

function nextActionFor(verdict, connectorName, reason) {
  if (verdict === "fresh") return "No action needed.";
  if (verdict === "skipped") {
    return reason?.toLowerCase().includes("project-scoped memory")
      ? "Provide project-scoped memory for this repo, or accept the expected skip."
      : `Review the skip reason, then run /lisa-wiki:ingest --source ${connectorName} when available.`;
  }
  if (verdict === "blocked") {
    return `Resolve the blocker, then run /lisa-wiki:ingest --source ${connectorName}.`;
  }
  return `Run /lisa-wiki:ingest --source ${connectorName}.`;
}

export function createWikiFreshnessReport({
  configPath = "wiki/lisa-wiki.config.json",
  wikiRoot,
  now = new Date(),
  staleAfterDays = DEFAULT_STALE_AFTER_DAYS,
} = {}) {
  const { config, configPath: resolvedConfigPath } = loadConfig(configPath);
  const resolvedWikiRoot = path.resolve(wikiRoot ?? config?.wikiRoot ?? "wiki");
  const logPath = path.join(resolvedWikiRoot, "log.md");
  const logText = readTextSafe(logPath);
  const connectors = enabledConnectors(config);
  const staleAfterMs = staleAfterDays * DAY_MS;

  const items = connectors.map(connector => {
    const state = stateFacts(resolvedWikiRoot, connector.name);
    const sources = sourceFacts(
      resolvedWikiRoot,
      connector.name,
      state.sourceNotes
    );
    const log = connectorLogFacts(logText, connector.name);
    const observedDate =
      newestDate([state.latestObservedAt, log?.date]) ??
      newestDate(
        sources.sourceNotes.map(note => note.match(/\d{4}-\d{2}-\d{2}/)?.[0])
      );
    const hasState = state.stateFiles.length > 0;
    const hasSourceNotes = sources.sourceNotes.length > 0;
    const isStale =
      observedDate && now.getTime() - observedDate.getTime() > staleAfterMs;

    const verdict =
      log?.status === "blocked"
        ? "blocked"
        : log?.status === "skipped" && !hasState && !hasSourceNotes
          ? "skipped"
          : !hasState && !hasSourceNotes
            ? "never_ingested"
            : !hasState || !hasSourceNotes || isStale
              ? "stale"
              : "fresh";

    const evidence = [
      ...sources.sourceNotes,
      ...state.stateFiles,
      fs.existsSync(logPath) ? relToCwd(logPath) : undefined,
    ].filter(Boolean);

    return {
      connector: connector.name,
      sideEffects: connector.sideEffects,
      verdict,
      evidence,
      lastObserved: observedDate?.toISOString().slice(0, 10) ?? "unknown",
      reason: verdict === "fresh" ? "" : (log?.reason ?? ""),
      nextAction: nextActionFor(verdict, connector.name, log?.reason),
    };
  });

  return {
    generatedAt: now.toISOString(),
    configPath: relToCwd(resolvedConfigPath),
    wikiRoot: relToCwd(resolvedWikiRoot),
    items,
  };
}

export function renderWikiFreshnessReport(report) {
  const lines = [
    "# Lisa wiki source freshness",
    "",
    `Generated: ${report.generatedAt}`,
    `Config: ${report.configPath}`,
    `Wiki root: ${report.wikiRoot}`,
    "",
    "| Connector | Verdict | Last observed | Evidence | Next action |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const item of report.items) {
    const evidence =
      item.evidence.length > 0
        ? item.evidence.slice(0, 3).join("<br>")
        : "none";
    lines.push(
      `| ${item.connector} | ${item.verdict} | ${item.lastObserved} | ${evidence} | ${item.nextAction} |`
    );
    if (item.reason && item.verdict !== "fresh") {
      lines.push(
        `| ${item.connector} | reason | ${item.lastObserved} | log | ${item.reason} |`
      );
    }
  }

  lines.push(
    "",
    "Integrity follow-up: run /lisa-wiki:lint separately for broken links, stale claims, or structure issues."
  );

  return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = createWikiFreshnessReport({
    configPath: opt("--config") ?? "wiki/lisa-wiki.config.json",
    wikiRoot: opt("--wiki"),
  });

  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderWikiFreshnessReport(report));
  }
}
