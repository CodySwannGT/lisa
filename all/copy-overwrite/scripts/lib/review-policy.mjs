// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Canonical provider-neutral policy shared by both gate entrypoints.
import {
  PROVIDERS,
  PROVIDER_SETTINGS,
  legacyReviewAdapters,
  providerReading,
} from "./review-providers/index.mjs";
import { submittedReview } from "./review-providers/native-evidence.mjs";

const record = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(item => typeof item === "string" && item !== "") &&
  new Set(value).size === value.length;
const defaulted = (value, fallback) => (value === undefined ? fallback : value);
const policyKeys = new Set([
  "providers",
  "requiredProviders",
  "minimumCount",
  "minimumHumanApprovals",
  "adapters",
  "holdLabels",
]);

/** Resolve defaults and validate policy; malformed configuration never softens it. */
export function resolveReviewPolicy(config = {}, declaration = {}) {
  if (config.review !== undefined && !record(config.review))
    throw new Error("review must be an object");
  if (config.policy !== undefined && !record(config.policy))
    throw new Error("policy must be an object");
  if (config.policy?.review !== undefined && !record(config.policy.review))
    throw new Error("policy.review must be an object");
  if (!record(declaration))
    throw new Error("Review declaration must be an object");
  if (
    declaration.evidence_bearing_checks !== undefined &&
    (!record(declaration.evidence_bearing_checks) ||
      Object.values(declaration.evidence_bearing_checks).some(
        value => !record(value)
      ))
  ) {
    throw new Error("Legacy review declarations must be objects");
  }
  const review = config.review ?? {};
  if (Object.keys(review).some(key => !policyKeys.has(key)))
    throw new Error("Review policy contains an unknown setting");
  const legacy = legacyReviewAdapters(config, declaration);
  const providers = defaulted(review.providers, [
    "agent",
    ...Object.keys(legacy),
  ]);
  const requiredProviders = defaulted(review.requiredProviders, []);
  const minimumCount = defaulted(review.minimumCount, 1);
  const protectedMinimum = defaulted(
    config.policy?.review?.required_approving_review_count,
    0
  );
  if (!Number.isSafeInteger(protectedMinimum) || protectedMinimum < 0)
    throw new Error("Human protection count is malformed");
  const minimumHumanApprovals = Math.max(
    defaulted(review.minimumHumanApprovals, 0),
    protectedMinimum
  );
  if (
    !list(providers) ||
    providers.some(name => !Object.hasOwn(PROVIDERS, name))
  )
    throw new Error("review.providers must name supported, distinct providers");
  if (
    !Array.isArray(requiredProviders) ||
    requiredProviders.some(name => !providers.includes(name)) ||
    new Set(requiredProviders).size !== requiredProviders.length
  )
    throw new Error(
      "review.requiredProviders must be a distinct subset of providers"
    );
  if (!Number.isSafeInteger(minimumCount) || minimumCount < 1)
    throw new Error("review.minimumCount must be a positive integer");
  if (
    !Number.isSafeInteger(defaulted(review.minimumHumanApprovals, 0)) ||
    defaulted(review.minimumHumanApprovals, 0) < 0 ||
    !Number.isSafeInteger(minimumHumanApprovals) ||
    minimumHumanApprovals < 0
  )
    throw new Error(
      "review.minimumHumanApprovals must be a nonnegative integer"
    );
  if (review.adapters !== undefined && !record(review.adapters))
    throw new Error("review.adapters must be an object");
  for (const [name, settings] of Object.entries(review.adapters ?? {})) {
    if (
      !Object.hasOwn(PROVIDER_SETTINGS, name) ||
      !record(settings) ||
      Object.keys(settings).some(key => !PROVIDER_SETTINGS[name].includes(key))
    )
      throw new Error("Review adapter settings are malformed or unknown");
    if (
      settings.context !== undefined &&
      (typeof settings.context !== "string" || !settings.context.trim())
    )
      throw new Error("Review adapter context must be a nonempty check name");
    for (const key of ["actorId", "appId"])
      if (
        settings[key] !== undefined &&
        (!Number.isSafeInteger(settings[key]) || settings[key] <= 0)
      )
        throw new Error(`Review adapter ${key} must be a positive native ID`);
    for (const key of ["proof", "no_work", "waive"])
      if (
        settings[key] !== undefined &&
        (!Array.isArray(settings[key]) ||
          settings[key].some(
            value => typeof value !== "string" || !value.trim()
          ))
      )
        throw new Error(`Review adapter ${key} must be nonempty phrases`);
  }
  const holdLabels = defaulted(review.holdLabels, [
    "hold",
    "do-not-merge",
    "lisa:hold",
  ]);
  if (
    !Array.isArray(holdLabels) ||
    holdLabels.some(name => typeof name !== "string" || !name)
  )
    throw new Error("review.holdLabels must be label names");
  const configuredHold = config.github?.labels?.merge?.hold;
  if (
    configuredHold !== undefined &&
    (typeof configuredHold !== "string" || !configuredHold)
  )
    throw new Error("Configured merge hold label is malformed");
  return {
    providers,
    requiredProviders,
    minimumCount,
    minimumHumanApprovals,
    adapters: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(legacy),
          ...Object.keys(review.adapters ?? {}),
        ]),
      ].map(name => [name, { ...legacy[name], ...review.adapters?.[name] }])
    ),
    holdLabels: [...new Set([...holdLabels, configuredHold ?? "lisa:hold"])],
  };
}

