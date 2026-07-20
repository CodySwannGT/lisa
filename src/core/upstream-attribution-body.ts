/** Allowlist-only body builder for public upstream Lisa attribution filings. */

/** Lisa-owned excerpt that is safe to quote in the public upstream issue. */
export type UpstreamAttributionExcerpt = {
  readonly surface: string;
  readonly text: string;
};

/** Typed allowlist accepted by the public upstream attribution body builder. */
export type UpstreamAttributionBodyInput = {
  readonly markerKey: string;
  readonly failureClass: string;
  readonly lisaSurface: string;
  readonly operatorImpact: string;
  readonly harnessFault: string;
  readonly requestedChange: string;
  readonly affectedProject: string;
  readonly hostIssueUrl: string;
  readonly attributionEvidence: readonly string[];
  readonly lisaOwnedExcerpts: readonly UpstreamAttributionExcerpt[];
  readonly upstreamRefs: readonly string[];
};

const INPUT_KEYS = [
  "markerKey",
  "failureClass",
  "lisaSurface",
  "operatorImpact",
  "harnessFault",
  "requestedChange",
  "affectedProject",
  "hostIssueUrl",
  "attributionEvidence",
  "lisaOwnedExcerpts",
  "upstreamRefs",
] as const;

const EXCERPT_KEYS = ["surface", "text"] as const;

const SIMPLE_BLOCKED_PATTERNS = [
  /AKIA[\dA-Z]{16}/u,
  /gh[pousr]_\w{20,}/u,
  /xox[baprs]-[\w-]{20,}/u,
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void => {
  const unknownKeys = Object.keys(value).filter(key => !allowed.includes(key));

  if (unknownKeys.length > 0) {
    throw new Error(
      `${label} contains non-allowlisted field(s): ${unknownKeys.join(", ")}`
    );
  }
};

const requireString = (
  value: Record<string, unknown>,
  key: keyof UpstreamAttributionBodyInput
): string => {
  const field = value[key];

  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(
      `upstream attribution field ${key} must be a non-empty string`
    );
  }

  if (matchesBlockedShape(field)) {
    throw new Error(
      `upstream attribution field ${key} matched a blocked shape`
    );
  }

  return field.trim();
};

const requireStringArray = (
  value: Record<string, unknown>,
  key: keyof UpstreamAttributionBodyInput
): readonly string[] => {
  const field = value[key];

  if (!Array.isArray(field) || field.length === 0) {
    throw new Error(
      `upstream attribution field ${key} must be a non-empty array`
    );
  }

  return field.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(
        `upstream attribution field ${key}[${index}] must be a non-empty string`
      );
    }

    if (matchesBlockedShape(item)) {
      throw new Error(
        `upstream attribution field ${key}[${index}] matched a blocked shape`
      );
    }

    return item.trim();
  });
};

const requireExcerpts = (
  value: Record<string, unknown>
): readonly UpstreamAttributionExcerpt[] => {
  const field = value.lisaOwnedExcerpts;

  if (!Array.isArray(field) || field.length === 0) {
    throw new Error(
      "upstream attribution field lisaOwnedExcerpts must be a non-empty array"
    );
  }

  return field.map((item, index) => {
    if (!isPlainRecord(item)) {
      throw new Error(
        `upstream attribution field lisaOwnedExcerpts[${index}] must be an object`
      );
    }

    assertKnownKeys(item, EXCERPT_KEYS, `lisaOwnedExcerpts[${index}]`);

    const surface = requireExcerptString(item, "surface", index);
    const text = requireExcerptString(item, "text", index);

    return { surface, text };
  });
};

const requireExcerptString = (
  value: Record<string, unknown>,
  key: keyof UpstreamAttributionExcerpt,
  index: number
): string => {
  const field = value[key];

  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(
      `upstream attribution field lisaOwnedExcerpts[${index}].${key} must be a non-empty string`
    );
  }

  if (matchesBlockedShape(field)) {
    throw new Error(
      `upstream attribution field lisaOwnedExcerpts[${index}].${key} matched a blocked shape`
    );
  }

  return field.trim();
};

const bulletList = (items: readonly string[]): string =>
  items.map(item => `- ${item}`).join("\n");

