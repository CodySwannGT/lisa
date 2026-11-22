// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Vendor discovery and readers stay behind this adapter boundary.
import { agentEvidence } from "./agent.mjs";
import * as statusProvider from "./coderabbit.mjs";
import * as reviewProvider from "./greptile.mjs";

export const PROVIDERS = Object.freeze({
  agent: agentEvidence,
  [statusProvider.provider]: statusProvider.statusEvidence,
  [reviewProvider.provider]: reviewProvider.reviewEvidence,
});

export const PROVIDER_SETTINGS = Object.freeze({
  agent: ["actorId"],
  [statusProvider.provider]: [
    "actorId",
    "appId",
    "context",
    "proof",
    "no_work",
    "waive",
  ],
  [reviewProvider.provider]: ["actorId", "proof"],
});

/** One neutral reading per adapter; optional external sources may remain unread. */
export function providerReading(provider, input, externalRead) {
  if (usesStatuses(provider) && !externalRead)
    return { provider, condition: "not-needed", evidence: [] };
  if (provider === statusProvider.provider)
    return statusProvider.inspectEvidence(input);
  const evidence = PROVIDERS[provider](input);
  return {
    provider,
    condition: evidence.length ? "completed" : "missing-or-invalid",
    evidence,
  };
}

/** Only adapters that use statuses require the commit-status API. */
export function usesStatuses(name) {
  return name === statusProvider.provider;
}

/** Native routes and source-specific fallback behavior belong to their adapter. */
export function readExternalEvidence({ policy, read, repo, head }) {
  return statusProvider.readEvidence({
    read,
    repo,
    head,
    settings: policy.adapters[statusProvider.provider],
  });
}

/** Discover configured legacy adapters without leaking vendor policy to callers. */
export function legacyReviewAdapters(config, declaration) {
  const settings = statusProvider.legacySettings(config, declaration);
  return settings === null ? {} : { [statusProvider.provider]: settings };
}
