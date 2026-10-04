/** Write scoped local verification telemetry; never manufacture shipping identity. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = ".lisa/evidence/4335";
const CLI_OUTPUT = "cli-output";
const STATE_DUMP = "state-dump";
const read = async file =>
  JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
const boundary = await read("verify-boundary-results.json");
const native = await read("verify-native-results.json");
const regular = await read("verify-host-custom-collision-results.json");
const helper = await read("verify-host-helper-collision-results.json");
const link = await read("verify-host-symlink-collision-results.json");
const nativeState = await read("verify-native-hooks-list.json");
const witnesses = (
  await readFile(`${directory}/verify-native-host-hook.jsonl`, "utf8")
)
  .trim()
  .split("\n")
  .map(line => JSON.parse(line));
const hash = value => createHash("sha256").update(value).digest("hex");
const currentInstaller = hash(await readFile("dist/codex/hooks-installer.js"));
const aligned =
  boundary.sourceHashes["dist/codex/hooks-installer.js"] === currentInstaller;
const statuses = Object.fromEntries(
  boundary.runs.map(run => [run.id, run.status])
);
const observed = id => boundary.runs.find(run => run.id === id);
const oldDeny = ["legacy-real-deny", "package-replacement-old-deny"].every(
  id =>
    JSON.parse(observed(id).stdout).hookSpecificOutput.permissionDecision ===
    "deny"
);
const realNotices = [
  "legacy-real-shell-write-notice",
  "package-replacement-real-shell-write",
].every(id => observed(id).stderr.includes("tracked"));
const entrypointsPassed = [
  "block-no-verify",
  "shell-write-nudge",
  "sg-scan-on-edit",
  "rubocop-on-edit",
].every(
  id =>
    statuses[`after-${id}`] === 0 && statuses[`package-replacement-${id}`] === 0
);
const behaviorPassed =
  oldDeny &&
  realNotices &&
  statuses["explicit-full-apply"] === 0 &&
  statuses["repeat-full-apply"] === 0 &&
  statuses["fallback-real-block"] === 2 &&
  statuses["package-replacement-fallback-block"] === 2 &&
  statuses["legacy-real-rubocop-autocorrect"] === 0 &&
  statuses["package-replacement-real-rubocop"] === 0 &&
  statuses["legacy-real-rubocop-error"] === 1 &&
  statuses["legacy-real-scanner-error"] === 1 &&
  statuses["legacy-real-scanner-clean"] === 0 &&
  statuses["package-replacement-real-scanner"] === 1;
const preservationPassed =
  regular.hostAuthoredPreserved &&
  helper.hostAuthoredPreserved &&
  helper.hookConfigPreserved &&
  helper.loadedEntrypointPreserved &&
  !helper.unexpectedCompanionCreated &&
  link.hostBehaviorPreserved &&
  link.stillSymlink &&
  [regular, helper, link].every(
    result => result.built_source_sha256 === currentInstaller
  );
const refusedCommand = "git commit --no-verify --dry-run";
const negativeWitness = witnesses.find(
  event => event.payload.tool_input.command === refusedCommand
);
const projectHooks = nativeState.entries.flatMap(entry => entry.projectHooks);
const trustedFallback = projectHooks.some(
  hook =>
    hook.command.includes("scripts/lisa-enforcement-fallback.sh") &&
    hook.enabled &&
    hook.trustStatus === "trusted"
);
const nativePassed =
  native.status.code === 0 &&
  native.witnessCount === witnesses.length &&
  native.probe === "fresh-native-session\n" &&
  native.fileCompletions.some(change => change.status === "completed") &&
  native.commandCompletions.some(
    command => command.exit_code === 0 && command.output === native.probe
  ) &&
  trustedFallback &&
  native.thread_ids.includes(negativeWitness?.payload.session_id) &&
  native.stderr.includes("Command blocked by PreToolUse hook") &&
  native.stderr.includes(
    "Refused by <anonymous-host>/scripts/lisa-hooks/block-no-verify.sh"
  ) &&
  native.stderr.includes(`Command: ${refusedCommand}`) &&
  !native.commandCompletions.some(command =>
    command.command.includes(refusedCommand)
  ) &&
  native.captured_at >= boundary.captured_at;
const evidence = [];
for (const [id, file, kind] of [
  ["EV-cli", "verify-boundary-results.json", CLI_OUTPUT],
  ["EV-native", "verify-native.jsonl", CLI_OUTPUT],
  ["EV-native-state", "verify-native-hooks-list.json", STATE_DUMP],
  ["EV-native-refusal", "verify-native-stderr.txt", CLI_OUTPUT],
  ["EV-native-witness", "verify-native-host-hook.jsonl", STATE_DUMP],
  ["EV-regular", "verify-host-custom-collision-results.json", CLI_OUTPUT],
  ["EV-helper", "verify-host-helper-collision-results.json", CLI_OUTPUT],
  ["EV-link", "verify-host-symlink-collision-results.json", CLI_OUTPUT],
]) {
  const content = await readFile(`${directory}/${file}`);
  evidence.push({
    evidence_id: id,
    kind,
    locator: `${directory}/${file}`,
    sha256: hash(content),
    captured_at: file.endsWith(".json")
      ? JSON.parse(content).captured_at
      : native.captured_at,
    artifact_head_sha: null,
  });
}
const now = new Date().toISOString();
const limits = [
  "Local uncommitted patch only; no shipping head exists",
  "No remote CI, release, deployment or consumer claim",
  "Native result is scoped to normally reviewed/trusted project hooks; inherited permission profile was not changed",
  "Native runtime emitted installed-version staleness advisory; local guard and installer source hashes identify the measured local code",
];
const claim = (id, statement, passed, refs, pending) => ({
  claim_id: id,
  statement,
  boundary: "cli",
  required_for_gate: true,
  required_evidence_kinds: [CLI_OUTPUT],
  status: passed ? "established" : "not-established",
  evidence_refs: refs,
  not_established: [...limits, ...(passed ? [] : [pending])],
});
const report = {
  schema_version: 2,
  plan: "Preserve active Codex commands through explicit hook migration",
  artifact: {
    repository: "CodySwannGT/lisa",
    base_sha: boundary.base_sha,
    head_sha: null,
    build_id: null,
    environment: "Anonymous supported-stack local host app on macOS",
    observed_at: now,
  },
  local_source_hashes: boundary.sourceHashes,
  local_patch_source_hashes: boundary.localPatchSourceHashes,
  local_source_fingerprint_sha256: boundary.localSourceFingerprintSha256,
  local_tracked_patch_sha256: boundary.trackedPatchSha256,
  shipping_identity_pending: true,
  claims: [
    claim(
      "AC-legacy",
      "Exact saved legacy commands remain executable and functional after full apply, refresh and package replacement",
      aligned &&
        entrypointsPassed &&
        behaviorPassed &&
        boundary.repeatHooksStable &&
        boundary.repeatManifestStable,
      ["EV-cli"],
      "Final aligned CLI replay pending"
    ),
    claim(
      "AC-host",
      "Measured host-authored regular hooks, unknown helpers and custom source-lookalike links preserve their behavior",
      aligned && preservationPassed,
      ["EV-regular", "EV-helper", "EV-link"],
      "Final positive-ownership correction and collision replays pending"
    ),
    claim(
      "AC-native",
      "A fresh normally trusted native Codex session rejects the prohibited command and performs harmless shell/edit operations",
      aligned && nativePassed,
      [
        "EV-native",
        "EV-native-state",
        "EV-native-refusal",
        "EV-native-witness",
      ],
      "Fresh trusted native tool proof pending"
    ),
    {
      claim_id: "AC-shipping",
      statement:
        "The artifact that will ship has passed delivery and runtime gates",
      boundary: "standards-compat",
      required_for_gate: true,
      required_evidence_kinds: [STATE_DUMP, "test-run-log"],
      status: "not-established",
      evidence_refs: [],
      not_established: [
        "Shipping identity null pending parent submission",
        "Retained security/quality review pending",
        "Final indexed evidence/artifact/anonymity checks pending",
        "CI named regression, release/package/runtime verification, canonical evidence, usage and tracker terminal readback pending",
      ],
    },
  ],
  evidence,
  not_established_reviewed: true,
  criteria: [],
  status: "in_progress",
  updated_at: now,
  learnings: [],
};
await writeFile(
  ".lisa/verification-status.json",
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(
  JSON.stringify(
    {
      status: report.status,
      shipping_head_sha: null,
      claims: report.claims.map(c => ({ id: c.claim_id, status: c.status })),
    },
    null,
    2
  )
);