const excerptList = (items: readonly UpstreamAttributionExcerpt[]): string =>
  items
    .map(item => `- ${item.surface}\n\n  \`\`\`text\n  ${item.text}\n  \`\`\``)
    .join("\n");

const hasHighEntropyAssignment = (value: string): boolean =>
  value.split(/\s+/u).some(token => {
    const [_key, fieldValue] = token.split("=", 2);

    if (fieldValue === undefined || fieldValue.length < 16) {
      return false;
    }

    return /[A-Za-z]/u.test(fieldValue) && /\d/u.test(fieldValue);
  });

const hasEmailLikeToken = (value: string): boolean =>
  value.split(/\s+/u).some(token => {
    const atIndex = token.indexOf("@");
    const dotIndex = token.lastIndexOf(".");

    return atIndex > 0 && dotIndex > atIndex + 1 && dotIndex < token.length - 1;
  });

const matchesBlockedShape = (value: string): boolean =>
  SIMPLE_BLOCKED_PATTERNS.some(pattern => pattern.test(value)) ||
  hasEmailLikeToken(value) ||
  hasHighEntropyAssignment(value);

const parseBodyInput = (input: unknown): UpstreamAttributionBodyInput => {
  if (!isPlainRecord(input)) {
    throw new Error("upstream attribution body input must be an object");
  }

  const unknownKeys = Object.keys(input).filter(
    key => !INPUT_KEYS.includes(key as (typeof INPUT_KEYS)[number])
  );

  if (unknownKeys.length > 0) {
    throw new Error(
      `upstream attribution body input contains non-allowlisted field(s): ${unknownKeys.join(", ")}`
    );
  }

  const markerKey = requireString(input, "markerKey");
  const failureClass = requireString(input, "failureClass");
  const lisaSurface = requireString(input, "lisaSurface");
  const operatorImpact = requireString(input, "operatorImpact");
  const harnessFault = requireString(input, "harnessFault");
  const requestedChange = requireString(input, "requestedChange");
  const affectedProject = requireString(input, "affectedProject");
  const hostIssueUrl = requireString(input, "hostIssueUrl");
  const attributionEvidence = requireStringArray(input, "attributionEvidence");
  const upstreamRefs = requireStringArray(input, "upstreamRefs");
  const lisaOwnedExcerpts = requireExcerpts(input);

  return {
    markerKey,
    failureClass,
    lisaSurface,
    operatorImpact,
    harnessFault,
    requestedChange,
    affectedProject,
    hostIssueUrl,
    attributionEvidence,
    lisaOwnedExcerpts,
    upstreamRefs,
  };
};

/**
 * Build the public upstream issue body from enumerated fields only.
 *
 * Unknown fields are rejected instead of ignored so callers cannot smuggle
 * host-project prose into a world-readable Lisa issue body.
 *
 * @param input - Candidate body data from the handoff-upstream flow
 * @returns Markdown body safe to pass to the upstream GitHub issue writer
 */
export function buildUpstreamAttributionIssueBody(input: unknown): string {
  const bodyInput = parseBodyInput(input);

  return [
    `<!-- [lisa-upstream-attribution] key=${bodyInput.markerKey} -->`,
    "",
    "## Operator impact",
    bodyInput.operatorImpact,
    "",
    "## Harness fault",
    bodyInput.harnessFault,
    "",
    "## Requested Lisa change",
    bodyInput.requestedChange,
    "",
    "## Redacted evidence chain",
    `- Failure class: ${bodyInput.failureClass}`,
    `- Lisa surface: ${bodyInput.lisaSurface}`,
    `- Affected project: ${bodyInput.affectedProject}`,
    `- Host-project issue: ${bodyInput.hostIssueUrl}`,
    "- Reproduction: REDACTED host values only; see linked host issue for private context.",
    "",
    "## Attribution evidence",
    bulletList(bodyInput.attributionEvidence),
    "",
    "## Lisa-owned excerpts",
    excerptList(bodyInput.lisaOwnedExcerpts),
    "",
    "## Upstream references",
    bulletList(bodyInput.upstreamRefs),
  ].join("\n");
}
