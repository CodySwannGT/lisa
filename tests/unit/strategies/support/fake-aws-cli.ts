/**
 * A functional stand-in for the AWS CLI, for tests that must assert on the
 * shared config file rather than on an exit status.
 *
 * The defect this exists for — a second project's bootstrap silently
 * overwriting the first's profiles — succeeds. Exit status distinguishes
 * nothing, and a shim that only records its arguments cannot show that one
 * `[profile dev]` replaced another. So `configure set` really writes ini
 * sections, and `sts get-caller-identity` really resolves the profile it is
 * given: it reads the `role_arn` and reports the account named there, exactly
 * as the real CLI would after assuming that role.
 *
 * `FAKE_STS_ACCOUNT` forces the reported account instead. That is how a
 * credential which authenticates successfully *into the wrong account* is
 * injected — the one case that separates an identity check from a liveness
 * check, and the one a test using broken credentials would pass against both
 * the defect and the fix.
 * @module tests/unit/strategies/support/fake-aws-cli
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The fake CLI itself.
 *
 * `String.raw` so the JavaScript below can be written exactly as it will be
 * executed: its own `\n` escapes and regular expressions survive verbatim
 * instead of being interpreted by the enclosing template. Written as CommonJS
 * with no backticks so it runs under `node` regardless of the package type of
 * whatever directory a test drops it into.
 */
const FAKE_AWS_SOURCE = String.raw`"use strict";
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AWS_LOG, args.join(" ") + "\n");

const awsDirectory = path.join(process.env.HOME, ".aws");
const credentialsFile =
  process.env.AWS_SHARED_CREDENTIALS_FILE ||
  path.join(awsDirectory, "credentials");
const configFile =
  process.env.AWS_CONFIG_FILE || path.join(awsDirectory, "config");
const CREDENTIAL_SETTINGS = new Set([
  "aws_access_key_id",
  "aws_secret_access_key",
  "aws_session_token",
]);

function readSections(file) {
  if (!fs.existsSync(file)) return [];
  const sections = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const header = /^\[([^\]]*)\]\s*$/.exec(line);
    if (header) {
      sections.push({ name: header[1].trim(), settings: [] });
    } else if (sections.length > 0 && line.includes("=")) {
      const index = line.indexOf("=");
      sections[sections.length - 1].settings.push([
        line.slice(0, index).trim(),
        line.slice(index + 1).trim(),
      ]);
    }
  }
  return sections;
}

function renderSection(section) {
  const body = section.settings
    .map(function (pair) {
      return pair[0] + " = " + pair[1] + "\n";
    })
    .join("");
  return "[" + section.name + "]\n" + body;
}

function writeSections(file, sections) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sections.map(renderSection).join("\n"));
}

function optionValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function sectionNameFor(profile, file) {
  if (file === credentialsFile) return profile;
  return profile === "default" ? "default" : "profile " + profile;
}

function findSection(sections, name) {
  return sections.find(function (candidate) {
    return candidate.name === name;
  });
}

function settingValue(section, setting) {
  const pair = section.settings.find(function (candidate) {
    return candidate[0] === setting;
  });
  return pair ? pair[1] : "";
}

function reportIdentity(account) {
  const identity = { Account: account, Arn: "arn:aws:sts::" + account + ":a" };
  process.stdout.write(JSON.stringify(identity) + "\n");
  process.exit(0);
}

if (args[0] === "configure" && args[1] === "set") {
  const setting = args[2];
  const value = args[3];
  const profile = optionValue("--profile", "default");
  const file = CREDENTIAL_SETTINGS.has(setting) ? credentialsFile : configFile;
  const name = sectionNameFor(profile, file);
  const sections = readSections(file);
  let section = findSection(sections, name);
  if (!section) {
    section = { name: name, settings: [] };
    sections.push(section);
  }
  const existing = section.settings.find(function (pair) {
    return pair[0] === setting;
  });
  if (existing) existing[1] = value;
  else section.settings.push([setting, value]);
  fs.mkdirSync(awsDirectory, { recursive: true });
  if (!fs.existsSync(credentialsFile)) fs.writeFileSync(credentialsFile, "");
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, "");
  writeSections(file, sections);
  process.exit(0);
}

if (args[0] === "sts" && args[1] === "get-caller-identity") {
  const forced = process.env.FAKE_STS_ACCOUNT;
  if (forced) reportIdentity(forced);
  const profile = optionValue("--profile", "default");
  const name = sectionNameFor(profile, configFile);
  const section = findSection(readSections(configFile), name);
  if (!section) {
    process.stderr.write("profile (" + profile + ") could not be found\n");
    process.exit(255);
  }
  const roleArn = settingValue(section, "role_arn");
  reportIdentity(roleArn ? roleArn.split(":")[4] : "000000000000");
}

process.stderr.write("fake-aws: unsupported command " + args.join(" ") + "\n");
process.exit(2);
`;

/** Where the fake CLI lives and what it recorded. */
export interface FakeAwsCli {
  /** Directory to put first on `PATH` so `aws` resolves to the fake. */
  readonly binaryDirectory: string;
  /** File the fake appends one line per invocation to. */
  readonly logPath: string;
}

/**
 * Install the fake AWS CLI under a disposable directory.
 * @param directory - Disposable test root
 * @returns The `PATH` entry to use and the invocation log path
 */
export function installFakeAwsCli(directory: string): FakeAwsCli {
  const binaryDirectory = path.join(directory, "bin");
  const logPath = path.join(directory, "aws.log");
  const implementationPath = path.join(binaryDirectory, "fake-aws.cjs");
  const awsPath = path.join(binaryDirectory, "aws");

  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(implementationPath, FAKE_AWS_SOURCE);
  // A bash shim rather than a `#!/usr/bin/env node` shebang: the script under
  // test runs with a deliberately narrow PATH, and naming the interpreter by
  // absolute path keeps the fake working whatever that PATH contains.
  writeFileSync(
    awsPath,
    `#!/usr/bin/env bash\nexec ${process.execPath} ${implementationPath} "$@"\n`
  );
  chmodSync(awsPath, 0o700);
  return { binaryDirectory, logPath };
}
