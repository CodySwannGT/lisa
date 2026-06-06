#!/usr/bin/env node
/**
 * Pre-commit safety gate for generated wiki output.
 *
 * Scans only explicit wiki paths, or current git changes under the configured
 * wiki root when no paths are passed. Reports safe metadata only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./_wiki-lib.mjs";
import { scanWikiGeneratedFiles } from "./wiki-safety.mjs";

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};
const repeated = name => {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
};

const { config } = loadConfig(opt("--config"));
const wikiRoot = path.resolve(opt("--wiki") ?? config?.wikiRoot ?? "wiki");
const asJson = flag("--json");
const scanner = opt("--scanner") ?? "builtin";

function commandExists(command) {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitChangedPaths() {
  let out = "";
  try {
    out = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  const entries = out.split("\0").filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (!file || status.includes("D")) continue;
    paths.push(file);
    if (status[0] === "R" || status[0] === "C") i += 1;
  }
  return paths;
}

const explicitPaths = repeated("--path");
const files = explicitPaths.length > 0 ? explicitPaths : gitChangedPaths();

const externalScanner =
  scanner === "gitleaks" || scanner === "trufflehog" ? scanner : undefined;
const externalScannerMissing =
  externalScanner !== undefined && !commandExists(externalScanner);

const result = scanWikiGeneratedFiles(files, {
  fsModule: fs,
  pathModule: path,
  wikiRoot,
});

const finalResult = {
  ...result,
  scanner: {
    selected: scanner,
    externalAvailable: externalScanner ? !externalScannerMissing : undefined,
  },
  ok: result.ok && !externalScannerMissing,
  errors: [
    ...result.errors,
    ...(externalScannerMissing
      ? [
          {
            file: path.relative(process.cwd(), wikiRoot) || ".",
            message: `${externalScanner} scanner selected but unavailable`,
          },
        ]
      : []),
  ],
};

if (asJson) {
  console.log(JSON.stringify(finalResult, null, 2));
} else {
  for (const finding of finalResult.findings) {
    console.log(
      `x [wiki-safety] possible ${finding.entityType} (${finding.confidence}) in ${finding.sourceId}; count=${finding.count}`
    );
  }
  for (const error of finalResult.errors) {
    console.log(`x [wiki-safety] ${error.message} (${error.file})`);
  }
  console.log(
    `\n${finalResult.findings.length} finding${finalResult.findings.length === 1 ? "" : "s"}, ${finalResult.errors.length} error${finalResult.errors.length === 1 ? "" : "s"} across ${finalResult.scanned.length} wiki file${finalResult.scanned.length === 1 ? "" : "s"} — ${finalResult.ok ? "OK" : "BLOCKING"}`
  );
}

process.exitCode = finalResult.ok ? 0 : 1;
