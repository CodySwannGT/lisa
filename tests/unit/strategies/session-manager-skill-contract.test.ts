/**
 * Prose contract for the session-manager skills (CodySwannGT/lisa#4448).
 *
 * The manager is an agent following `lisa-session-manager`, so the instruction
 * text is the contract surface. These assertions pin the lines that keep it
 * safe and honest, in the source and in every runtime projection: one run
 * outcome per cycle under `automation-runbook-contract`, workers launched with
 * exactly `/lisa:implement <REF> managedBy=<manager-name>`, claims through
 * `lisa-tracker-claim`, lifecycle states resolved by role, untrusted text kept
 * off the command line, and an explicit `## Runtime parity` section (the
 * manager process is Claude Code only).
 *
 * The skills also tell the agent which CLI subcommands and flags to run. Every
 * one is checked against the CLI's own usage text, so a skill cannot direct
 * the agent to an invented flag. Packaging and byte parity live in
 * session-manager-skill.test.ts.
 * @module tests/unit/strategies/session-manager-skill-contract
 */
import { describe, expect, it } from "vitest";

import { USAGE } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/cli-usage.mjs";
import { buildWorkerSpawn } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";
import { hostNameEntries } from "../../../src/core/downstream-names.js";
import { findDownstreamReferences } from "../../../src/core/downstream-references.js";
import {
  ALL_ROOTS,
  read,
  section,
  SKILLS,
  SOURCE_ROOT,
} from "./session-manager-skill-helpers.js";

const MANAGER = "lisa-session-manager";
const SETUP = "lisa-setup-session-manager";
const OUTCOMES = [
  "nothing-needed",
  "change-proved",
  "approval-requested",
  "recovery-required",
  "policy-obsolete",
  "candidate-proposed",
] as const;
const RUNTIMES = [
  "Claude Code",
  "Codex",
  "Cursor",
  "OpenCode",
  "agy",
  "Copilot",
  "Devin",
];
const FACTS = "## Fixed facts";
const GLOBAL_FLAGS = ["--project-root", "--help"];
/** A Telegram bot token: numeric bot id, colon, 35-character secret. */
const BOT_TOKEN = /\d{8,10}:[A-Za-z0-9_-]{35}/;

/**
 * Map each usage entry (`spawn`, `ledger finish`, ...) to its text.
 * @param usage - The CLI's usage text
 * @returns Entry key to the entry's lines
 */
function usageEntries(usage: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  let key = "";
  for (const line of usage.split("\n")) {
    const head = /^ {2}(ledger [a-z-]+|[a-z][a-z-]*)\b/.exec(line);
    if (head?.[1]) key = head[1];
    else if (!/^ {3,}/.test(line)) key = "";
    if (key) entries.set(key, `${entries.get(key) ?? ""}\n${line}`);
  }
  return entries;
}

const ENTRIES = usageEntries(USAGE);

/**
 * Every CLI call a skill tells the agent to make, with the flags it passes.
 * Calls through `session-manager.mjs` and `ledger <x>` spans take any
 * subcommand word, so an invented one is caught; a bare inline span counts
 * only when it starts with a real subcommand.
 * @param skill - SKILL.md text
 * @returns One `{key, flags}` per call site
 */
