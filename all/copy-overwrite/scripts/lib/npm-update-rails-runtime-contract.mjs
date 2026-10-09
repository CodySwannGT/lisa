// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed committed runtime data cannot select commands, credentials or tool versions. */
import { keys, required } from "./npm-update-invariants.mjs";
import { canonicalJson } from "./automation-provenance-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

/** Explicit absence preserves the historical npm-only contract byte for byte. */
export function railsRuntime(policy) {
  if (!Object.hasOwn(policy, "runtime")) return undefined;
  const value = policy.runtime;
  keys(value, ["profile", "database", "browser", "dockerFixtures"]);
  required(
    value.profile === "rails-mysql" &&
      typeof value.database === "string" &&
      /^[a-z][a-z0-9_]{0,40}$/.test(value.database) &&
      typeof value.browser === "boolean" &&
      typeof value.dockerFixtures === "boolean",
    "unsupported closed Rails runtime profile"
  );
  return structuredClone(value);
}

/** All four finite fields enter the signed proposal, independently of caller inputs. */
export function runtimeBinding(policy) {
  const value = railsRuntime(policy);
  return value === undefined
    ? {}
    : { runtimeSha256: sha256(canonicalJson(value)) };
}

/** Four role names have one bounded ASCII base; no SQL or environment keys are accepted. */
export function runtimeSchemas(policy) {
  const value = railsRuntime(policy);
  required(value !== undefined, "Rails runtime profile is absent");
  return ["test", "queue_test", "cache_test", "cable_test"].map(
    suffix => `${value.database}_${suffix}`
  );
}

/** Original committed policy must affirm a descriptor's optional runtime authority. */
export function assertRuntimeBinding(value, policy) {
  const expected = runtimeBinding(policy);
  required(
    Object.hasOwn(value, "runtimeSha256") ===
      Object.hasOwn(expected, "runtimeSha256") &&
      value.runtimeSha256 === expected.runtimeSha256,
    "original committed Rails runtime differs"
  );
}

/** The finite workflow selector can only affirm the already signed committed choice. */
export function affirmRuntimeProfile(value, policy, input) {
  assertRuntimeBinding(value, policy);
  const runtime = railsRuntime(policy);
  required(
    input === (runtime?.profile ?? "none"),
    "caller Rails runtime affirmation differs"
  );
  return runtime;
}

/** Current native HEAD, including genuine absence, selects the sole original runtime policy. */
export function assertCommittedRuntime(value, git) {
  const entry = git(["ls-tree", "HEAD", "--", ".lisa.config.json"]);
  required(
    entry === "" ||
      /^100644 blob [a-f0-9]{40}\t\.lisa\.config\.json$/.test(entry),
    "original runtime configuration is not regular"
  );
  const original =
    entry === "" ? {} : JSON.parse(git(["show", "HEAD:.lisa.config.json"]));
  assertRuntimeBinding(value, original.npmUpdater ?? {});
}
