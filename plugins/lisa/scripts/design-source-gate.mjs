#!/usr/bin/env node
/**
 * Deterministic, fail-closed gate for the `design-source-of-truth` contract.
 *
 * Figma is the design source of truth. Every other Lisa design obligation is
 * conditioned on a design artifact already existing — ticket gate S12 fires only
 * `when artifacts_attached = true` — so UI invented straight into code was
 * governed by nothing at all. This gate governs that case, and only that case:
 * every UI surface a change touches must declare where its design came from,
 * in exactly one of two forms.
 *
 * ```
 * // DESIGN-SOURCE: https://www.figma.com/design/<file>?node-id=<node>
 * // DESIGN-SOURCE: none — not in Figma
 * ```
 *
 * The first says the surface is backed by a design node (it already existed, or
 * it was synced back). The second says the surface is deliberately not captured
 * at the source; it is the exception, not the default, and the gate reports
 * every one of them so review can challenge it.
 *
 * **The gate fails closed.** Anything it cannot resolve into one of those two
 * declarations is a violation: no annotation, a malformed one, a file that both
 * cites Figma and denies having a source, a changed file it could not read, or
 * a diff it could not compute. A gate that returns PASS when it could not look
 * proves nothing, so it never does.
 *
 * What this module deliberately does NOT decide is *what to build*. Host
 * design-system rules (`figma-design-system`, `design-system`,
 * `use-the-design-library`) own component hierarchy, token vocabulary, and
 * reuse; several are generated from a ratified RFC. This gate stays orthogonal
 * to all of it — it asks only whether the design source is declared.
 *
 * Run it: `node design-source-gate.mjs --base=origin/main [--head=HEAD] [--json]`
 * Exit 0 = PASS, 1 = FAIL (any violation, or anything unresolvable), 2 = usage.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Hang-detector deadline for a child of this script, in milliseconds.
 *
 * Written inline rather than imported. The shared `bounded-child.mjs` lives in
 * the `skills/` tree because the built Codex artifact copies `skills/` and
 * nothing else — and these plugin-ROOT scripts are not in that artifact at all,
 * so reaching across into `../skills/` would invent a dependency between two
 * halves of the plugin for no gain.
 *
 * A ceiling, not a budget: `git` through PATH on macOS goes via Apple's `xcrun`
 * shim, measured over 20s under load (CodySwannGT/lisa#2887).
 */
const CHILD_BUDGET_MS = 30_000;

/** The one designated marker for UI deliberately not captured in Figma. */
export const DESIGN_SOURCE_NONE_MARKER = "DESIGN-SOURCE: none — not in Figma";

/** The annotation keyword, in whatever comment syntax the file uses. */
const ANNOTATION = /DESIGN-SOURCE:[ \t]*(?<value>[^\n]*)/gu;

/**
 * The none-form, plus an optional trailing reason. The reason is optional so
 * the marker's documented spelling stays exactly what the rule prints, but a
 * reasonless marker is reported for sync-back when Figma access is proven.
 */
const NONE_FORM =
  /^none[ \t]*(?:—|--|–)[ \t]*not in Figma(?:[ \t]*(?:—|--|–)[ \t]*(?<reason>.+?))?[ \t]*(?:-->|\*\/|\*|#)?[ \t]*$/u;

/** Only a Figma URL seals a surface. Any other link is malformed, not proof. */
const FIGMA_URL = /^https:\/\/(?:[\w-]+\.)*figma\.com\/[^\s)]+$/u;

/** Extensions that are a UI surface wherever they live. */
const UI_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte"];

/**
 * Markup and style extensions that are a UI surface only inside a directory
 * that renders. A `.ts` barrel or a pure-logic module under `components/`
 * renders nothing, so extension-plus-directory keeps the gate off code that has
 * no design to declare.
 */
const UI_MARKUP_EXTENSIONS = [
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".html",
  ".erb",
  ".haml",
  ".slim",
  ".swift",
  ".kt",
  ".dart",
  ".xml",
];

/** Directory names that mark a rendering surface. */
const UI_DIRECTORIES = [
  "components",
  "screens",
  "views",
  "pages",
  "ui",
  "widgets",
  "layouts",
  "templates",
  "atoms",
  "molecules",
  "organisms",
];

/** Never a UI surface: generated output, vendored code, and test scaffolding. */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".next/**",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/__tests__/**",
  "**/__snapshots__/**",
];

/** Change types that carry no head content to annotate. */
const REMOVED_CHANGE_TYPES = new Set(["deleted", "D", "removed"]);

