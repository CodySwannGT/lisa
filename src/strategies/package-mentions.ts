/**
 * Which packages a host still names outside its manifest (CodySwannGT/lisa#4932).
 *
 * `adopt` reclaims a key that still holds a value Lisa wrote, on the reasoning
 * that the host never customised it. For a script that is the whole story. For
 * a dependency it is not: a host can import a package Lisa once forced without
 * ever changing the version Lisa wrote, and deleting that key would break the
 * import. So a dependency key is reclaimed only when no file in the host other
 * than its manifest and lockfiles mentions the package at all. A `@types/`
 * package is consumed by the compiler without ever being named, so it also
 * counts as mentioned whenever the package it types is.
 *
 * Nor may a package go while another package the host keeps declares it as a
 * peer: `lucide-react-native` needs the host's `react-native-svg` without the
 * host ever importing it. Peers are read from the installed packages, and a
 * host with no `node_modules` to read keeps everything.
 *
 * Prose and ignore lists never count either: a changelog, a skill document, a
 * knip or audit exception names a package without using it.
 *
 * Nor is a file Lisa itself writes — its header says Lisa replaces it, or its
 * path has a `lisa-` segment, which Lisa reserves for itself, or it is Lisa's
 * machine state under `.lisa/` — nor Lisa's
 * guardrails block inside a hook the host shares, and a name only counts when
 * it stands alone: `tar` inside `start` is not a mention. Lisa answers for what its own files import:
 * it supplies those packages, and its template suites prove they resolve. An
 * orphan Lisa file nothing loads would otherwise keep alive, in every host it
 * reached, each package Lisa ever wrote for it.
 *
 * The check is deliberately crude and leans one way. A name that turns up in a
 * code comment keeps the dependency;
 * that host is left with a package it may not use, which its own dead-code gate
 * then reports as its own. The opposite mistake — deleting a package the host
 * imports — is never made, and when git cannot answer at all every package
 * counts as mentioned.
 * @module strategies/package-mentions
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { classifyOwnershipHeader } from "../core/ownership-header.js";

const run = promisify(execFile);

/** A package's manifest file name. */
const MANIFEST = "package.json";

/** The files that name every dependency by construction, so prove nothing. */
const MANIFEST_AND_LOCKFILES = [
  MANIFEST,
  // Lisa's governance manifest for the host: it lists what Lisa writes.
  "package.lisa.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
] as const;

/**
 * Files that name packages without ever using one: prose, ignore lists, the
 * dead-code gate's own config, and audit exceptions, which name a package
 * because it is installed. Matched anywhere in the tree.
 */
const NEVER_USE = [
  "*.md",
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "audit.ignore.*.json",
  ".gitignore",
  ".lisaignore",
  ".prettierignore",
  ".eslintignore",
] as const;

/**
 * A package a kept package's tooling loads by name from the host, so it stays
 * while that package stays. A host keeping its own `@commitlint/cli` runs
 * Lisa's commitlint config, which extends the conventional preset.
 */
const LOADED_BY: Readonly<Record<string, readonly string[]>> = {
  "@commitlint/cli": ["@commitlint/config-conventional"],
};

/** `git grep` exits 1 when it searched and found nothing. */
const GIT_GREP_NO_MATCH = 1;

/** Long enough for a large host tree; a hang still ends in "mentioned". */
const GIT_GREP_TIMEOUT_MS = 30_000;

/**
 * Tools that load a package from a short name, and the prefix they drop:
 * codegen's `typescript` is `@graphql-codegen/typescript`, Babel's
 * `module-resolver` is `babel-plugin-module-resolver`. ESLint plugins are not
 * here: Lisa's flat configs import them by their full names.
 */
const SHORT_NAME_PREFIXES = ["@graphql-codegen/", "babel-plugin-"] as const;

/**
 * Packages a framework loads because of a setting rather than a name — the
 * same inferences knip's Expo plugin makes from the app config, so the reclaim
 * never removes a package the host's own gate counts as used.
 */
const IMPLIED_BY_SETTING: Readonly<Record<string, readonly string[]>> = {
  "expo-system-ui": ["userInterfaceStyle", "backgroundColor"],
  "expo-notifications": ["notification"],
  "expo-updates": ["updates"],
  "expo-navigation-bar": ["androidNavigationBar"],
};

/**
 * The names whose mention keeps a package: itself; for a `@types/` package the
 * package it types (`@types/scope__pkg` types `@scope/pkg`); the short name a
 * tool loads it by; and any setting that makes a framework load it.
 * @param name - Dependency key
 * @returns Literal strings to search for
 */
function mentionNames(name: string): readonly string[] {
  const typed = /^@types\/(.+)$/u.exec(name)?.[1];
  const [scope, pkg] = typed?.split("__") ?? [];
  const typedName =
    typed === undefined ? [] : [pkg === undefined ? typed : `@${scope}/${pkg}`];
  const shortName = SHORT_NAME_PREFIXES.filter(
    prefix => name.startsWith(prefix) && name.length > prefix.length
  ).map(prefix => name.slice(prefix.length));
  return [
    name,
    ...typedName,
    ...shortName,
    ...(IMPLIED_BY_SETTING[name] ?? []),
  ];
}

