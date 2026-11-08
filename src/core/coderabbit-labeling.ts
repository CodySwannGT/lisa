/**
 * Which labels CodeRabbit's issue enrichment must never apply by itself, and
 * whether a parsed CodeRabbit config lets it.
 *
 * CodeRabbit can label issues on its own (`issue_enrichment.labeling.
 * auto_apply_labels`). With no `labeling_instructions` allowlist it may apply
 * any label the repository has, which includes the labels Lisa's lifecycle
 * runs on. Lisa learned this in its own repository twice: the bot stamped
 * `status:done` on fresh issues (CodySwannGT/lisa#2589), and later overwrote
 * the `type:` and `points:` labels its issue writer sets (CodySwannGT/lisa#4617).
 * Lisa had already shipped hosts the opposite configuration, and a downstream
 * host watched the bot put `status:ready` back onto claimed issues within
 * minutes of each claim (CodySwannGT/lisa#4633).
 *
 * The protected families are defined once here so the guard on Lisa's own
 * `.coderabbit.yml` (its unit test) and the `lisa doctor` check that reads a
 * host's copy cannot drift apart.
 * @module core/coderabbit-labeling
 */
import { isJsonObject } from "../sync/json-path.js";
import { BUILD_LABEL_DEFAULTS } from "../sync/lifecycle-defaults.js";

/**
 * The lifecycle family. Matched by prefix, as the build intake does, so a
 * lifecycle label a project renamed inside the family is still covered.
 */
export const LIFECYCLE_LABEL_PREFIX = "status:";

/** Families Lisa's issue writer sets itself; a bot's guess only conflicts. */
export const WRITER_OWNED_LABEL_PREFIXES: readonly string[] = [
  "type:",
  "points:",
];

/** Every prefix a bot must never apply. */
export const PROTECTED_LABEL_PREFIXES: readonly string[] = [
  LIFECYCLE_LABEL_PREFIX,
  ...WRITER_OWNED_LABEL_PREFIXES,
];

/** Roles a bot must never decide, beyond the protected prefixes. */
export const DEFAULT_HUMAN_ONLY_LABELS: readonly string[] = [
  BUILD_LABEL_DEFAULTS.human_needed,
];

/**
 * sha256 of every `.coderabbit.yml` Lisa ever shipped into hosts. Only one
 * version existed: `all/copy-overwrite/.coderabbit.yml`, added at `41e69a0261`
 * (2026-02-11) and removed at `575a3fa7ee` (2026-03-01) unchanged.
 */
export const SHIPPED_CODERABBIT_CONFIG_DIGESTS: ReadonlySet<string> = new Set([
  "e7212aa8c14aefecaf98d641a3464764a4ce3c871d73a403e6cc9f6d7da77fba",
]);

/** What a CodeRabbit config allows the bot to do with labels. */
export type CoderabbitLabelingVerdict =
  | { readonly safe: true; readonly reason: "auto-apply-off" | "allowlisted" }
  | { readonly safe: false; readonly reason: "no-allowlist" }
  | {
      readonly safe: false;
      readonly reason: "undeterminable";
      readonly value: unknown;
    }
  | {
      readonly safe: false;
      readonly reason: "protected-labels";
      readonly offending: readonly string[];
    };

/**
 * Whether one label is one a bot must never apply.
 *
 * Case-insensitive, because GitHub matches label names that way: `Type:Bug`
 * still lands as `type:Bug`.
 * @param label - Label as the config spells it
 * @param humanOnly - Exact labels reserved for humans
 * @returns True when the label is protected
 */
export function isProtectedLabel(
  label: string,
  humanOnly: readonly string[] = DEFAULT_HUMAN_ONLY_LABELS
): boolean {
  const lower = label.trim().toLowerCase();
  return (
    PROTECTED_LABEL_PREFIXES.some(prefix => lower.startsWith(prefix)) ||
    humanOnly.some(name => name.toLowerCase() === lower)
  );
}

/**
 * The `issue_enrichment.labeling` block of a parsed config, when it is one.
 * @param config - Parsed CodeRabbit config
 * @returns The labeling block, or an empty object
 */
function labelingBlock(config: unknown): Record<string, unknown> {
  const enrichment = isJsonObject(config)
    ? config["issue_enrichment"]
    : undefined;
  const labeling = isJsonObject(enrichment)
    ? enrichment["labeling"]
    : undefined;
  return isJsonObject(labeling) ? labeling : {};
}

/**
 * The labels a config's allowlist names. Entries with no string label name
 * nothing, so they cannot make an allowlist non-empty.
 * @param instructions - The raw `labeling_instructions` value
 * @returns Allowlisted labels
 */
function allowlistedLabels(instructions: unknown): readonly string[] {
  if (!Array.isArray(instructions)) return [];
  return instructions
    .map(entry => (isJsonObject(entry) ? entry["label"] : undefined))
    .filter(
      (label): label is string =>
        typeof label === "string" && label.trim() !== ""
    );
}

/**
 * Decide whether a parsed CodeRabbit config can make the bot write a
 * protected label.
 *
 * CodeRabbit's own default for `auto_apply_labels` is off, so a config that
 * never mentions it is safe, and so is an explicit `false`. Any value that is
 * not a boolean is `undeterminable`, never safe.
 * @param config - Parsed CodeRabbit config (any shape)
 * @param humanOnly - Exact labels reserved for humans
 * @returns The verdict, naming offending labels as the config spells them
 */
export function evaluateCoderabbitLabeling(
  config: unknown,
  humanOnly: readonly string[] = DEFAULT_HUMAN_ONLY_LABELS
): CoderabbitLabelingVerdict {
  const labeling = labelingBlock(config);
  const autoApply = labeling["auto_apply_labels"];
  if (autoApply === undefined || autoApply === false) {
    return { safe: true, reason: "auto-apply-off" };
  }
  // A quoted "true", a number, or a bare `auto_apply_labels:` (null) is not
  // something this check can read as off. How CodeRabbit coerces it is not
  // visible here, so it must not pass as safe.
  if (autoApply !== true) {
    return { safe: false, reason: "undeterminable", value: autoApply };
  }
  const allowed = allowlistedLabels(labeling["labeling_instructions"]);
  if (allowed.length === 0) return { safe: false, reason: "no-allowlist" };
  const offending = allowed.filter(label => isProtectedLabel(label, humanOnly));
  return offending.length === 0
    ? { safe: true, reason: "allowlisted" }
    : { safe: false, reason: "protected-labels", offending };
}