/**
 * Translate a `**`/`*` glob into an anchored regular expression. Deliberately
 * tiny: the gate must run from a plugin directory with no dependency install,
 * so pulling in a glob library is not an option.
 *
 * @param {string} pattern Glob pattern, `/`-separated.
 * @returns {RegExp} Anchored matcher for a repo-relative path.
 */
function globToRegExp(pattern) {
  // Scanned in one pass rather than chained replacements: a second pass would
  // re-expand the `*` inside a `.*` it had just emitted, which silently turns
  // `**/node_modules/**` into a pattern that matches nothing.
  let body = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      const slashed = pattern[index + 2] === "/";
      body += slashed ? "(?:[^/]*/)*" : ".*";
      index += slashed ? 3 : 2;
      continue;
    }
    if (char === "*") {
      body += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      body += "[^/]";
      index += 1;
      continue;
    }
    body += ".+^${}()|[]\\".includes(char) ? `\\${char}` : char;
    index += 1;
  }

  return new RegExp(`^${body}$`, "u");
}

/**
 * @param {string} relPath Repo-relative path.
 * @param {readonly string[]} patterns Glob patterns to test.
 * @returns {boolean} True when any pattern matches.
 */
function matchesAny(relPath, patterns) {
  return patterns.some(pattern => globToRegExp(pattern).test(relPath));
}

/**
 * @param {string} relPath Repo-relative path.
 * @returns {string} Lowercased extension including the dot, or "".
 */
function extensionOf(relPath) {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/**
 * Decide whether a path is a UI surface — something a user can observe.
 *
 * Membership is surface, not repo name or file extension alone: an extension
 * that always renders counts anywhere, while markup and styles count inside a
 * rendering directory. Projects narrow or widen this through
 * `designSource.include` / `designSource.exclude` in `.lisa.config.json`.
 *
 * @param {string} relPath Repo-relative path of the changed file.
 * @param {{ include?: readonly string[], exclude?: readonly string[] } | undefined} [config] Project overrides.
 * @returns {boolean} True when the path is a UI surface.
 */
export function isUiSurface(relPath, config) {
  if (typeof relPath !== "string" || relPath.length === 0) return false;

  const normalized = relPath.replaceAll("\\", "/");
  const exclude = [...DEFAULT_EXCLUDES, ...(config?.exclude ?? [])];
  if (matchesAny(normalized, exclude)) return false;

  const include = config?.include ?? [];
  if (include.length > 0 && matchesAny(normalized, include)) return true;

  const extension = extensionOf(normalized);
  if (UI_EXTENSIONS.includes(extension)) return true;

  if (!UI_MARKUP_EXTENSIONS.includes(extension)) return false;
  const segments = normalized.split("/").slice(0, -1);
  return segments.some(segment =>
    UI_DIRECTORIES.includes(segment.toLowerCase())
  );
}

/**
 * Strip a trailing comment terminator so a marker written in block or markup
 * comment syntax yields the same reason as a line comment would.
 *
 * @param {string} value Raw annotation value.
 * @returns {string} Value with any trailing comment close removed.
 */
function stripCommentClose(value) {
  return value.replace(/[ \t]*(?:-->|\*\/|\*\}|\}\)?|#>)[ \t]*$/u, "").trim();
}

/**
 * Read every design-source annotation out of a file body.
 *
 * @param {string} content File body at the head of the change.
 * @returns {{ figma: string[], none: { reason: string | null }[], malformed: string[] }} Parsed annotations.
 */
function parseAnnotations(content) {
  const figma = [];
  const none = [];
  const malformed = [];

  for (const match of content.matchAll(ANNOTATION)) {
    const value = stripCommentClose(match.groups?.value ?? "");
    const noneMatch = NONE_FORM.exec(value);
    if (noneMatch) {
      none.push({ reason: noneMatch.groups?.reason?.trim() || null });
      continue;
    }
    if (FIGMA_URL.test(value)) {
      figma.push(value);
      continue;
    }
    malformed.push(value);
  }

  return { figma, none, malformed };
}

/**
 * Classify one changed file against the contract.
 *
 * Statuses: `figma-source` (sealed), `marked-exception` (declared exception),
 * `not-applicable` (not a UI surface, or a deletion), and the four failing
 * states `undeclared`, `malformed`, `conflicting`, and `unreadable`.
 *
 * @param {{ path: string, changeType?: string, content?: string | null }} file Changed-file record.
 * @param {{ include?: readonly string[], exclude?: readonly string[] } | undefined} [config] Project overrides.
 * @returns {{ path: string, uiSurface: boolean, status: string, evidence: string | null, reason: string | null }} Classification.
 */