/** Manifest sections that list packages rather than use them. */
const LISTING_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
  "trustedDependencies",
] as const;

/**
 * Whether the host manifest uses a package outside the sections that merely
 * list it: a script that runs its binary or preloads it (`-r ts-node/register`),
 * or tool configuration kept in package.json.
 * @param projectDir - Host directory
 * @param names - Names whose standalone mention counts
 * @returns True when the manifest uses the package, or exists but cannot be
 *   read
 */
function manifestUses(projectDir: string, names: readonly string[]): boolean {
  const file = path.join(projectDir, MANIFEST);
  if (!existsSync(file)) return false;
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    const rest = JSON.stringify(
      Object.fromEntries(
        Object.entries(manifest).filter(
          ([key]) => !(LISTING_SECTIONS as readonly string[]).includes(key)
        )
      )
    );
    return names.some(literal => standalone(literal).test(rest));
  } catch {
    return true;
  }
}

/** Lisa's block inside a host file it shares, such as a git hook. */
const GUARDRAILS_BLOCK = /# BEGIN: AI GUARDRAILS[\s\S]*?# END: AI GUARDRAILS/gu;

/**
 * Characters that continue a package name, or join it into a list of file
 * extensions (`*.{ts,tsx}`), so a match against them is not a mention.
 */
const NAME_CHARACTER = "[A-Za-z0-9_.,-]";

/** Path-segment namespace Lisa reserves for artifacts it owns outright. */
const LISA_SEGMENT = "lisa-";

/**
 * Top-level directory holding Lisa's machine state — plans, learnings,
 * ledgers. Lisa writes it, so a package named there was named by Lisa.
 */
const LISA_STATE_DIR = ".lisa";

/** Larger files are not read; a match in one counts as a mention. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * A matcher for a package name standing on its own: not inside a longer name
 * (`tar` in `start`, `react` in `eslint-plugin-react`), not a plugin id
 * (`playwright@claude-plugins-official`) and not a scope (`@playwright/test`),
 * while `pkg@^1`, `"pkg"` and `node_modules/pkg` all still count.
 * @param name - Literal package name
 * @returns Regular expression matching a standalone mention
 */
