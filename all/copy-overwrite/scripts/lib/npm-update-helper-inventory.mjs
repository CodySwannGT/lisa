// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** One fixed source inventory is shared by the closed validator and reproducible generator. */
const COMMON = [
  "lisa-work-item.mjs",
  "lisa-automation-provenance.mjs",
  "lisa-rails-prepush.mjs",
  "lisa-history-secrets.mjs",
  "lisa-gates.mjs",
  "lisa-run-gates.mjs",
  "lisa-commit-msg-gates.mjs",
  "lisa-test-node.mjs",
  "lib/invoked-as-script.mjs",
  "lib/bounded-spawn.mjs",
  "lib/process-tree-runner.mjs",
  "lib/windows-process-job.mjs",
  "lib/windows-process-job.ps1",
  "lib/windows-process-job.cs",
  "lib/kill-marks.mjs",
  "lib/gate-failure-diagnosis.mjs",
  "lib/worktree-dependencies.mjs",
  "lib/history-secret-git.mjs",
  "lib/history-secret-scanner.mjs",
  "lib/history-secret-evidence.mjs",
  "lib/history-secret-evidence-shape.mjs",
  "lib/history-secret-policy.mjs",
  "lib/github-attestation-verifier.mjs",
  "lib/github-attestation-provider.mjs",
  "lib/github-attestation-recovery.mjs",
  "lib/automation-provenance-contract.mjs",
  "lib/automation-provenance-local.mjs",
];
const RAILS = [
  "lisa-clean-git-env.sh",
  "lisa-scratch-run.sh",
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const PRODUCER = [
  "allocate",
  "authorization",
  "broker-client",
  "cancel-origin",
  "cancellation",
  "cancellation-proof",
  "checkpoint",
  "classifier-cache",
  "contract",
  "controller-broker",
  "controller-factory",
  "controller-recipe",
  "execution-adapter",
  "gate-hooks",
  "gate-install",
  "gate-proof",
  "gate",
  "gh-dispatch",
  "gh-grants",
  "gh-requests",
  "github",
  "helper",
  "helper-graph",
  "helper-inventory",
  "hosted-gate",
  "hosted-hook",
  "hook-installation",
  "hook-preload",
  "hook-provider",
  "hook-read-client",
  "invariants",
  "isolation",
  "leaf",
  "leaf-contract",
  "npm",
  "native-process",
  "object",
  "orchestrator",
  "owner",
  "prepare",
  "process",
  "process-core",
  "publication",
  "publish",
  "quality",
  "recovery",
  "supersession",
  "runtime-archive",
  "runtime-graph",
  "runtime-transport",
  "runtime",
  "tool-launcher",
  "worker-environment",
  "worker-inspection",
  "worker-lifecycle",
  "worker-policy",
];
export const HELPER_CONTROLS = [
  "lib/npm-update-helper-graph.mjs",
  "npm-updater-helper-graph.json",
];
export const CLASSIFIER_MEMBERS = [
  "plugins/lisa/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa/scripts/intake-prework-denominator.mjs",
];
export const OWNER_MEMBERS = [
  "plugins/lisa/hooks/auto-update.mjs",
  "plugins/lisa/hooks/auto-update.sh",
  "plugins/lisa/.codex-plugin/hooks.json",
];
export const HELPER_PACKAGE_MEMBERS = CLASSIFIER_MEMBERS.map(
  member => `package/${member}`
);

/** Only reviewed upstream templates and fixed classifier package members can enter the inventory. */
export function managedTemplateMembers() {
  return new Map([
    ...[
      ...COMMON,
      "lisa-npm-updater.mjs",
      "npm-updater-helper-graph.json",
      "npm-updater-gate-runtime.json",
      "npm-updater-gate-supervisor.c",
      "npm-updater-gate.Dockerfile",
      ...PRODUCER.map(name => `lib/npm-update-${name}.mjs`),
    ].map(member => [member, `all/copy-overwrite/scripts/${member}`]),
    ...RAILS.map(member => [member, `rails/copy-overwrite/scripts/${member}`]),
    ["lisa-mutation.sh", "rails/copy-contents/scripts/lisa-mutation.sh"],
  ]);
}
