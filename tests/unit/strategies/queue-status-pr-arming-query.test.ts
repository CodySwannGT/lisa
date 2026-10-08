/** Exercise the documented queue read with real jq and the shipped arming sweep. */
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const SOURCE = "plugins/src/base/skills/lisa-queue-status/SKILL.md";
const SWEEP = "plugins/src/base/scripts/pr-arming-sweep.mjs";
const NOT_MEASURED = "NOT_MEASURED";
const roots: string[] = [];
const skill = readFileSync(SOURCE, "utf8");
const section = skill.indexOf("## Pull request arming");
const start = skill.indexOf("```bash\n", section) + "```bash\n".length;
const end = skill.indexOf("\n```", start);
const code = skill.slice(start, end);

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Native REST pull request shape consumed by the documented read.
 * @param number - Pull request number.
 * @param armed - Whether auto-merge is enabled.
 * @returns A complete provider row.
 */
function pr(number: number, armed = true) {
  return {
    number,
    title: `Pull request ${number}`,
    html_url: `https://github.com/CodySwannGT/lisa/pull/${number}`,
    draft: false,
    body: null,
    labels: [],
    auto_merge: armed ? { merge_method: "merge" } : null,
  };
}

/**
 * Execute the actual skill read against a provider response and real sweep CLI.
 * @param pages - Provider pages, already slurped by the provider fixture.
 * @param options - Failure and plugin-root scenarios.
 * @param options.apiExit - Provider API exit status.
 * @param options.repoExit - Repository identity read exit status.
 * @param options.pluginRoot - Exported or deliberately incorrect script root.
 * @returns The supervised native shell result.
 */
function runRead(
  pages: unknown,
  options: {
    apiExit?: number;
    repoExit?: number;
    pluginRoot?: "exported" | "wrong";
  } = {}
) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-queue-arming-"));
  const installed = path.join(
    root,
    "node_modules/@codyswann/lisa/plugins/lisa"
  );
  const pluginRoot =
    options.pluginRoot === "exported" ? path.join(root, "plugin") : installed;
  const script = path.join(root, "read.sh");
  const response = path.join(root, "pages.json");
  const provider = path.join(root, "gh");
  roots.push(root);
  mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
  copyFileSync(SWEEP, path.join(pluginRoot, "scripts/pr-arming-sweep.mjs"));
  writeFileSync(script, code);
  writeFileSync(response, JSON.stringify(pages));
  writeFileSync(
    provider,
    `#!/bin/sh
case "$*" in
  'repo view --json nameWithOwner --jq .nameWithOwner')
    printf '%s\\n' 'CodySwannGT/lisa'
    exit ${options.repoExit ?? 0}
    ;;
  'api --paginate --slurp repos/CodySwannGT/lisa/pulls?state=open&per_page=100')
    cat "$QUEUE_FIXTURE_RESPONSE"
    exit ${options.apiExit ?? 0}
    ;;
  *) printf '%s\\n' 'Unexpected provider request' >&2; exit 77 ;;
esac
`
  );
  chmodSync(provider, 0o755);
  return boundedSpawnSync({
    label: "shipped queue arming read",
    command: "/bin/bash",
    args: [script],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      QUEUE_FIXTURE_RESPONSE: response,
      CLAUDE_PLUGIN_ROOT:
        options.pluginRoot === "wrong"
          ? path.join(root, "missing")
          : options.pluginRoot === "exported"
            ? pluginRoot
            : "",
      PLUGIN_ROOT: "",
    },
  });
}

describe("documented queue PR arming read", () => {
  it("finds an unarmed PR beyond 200 rows with no exported plugin root", () => {
    const result = runRead([
      Array.from({ length: 100 }, (_, index) => pr(index + 1)),
      Array.from({ length: 100 }, (_, index) => pr(index + 101)),
      [pr(201, false)],
    ]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain("UNARMED_PRS_FOUND");
    expect(result.stdout).toContain("#201");
  });

  it("reports a genuinely empty complete queue", () => {
    const result = runRead([[]]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MEASURED_CLEAN");
  });

  it("honors the exported plugin root when no package copy exists", () => {
    const result = runRead([[pr(1)]], { pluginRoot: "exported" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MEASURED_CLEAN");
  });

  it("fails loudly on an explicitly wrong script path", () => {
    const result = runRead([[pr(1)]], { pluginRoot: "wrong" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Cannot find module");
  });

  it.each([{ apiExit: 1 }, { repoExit: 1 }])(
    "refuses provider failure %j",
    options => {
      const result = runRead([[pr(1)]], options);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(NOT_MEASURED);
    }
  );

  it.each([
    { label: "no pages", pages: [] },
    { label: "API error object", pages: { message: "Access refused" } },
    { label: "non-array page", pages: [[pr(1)], null] },
    {
      label: "absent auto-merge field",
      pages: [
        [
          Object.fromEntries(
            Object.entries(pr(1)).filter(([key]) => key !== "auto_merge")
          ),
        ],
      ],
    },
    { label: "malformed draft", pages: [[{ ...pr(1), draft: null }]] },
    { label: "missing labels", pages: [[{ ...pr(1), labels: null }]] },
    {
      label: "malformed auto-merge object",
      pages: [[{ ...pr(1), auto_merge: {} }]],
    },
  ])("refuses $label without a clean report", ({ pages }) => {
    const result = runRead(pages);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(NOT_MEASURED);
  });
});
