/**
 * Shared machinery for the credential-resolver-ladder suite.
 *
 * The suite lifts each `read_*()` out of its own `SKILL.md` and RUNS it, so it
 * needs an extractor, a tree builder, and a runner. Those live here rather than
 * in the test file: importing a test module from another test would re-register
 * its suites, and the extraction is the part most likely to be reused when a
 * future skill grows a ladder of its own.
 * @module tests/unit/strategies/credential-resolver-ladder-helpers
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Every surface the access and setup skills are fanned out to. */
export const SURFACES = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-cursor",
] as const;

/** The canonical source every built surface is regenerated from. */
export const SOURCE = "plugins/src/base";

/** Filename every rung ends at. */
const RESOLVER = "resolve-secret.mjs";

/** Tail every rung shares, from the secrets skill down to the resolver. */
const TAIL = `skills/lisa-secrets-access/scripts/${RESOLVER}`;

/** Repo-relative rung a project that vendors the resolver declares. */
export const REPO_COPY = `.claude/${TAIL}`;

/** The `.opencode` layout that had no rung at all before this fix. */
export const OPENCODE_COPY = `.opencode/skills/lisa/lisa-secrets-access/scripts/${RESOLVER}`;

/** The final rung: the one that depends on nothing the host has to provide. */
export const FLOOR_RUNG = `node_modules/@codyswann/lisa/plugins/lisa/${TAIL}`;

/**
 * The rungs every ladder must offer, in order.
 *
 * `.opencode` and `.codex` are the layouts a consumer repo actually uses; the
 * two plugin-root rungs are opportunistic, since neither variable is exported
 * into a plain shell call; and `node_modules` is the floor that needs no
 * environment variable at all.
 */
export const REQUIRED_RUNGS = [
  REPO_COPY,
  `.agents/${TAIL}`,
  OPENCODE_COPY,
  `.codex/skills/lisa/lisa-secrets-access/scripts/${RESOLVER}`,
  `$CLAUDE_PLUGIN_ROOT/${TAIL}`,
  `$PLUGIN_ROOT/${TAIL}`,
  FLOOR_RUNG,
] as const;

/** The rungs reachable with no plugin-root variable set — what a bare shell sees. */
export const UNCONDITIONAL_RUNGS = REQUIRED_RUNGS.filter(
  rung => !rung.startsWith("$")
);

/** One copy of the ladder, and how to drive it. */
export interface LadderSkill {
  /** Skill directory name under `<surface>/skills/`, or a path for a rule. */
  readonly skill: string;
  /** Shell function that owns the ladder. */
  readonly fn: string;
  /** Call that drives the function, arguments included. */
  readonly invoke: string;
  /** Credential the ladder resolves — named in the exhaustion message. */
  readonly credential: string;
  /** True when a legacy OS-keychain rung follows the ladder. */
  readonly keychain: boolean;
}

export const readSkill = (surface: string, skill: string): string =>
  readFileSync(path.resolve(surface, `skills/${skill}/SKILL.md`), "utf8");

/** Where the scan for a function's closing brace has got to. */
interface ScanState {
  /** Index of the closing brace, or -1 while still searching. */
  readonly end: number;
  /** True while inside a single-quoted shell string. */
  readonly openQuote: boolean;
}

/**
 * Advance the closing-brace scan by one line.
 *
 * A `#` comment outside a string is prose, and prose contains apostrophes
 * ("the plugin's own copy") that would otherwise read as an opening quote and
 * swallow the rest of the function.
 * @param state Scan state so far.
 * @param line The line to fold in.
 * @param index Position of that line.
 * @returns The next scan state.
 */
const scanLine = (state: ScanState, line: string, index: number): ScanState => {
  if (state.end >= 0) {
    return state;
  }
  if (line === "}" && !state.openQuote) {
    return { end: index, openQuote: state.openQuote };
  }
  const isProse = !state.openQuote && line.trimStart().startsWith("#");
  const hasOddQuotes = line.split("'").length % 2 === 0;
  return {
    end: -1,
    openQuote: !isProse && hasOddQuotes ? !state.openQuote : state.openQuote,
  };
};

/**
 * Lift one shell function verbatim out of a Markdown file.
 *
 * The terminator is a `}` in column zero, but several of these functions embed
 * a PowerShell program inside a single-quoted string that also has `}` in
 * column zero. Tracking quote parity from the function header tells the two
 * apart, so what runs in the test is the exact text that ships rather than a
 * paraphrase of it.
 * @param source Full text of the file that defines the function.
 * @param fn Name of the function to lift.
 * @returns The function, header through closing brace.
 */
export const extractFunction = (source: string, fn: string): string => {
  const header = new RegExp(`\\n${fn}\\(\\) \\{[^\\n]*\\n`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`${fn}() not found in source`);
  }
  const lines = source.slice(match.index + 1).split("\n");
  const scan = lines.reduce<ScanState>(scanLine, { end: -1, openQuote: false });
  if (scan.end < 0) {
    throw new Error(`unterminated ${fn}() in source`);
  }
  return lines.slice(0, scan.end + 1).join("\n");
};

