/**
 * Answers one question of Lisa's shipped `package.lisa.json` templates: does
 * every tool a script names come from a package the receiving stack is
 * actually given?
 *
 * The templates deep-merge parent into child, so a key added to
 * `typescript/package-lisa/package.lisa.json` is written verbatim into the
 * `package.json` of every stack that names `typescript` as its parent —
 * including stacks whose toolchain cannot run it. Nothing in the edit, the
 * diff, or the apply summary says which stacks received it, and an unreferenced
 * script costs nothing until something invokes it, which can be months later
 * and in a consumer rather than here. That is how a Jest stack came to carry a
 * vitest coverage command (#2848) and a vitest mutation runner (#1413).
 *
 * Two properties keep this from being a roster that has to be edited:
 *
 * - The stacks come from {@link PROJECT_TYPE_HIERARCHY} and the resolution
 *   comes from {@link PackageLisaStrategy.planPackageJson} — the same code
 *   `apply` runs — so adding a stack or a template layer is covered with no
 *   edit here.
 * - Which tools are *governed* is derived from the templates too: a tool is
 *   governed when some stack pins a package that provides it. Tools no stack
 *   pins (`node`, `tsc`, `bash`, `docker`) are the host's to supply and are
 *   ignored. The moment one stack pins a tool, every stack whose scripts name
 *   it must pin it as well — which is precisely the asymmetry that makes an
 *   inherited pin dangerous.
 * @module tests/helpers/template-toolchain
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { env } from "node:process";

import type { ProjectType } from "../../src/core/config.js";
import { PROJECT_TYPE_HIERARCHY } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";

/** Environment keys Node consults when resolving the platform temp root. */
const TEMP_KEYS = ["TMPDIR", "TMP", "TEMP"] as const;

/** Guard against overlapping process-environment mutations in one worker. */
const platformTempGuard = { active: false };

/**
 * Run one synchronous test after selecting its logical platform temp root.
 * Production still calls `os.tmpdir()` and enforces uid/mode/inode authority.
 * @param root - Existing platform-temp fixture root
 * @param operation - Synchronous test operation
 * @returns Test result
 */
export function withProcessPlatformTempRoot<T>(
  root: string,
  operation: () => T
): T {
  if (platformTempGuard.active) {
    throw new Error("Platform-temp test controls must not overlap");
  }
  // eslint-disable-next-line functional/immutable-data -- restored by the synchronous finally below
  platformTempGuard.active = true;
  const previous = TEMP_KEYS.map(key => [key, Reflect.get(env, key)] as const);
  for (const key of TEMP_KEYS) {
    Reflect.set(env, key, root);
  }
  try {
    const result = operation();
    if (result instanceof Promise) {
      throw new Error("Platform-temp test controls must remain synchronous");
    }
    return result;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(env, key);
      } else {
        Reflect.set(env, key, value);
      }
    }
    // eslint-disable-next-line functional/immutable-data -- paired with guarded acquisition
    platformTempGuard.active = false;
  }
}

/** A stack's shipped scripts and the packages it receives. */
interface ResolvedStack {
  /** Scripts the stack's `package.json` ends up with. */
  readonly scripts: Readonly<Record<string, string>>;
  /** Every dependency and devDependency the stack ends up with. */
  readonly packages: ReadonlySet<string>;
}

/** One script that names a tool its stack is not given. */
export interface ToolchainViolation {
  /** Project type whose resolved `package.json` carries the script. */
  readonly stack: string;
  /** The `scripts` key. */
  readonly scriptKey: string;
  /** The script body, verbatim. */
  readonly command: string;
  /** The executable the command invokes. */
  readonly tool: string;
  /** Packages that provide {@link tool}, none of which the stack receives. */
  readonly providers: readonly string[];
  /** Layer the script's final value came from, or the stack itself. */
  readonly origin: string;
}

/**
 * Wrappers that fetch their argument on demand, so the tool they name needs no
 * pin. `npx vitest` is a download, not a dependency.
 */
const ON_DEMAND_RUNNERS: ReadonlySet<string> = new Set([
  "npx",
  "bunx",
  "pnpx",
  "dlx",
]);

/**
 * Package managers whose next word is a sibling script, not a tool. That
 * sibling is resolved and checked in its own right.
 */
const SCRIPT_DELEGATES: ReadonlySet<string> = new Set([
  "bun",
  "npm",
  "pnpm",
  "yarn",
]);

/** Shell metacharacters that end one command and begin another. */
const SEGMENT_BREAKS: ReadonlySet<string> = new Set(["&", "|", ";"]);

