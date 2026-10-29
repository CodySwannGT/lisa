// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Exclude only actual canonical accounting; retain unknown requirement text. */
import { parseLisaUsageSection } from "./usage-ledger.mjs";
import { verifyLisaUsageSectionIntegrity } from "./usage-ledger-integrity.mjs";
import { requireProof } from "./completion-proof-errors.mjs";

/** Stable presentation matching; this does not parse or authorize usage data. */
const normalizedRow = line =>
  line
    .trim()
    .split("|")
    .map(part => part.trim())
    .join("|");

/** Match the canonical writer's visible table rows to the already parsed data. */
function accountingRows(entries) {
  const known = new Set([
    "## Lisa Usage",
    "_This section is managed by Lisa. Rewrites update matching usage entries in place and preserve older rows._",
    "|Flow|Source|Model|Tokens|Cost|",
    "|---|---|---|---:|---:|",
    "|_No direct entries recorded_|||||",
  ]);
  for (const entry of entries) {
    const tokens =
      entry.totalTokens !== null
        ? String(entry.totalTokens)
        : entry.measuredSubsetTokens == null
          ? "null"
          : `${entry.measuredSubsetTokens} measured subset`;
    const cost =
      entry.cost === null
        ? "null"
        : entry.currency
          ? `${entry.cost} ${entry.currency}`
          : String(entry.cost);
    known.add(
      normalizedRow(
        `| ${entry.flow} | ${entry.source} | ${entry.provider}/${entry.model} | ${tokens} | ${cost} |`
      )
    );
  }
  return known;
}

/** A known token must positively parse; a tag-shaped comment is insufficient. */
function canonicalToken(token, section) {
  if (token.startsWith("<!-- lisa:usage-entry "))
    return (
      parseLisaUsageSection(`## Lisa Usage\n${token}\n`).entries.length === 1
    );
  if (token.startsWith("<!-- lisa:usage-rollup "))
    return parseLisaUsageSection(`## Lisa Usage\n${token}\n`).rollup !== null;
  if (
    token ===
    "<!-- lisa:usage-rollup-token-status child_tokens_incomplete=true -->"
  )
    return true;
  if (/^<!-- lisa:usage-effectiveness entry_id=\S+ data=\S+ -->$/.test(token))
    return true;
  const subset =
    /^<!-- lisa:usage-entry-measured-subset entry_id=(\S+) measured_subset_tokens=(\S+) -->$/.exec(
      token
    );
  return (
    subset &&
    section.entries.some(
      row => encodeURIComponent(row.entryId) === subset[1]
    ) &&
    (subset[2] === "null" || Number.isFinite(Number(subset[2])))
  );
}

/** Unknown prose/table rows within usage remain part of the full spec digest. */
export function usageSpecRemainder(document) {
  let parsed;
  try {
    parsed = parseLisaUsageSection(document);
    requireProof(
      verifyLisaUsageSectionIntegrity(document).ok,
      "The canonical usage section is not an intact stored ledger."
    );
  } catch {
    requireProof(
      false,
      "The canonical usage section is malformed; restore its actual accounting before completion."
    );
  }
  const known = accountingRows(parsed.entries);
  return document
    .split(/(?<=\n)/)
    .map(raw => {
      const line = raw.replace(
        /<!-- lisa:usage-(?:entry(?:-measured-subset)?|rollup(?:-token-status)?|effectiveness) [^\r\n]*? -->/g,
        token => (canonicalToken(token, parsed) ? "" : token)
      );
      return !line.trim() || known.has(normalizedRow(line)) ? "" : line;
    })
    .join("");
}

/** Only a closed canonical metadata schema can be omitted from the primary spec. */
export function canonicalCompletionBlock(name, payload) {
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return false;
  }
  if (
    payload !== JSON.stringify(value) &&
    payload !== JSON.stringify(value, null, 2)
  )
    return false;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema_version !== 1
  )
    return false;
  const digest = input =>
    typeof input === "string" && /^[a-f0-9]{64}$/.test(input);
  const id = input => Number.isSafeInteger(input) && input > 0;
  const exact = fields =>
    Object.keys(value).sort().join() === fields.sort().join();
  if (name === "authorization")
    return (
      exact([
        "schema_version",
        "record_id",
        "revision",
        "repository",
        "asset_id",
        "sha256",
      ]) &&
      /^completion-[a-f0-9]{64}$/.test(value.record_id) &&
      id(value.revision) &&
      id(value.asset_id) &&
      /^[\w.-]+\/[\w.-]+$/.test(value.repository) &&
      digest(value.sha256)
    );
  return (
    exact([
      "schema_version",
      "provider",
      "ref",
      "native_id",
      "record_sha256",
      "completed_at",
      "state",
    ]) &&
    ["github", "linear"].includes(value.provider) &&
    (value.provider === "github"
      ? /^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(value.ref) &&
        value.state === "CLOSED"
      : /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(value.ref) &&
        value.state === "completed") &&
    (id(value.native_id) ||
      (typeof value.native_id === "string" &&
        /^[\w:/#.-]{1,256}$/.test(value.native_id))) &&
    digest(value.record_sha256) &&
    typeof value.completed_at === "string" &&
    value.completed_at.endsWith("Z") &&
    Number.isFinite(Date.parse(value.completed_at))
  );
}
