/**
 * Parity tests for the cross-repository arm of the ready-role filing guard.
 *
 * The guard exists twice — the canonical bash hook and an independent OpenCode
 * port — so a fix in one is a parity break in the other. These tests run both
 * implementations against the same command and the same `.lisa.config.json`
 * and assert they reach the same verdict, which is the only thing that keeps
 * an upstream filing from being permitted on one agent and refused on another.
 *
 * Every OpenCode case is evaluated in ONE Bun process. Spawning a runtime per
 * case cost ~10s each and put the file over the pre-push 60s per-test budget,
 * which fails the push as a test-correctness error rather than a slow test.
 * The plugin snapshots config at init from the process cwd, so each case
 * chdirs and re-imports the template with a cache-busting query.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  bashVerdict,
  LINEAR_CALLER,
  LINEAR_MUTATION,
  opencodeVerdicts,
  project,
  UNDECLARED_SCRIPT,
  UPSTREAM_REPO,
} from "./support/filing-parity.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const CUSTOM_ROLE = "state:queued";

/**
 * The canonical container declaration, verbatim — defined by
 * `derived-branch-plan` and stamped by every Lisa writer.
 */
const CONTAINER_DECLARATION = "None — container: state rolls up from children";

/** A GitHub-tracked caller that renamed its ready lane. */
const GITHUB_CALLER = {
  tracker: "github",
  github: {
    org: "own-org",
    repo: "own-repo",
    labels: { build: { ready: CUSTOM_ROLE } },
  },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** A JIRA-tracked caller, whose ready role is a workflow state. */
const JIRA_CALLER = {
  tracker: "jira",
  jira: { workflow: { ready: "Ready for Development" } },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** One command, its project config, and the verdict both guards must reach. */
const CASES: readonly {
  readonly label: string;
  readonly config: Record<string, unknown>;
  readonly command: string;
  readonly expected: string;
  /** Files written into the project directory before the case runs. */
  readonly files?: Readonly<Record<string, string>>;
  /** Command with `{dir}` replaced by the project directory. */
  readonly template?: string;
}[] = [
  {
    label: "an upstream filing carrying the upstream role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "status:ready"`,
    expected: "allow",
  },
  {
    label: "an upstream filing carrying only the caller's role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${CUSTOM_ROLE}"`,
    expected: "deny",
  },
  {
    label: "an undeclared upstream filing",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x"`,
    expected: "deny",
  },
  {
    label: "a same-repo filing carrying the caller's role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo own-org/own-repo --title "x" --label "${CUSTOM_ROLE}"`,
    expected: "allow",
  },
  {
    label: "an undeclared same-repo filing",
    config: GITHUB_CALLER,
    command: 'gh issue create --title "x"',
    expected: "deny",
  },
  {
    label: "a JIRA caller filing upstream with the upstream role",
    config: JIRA_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "status:ready"`,
    expected: "allow",
  },
  // Reach. Both guards inspected only the command they were handed, so a
  // creation one file away was invisible on both — and Lisa's other guards
  // instruct agents into exactly that shape. A parity break here would mean
  // the bypass is closed on one agent and open on another.
  {
    label: "a creation inside an executed script",
    config: LINEAR_CALLER,
    command: "",
    template: "bash {dir}/create.sh",
    files: { "create.sh": UNDECLARED_SCRIPT },
    expected: "deny",
  },
  {
    label: "a creation inside a script that declares the human gate",
    config: LINEAR_CALLER,
    command: "",
    template: "bash {dir}/gated.sh",
    files: {
      "gated.sh": `# [lisa-human-gate] reason=pricing\n${UNDECLARED_SCRIPT}`,
    },
    expected: "allow",
  },

  {
    label: "a mutation submitted from a payload file",
    config: LINEAR_CALLER,
    command: "",
    template:
      "curl -X POST https://api.linear.app/graphql --data-binary @{dir}/payload.json",
    files: { "payload.json": LINEAR_MUTATION },
    expected: "deny",
  },
  {
    label: "a file that only writes about creations",
    config: LINEAR_CALLER,
    command: "",
    template: "cat {dir}/notes.md",
    files: {
      "notes.md": "The guard refuses `gh issue create` and `issueCreate`.\n",
    },
    expected: "allow",
  },
  // The declaration a state-based tracker can actually write down. Without it
  // the only thing that passed on Linear and JIRA was the human-gate marker,
  // which is a false statement about a build-ready item.
  {
    label: "a hand-rolled Linear creation declaring nothing",
    config: LINEAR_CALLER,
    command: `curl -X POST https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`,
    expected: "deny",
  },
  {
    label: "a hand-rolled Linear creation declaring the ready lifecycle role",
    config: LINEAR_CALLER,
    command: `LIFECYCLE_ROLE=ready curl -X POST https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`,
    expected: "allow",
  },
  {
    label: "a lifecycle role that is not the build-ready one",
    config: LINEAR_CALLER,
    command: `LIFECYCLE_ROLE=blocked curl -X POST https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`,
    expected: "deny",
  },
  {
    label: "the role escape offered to a label-based tracker",
    config: GITHUB_CALLER,
    command: `gh issue create --title "x" --body "lifecycle_role:ready"`,
    expected: "deny",
  },
  // Both refusals tell the operator to put the declaration in the request
  // payload, and a JSON payload quotes its keys. A guard that refuses the
  // spelling it just asked for puts the operator back where #3484 found them.
  {
    label: "the JSON spelling the refusal message asks for",
    config: LINEAR_CALLER,
    command: `curl -X POST https://api.linear.app/graphql -d '{"lifecycle_role": "ready", "query":"mutation{issueCreate(input:{}){id}}"}'`,
    expected: "allow",
  },
  // `-d@file` is the ordinary curl spelling, and a parser that only reads the
  // next token and `flag=value` sees neither half of it.
  {
    label: "a payload file behind a glued short flag",
    config: LINEAR_CALLER,
    command: "",
    template:
      "curl -X POST https://api.linear.app/graphql -d@{dir}/payload.json",
    files: { "payload.json": LINEAR_MUTATION },
    expected: "deny",
  },
  // A file-scope role is this project's vocabulary, and another repository's
  // build queue does not read it.
  {
    label: "a cross-repo filing behind a file-scope lifecycle role",
    config: {
      tracker: "linear",
      linear: { workflow: { ready: "Ready" } },
      github: { org: "own-org", repo: "own-repo" },
    },
    command: "",
    template: "bash {dir}/cross.sh",
    files: {
      "cross.sh":
        '# lifecycle_role: ready\ngh issue create --repo other-org/other-repo --title "x"\n',
    },
    expected: "deny",
  },
  // The container arm. A container is neither build-ready nor human-gated, so
  // before it existed the guard could be satisfied for one only by writing
  // something untrue. A parity break here would mean an Epic is fileable on
  // one agent and not on another.
  {
    label: "a container filing carrying the container declaration",
    config: GITHUB_CALLER,
    command:
      'gh issue create --title "Rollup" --label "type:Epic" ' +
      `--body "${CONTAINER_DECLARATION}"`,
    expected: "allow",
  },
  {
    label: "a leaf claiming to be a container",
    config: GITHUB_CALLER,
    command:
      'gh issue create --title "Crash on save" --label "type:Bug" ' +
      `--body "${CONTAINER_DECLARATION}"`,
    expected: "deny",
  },
];

describe("cross-repo filing parity: bash guard vs OpenCode port", () => {
  const directories = CASES.map(entry => project(entry.config, entry.files));
  // A case naming a file has to name it where the file actually is, and the
  // directory is only known once it exists.
  const commands = CASES.map((entry, index) =>
    entry.template
      ? entry.template.replaceAll("{dir}", directories[index] ?? "")
      : entry.command
  );
  let opencode: readonly string[] = [];

  beforeAll(() => {
    opencode = opencodeVerdicts(
      CASES.map((_entry, index) => ({
        dir: directories[index] ?? "",
        command: commands[index] ?? "",
      }))
    );
  });

  it.each(CASES.map((entry, index) => [entry.label, index] as const))(
    "agrees on %s",
    (_label, index) => {
      const entry = CASES[index];
      expect(entry).toBeDefined();
      expect(bashVerdict(commands[index] ?? "", directories[index] ?? "")).toBe(
        entry?.expected
      );
      expect(opencode[index]).toBe(entry?.expected);
    }
  );
});