/** Placeholder host manifest — never Lisa's own, which resolves differently. */
const PROBE_MANIFEST: Readonly<Record<string, unknown>> = {
  name: "lisa-template-toolchain-probe",
  version: "0.0.0",
};

/** Running state of the quote-aware segment splitter. */
interface SplitState {
  readonly quote: string | null;
  readonly current: string;
  readonly segments: readonly string[];
}

/**
 * Split a script body into the individual commands a shell would run.
 * @remarks
 * Quote-aware, because `node -e "a; b"` is one command and not two. Any run of
 * `&`, `|` or `;` outside quotes separates; empty pieces are dropped, so `&&`
 * and `||` need no special case.
 * @param command - A `scripts` value
 * @returns The commands, in order
 */
function splitSegments(command: string): readonly string[] {
  const final = [...command].reduce<SplitState>(
    (state, char) => {
      if (state.quote !== null) {
        return {
          ...state,
          quote: char === state.quote ? null : state.quote,
          current: state.current + char,
        };
      }
      if (char === '"' || char === "'") {
        return { ...state, quote: char, current: state.current + char };
      }
      if (SEGMENT_BREAKS.has(char)) {
        return {
          quote: null,
          current: "",
          segments: [...state.segments, state.current],
        };
      }
      return { ...state, current: state.current + char };
    },
    { quote: null, current: "", segments: [] }
  );

  return [...final.segments, final.current]
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);
}

/**
 * The executable one command invokes, if it invokes a nameable one.
 * @remarks
 * Leading `VAR=value` assignments are stripped. On-demand runners and
 * package-manager script delegation yield nothing: neither names a tool that
 * has to be pinned.
 * @param segment - A single command
 * @param siblingScripts - Script names defined alongside this one
 * @returns The executable name, or null
 */
function executableOf(
  segment: string,
  siblingScripts: ReadonlySet<string>
): string | null {
  const words = segment.split(/\s+/u).filter(word => word.length > 0);
  const meaningful = words.filter(word => !/^[A-Za-z_]\w*=/u.test(word));
  const head = meaningful[0];
  if (head === undefined) return null;
  if (head === "lisa-test-run") {
    const separator = meaningful.indexOf("--");
    return separator >= 0
      ? executableOf(meaningful.slice(separator + 1).join(" "), siblingScripts)
      : null;
  }
  if (ON_DEMAND_RUNNERS.has(head)) return null;
  if (SCRIPT_DELEGATES.has(head)) {
    return delegatedTool(head, meaningful.slice(1), siblingScripts);
  }
  return head;
}

/**
 * The tool a package-manager delegation actually runs, if it is not a sibling
 * script.
 * @remarks
 * `bun run <name>` is not always script delegation. Bun's documented resolution
 * order falls through to `node_modules/.bin` when no script of that name
 * exists, so `bun run vitest` in a stack with no `vitest` script runs the
 * vitest BINARY — and treating every `bun` command as delegation let a missing
 * `vitest` dependency pass this check entirely. That is the shape this whole
 * suite exists to catch: a check that reports success while proving nothing.
 *
 * Deliberately `bun` only. `npm run <name>`, `pnpm run <name>` and
 * `yarn run <name>` fail when no such script exists rather than falling back to
 * a binary, so for those the next word really is always a sibling script and
 * treating it as a tool would invent violations.
 * @param delegate - The package manager that heads the segment
 * @param rest - The remaining words of the segment
 * @param siblingScripts - Script names defined alongside this one
 * @returns The binary name, or null when the word is a sibling script
 */
function delegatedTool(
  delegate: string,
  rest: readonly string[],
  siblingScripts: ReadonlySet<string>
): string | null {
  if (delegate !== "bun") return null;
  const [verb, ...after] = rest;
  if (verb !== "run") return null;
  // `bun run --silent vitest` — flags sit between the verb and the name.
  const name = after.find(word => !word.startsWith("-"));
  if (name === undefined) return null;
  return siblingScripts.has(name) ? null : name;
}

/**
 * Every executable a script body invokes.
 * @param command - A `scripts` value
 * @param siblingScripts - Script names defined alongside this one, so a
 * package-manager delegation can be told from a binary of the same shape
 * @returns Executable names, deduplicated, in first-seen order
 */
export function commandTools(
  command: string,
  siblingScripts: ReadonlySet<string> = new Set()
): readonly string[] {
  const named = splitSegments(command)
    .map(segment => executableOf(segment, siblingScripts))
    .filter((tool): tool is string => tool !== null);
  return [...new Set(named)];
}