/** Latest submitted state per stable GitHub actor identity; unknown identity is unusable. */
export function latestReviews(reviews) {
  const latest = new Map();
  for (const review of [...reviews].sort(
    (left, right) =>
      String(left.submitted_at ?? "").localeCompare(
        String(right.submitted_at ?? "")
      ) || Number(left.id ?? 0) - Number(right.id ?? 0)
  )) {
    if (Number.isSafeInteger(review.user?.id))
      latest.set(review.user.id, review);
  }
  return [...latest.values()];
}

/** Evaluate a single authenticated head snapshot; count unique actors, never markers. */
export function evaluateReviewPolicy({
  policy,
  head,
  reviews,
  statuses = [],
  checkRuns = [],
  activity,
  pull,
  canWrite,
  externalRead = false,
}) {
  // Completion applies only to the reviewed commit. An objection continues
  // across pushes until its reviewer clears it or GitHub records a dismissal.
  const atHead = reviews.filter(review => review.commit_id === head);
  const latest = latestReviews(atHead);
  const decisive = reviews.filter(review =>
    ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)
  );
  const currentDecisions = latestReviews(
    decisive.filter(review => review.commit_id === head)
  );
  const hasObjection = review => review.state === "CHANGES_REQUESTED";
  const reasons = [];
  if (
    reviews.some(
      review => review?.state !== "PENDING" && !submittedReview(review)
    )
  ) {
    reasons.push("malformed-native-review");
  }
  if (
    !/^[a-f0-9]{40}$/.test(head) ||
    pull.head?.sha !== head ||
    activity.headRefOid !== head
  )
    reasons.push("head-changed-or-unproven");
  if (pull.draft === true) reasons.push("draft-pull-request");
  if (pull.state !== "open") reasons.push("pull-request-not-open");
  if (
    activity.reviewDecision === "CHANGES_REQUESTED" ||
    currentDecisions.some(hasObjection) ||
    latestReviews(decisive).some(hasObjection)
  )
    reasons.push("standing-review-objection");
  if (activity.threads.some(thread => thread.isResolved !== true))
    reasons.push("unresolved-review-thread");
  if ((pull.labels ?? []).some(label => policy.holdLabels.includes(label.name)))
    reasons.push("explicit-review-hold");
  const readings = policy.providers.map(provider =>
    providerReading(
      provider,
      {
        reviews: latest,
        statuses,
        checkRuns,
        head,
        canWrite,
        authorId: pull.user?.id,
        settings: policy.adapters[provider],
      },
      externalRead
    )
  );
  const evidence = readings.flatMap(reading => reading.evidence);
  const actors = new Set(evidence.map(item => item.actor));
  const providers = [...new Set(evidence.map(item => item.provider))];
  for (const provider of policy.requiredProviders)
    if (!providers.includes(provider))
      reasons.push(`required-provider:${provider}`);
  if (actors.size < policy.minimumCount)
    reasons.push(`review-count:${actors.size}/${policy.minimumCount}`);
  const humans = currentDecisions.filter(
    review =>
      review.state === "APPROVED" &&
      submittedReview(review) &&
      review.commit_id === head &&
      review.user?.type === "User" &&
      review.user.id !== pull.user?.id &&
      !String(review.body ?? "").startsWith("<!-- lisa:review ") &&
      canWrite(review.user.login)
  );
  if (humans.length < policy.minimumHumanApprovals)
    reasons.push(
      `human-approvals:${humans.length}/${policy.minimumHumanApprovals}`
    );
  return {
    outcome: reasons.length === 0 ? "reviewed" : "not-reviewed",
    sha: head,
    providers,
    count: actors.size,
    humanApprovals: humans.length,
    reasons,
    evidence,
    readings,
  };
}
