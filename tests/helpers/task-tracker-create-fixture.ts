/**
 * An unbound project for driving `--tracker-create` (CodySwannGT/lisa#5198):
 * the readiness fixture plus the files the create module loads, and stand-ins
 * for each tracker's transport that record what they were asked to do.
 * @module tests/helpers/task-tracker-create-fixture
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "./io-latency-budget.js";
import { taskFixture } from "./task-readiness-fixture.js";

const BASE = path.resolve(__dirname, "../../plugins/src/base");
const OWNER = "skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
export const CREATE_FLAG = "--tracker-create";
export const INPUT_FLAG = "--input-file";
export const INPUT_FILE = "ticket.json";
/** The fixture's configured repository, and the issue its `gh` reports filing. */
const FIXTURE_REPO = "fixture/project";
export const FILED_URL = `https://github.com/${FIXTURE_REPO}/issues/42`;

/** One recorded transport call. */
export interface Call {
  argv: string[];
  stdin: string;
}

/**
 * Write an executable stand-in that journals its argv and stdin.
 * @param file - Where to write it.
 * @param journal - The journal file.
 * @param reply - JavaScript printing the reply, given `a` (argv) and `stdin`.
 */
export function standIn(file: string, journal: string, reply: string): void {
  const record = `fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify({argv:a,stdin})+"\\n");`;
  writeFileSync(
    file,
    `#!${process.execPath}\nconst fs=require("node:fs");const a=process.argv.slice(2);const stdin=fs.readFileSync(0,"utf8");${record}${reply}\n`
  );
  chmodSync(file, 0o755);
}

/**
 * Every call a journal recorded, oldest first.
 * @param journal - The journal file.
 * @returns The calls.
 */
export function journalCalls(journal: string): Call[] {
  return existsSync(journal)
    ? readFileSync(journal, "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as Call)
    : [];
}

/**
 * The value after a flag in a recorded argv.
 * @param argv - The recorded argv.
 * @param flag - The flag.
 * @returns Its value.
 */
export function flagValue(argv: readonly string[], flag: string): string {
  const value = argv[argv.indexOf(flag) + 1];
  if (!argv.includes(flag) || value === undefined)
    throw new Error(`no ${flag} in the recorded call`);
  return value;
}

/**
 * One recorded call, which must exist.
 * @param call - The call, if any.
 * @returns The call.
 */
export function recorded(call: Call | undefined): Call {
  if (!call) throw new Error("the expected call was not recorded");
  return call;
}

/**
 * Copy the files the create module loads into the fixture plugin, merge the
 * tracker settings into its config, and put a `gh` in front of the fixture's
 * own that answers `issue create`.
 * @param plugin - The fixture plugin root.
 * @param root - The fixture project root.
 * @param config - Tracker settings to merge.
 * @param journal - Where the `gh` stand-in records its calls.
 */
function install(
  plugin: string,
  root: string,
  config: Record<string, unknown>,
  journal: string
): void {
  const bin = path.join(root, "bin");
  const file = path.join(root, ".lisa.config.json");
  const original = path.join(bin, "gh-fixture");
  rmSync(path.join(root, ".lisa/work-item-context.md"));
  for (const skill of ["lisa-atlassian-access", "lisa-linear-access"])
    cpSync(
      path.join(BASE, "skills", skill),
      path.join(plugin, "skills", skill),
      { recursive: true }
    );
  for (const name of [
    "intake-blocker-reprobe.mjs",
    "intake-prework-denominator.mjs",
    "resolve-lifecycle-role.mjs",
  ])
    cpSync(
      path.join(BASE, "scripts", name),
      path.join(plugin, "scripts", name)
    );
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...config })
  );
  cpSync(path.join(bin, "gh"), original);
  standIn(
    path.join(bin, "gh"),
    journal,
    `if(a[0]==="issue"&&a[1]==="create"){console.log(${JSON.stringify(FILED_URL)});}else{const r=require("node:child_process").spawnSync(${JSON.stringify(original)},a,{input:stdin,encoding:"utf8"});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;}`
  );
}

/**
 * An isolated project with no ticket bound and the given tracker settings.
 * @param config - Tracker settings merged into the fixture's config.
 * @returns The fixture, its owner script, a scratch folder, and drivers.
 */
export function trackerCreateFixture(config: Record<string, unknown> = {}) {
  const f = taskFixture(true, true, { ATLASSIAN_API_TOKEN: "synthetic-token" });
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-tracker-create-"));
  const journal = path.join(outside, "transport.jsonl");
  // The guard names, and admits, the owner's resolved path.
  const owner = realpathSync(path.join(f.plugin, OWNER));
  const guard = (tool: string, input: Record<string, unknown>) =>
    boundedSpawnSync({
      label: "host readiness wrapper",
      command: process.execPath,
      args: [
        path.join(
          f.plugin,
          "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
        ),
        "--hook",
      ],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: tool,
        tool_input: input,
      }),
    });
  const create = (ticket: unknown, at = path.join(outside, INPUT_FILE)) => {
    writeFileSync(at, JSON.stringify(ticket));
    return boundedSpawnSync({
      label: "tracker create",
      command: process.execPath,
      args: [owner, CREATE_FLAG, INPUT_FLAG, at],
      cwd: f.root,
      env: f.env,
    });
  };
  const filed = () =>
    journalCalls(journal).filter(call => call.argv[0] === "issue");
  install(f.plugin, f.root, config, journal);
  return {
    f,
    owner,
    outside,
    guard,
    create,
    filed,
    bin: path.join(f.root, "bin"),
    dirs: [f.root, outside],
  };
}