/**
 * The binaries an installed package declares.
 * @remarks
 * Read from the package's own `bin` field where the package is installed, so
 * `tsc` maps to `typescript` and `ast-grep` to `@ast-grep/cli` without a
 * hand-written alias table — and so `@types/node`, which declares no binary,
 * is not mistaken for the provider of `node`. Where the package is not
 * installed the name is the only evidence available, and `@scope/name`
 * conventionally provides `name`.
 * @param pkg - Package name
 * @param nodeModulesDir - Directory installed packages live in
 * @returns Binary names the package provides
 */
function binariesOf(pkg: string, nodeModulesDir: string): readonly string[] {
  // Unconditional, and not merely a fallback: a type package ships no binary,
  // and letting `@types/node` name itself the provider of `node` would turn
  // every `node scripts/…` script in the tree into a violation the moment a
  // lockfile stopped hoisting it.
  if (pkg.startsWith("@types/")) return [];
  const manifestPath = path.join(nodeModulesDir, pkg, "package.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      readonly bin?: string | Record<string, string>;
      readonly directories?: { readonly bin?: string };
    };
    if (manifest.bin === undefined) {
      // npm exposes every file in `directories.bin` as an executable, so a
      // manifest that declares only that field still provides binaries.
      // Reading `bin` alone reported none, which let a child stack omit the
      // package and pass — the same false pass this check exists to prevent.
      return directoryBinaries(path.join(nodeModulesDir, pkg), manifest);
    }
    return typeof manifest.bin === "string" ? [pkg] : Object.keys(manifest.bin);
  }
  const tail = pkg.startsWith("@") ? (pkg.split("/")[1] ?? pkg) : pkg;
  return [...new Set([pkg, tail])];
}

/**
 * Binaries an installed package exposes through `directories.bin`.
 * @param packageDir - Where the package is installed
 * @param manifest - Its parsed manifest
 * @param manifest.directories - The manifest's `directories` field
 * @param manifest.directories.bin - Directory whose files npm exposes as binaries
 * @returns Every file name in the declared directory, or none
 */
