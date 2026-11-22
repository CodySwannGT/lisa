// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Vendor vocabulary and authenticated status reader adapter.
import { nativeId, nativeRecord } from "./native-evidence.mjs";
import { readReviewerEvidence } from "../../check-third-party-review-evidence.mjs";
export const provider = "coderabbit";
export const context = "CodeRabbit";
export const actor = "coderabbitai[bot]";
export const actorId = 136622811;
export const satisfiedDescriptions = Object.freeze([
  "review completed",
  "review approved",
]);
export const noWorkDescriptions = Object.freeze([
  "rate limited",
  "review skipped",
  "queued",
  "waiting",
  "in progress",
  "paused",
]);

const normalized = value =>
  String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
const noWork = (text, settings = {}) =>
  [...noWorkDescriptions, ...(settings.no_work ?? [])].some(phrase =>
    normalized(text).includes(normalized(phrase))
  ) ||
  (settings.waive ?? []).some(
    phrase => normalized(text) === normalized(phrase)
  );
const newest = rows =>
  [...rows].sort(
    (left, right) =>
      (Date.parse(right.created_at ?? "") || 0) -
        (Date.parse(left.created_at ?? "") || 0) ||
      Number(right.id ?? 0) - Number(left.id ?? 0)
  )[0];

// GitHub's latest-run API supplies native records without top-level created_at.
// Retain deterministic native-ID ordering among those returned latest records.
const newestRun = rows =>
  [...rows].sort((left, right) => right.id - left.id)[0];

// Another app or head cannot speak for this provider, including by shadowing
// its genuine native record with a newer no-work result under the same name.
const ownedRuns = (checkRuns, head, settings) =>
  checkRuns.filter(
    row =>
      row.name === (settings.context ?? context) &&
      row.app?.id === (settings.appId ?? 347564) &&
      row.head_sha === head
  );

// A known foreign creator cannot supersede this provider. Keep records whose
// expected actor has malformed metadata, and refuse an undeterminable source,
// rather than discarding either to resurrect an earlier successful result.
function statusSources(statuses, name, settings) {
  const rows = statuses.filter(row => row.context === name);
  return {
    owned: rows.filter(
      row => row.creator?.id === (settings.actorId ?? actorId)
    ),
    unknown: rows.some(
      row =>
        !Number.isSafeInteger(row.creator?.id) ||
        row.creator.id <= 0 ||
        !["Bot", "User"].includes(row.creator?.type)
    ),
  };
}

/** Validate only the authoritative source: a check run outranks duplicate legacy statuses. */
function malformedSource(checkRuns, statuses, name) {
  const runs = checkRuns.filter(row => row.name === name);
  return runs.length > 0
    ? runs.some(row => !nativeId(row))
    : statuses.some(
        row =>
          row.context === name &&
          (!nativeRecord(row) || row.creator?.type !== "Bot")
      );
}