export function classifyDesignSource(file, config) {
  const relPath = file?.path ?? "";
  const notApplicable = {
    path: relPath,
    uiSurface: false,
    status: "not-applicable",
    evidence: null,
    reason: null,
  };

  if (REMOVED_CHANGE_TYPES.has(file?.changeType ?? "")) return notApplicable;
  if (!isUiSurface(relPath, config)) return notApplicable;

  const base = { path: relPath, uiSurface: true, evidence: null, reason: null };

  if (typeof file?.content !== "string") {
    return { ...base, status: "unreadable" };
  }

  const { figma, none, malformed } = parseAnnotations(file.content);

  if (figma.length > 0 && none.length > 0) {
    return { ...base, status: "conflicting", evidence: figma[0] };
  }
  if (malformed.length > 0) {
    return { ...base, status: "malformed", evidence: malformed[0] };
  }
  if (figma.length > 0) {
    return { ...base, status: "figma-source", evidence: figma[0] };
  }
  if (none.length > 0) {
    return {
      ...base,
      status: "marked-exception",
      evidence: DESIGN_SOURCE_NONE_MARKER,
      reason: none[0]?.reason ?? null,
    };
  }
  return { ...base, status: "undeclared" };
}

/**
 * Per-file statuses that fail the gate.
 *
 * Exported so the suite can pin the set itself, not just its members' behavior.
 * Classifying a file `unreadable` is not a guard; *failing the change* because
 * of it is. Issue #2492 measured the difference: with only classification
 * asserted, deleting `conflicting` or `unreadable` from this list flipped the
 * verdict to PASS with the whole suite still green. The pinning test now fails
 * on any edit to this set — a removal and an addition alike.
 */
export const VIOLATION_STATUSES = new Set([
  "undeclared",
  "malformed",
  "conflicting",
  "unreadable",
]);

/**
 * Evaluate a whole change.
 *
 * Only the files this change touched are judged — a repo full of unannotated
 * legacy UI is burndown, not this work item's blocker. But the gate refuses to
 * pass on ignorance: an unresolved file list or a reported diff error is a FAIL
 * with a named reason, never a quiet PASS.
 *
 * @param {{
 *   files?: readonly { path: string, changeType?: string, content?: string | null }[] | null,
 *   diffError?: string | null,
 *   figmaAccess?: boolean,
 *   config?: { include?: readonly string[], exclude?: readonly string[] }
 * }} input Change under evaluation.
 * @returns {{
 *   verdict: "PASS" | "FAIL",
 *   reasons: string[],
 *   violations: object[],
 *   exceptions: object[],
 *   syncBackPreferred: object[],
 *   sealed: object[],
 *   notApplicable: object[],
 *   summary: { judged: number, sealed: number, exceptions: number, violations: number }
 * }} The gate result.
 */
export function evaluateDesignSource(input = {}) {
  const reasons = [];
  const files = Array.isArray(input.files) ? input.files : null;

  if (files === null) reasons.push("changed-files-unresolved");
  if (
    typeof input.diffError === "string" &&
    input.diffError.trim().length > 0
  ) {
    reasons.push("diff-unresolved");
  }

  const classified = (files ?? []).map(file =>
    classifyDesignSource(file, input.config)
  );

  const sealed = classified.filter(entry => entry.status === "figma-source");
  const exceptions = classified.filter(
    entry => entry.status === "marked-exception"
  );
  const violations = classified.filter(entry =>
    VIOLATION_STATUSES.has(entry.status)
  );
  const notApplicable = classified.filter(
    entry => entry.status === "not-applicable"
  );

  // Sync-back is the preference, not a second blocking gate: when Figma access
  // is proven, an exception that records no reason is surfaced so review can
  // ask why it was not captured at the source instead.
  const syncBackPreferred =
    input.figmaAccess === true
      ? exceptions.filter(entry => entry.reason === null)
      : [];

  for (const entry of violations) reasons.push(`${entry.status}:${entry.path}`);

  return {
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    violations,
    exceptions,
    syncBackPreferred,
    sealed,
    notApplicable,
    summary: {
      judged: sealed.length + exceptions.length + violations.length,
      sealed: sealed.length,
      exceptions: exceptions.length,
      violations: violations.length,
    },
  };
}

/**
 * Collect the changed files of a git range, reading each one at the head.
 *
 * @param {string} base Base revision.
 * @param {string} head Head revision.
 * @returns {{ files: object[] | null, diffError: string | null }} Changed files, or the failure.
 */
