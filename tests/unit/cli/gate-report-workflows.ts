/**
 * Workflow and plugin fixtures for the attribution tests.
 *
 * Separated from the tests so the two upstream cases stay readable side by
 * side: a repository that HOLDS the reusable workflow — where Tier 3 is
 * answerable — and one that only calls it by ref, which is what a consumer is.
 * @module tests/unit/cli/gate-report-workflows
 */

/** The runner every fixture job declares. */
const RUNNER = "    runs-on: ubuntu-latest";

/** The tool matcher an edit-time hook registers on. */
export const EDIT_MATCHER = "Write|Edit";

/** The moment a ruleset guards. */
export const PULL_REQUEST = "pull-request";

/** The context Lisa's type-check job posts. */
export const TYPE_CHECK_CONTEXT = "🔍 Quality Checks / 🔍 Type Check";

/** The context the fixture project's own workflow posts. */
export const HOUSE_CONTEXT = "🧩 House Rules / House check";

/** A workflow declaring one gated job and one that runs a fixed command. */
export const QUALITY_YML = [
  "name: 🔍 Quality Checks",
  "on:",
  "  workflow_call:",
  "jobs:",
  "  typecheck:",
  "    name: 🔍 Type Check",
  RUNNER,
  "    steps:",
  "      - id: gate",
  "        env:",
  "          GATE_ID: type-correctness",
  "        run: echo resolve",
  "      - run: npm run typecheck",
  "  npm_security_scan:",
  "    name: 🔒 Security Scan",
  RUNNER,
  "    steps:",
  "      - run: npm audit",
  "",
].join("\n");

/**
 * A workflow the project wrote itself, posting its own required context.
 * @param step - The shell its one job runs
 * @returns The workflow source
 */
export function ownWorkflow(step = "npm run house:check"): string {
  return [
    "name: 🧩 House Rules",
    "on: [push]",
    "jobs:",
    "  house:",
    "    name: House check",
    RUNNER,
    "    steps:",
    `      - run: ${step}`,
    "",
  ].join("\n");
}

/** The manifest of a plugin that enforces on every edit. */
export const EDIT_PLUGIN = {
  name: "lisa-typescript",
  hooks: {
    PreToolUse: [
      {
        matcher: EDIT_MATCHER,
        hooks: [{ type: "command", command: "${ROOT}/hooks/block.sh" }],
      },
    ],
    PostToolUse: [
      {
        matcher: EDIT_MATCHER,
        hooks: [{ type: "command", command: "${ROOT}/hooks/lint-on-edit.sh" }],
      },
      {
        // Deliberately a matcher that CONTAINS `Write` without being a tool
        // that writes a file. A substring test counts this one, and the count
        // it feeds is an operator's measure of ungovernable enforcement.
        matcher: "TodoWrite",
        hooks: [{ type: "command", command: "record-task || true" }],
      },
    ],
  },
};

/** A project that enables the edit-time plugin, with it installed. */
export const WITH_EDIT_PLUGIN = {
  config: {},
  agentSettings: { enabledPlugins: { "lisa-typescript@lisa": true } },
  installedPlugins: { lisa: { "lisa-typescript": EDIT_PLUGIN } },
};