/** Structured results own the first physical line and cannot inherit a positive title. */
export function completedRun(run, settings = {}) {
  const title = run.output?.title;
  if (noWork(title, settings)) return false;
  const summary = run.output?.summary;
  if (summary !== undefined && summary !== null && typeof summary !== "string")
    return false;
  const first = String(summary ?? "").split(/\r?\n/u, 1)[0];
  if (noWork(first, settings)) return false;
  if (first === "Result: Success - Review completed") return true;
  if (/^[\s>#|]*Result\b/iu.test(first) || /\bResult\s*[:=-]/iu.test(first))
    return false;
  return [...satisfiedDescriptions, ...(settings.proof ?? [])]
    .map(normalized)
    .includes(normalized(title));
}

/** Exact normalized descriptions grant credit; a no-work string never does. */
export function statusEvidence({
  statuses,
  checkRuns = [],
  head,
  settings = {},
}) {
  const name = settings.context ?? context;
  const runs = ownedRuns(checkRuns ?? [], head, settings);
  const sources = statusSources(statuses ?? [], name, settings);
  if (
    (runs.length === 0 && sources.unknown) ||
    malformedSource(runs, sources.owned, name)
  )
    return [];
  const run = newestRun(runs);
  if (run !== undefined) {
    if (
      run.app?.id !== (settings.appId ?? 347564) ||
      run.head_sha !== head ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      !completedRun(run, settings)
    )
      return [];
    return [
      {
        provider,
        actor: String(settings.actorId ?? actorId),
        evidence: `check-run:${run.id}`,
        head,
      },
    ];
  }
  const status = newest(sources.owned);
  const authorized =
    status?.creator?.type === "Bot" &&
    Number.isSafeInteger(status.creator.id) &&
    status.creator.id === (settings.actorId ?? actorId);
  const proof = [...satisfiedDescriptions, ...(settings.proof ?? [])].map(
    normalized
  );
  if (
    !authorized ||
    status.state !== "success" ||
    noWork(status.description, settings) ||
    !proof.includes(normalized(status.description))
  )
    return [];
  return [
    {
      provider,
      actor: String(status.creator.id),
      evidence: `status:${status.id}`,
      head,
    },
  ];
}

/** Preserve observed completion/no-work/unknown distinctions without granting waiver credit. */
export function inspectEvidence(input) {
  const settings = input.settings ?? {};
  const name = settings.context ?? context;
  const runs = ownedRuns(input.checkRuns ?? [], input.head, settings);
  const run = newestRun(runs);
  const sources = statusSources(input.statuses ?? [], name, settings);
  const status = newest(sources.owned);
  const evidence = statusEvidence(input);
  const first =
    typeof run?.output?.summary === "string"
      ? run.output.summary.split(/\r?\n/u, 1)[0]
      : "";
  const observed = run
    ? noWork(run.output?.title, settings)
      ? run.output?.title
      : first.startsWith("Result") || noWork(first, settings)
        ? first
        : run.output?.title
    : status?.description;
  let condition = "absent";
  if (
    (runs.length === 0 && sources.unknown) ||
    malformedSource(runs, sources.owned, name)
  )
    condition = "malformed";
  else if (evidence.length > 0) condition = "completed";
  else if (run) {
    if (
      run.app?.id !== (settings.appId ?? 347564) ||
      run.head_sha !== input.head
    )
      condition = "untrusted-or-stale";
    else if (run.status !== "completed" || run.conclusion === null)
      condition = "pending";
    else if (
      ["neutral", "skipped"].includes(run.conclusion) ||
      noWork(observed, settings)
    )
      condition = "no-work";
    else condition = run.conclusion === "success" ? "unknown" : "failed";
  } else if (status) {
    if (status.state === "pending") condition = "pending";
    else condition = noWork(observed, settings) ? "no-work" : "unknown";
  } else if (
    (input.checkRuns ?? []).some(row => row.name === name) ||
    (input.statuses ?? []).some(row => row.context === name)
  ) {
    condition = "untrusted-or-stale";
  }
  const diagnostic = readReviewerEvidence({
    reviewer: {
      context: name,
      postedBy: settings.appId ?? 347564,
      proof: [...satisfiedDescriptions, ...(settings.proof ?? [])].map(
        normalized
      ),
    },
    statuses: input.statuses === null ? null : sources.owned,
    checkRuns: input.checkRuns,
    sha: input.head,
  });
  if (diagnostic.reading === "unreadable" && evidence.length === 0)
    condition = "unreadable";
  return {
    ...diagnostic,
    reviewed: evidence.length > 0,
    reading:
      evidence.length > 0
        ? "reviewed"
        : condition === "malformed"
          ? "malformed"
          : diagnostic.reviewed
            ? "unrecognised"
            : diagnostic.reading,
    provider,
    condition,
    observed:
      noWork(run?.output?.title, settings) || noWork(first, settings)
        ? observed
        : (diagnostic.observed ?? observed ?? null),
    evidence,
  };
}

/** Read both native representations. A failed route is never an absent row.
 * Authentic status evidence remains usable when the check-run API is unavailable,
 * preserving the delivered adapter's compatibility behavior without granting a waiver.
 */
export function readEvidence({ read, repo, head, settings = {} }) {
  const name = encodeURIComponent(settings.context ?? context);
  const attempt = (endpoint, property) => {
    try {
      return read(endpoint, property);
    } catch {
      return null;
    }
  };
  return {
    statuses: attempt(`repos/${repo}/commits/${head}/statuses?per_page=100`),
    checkRuns: attempt(
      `repos/${repo}/commits/${head}/check-runs?check_name=${name}&filter=latest&per_page=100`,
      "check_runs"
    ),
  };
}

/** Legacy declarations identify an optional adapter, never a required provider. */
export function recognizes(name) {
  return name === context;
}

/** Defaults apply to absence; malformed legacy vocabulary cannot soften policy. */
function phrases(value, field) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(
      `Legacy reviewer ${field} must be an array of nonempty phrases`
    );
  }
  return value;
}

/** Preserve explicit legacy proof vocabulary inside its owning adapter. */
export function legacySettings(config, declaration) {
  const snapshot = declaration.evidence_bearing_checks?.[context];
  const entries = Object.values(config.gates ?? {})
    .map(gate => gate?.["pull-request"])
    .filter(
      entry => entry?.evidence?.reviewer === true && recognizes(entry.await)
    );
  if (snapshot === undefined && entries.length === 0) return null;
  const proof = [
    ...phrases(snapshot?.proof, "proof"),
    ...phrases(snapshot?.satisfy, "satisfy"),
    ...entries.flatMap(entry => phrases(entry.evidence.proof, "proof")),
  ];
  const pins = [
    ...new Set(
      entries.map(entry => entry.posted_by).filter(pin => pin !== undefined)
    ),
  ];
  if (pins.length > 1) throw new Error("Conflicting legacy reviewer app pins");
  if (pins.some(pin => !Number.isSafeInteger(pin) || pin <= 0))
    throw new Error("Invalid legacy reviewer app pin");
  return {
    context,
    proof,
    no_work: phrases(snapshot?.no_work, "no_work"),
    waive: phrases(snapshot?.waive, "waive"),
    ...(pins.length === 1 ? { appId: pins[0] } : {}),
  };
}
