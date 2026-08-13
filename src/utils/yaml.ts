/**
 * The single js-yaml entry point for all of Lisa.
 *
 * Why this exists rather than `import yaml from "js-yaml"` at each call site:
 * Lisa is `"type": "module"`, so a default import compiles to a real ESM
 * default import. js-yaml 5.x ships an ESM build that exports `load`/`dump`
 * as *named* exports and no `default`, so the default import is a link-time
 * `SyntaxError: The requested module 'js-yaml' does not provide an export
 * named 'default'`. That error fires while the module graph is being
 * instantiated — before any Lisa code runs — so the whole CLI is dead,
 * including `lisa doctor`. Lisa declares js-yaml `^4.3.1` for itself, but a
 * host project's `overrides`/`resolutions` collapse Lisa's nested copy onto
 * whatever the host pinned, which is exactly how geminisportsai/frontend-v2
 * ended up running Lisa against js-yaml 5 (CodySwannGT/lisa#2467).
 *
 * A namespace import links against any module shape, so the incompatibility
 * becomes a *runtime* condition this module can inspect and report in plain
 * language instead of a link-time crash with a stack trace.
 *
 * Compatibility is deliberately shape-based, not version-based: js-yaml 3, 4
 * and 5 all expose a `load(source)` that Lisa uses identically, and Lisa uses
 * nothing else from the package. Anything exposing that function works; a
 * future major that renames it fails with a message naming the problem.
 * @module utils/yaml
 */
import * as jsYaml from "js-yaml";
import { LisaError } from "../errors/index.js";

/** The only js-yaml surface Lisa consumes. */
export interface YamlApi {
  /**
   * Parse a single YAML document.
   * @param source - YAML text
   * @returns The parsed document
   */
  readonly load: (source: string) => unknown;
}

/** Human-readable statement of what Lisa can drive. */
export const SUPPORTED_JS_YAML_DESCRIPTION =
  "js-yaml 3.x, 4.x and 5.x (any build exposing a load() function)";

/**
 * Raised when the resolved js-yaml cannot be driven by Lisa.
 *
 * Carries the remediation inline: the operator reading this in a postinstall
 * warning has no other context to work from.
 */
export class IncompatibleYamlError extends LisaError {
  /**
   * Build the operator-facing incompatibility message.
   * @param shape - Short description of what the resolved module did expose
   */
  constructor(shape: string) {
    super(
      "Lisa cannot use the installed js-yaml: the resolved package exposes no " +
        `load() function (${shape}). Lisa supports ${SUPPORTED_JS_YAML_DESCRIPTION}. ` +
        "This usually means a js-yaml pin, override, or resolution in your " +
        "package.json forced Lisa onto an incompatible copy. Remove or widen " +
        "that js-yaml entry, reinstall, and re-run `lisa doctor`.",
      "INCOMPATIBLE_JS_YAML"
    );
    this.name = "IncompatibleYamlError";
  }
}

/**
 * Pull a callable `load` off a candidate object.
 * @param candidate - Namespace object, interop default, or anything else
 * @returns The `load` function when present and callable
 */
function pickLoad(candidate: unknown): YamlApi["load"] | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  const { load } = candidate as { readonly load?: unknown };
  return typeof load === "function" ? (load as YamlApi["load"]) : undefined;
}

/**
 * Describe what a resolved module actually exposed, for the failure message.
 * @param moduleNamespace - The resolved js-yaml module namespace
 * @returns A short, bounded description of its exports
 */
function describeShape(moduleNamespace: unknown): string {
  if (typeof moduleNamespace !== "object" || moduleNamespace === null) {
    return `resolved to ${typeof moduleNamespace}`;
  }
  const keys = Object.keys(moduleNamespace);
  return keys.length === 0
    ? "no exports"
    : `exports: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}`;
}

/**
 * Resolve Lisa's YAML surface from a js-yaml module namespace, tolerating both
 * the named-export shape (3.x/4.x/5.x ESM) and the CJS interop shape where the
 * whole module hangs off `default`.
 *
 * Exported so `lisa doctor` can probe compatibility without parsing anything,
 * and so the failure path is directly testable.
 * @param moduleNamespace - The resolved js-yaml module namespace
 * @returns The YAML surface Lisa uses
 * @throws IncompatibleYamlError when no callable `load` can be found
 */
export function resolveYamlApi(moduleNamespace: unknown): YamlApi {
  const named = pickLoad(moduleNamespace);
  if (named) {
    return { load: named };
  }
  const interop = pickLoad(
    (moduleNamespace as { readonly default?: unknown } | null)?.default
  );
  if (interop) {
    return { load: interop };
  }
  throw new IncompatibleYamlError(describeShape(moduleNamespace));
}

/**
 * Parse a single YAML document using whichever js-yaml the install resolved.
 * @param source - YAML text
 * @returns The parsed document
 * @throws IncompatibleYamlError when the resolved js-yaml is unusable
 */
export function loadYaml(source: string): unknown {
  return resolveYamlApi(jsYaml).load(source);
}

/**
 * Probe the js-yaml this process actually resolved.
 *
 * Never throws: `lisa doctor` turns the result into a check line, and a doctor
 * that crashed on the very incompatibility it is meant to report would be the
 * silent-failure bug all over again.
 * @returns The incompatibility message, or null when the resolved js-yaml works
 */
export function probeYamlRuntime(): string | null {
  try {
    resolveYamlApi(jsYaml);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