function standalone(name: string): RegExp {
  const literal = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?<!${NAME_CHARACTER}|@)${literal}(?!${NAME_CHARACTER}|@[A-Za-z])`,
    "u"
  );
}

/**
 * Whether a file that contains a package's name mentions it on the host's
 * behalf. Lisa's own files and Lisa's blocks inside shared files do not.
 * @param projectDir - Host directory
 * @param relative - File path git reported, relative to the host
 * @param names - Names whose standalone mention counts
 * @returns True when the host's own text names the package
 */
function hostMentions(
  projectDir: string,
  relative: string,
  names: readonly string[]
): boolean {
  const segments = relative.split("/");
  if (
    segments[0] === LISA_STATE_DIR ||
    segments.some(segment => segment.startsWith(LISA_SEGMENT))
  )
    return false;
  const file = path.join(projectDir, relative);
  try {
    if (statSync(file).size > MAX_READ_BYTES) return true;
    const text = readFileSync(file, "utf8");
    if (classifyOwnershipHeader(text) === "lisa-managed") return false;
    const own = text.replaceAll(GUARDRAILS_BLOCK, "");
    return names.some(name => standalone(name).test(own));
  } catch {
    return true;
  }
}

/**
 * Whether any host file other than the manifest and lockfiles names a package.
 * @param projectDir - Host directory holding package.json
 * @param name - Package name to look for, matched literally
 * @param providers - Declared packages that stay, whose binaries can serve a
 *   script's command in place of the candidate's
 * @returns False only when git searched the host and found no mention
 */
async function isMentioned(
  projectDir: string,
  name: string,
  providers: readonly string[]
): Promise<boolean> {
  if (
    manifestUses(projectDir, mentionNames(name)) &&
    !binaryProvidedElsewhere(projectDir, name, name, providers)
  )
    return true;
  // A script that runs the package's own binary uses it without naming it:
  // `nest build` needs `@nestjs/cli`. A binary a kept package also provides
  // does not: `playwright test` runs `@playwright/test`'s copy.
  if (
    manifestUses(
      projectDir,
      installedBinaries(projectDir, name).filter(
        binary => !binaryProvidedElsewhere(projectDir, binary, name, providers)
      )
    )
  )
    return true;
  try {
    const { stdout } = await run(
      "git",
      [
        "grep",
        "-z",
        "--name-only",
        "--untracked",
        "--fixed-strings",
        ...mentionNames(name).flatMap(literal => ["-e", literal]),
        "--",
        ".",
        ...MANIFEST_AND_LOCKFILES.map(file => `:(exclude)${file}`),
        // Installed packages name themselves; a host that does not ignore
        // them would otherwise keep everything.
        ":(exclude,glob)**/node_modules/**",
        ...NEVER_USE.map(file => `:(exclude,glob)**/${file}`),
      ],
      {
        cwd: projectDir,
        timeout: GIT_GREP_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    const names = mentionNames(name);
    return stdout
      .split("\0")
      .filter(file => file !== "")
      .some(file => hostMentions(projectDir, file, names));
  } catch (error) {
    return (error as { code?: unknown }).code !== GIT_GREP_NO_MATCH;
  }
}

/**
 * Every peer the installed copy of one package declares.
 * @param projectDir - Host directory
 * @param name - Installed package
 * @returns Peer names; none when the package is not installed or unreadable
 */
function installedPeers(projectDir: string, name: string): readonly string[] {
  return Object.keys(
    installedManifest(projectDir, name).peerDependencies ?? {}
  );
}

/**
 * An installed package's manifest, or an empty one when it cannot be read.
 * @param projectDir - Host directory
 * @param name - Package name
 * @returns The fields this module reads
 */
function installedManifest(
  projectDir: string,
  name: string
): {
  readonly peerDependencies?: Record<string, unknown>;
  readonly bin?: string | Record<string, unknown>;
} {
  try {
    return JSON.parse(
      readFileSync(
        path.join(projectDir, "node_modules", name, MANIFEST),
        "utf8"
      )
    ) as {
      peerDependencies?: Record<string, unknown>;
      bin?: string | Record<string, unknown>;
    };
  } catch {
    return {};
  }
}

/**
 * Binary names an installed package puts on PATH.
 * @param projectDir - Host directory
 * @param name - Package name
 * @returns Its `bin` names
 */
function installedBinaries(
  projectDir: string,
  name: string
): readonly string[] {
  const { bin } = installedManifest(projectDir, name);
  if (typeof bin === "string") return [name.slice(name.lastIndexOf("/") + 1)];
  return Object.keys(bin ?? {});
}

/**
 * Whether a manifest script's use of `binary` as a command is already served
 * by another package the host keeps. `@playwright/test` puts `playwright` on
 * PATH, so `playwright test` in a script does not need the `playwright`
 * package Lisa once installed beside it (CodySwannGT/lisa#4932). Only the
 * manifest checks defer to this; a host file that imports the package still
 * keeps it.
 * @param projectDir - Host directory
 * @param binary - Command a script may run
 * @param name - Candidate package name
 * @param providers - Declared packages that are not reclaim candidates
 * @returns True when another kept package provides a binary of that name
 */
function binaryProvidedElsewhere(
  projectDir: string,
  binary: string,
  name: string,
  providers: readonly string[]
): boolean {
  return providers.some(
    provider =>
      provider !== name &&
      installedBinaries(projectDir, provider).includes(binary)
  );
}

/**
 * Remove from `removable` every package a kept dependency needs as a peer,
 * until nothing changes: keeping one package can keep the peers it names.
 * @param projectDir - Host directory
 * @param dependencies - Every package the host manifest declares
 * @param removable - Unmentioned candidates
 * @returns The candidates still safe to remove
 */
function withoutKeptPeers(
  projectDir: string,
  dependencies: readonly string[],
  removable: ReadonlySet<string>
): ReadonlySet<string> {
  const needed = new Set(
    dependencies
      .filter(name => !removable.has(name))
      .flatMap(name => [
        ...installedPeers(projectDir, name),
        ...(LOADED_BY[name] ?? []),
      ])
  );
  const next = new Set([...removable].filter(name => !needed.has(name)));
  return next.size === removable.size
    ? next
    : withoutKeptPeers(projectDir, dependencies, next);
}

/**
 * The candidates a dependency reclaim must keep.
 * @param projectDir - Host directory, or undefined when there is no tree to
 *   read, in which case every candidate is kept
 * @param candidates - Package names a reclaim would otherwise delete
 * @param dependencies - Every package the host manifest declares, whose
 *   installed peers are honoured
 * @returns Candidates the host mentions or a kept package needs as a peer
 */
export async function findMentionedPackages(
  projectDir: string | undefined,
  candidates: readonly string[],
  dependencies: readonly string[] = []
): Promise<ReadonlySet<string>> {
  if (
    projectDir === undefined ||
    (candidates.length > 0 &&
      !existsSync(path.join(projectDir, "node_modules")))
  ) {
    return new Set(candidates);
  }
  const providers = dependencies.filter(name => !candidates.includes(name));
  const verdicts = await Promise.all(
    candidates.map(async name => [
      name,
      await isMentioned(projectDir, name, providers),
    ])
  );
  const removable = withoutKeptPeers(
    projectDir,
    dependencies,
    new Set(
      verdicts.flatMap(([name, mentioned]) =>
        mentioned ? [] : [name as string]
      )
    )
  );
  return new Set(candidates.filter(name => !removable.has(name)));
}
