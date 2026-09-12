/**
 * Both filing guards agree on the STRUCTURED substrate (CodySwannGT/lisa#3785).
 *
 * CodySwannGT/lisa#3753 taught the canonical guard that a creation also arrives
 * as NAMED FIELDS rather than as a command line. The OpenCode port returned
 * early for every tool but `bash`, so on OpenCode that whole substrate was
 * unenforced while the same project was covered on Claude — the failure this
 * repository names most often: a control that reports success with a substrate
 * behind it ungoverned.
 *
 * ## The envelope was CAPTURED, not invented
 *
 * The ticket's own first deliverable, and the reason this suite can assert a
 * tool NAME rather than guessing one. `opencode run` against a local MCP server
 * exposing a single `create_issue` tool, with a probe plugin on
 * `tool.execute.before`, on OpenCode 1.17.13:
 *
 *   input  {"tool":"probe-tracker_create_issue", …}
 *   output {"args":{"title":"envelope probe","body":"capture"}}
 *
 * So OpenCode names the tool `<server>_<tool>` and hands the tool's own
 * arguments straight through on `args` — the shape the canonical guard's
 * structured classifier already reads. agy does the opposite (one generic tool
 * name, the real one buried in the arguments), which is why that port needed a
 * translation and this one needs the predicate.
 *
 * ## Why parity, and not a table of expected verdicts
 *
 * The port cannot delegate: the canonical guard is a bash script and is not
 * shipped to OpenCode, so this template carries the predicate as it already
 * does for the shell arm. A second implementation of a predicate drifts — the
 * shell arm drifted for four tickets — and what caught that was this harness
 * comparing verdicts rather than each side being asserted alone. `expected` is
 * still stated per case, so a change that moved BOTH implementations the same
 * wrong way is caught too; agreement alone would not catch it.
 *
 * The rejection controls are the half that matters most here. No issue-creating
 * MCP is provisioned in CI, so a suite that refused every structured call would
 * satisfy every refusal above and be indistinguishable from a working guard.
 * @module tests/unit/opencode/block-direct-issue-create-structured-parity
 */
import { beforeAll, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  bashStructuredVerdict,
  LINEAR_CALLER,
  opencodeStructuredVerdicts,
  project,
} from "./support/filing-parity.js";

useIoLatencyBudget();

const READY_ROLE = "status:ready";
/** The tool name OpenCode gave the probe server's create tool, as captured. */
const CREATE_TOOL = "probe-tracker_create_issue";
const GITHUB_CALLER = {
  github: { labels: { build: { ready: READY_ROLE } }, org: "o", repo: "r" },
  tracker: "github",
};

/** One structured call, its project config, and the verdict both must reach. */
interface StructuredCase {
  readonly label: string;
  readonly config: Record<string, unknown>;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly expected: string;
}

const CASES: readonly StructuredCase[] = [
  {
    label: "an undeclared creation through a server's create tool",
    config: GITHUB_CALLER,
    tool: CREATE_TOOL,
    args: { body: "b", title: "t" },
    expected: "deny",
  },
  {
    label: "an undeclared creation whose tool is spelled create_work_item",
    // The shape gate, not a list of server tool names: a server nobody
    // enumerated is recognised by the verb and the noun in its tool name.
    config: GITHUB_CALLER,
    tool: "srv_create_work_item",
    args: { name: "n" },
    expected: "deny",
  },
  {
    label: "an undeclared creation whose tool is spelled new_ticket",
    config: GITHUB_CALLER,
    tool: "srv_new_ticket",
    args: { name: "n" },
    expected: "deny",
  },
  {
    label: "a body that merely MENTIONS the ready role in prose",
    // `contains` here would be a fail-open on the one question this path
    // answers: "do not mark this status:ready" is not a declaration.
    config: GITHUB_CALLER,
    tool: CREATE_TOOL,
    args: { title: `do not mark this ${READY_ROLE} please` },
    expected: "deny",
  },
  {
    label: "an undeclared creation on a state-role tracker",
    config: LINEAR_CALLER,
    tool: "linear_create_issue",
    args: { title: "t" },
    expected: "deny",
  },

  // ── Rejection controls ────────────────────────────────────────────────────
  // An implementation that refused every structured call satisfies all five
  // cases above. These are what make those five mean anything.
  {
    label: "a creation declaring the role in a label ARRAY",
    config: GITHUB_CALLER,
    tool: CREATE_TOOL,
    args: { labels: [READY_ROLE], title: "t" },
    expected: "allow",
  },
  {
    label: "a creation declaring the role in a PACKED label string",
    // The shape several MCP servers pass through verbatim. Exact equality
    // against the flattened values alone would refuse a filing that declared
    // exactly what the guard demanded — and a false refusal costs more than a
    // miss, because it teaches the operator to argue with the next one.
    config: GITHUB_CALLER,
    tool: CREATE_TOOL,
    args: { labels: `${READY_ROLE},type:Bug`, title: "t" },
    expected: "allow",
  },
  {
    label: "a creation carrying a human-gate marker in its body",
    config: GITHUB_CALLER,
    tool: CREATE_TOOL,
    args: { body: "<!-- [lisa-human-gate] reason=pending -->", title: "t" },
    expected: "allow",
  },
  {
    label: "a state-role tracker's role nested deep in the payload",
    // A role lands in a different field on every tracker, so the declaration
    // is read from every string at any depth rather than from an enumerated
    // field name per vendor.
    config: LINEAR_CALLER,
    tool: "linear_create_issue",
    args: { input: { state: { name: "Ready" }, title: "t" } },
    expected: "allow",
  },
  {
    label: "an update, which creates nothing",
    config: GITHUB_CALLER,
    tool: "probe-tracker_update_issue",
    args: { id: "1", title: "t" },
    expected: "allow",
  },
  {
    label: "a comment, which creates nothing",
    config: GITHUB_CALLER,
    tool: "probe-tracker_add_comment",
    args: { body: "hi", id: "1" },
    expected: "allow",
  },
  {
    label: "a search, which creates nothing",
    config: GITHUB_CALLER,
    tool: "probe-tracker_search_issues",
    args: { query: "is:open" },
    expected: "allow",
  },
  {
    label: "OpenCode's own read tool",
    config: GITHUB_CALLER,
    tool: "read",
    args: { filePath: "/etc/hosts" },
    expected: "allow",
  },
  {
    label: "OpenCode's own todowrite tool",
    config: GITHUB_CALLER,
    tool: "todowrite",
    args: { todos: [] },
    expected: "allow",
  },
];

let bash: readonly string[] = [];
let port: readonly string[] = [];

beforeAll(() => {
  const prepared = CASES.map(item => ({
    args: item.args,
    dir: project(item.config),
    tool: item.tool,
  }));
  bash = prepared.map(item =>
    bashStructuredVerdict(item.tool, item.args, item.dir)
  );
  port = opencodeStructuredVerdicts(prepared);
});

describe("the filing guards agree on the structured substrate", () => {
  it.each(CASES.map((item, index) => [item.label, index] as const))(
    "%s",
    (_label, index) => {
      const item = CASES[index];
      expect(bash[index], "the canonical bash guard").toBe(item?.expected);
      expect(port[index], "the OpenCode port").toBe(item?.expected);
    }
  );
});