function directoryBinaries(
  packageDir: string,
  manifest: { readonly directories?: { readonly bin?: string } }
): readonly string[] {
  const declared = manifest.directories?.bin;
  if (declared === undefined) return [];
  const binDir = path.join(packageDir, declared);
  if (!fs.existsSync(binDir)) return [];
  return fs
    .readdirSync(binDir, { withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => entry.name);
}

/**
 * Index every governed binary to the packages that provide it.
 * @param packages - Every package any stack receives
 * @param nodeModulesDir - Directory installed packages live in
 * @returns Binary name to providing packages
 */
function indexBinaries(
  packages: ReadonlySet<string>,
  nodeModulesDir: string
): ReadonlyMap<string, readonly string[]> {
  const pairs = [...packages].flatMap(pkg =>
    binariesOf(pkg, nodeModulesDir).map(bin => ({ bin, pkg }))
  );
  return new Map(
    [...new Set(pairs.map(pair => pair.bin))].map(bin => [
      bin,
      pairs.filter(pair => pair.bin === bin).map(pair => pair.pkg),
    ])
  );
}

/**
 * Resolve one stack's `package.json` exactly as `apply` would for a greenfield
 * project of that type.
 * @param lisaDir - Directory the template layers live in
 * @param type - Project type
 * @returns Its scripts and packages
 */
async function resolveStack(
  lisaDir: string,
  type: string
): Promise<ResolvedStack> {
  const planned = await new PackageLisaStrategy().planPackageJson(
    { ...PROBE_MANIFEST },
    [type as ProjectType],
    lisaDir
  );
  const section = (name: string): Record<string, string> =>
    (planned[name] ?? {}) as Record<string, string>;
  return {
    scripts: section("scripts"),
    packages: new Set([
      ...Object.keys(section("dependencies")),
      ...Object.keys(section("devDependencies")),
    ]),
  };
}

/**
 * A stack's ancestors, nearest parent first.
 * @param type - Project type
 * @param hierarchy - Parent map
 * @returns Ancestor types
 */
function ancestorsOf(
  type: string,
  hierarchy: Readonly<Record<string, string | undefined>>
): readonly string[] {
  const parent = hierarchy[type];
  return parent === undefined
    ? []
    : [parent, ...ancestorsOf(parent, hierarchy)];
}

/**
 * Which layer a stack's script value came from.
 * @param scriptKey - The `scripts` key
 * @param command - Its resolved value
 * @param stack - The receiving stack
 * @param ancestors - The stack's ancestors, nearest first
 * @param resolved - Every stack's resolution
 * @returns The nearest ancestor carrying the identical value, else the stack
 */
function originOf(
  scriptKey: string,
  command: string,
  stack: string,
  ancestors: readonly string[],
  resolved: ReadonlyMap<string, ResolvedStack>
): string {
  const inherited = ancestors.find(
    ancestor => resolved.get(ancestor)?.scripts[scriptKey] === command
  );
  return inherited ?? stack;
}

/** Optional inputs, all defaulted from `lisaDir`. */
export interface ToolchainCheckOptions {
  /** Project types to resolve; defaults to every type in the hierarchy. */
  readonly types?: readonly string[];
  /**
   * Where installed packages live; defaults to `<lisaDir>/node_modules`, which
   * must exist. Supply a path explicitly only for a fixture tree, whose
   * synthetic packages are named after the binaries they provide.
   */
  readonly nodeModulesDir?: string;
}

/**
 * Every shipped script that names a governed tool its stack is not given.
 * @param lisaDir - Directory the template layers live in
 * @param options - Overrides, for exercising the check against fixtures
 * @returns Violations, stack by stack
 */
export async function findToolchainViolations(
  lisaDir: string,
  options: ToolchainCheckOptions = {}
): Promise<readonly ToolchainViolation[]> {
  const types = options.types ?? Object.keys(PROJECT_TYPE_HIERARCHY);
  const nodeModulesDir =
    options.nodeModulesDir ?? path.join(lisaDir, "node_modules");
  if (options.nodeModulesDir === undefined && !fs.existsSync(nodeModulesDir)) {
    // Refuse rather than degrade. Without installed packages the binary map
    // falls back to guessing from names, which cannot see that
    // `@playwright/test` provides `playwright` — so a stack that is fine reads
    // as a violation, and a stack that is not can read as fine. An empty
    // result from a check that could not do its job is the failure mode this
    // whole class of defect is made of.
    throw new Error(
      `${nodeModulesDir} is missing; install dependencies before checking template toolchains`
    );
  }

  const resolved = new Map<string, ResolvedStack>(
    await Promise.all(
      types.map(
        async type =>
          [
            type,
            await resolveStack(lisaDir, type),
          ] as const satisfies readonly [string, ResolvedStack]
      )
    )
  );

  const governed = new Set(
    [...resolved.values()].flatMap(stack => [...stack.packages])
  );
  const binaries = indexBinaries(governed, nodeModulesDir);

  return types.flatMap(stack => violationsForStack(stack, resolved, binaries));
}

/**
 * Every violation one stack's resolved scripts carry.
 * @param stack - Project type
 * @param resolved - Every stack's resolution
 * @param binaries - Governed binary to providing packages
 * @returns Violations for this stack
 */
function violationsForStack(
  stack: string,
  resolved: ReadonlyMap<string, ResolvedStack>,
  binaries: ReadonlyMap<string, readonly string[]>
): readonly ToolchainViolation[] {
  const resolution = resolved.get(stack);
  if (resolution === undefined) return [];
  const ancestors = ancestorsOf(stack, PROJECT_TYPE_HIERARCHY);
  return Object.entries(resolution.scripts).flatMap(([scriptKey, command]) =>
    commandTools(command, new Set(Object.keys(resolution.scripts)))
      .filter(tool => isUnavailable(tool, resolution.packages, binaries))
      .map(tool => ({
        stack,
        scriptKey,
        command,
        tool,
        providers: binaries.get(tool) ?? [],
        origin: originOf(scriptKey, command, stack, ancestors, resolved),
      }))
  );
}

/**
 * Whether a tool is governed by some stack's pin yet absent from this one's.
 * @param tool - Executable name
 * @param packages - Packages the stack receives
 * @param binaries - Governed binary to providing packages
 * @returns True when the stack cannot run the tool
 */
function isUnavailable(
  tool: string,
  packages: ReadonlySet<string>,
  binaries: ReadonlyMap<string, readonly string[]>
): boolean {
  const providers = binaries.get(tool) ?? [];
  return (
    providers.length > 0 && !providers.some(provider => packages.has(provider))
  );
}

/**
 * One violation as a single operator-readable line.
 * @param violation - The violation
 * @returns A line naming the stack, the script key, and the missing tool
 */
export function formatViolation(violation: ToolchainViolation): string {
  const source =
    violation.origin === violation.stack
      ? "pinned by the stack itself"
      : `inherited from ${violation.origin}`;
  return `${violation.stack}: script "${violation.scriptKey}" runs \`${violation.tool}\` (${source}) but ${violation.stack} is given none of: ${violation.providers.join(", ")}`;
}