export function collectChangedFiles(base, head) {
  let output = "";
  try {
    output = execFileSync(
      "git",
      ["diff", "--name-status", "--no-renames", `${base}...${head}`],
      { encoding: "utf8", killSignal: "SIGKILL", timeout: CHILD_BUDGET_MS }
    );
  } catch (error) {
    // KEPT for a timeout too, deliberately: `files: null` already pushes
    // `changed-files-unresolved` into the reasons and `diffError` carries the
    // message, which for a kill names ETIMEDOUT. Already fail-closed and
    // already speaking; re-raising would trade a good report for a crash.
    return { files: null, diffError: String(error?.message ?? error) };
  }

  const files = output
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => {
      const [rawStatus, relPath] = line.split("\t");
      const changeType = rawStatus?.startsWith("D") ? "deleted" : "modified";
      if (changeType === "deleted") {
        return { path: relPath ?? "", changeType, content: null };
      }
      let content = null;
      try {
        content = readFileSync(relPath ?? "", "utf8");
      } catch {
        content = null;
      }
      return { path: relPath ?? "", changeType, content };
    });

  return { files, diffError: null };
}

/**
 * Read the optional `designSource` block from `.lisa.config.json`.
 *
 * @returns {{ include?: string[], exclude?: string[] }} Project overrides, or {}.
 */
function readProjectConfig() {
  try {
    const raw = JSON.parse(readFileSync(".lisa.config.json", "utf8"));
    return raw?.designSource ?? {};
  } catch {
    return {};
  }
}

/**
 * Render the operator-readable report. Written for the non-technical operator
 * standing at the gate, so it names the file and the exact next action.
 *
 * @param {ReturnType<typeof evaluateDesignSource>} result Gate result.
 * @returns {string} Report text.
 */
export function renderReport(result) {
  const lines = [`design-source gate: ${result.verdict}`];

  if (result.verdict === "PASS") {
    lines.push(
      `  ${result.summary.sealed} surface(s) backed by Figma, ${result.summary.exceptions} explicitly marked as not in Figma.`
    );
  }

  for (const entry of result.violations) {
    lines.push(`  ✗ ${entry.path} — ${entry.status}`);
  }
  if (result.violations.length > 0) {
    lines.push(
      "",
      "  Each file above changes something a user can see but does not say where its design came from.",
      "  Fix it one of two ways, sync-back first:",
      "    1. Reflect the surface in Figma, then annotate it: `DESIGN-SOURCE: <figma-url>`",
      `    2. If it genuinely is not captured at the source, annotate: \`${DESIGN_SOURCE_NONE_MARKER}\``
    );
  }
  if (result.reasons.includes("changed-files-unresolved")) {
    lines.push("  ✗ the set of changed files could not be resolved");
  }
  if (result.reasons.includes("diff-unresolved")) {
    lines.push(
      "  ✗ the diff could not be computed — the gate cannot pass on a change it could not read"
    );
  }
  for (const entry of result.syncBackPreferred) {
    lines.push(
      `  ! ${entry.path} — marked as not in Figma with no reason recorded, and Figma access is available. Prefer syncing it back.`
    );
  }

  return lines.join("\n");
}

/**
 * CLI entrypoint.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {number} Process exit code.
 */
export function runCli(argv) {
  const args = new Map(
    argv
      .filter(arg => arg.startsWith("--"))
      .map(arg => {
        const eq = arg.indexOf("=");
        return eq === -1
          ? [arg.slice(2), "true"]
          : [arg.slice(2, eq), arg.slice(eq + 1)];
      })
  );

  const base = args.get("base");
  if (!base) {
    process.stderr.write(
      "usage: design-source-gate.mjs --base=<ref> [--head=<ref>] [--figma-access] [--json]\n"
    );
    return 2;
  }

  const { files, diffError } = collectChangedFiles(
    base,
    args.get("head") ?? "HEAD"
  );
  const result = evaluateDesignSource({
    files,
    diffError,
    figmaAccess: args.get("figma-access") === "true",
    config: readProjectConfig(),
  });

  process.stdout.write(
    args.get("json") === "true"
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderReport(result)}\n`
  );
  return result.verdict === "PASS" ? 0 : 1;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * The previous spelling tested whether `process.argv[1]` ENDED WITH this
 * module's basename, which is looser still than the `file://` comparison the
 * sibling modules used: any path ending in `design-source-gate.mjs` satisfied
 * it, including a different copy of this file in another checkout, and a
 * rename silently turned the guard off with nothing to notice.
 *
 * Both sides are realpath'd instead. Reached through a symlinked checkout, a
 * git worktree, or a `/tmp` path on macOS the naive comparisons disagree, the
 * body never runs, and the process exits 0 having done nothing — and every
 * Lisa-driven agent runs in a worktree, so that is the routine path.
 *
 * Written out rather than imported: this ships inside a plugin payload, which
 * has no `./lib/` to resolve against. Same rule and reasoning as
 * `scripts/lib/invoked-as-script.mjs`.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exit(runCli(process.argv.slice(2)));
}