/**
 * Pull the ordered resolver paths out of an extracted ladder.
 *
 * Reads the paths rather than the surrounding shell, so the copies keep the
 * tails they legitimately differ in — a keychain rung, or a loud failure — and
 * are still held to the same rungs in the same order.
 * @param fnText An extracted `read_*()` function.
 * @returns The resolver paths the ladder tries, in order.
 */
export const ladderOf = (fnText: string): readonly string[] =>
  fnText
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n")
    .split(/\s+/u)
    .map(token =>
      token.replace(/^candidates\+=\(/u, "").replace(/^["'(]+/u, "")
    )
    .filter(token => token.includes(RESOLVER))
    .map(token => token.slice(0, token.indexOf(RESOLVER) + RESOLVER.length));

/** A resolver planted in a tree: where it sits and what it answers. */
export interface PlantedResolver {
  /** Path relative to the tree root. */
  readonly at: string;
  /** Value it prints, or `null` to answer "no entry" the way a real miss does. */
  readonly answers: string | null;
}

/** A tree built for one ladder run. */
interface Tree {
  readonly root: string;
  readonly marker: string;
  readonly stubBin: string;
}

/**
 * Build a tree with a chosen set of resolvers planted in it, plus the PATH
 * stubs that keep the legacy keychain rung deterministic.
 * @param resolvers Resolvers to plant.
 * @returns Paths of the tree root, the invocation-marker file, and the stub bin.
 */
const buildTree = (resolvers: readonly PlantedResolver[]): Tree => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-ladder-"));
  const marker = path.join(root, "invocations.log");
  // `uname` reports Linux and `secret-tool` is absent, so the legacy keychain
  // rung reaches a deterministic empty answer on every host instead of
  // prompting a real macOS keychain from a unit test.
  const stubBin = path.join(root, "stub-bin");

  writeFileSync(marker, "");
  for (const resolver of resolvers) {
    const file = path.join(root, resolver.at);
    mkdirSync(path.dirname(file), { recursive: true });
    // The marker is what separates "never reached a resolver" from "a resolver
    // answered and the store had no entry" — the two outcomes a bare `return 1`
    // renders identical, and the whole reason this bug was hard to see.
    const body = [
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(resolver.at)} + "\\n");`,
      resolver.answers === null
        ? "process.exit(1);"
        : `process.stdout.write(${JSON.stringify(resolver.answers)} + "\\n");`,
    ].join("\n");
    writeFileSync(file, `${body}\n`);
  }
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(path.join(stubBin, "uname"), "#!/bin/sh\necho Linux\n", {
    mode: 0o755,
  });
  return { root, marker, stubBin };
};

/** What running one ladder produced. */
export interface LadderRun {
  readonly status: number | null;
  /** Set when the child was killed rather than allowed to finish. */
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Resolver paths actually invoked, in order. */
  readonly invoked: readonly string[];
}

/* eslint-disable sonarjs/no-os-command-from-path -- The PATH is built here on
   purpose: a test-only stub bin fronts a deliberately minimal PATH so `uname`
   is deterministic and no developer-shell credential leaks into the child. */

/**
 * Run one ladder inside a purpose-built tree.
 * @param entry The copy of the ladder to drive.
 * @param resolvers Resolvers to plant in the tree.
 * @param env Extra environment for the shell (e.g. a plugin root).
 * @param fnTextOverride Pre-extracted function, for ladders outside `skills/`.
 * @returns Exit status, streams, and the resolvers the ladder actually invoked.
 */
export const runLadder = (
  entry: LadderSkill,
  resolvers: readonly PlantedResolver[],
  env: Readonly<Record<string, string>> = {},
  fnTextOverride?: string
): LadderRun => {
  const { root, marker, stubBin } = buildTree(resolvers);
  const fnText =
    fnTextOverride ?? extractFunction(readSkill(SOURCE, entry.skill), entry.fn);
  const result = spawnSync("bash", ["-c", `${fnText}\n${entry.invoke}\n`], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      // A deliberately minimal environment: any leaked ATLASSIAN_API_TOKEN or
      // LINEAR_API_KEY from the developer's shell would short-circuit the
      // ladder at rung zero and make every assertion vacuous.
      PATH: [stubBin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(
        ":"
      ),
      HOME: root,
      ...env,
    },
  });
  const invoked = readFileSync(marker, "utf8").split("\n").filter(Boolean);

  // The tree is disposable and `root` came from `mkdtempSync`, so reaping it
  // here keeps a saturated $TMPDIR from becoming the next run's mystery
  // failure — and keeps the helper free of module-level mutable state.
  rmSync(root, { recursive: true, force: true });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    invoked,
  };
};

/* eslint-enable sonarjs/no-os-command-from-path -- End test-only PATH shim scope. */