function cliCalls(skill: string): { key: string; flags: string[] }[] {
  const flagsOf = (rest: string): string[] =>
    rest.match(/--[a-z][a-z-]*/g) ?? [];
  const viaScript = [
    ...skill.matchAll(/session-manager\.mjs"\s+([a-z][a-z-]*)([^`\n)]*)/g),
  ].map(([, key = "", rest = ""]) => ({ key, flags: flagsOf(rest) }));
  const prose = skill.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, "");
  const viaSpan = [...prose.matchAll(/`([^`\n]+)`/g)].flatMap(([, span]) => {
    const words = (span ?? "").split(" ");
    const isLedger = words[0] === "ledger" && /^[a-z-]+$/.test(words[1] ?? "");
    const size = isLedger ? 2 : 1;
    const key = words.slice(0, size).join(" ");
    const rest = words.slice(size).join(" ");
    return isLedger || ENTRIES.has(key) ? [{ key, flags: flagsOf(rest) }] : [];
  });
  return [...viaScript, ...viaSpan];
}

/**
 * The script-root ladder block, dedented.
 * @param skill - SKILL.md text
 * @returns The fenced bash block that resolves `$SM`
 */
function ladder(skill: string): string {
  const block = /^([ \t]*)```bash\n([\s\S]*?)\n[ \t]*```/m.exec(
    skill.slice(skill.indexOf('SM="${SM_SCRIPTS_DIR:-}"') - 400)
  );
  if (!block?.[2]) throw new Error("ladder block not found");
  const indent = block[1] ?? "";
  return block[2]
    .split("\n")
    .map(line => line.slice(indent.length))
    .join("\n");
}

describe.each(ALL_ROOTS)("lisa-session-manager contract (%s)", root => {
  const skill = read(`${root}/${MANAGER}/SKILL.md`);

  it("ends every cycle in exactly one runbook-contract outcome", () => {
    const outcome = section(skill, "## Run outcome");
    expect(outcome).toContain("`automation-runbook-contract`");
    expect(outcome).toContain("**exactly one** of the six outcomes");
    for (const name of OUTCOMES) expect(outcome).toContain(`\`${name}\``);
    expect(outcome).toMatch(/record-cycle --outcome [a-z-]+ .*< \.lisa\//);
  });

  it("launches workers only through spawn with the managedBy prompt", () => {
    const facts = section(skill, FACTS);
    expect(facts).toContain("**Workers** start only through `spawn`");
    expect(facts).toContain(
      "The worker prompt is exactly\n  `/lisa:implement <REF> managedBy=<manager-name>`"
    );
  });

  it("claims through lisa-tracker-claim, never a vendor claim skill", () => {
    expect(section(skill, FACTS)).toContain(
      "claims go through `lisa-tracker-claim`"
    );
    expect(section(skill, "## The cycle")).toContain(
      "invoke `lisa-tracker-claim <ref>`"
    );
    expect(skill).not.toMatch(/lisa-(?:github|jira|linear)-claim/);
  });

  it("resolves lifecycle states by role and never names one", () => {
    expect(skill).toContain("Never hard-code a state or label name.");
    expect(skill).toContain(
      'resolve-lifecycle-role.mjs" --role <role> --vendor <tracker> --intent <read|write>'
    );
    const moves = [
      ...skill.matchAll(/\bmove (?:the item|it)(?: back)?\s+to\s+(.{0,24})/gs),
    ].map(([, target]) => target ?? "");
    expect(moves.length).toBeGreaterThanOrEqual(5);
    for (const target of moves) {
      expect(target).toMatch(/^the `(?:ready|blocked)`\s+role/);
    }
    expect(skill).not.toMatch(/["`'](?:Ready|In Progress|Blocked|Done)["`']/);
    expect(skill).not.toMatch(/status:(?:ready|in[- ]progress|blocked)/i);
  });

  it("keeps untrusted text on STDIN, never on a command line", () => {
    const facts = section(skill, FACTS);
    expect(facts).toContain("**Untrusted text never goes on a command line.**");
    expect(facts).toContain("reach the CLI on STDIN only");
    expect(facts).toContain("< .lisa/session-manager/msg.txt");
    expect(USAGE).toContain("read from STDIN, never from argv");
  });

  it("states runtime parity: Claude Code only, with the gap named", () => {
    const parity = section(skill, "## Runtime parity");
    for (const runtime of RUNTIMES) expect(parity).toContain(runtime);
    expect(parity).toContain("`claude` ≥ 2.1.224");
    expect(parity).toContain(
      "The session manager runs on Claude Code\nonly (background sessions, channels, cross-session messaging)."
    );
    expect(parity).toMatch(/OpenCode \| [^\n]*npm rung[^\n]*\| gap \|/);
  });
});

describe.each(ALL_ROOTS)("lisa-setup-session-manager contract (%s)", root => {
  const skill = read(`${root}/${SETUP}/SKILL.md`);

  it("points at the manager's Runtime parity section", () => {
    expect(skill).toContain('`lisa-session-manager` "Runtime parity"');
  });

  it("resolves the scripts with the manager's ladder, byte for byte", () => {
    expect(ladder(skill)).toBe(ladder(read(`${root}/${MANAGER}/SKILL.md`)));
    expect(ladder(skill)).toContain('exit 1; }\necho "$SM"');
  });

  it("never asks for the token in chat or writes it to config", () => {
    expect(skill).toContain("Never ask for the token in chat");
    expect(skill).toContain("never put it in\n`.lisa.config.json`");
  });
});

describe("the skills use only real CLI subcommands and flags", () => {
  const roster = {
    [MANAGER]: [
      "capacity",
      "spawn",
      "resume",
      "classify",
      "queue",
      "route",
      "blocked-plan",
      "record-cycle",
      "repo-dir",
      "validate",
      "ledger finish",
      "ledger set-question",
      "ledger control",
    ],
    [SETUP]: ["init-config", "validate", "store-token", "start", "status"],
  };

  it.each(SKILLS)("%s: every call names a subcommand in --help", skill => {
    const calls = cliCalls(read(`${SOURCE_ROOT}/${skill}/SKILL.md`));
    const keys = new Set(calls.map(call => call.key));
    for (const key of roster[skill]) expect(keys).toContain(key);
    for (const { key } of calls) expect([...ENTRIES.keys()]).toContain(key);
  });

  it.each(SKILLS)("%s: every flag belongs to its subcommand", skill => {
    for (const { key, flags } of cliCalls(
      read(`${SOURCE_ROOT}/${skill}/SKILL.md`)
    )) {
      for (const flag of flags.filter(flag => !GLOBAL_FLAGS.includes(flag))) {
        expect(ENTRIES.get(key), `${key} ${flag}`).toContain(flag);
      }
    }
  });

  it("matches the prompt the CLI actually launches", () => {
    const spawn = buildWorkerSpawn({
      ref: "ABC-1",
      name: "wk-abc-1-0101-0000",
      manager: "mgr",
      repoDir: "/repo",
      env: {},
    });
    expect(spawn.args.at(-1)).toBe("/lisa:implement ABC-1 managedBy=mgr");
  });
});

describe.each(ALL_ROOTS)("no secrets or downstream names (%s)", root => {
  const files = SKILLS.map(skill => `${root}/${skill}/SKILL.md`).concat(
    `${root}/${MANAGER}/references/runbook-template.md`
  );

  it.each(files)("%s has no bot token and names no host project", file => {
    const text = read(file);
    expect(text).not.toMatch(BOT_TOKEN);
    expect(findDownstreamReferences(text)).toEqual([]);
  });

  it("the guards bite on a planted token and host name", () => {
    expect(`x 123456789:${"A".repeat(35)} y`).toMatch(BOT_TOKEN);
    const planted = `${read(files[0]!)}\nMeasured on somehost.`;
    const matcher = hostNameEntries({ LISA_DOWNSTREAM_NAMES: "somehost" });
    expect(findDownstreamReferences(planted, matcher)).toHaveLength(1);
  });
});
