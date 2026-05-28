#!/usr/bin/env node
/**
 * Deterministic verification harness for project-ideation PRD dedupe.
 *
 * The harness runs a caller-supplied deterministic project-ideation command
 * twice, checks that exactly one open GitHub PRD contains the expected marker,
 * then optionally removes the automation memory file and verifies a third run
 * recreates memory without creating a duplicate PRD. The recreated memory entry
 * must include the advisory run fields project-ideation promises to write.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const repo = requireValue(args.repo, "--repo");
const marker = requireValue(args.marker, "--marker");
const command = requireValue(args.command, "--command");
const memoryFile = args.memoryFile ? resolve(args.memoryFile) : null;

runCommand("first ideation run", command);
const first = assertSingleOpenMarker(repo, marker, "after first run");

runCommand("second ideation run", command);
const second = assertSingleOpenMarker(repo, marker, "after second run");

let missingMemory = null;
if (memoryFile) {
  missingMemory = runMissingMemoryVariant(repo, marker, command, memoryFile);
}

console.log(
  JSON.stringify(
    {
      repo,
      marker,
      first,
      second,
      missingMemory,
      verdict: "PASS",
    },
    null,
    2
  )
);

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      fail(`Unexpected positional argument: ${token}`);
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1) {
      parsed[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

/**
 * @param {Record<string, string | boolean>} input
 * @param {string} key
 * @returns {string}
 */
function requireValue(input, key) {
  const normalized = key.replace(/^--/, "");
  const value = input[normalized];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${key} is required`);
  }
  return value.trim();
}

/**
 * @param {string} label
 * @param {string} command
 */
function runCommand(label, command) {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    fail(`${label} failed with exit code ${String(result.status)}`);
  }
}

/**
 * @param {string} repo
 * @param {string} marker
 * @param {string} phase
 * @returns {{ readonly count: number, readonly issue: Record<string, any> }}
 */
function assertSingleOpenMarker(repo, marker, phase) {
  const issues = queryOpenIssuesByMarker(repo, marker);
  if (issues.length !== 1) {
    fail(
      `Expected exactly one open issue containing marker ${JSON.stringify(marker)} ${phase}, found ${issues.length}`
    );
  }

  return {
    count: issues.length,
    issue: {
      number: issues[0].number,
      title: issues[0].title,
      url: issues[0].url,
      labels: normalizeLabels(issues[0].labels),
    },
  };
}

/**
 * @param {string} repo
 * @param {string} marker
 * @returns {readonly Record<string, any>[]}
 */
function queryOpenIssuesByMarker(repo, marker) {
  const search = runJson("gh", [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--search",
    `"${marker}" in:body`,
    "--limit",
    "100",
    "--json",
    "number,title,url,labels",
  ]);

  if (Array.isArray(search) && search.length > 0) {
    return search;
  }

  const fallback = runJson("gh", [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,title,url,labels,body",
  ]);

  if (!Array.isArray(fallback)) {
    return [];
  }

  return fallback.filter(issue => String(issue.body ?? "").includes(marker));
}

/**
 * @param {string} repo
 * @param {string} marker
 * @param {string} command
 * @param {string} memoryFile
 * @returns {{ readonly count: number, readonly issue: Record<string, any>, readonly memoryRecreated: boolean, readonly memoryFieldsRecorded: boolean }}
 */
function runMissingMemoryVariant(repo, marker, command, memoryFile) {
  const backup = `${memoryFile}.project-ideation-idempotency-backup`;
  rmSync(backup, { force: true });

  if (existsSync(memoryFile)) {
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(memoryFile, backup);
  }

  try {
    runCommand("missing-memory ideation run", command);
    const result = assertSingleOpenMarker(
      repo,
      marker,
      "after missing-memory run"
    );
    const memoryRecreated = existsSync(memoryFile);
    const memoryFieldsRecorded =
      memoryRecreated &&
      memoryContainsRunEntry(memoryFile, {
        marker,
        prdUrl: String(result.issue.url),
      });

    if (!memoryRecreated) {
      fail(`Expected missing-memory run to recreate ${memoryFile}`);
    }
    if (!memoryFieldsRecorded) {
      fail(
        `Expected recreated memory to record marker, PRD URL, outcome, lifecycle_role, and source_agreement`
      );
    }

    return {
      ...result,
      memoryRecreated,
      memoryFieldsRecorded,
    };
  } finally {
    if (existsSync(backup)) {
      rmSync(memoryFile, { force: true });
      mkdirSync(dirname(memoryFile), { recursive: true });
      renameSync(backup, memoryFile);
    }
  }
}

/**
 * @param {string} memoryFile
 * @param {{ readonly marker: string, readonly prdUrl: string }} expected
 * @returns {boolean}
 */
function memoryContainsRunEntry(memoryFile, expected) {
  const memory = readFileSync(memoryFile, "utf8");
  const requiredFragments = [
    expected.marker,
    expected.prdUrl,
    "outcome:",
    "lifecycle_role:",
    "source_agreement:",
  ];

  return requiredFragments.every(fragment => memory.includes(fragment));
}

/**
 * @param {string} command
 * @param {readonly string[]} argv
 * @returns {any}
 */
function runJson(command, argv) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    fail(`${command} ${argv.join(" ")} failed:\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`Could not parse JSON from ${command}: ${error.message}`);
  }
}

/**
 * @param {readonly any[] | undefined} labels
 * @returns {readonly string[]}
 */
function normalizeLabels(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map(label => (typeof label === "string" ? label : label?.name))
    .filter(Boolean);
}

function printUsage() {
  console.log(`Usage:
  node plugins/lisa/scripts/project-ideation-idempotency-harness.mjs \\
    --repo CodySwannGT/lisa \\
    --marker "[lisa-project-ideation] idea=<stable-key>" \\
    --command "codex exec '/lisa:project-ideation ./fixtures/project-ideation-idempotency prd_ready=true max_prds=1'" \\
    --memory-file "$CODEX_HOME/automations/<automation_id>/memory.md"

The command must be deterministic: it should select the same idea and marker on
each run. When --memory-file is provided, the harness temporarily moves it aside
for the missing-memory variant and restores the original file afterward.`);
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}
