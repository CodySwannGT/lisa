/**
 * Module resolution knip 6 does not do on its own, for hosts that need it in a
 * `knip.ts` (CodySwannGT/lisa#4932).
 *
 * Knip 5 resolved imports through TypeScript, so it followed two tsconfig
 * settings Lisa's Expo stack depends on. Knip 6 resolves through
 * oxc-resolver, which follows neither, and no `knip.json` key can add them:
 *
 * - `moduleSuffixes` — `import "./Picker"` loads `Picker.native.tsx` or
 *   `Picker.web.tsx`. Knip reports every such import as unresolved. Knip
 *   widens its resolver's extensions only for configured compilers, so
 *   {@link platformSuffixCompilers} declares a pass-through compiler for each
 *   suffix-and-extension pair. The files are ordinary TypeScript; the compiler
 *   returns them unchanged and exists only to make the extension resolvable.
 *   Upstream: knip defers this to oxc-resolver (oxc-project/oxc-resolver#1401).
 * - `baseUrl` in a file the tsconfig excludes — TypeScript resolves a bare
 *   specifier such as `import "tailwind.config"` against `baseUrl` in every
 *   file of the program. Knip does not for files the tsconfig excludes, and
 *   Lisa's Expo `tsconfig.local.json` excludes `src/components/ui`, where
 *   generated gluestack UI imports `tailwind.config`; knip then reports it as
 *   an unlisted dependency. {@link tsconfigPathAliases} hands knip `baseUrl`
 *   as a final `*` alias, after the tsconfig's own aliases so `@/…` still
 *   wins first, the order TypeScript uses.
 *
 * Both read the host's resolved tsconfig, so they follow whatever the host and
 * Lisa's stack tsconfig declare instead of a second copy of either list.
 * @module configs/knip
 */
import path from "node:path";
import ts from "typescript";

/** Where to read the host's TypeScript settings from. */
export interface KnipResolutionOptions {
  /** Host directory knip runs in. Defaults to the current directory. */
  readonly cwd?: string;
  /** The tsconfig to resolve, relative to `cwd`. Defaults to `tsconfig.json`. */
  readonly tsconfig?: string;
}

/** A knip compiler: source text in, source text out. */
export type KnipCompiler = (source: string) => string;

/** Source extensions a platform file can carry. */
const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

/**
 * The host's compiler options, with `extends` followed the way `tsc` follows it.
 * @param options - Where the tsconfig lives
 * @returns The parsed options and the directory they resolve against
 */
function hostCompilerOptions(options: KnipResolutionOptions): {
  readonly compilerOptions: ts.CompilerOptions;
  readonly cwd: string;
} {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const file = path.resolve(cwd, options.tsconfig ?? "tsconfig.json");
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error !== undefined)
    throw new Error(
      `cannot read ${file}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`
    );
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(file),
    undefined,
    file
  );
  return { compilerOptions: parsed.options, cwd };
}

/**
 * Pass-through knip compilers that make every `moduleSuffixes` platform file
 * resolvable, e.g. `native.tsx` for `Picker.native.tsx`.
 * @param options - Where the host's tsconfig lives
 * @returns Knip `compilers`, keyed by suffixed extension
 */
export function platformSuffixCompilers(
  options: KnipResolutionOptions = {}
): Record<string, KnipCompiler> {
  const suffixes = (
    hostCompilerOptions(options).compilerOptions.moduleSuffixes ?? []
  ).filter(suffix => suffix !== "");
  const passThrough: KnipCompiler = source => source;
  return Object.fromEntries(
    suffixes.flatMap(suffix =>
      SOURCE_EXTENSIONS.map(extension => [
        `${suffix.replace(/^\./u, "")}.${extension}`,
        passThrough,
      ])
    )
  );
}

/**
 * The host's tsconfig `paths` plus `baseUrl` as a final `*`, rewritten relative
 * to the knip directory so knip applies them to every file, including ones the
 * tsconfig excludes.
 * @param options - Where the host's tsconfig lives
 * @returns Knip `paths`
 */
export function tsconfigPathAliases(
  options: KnipResolutionOptions = {}
): Record<string, string[]> {
  const { compilerOptions, cwd } = hostCompilerOptions(options);
  const base =
    compilerOptions.baseUrl ??
    (compilerOptions as { pathsBasePath?: string }).pathsBasePath ??
    cwd;
  const relative = (target: string): string => {
    const resolved = path.relative(cwd, path.resolve(base, target));
    if (resolved === "") return ".";
    return resolved.startsWith(".") ? resolved : `./${resolved}`;
  };
  const aliases = Object.entries(compilerOptions.paths ?? {}).map(
    ([alias, targets]): [string, string[]] => [alias, targets.map(relative)]
  );
  // TypeScript resolves a bare specifier against `baseUrl` once no alias
  // matches, then falls back to node_modules; knip does the same with `*`.
  const fromBaseUrl: [string, string[]][] =
    compilerOptions.baseUrl === undefined ||
    "*" in (compilerOptions.paths ?? {})
      ? []
      : [["*", [`${relative(compilerOptions.baseUrl)}/*`]]];
  return Object.fromEntries([...aliases, ...fromBaseUrl]);
}

/**
 * Everything an Expo host's `knip.ts` spreads in to resolve like TypeScript.
 * @param options - Where the host's tsconfig lives
 * @returns Knip `compilers` and `paths`
 */
export function expoKnipResolution(options: KnipResolutionOptions = {}): {
  readonly compilers: Record<string, KnipCompiler>;
  readonly paths: Record<string, string[]>;
} {
  return {
    compilers: platformSuffixCompilers(options),
    paths: tsconfigPathAliases(options),
  };
}
