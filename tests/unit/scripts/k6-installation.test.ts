import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { extractSetup } from "../../fixtures/k6-installation/extract.mjs";
import { judgeMetrics } from "../../fixtures/k6-installation/metrics.mjs";
import { classifyBaseline } from "../../fixtures/k6-installation/classify-baseline.mjs";
import { prepare } from "../../fixtures/k6-installation/prepare.mjs";

const owner = readFileSync(".github/workflows/load-test.yml");
const workflow = parse(owner.toString());
const expected = {
  httpRequests: 1,
  iterations: 1,
  checksPass: 2,
  checksFail: 0,
  loopbackExit: 0,
  serverRequests: 1,
};
const summary = {
  metrics: {
    http_reqs: { count: 1 },
    iterations: { count: 1 },
    checks: { passes: 2, fails: 0 },
  },
};
const request = '127.0.0.1 - - [date] "GET /health HTTP/1.1" 200 -\n';

it("keeps private captures from changing actual installer child permissions", () => {
  expect(() =>
    boundedExecFileSync({
      label: "k6 installer child permissions regression",
      command: "python3",
      args: ["tests/fixtures/k6-installation/test-umask.py"],
      stdio: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })
  ).not.toThrow();
});

describe("actual YAML k6 installation extraction", () => {
  it("refuses a head mismatch before creating or executing evidence", () => {
    expect(() =>
      prepare("latest", "/unused-k6-evidence", "0".repeat(40), undefined, true)
    ).toThrow("Checked-out source differs");
  });
  it("resolves the omitted latest and supplied explicit inputs without leftover expressions", () => {
    expect(extractSetup(owner).input).toEqual({
      supplied: false,
      name: "k6_version",
      resolved: "latest",
    });
    const explicit = extractSetup(owner, "2.3.0");
    expect(explicit.input.resolved).toBe("2.3.0");
    expect(explicit.script).not.toContain("${{");
    expect(explicit.shell).toEqual({
      declared: null,
      argv: ["bash", "-e", "{script}"],
      pipefail: false,
    });
  });

  it("executes substituted commands from YAML, including the supplied input", () => {
    const fixture = structuredClone(workflow);
    fixture.jobs.k6_test.steps = [
      { name: "Set up k6", run: 'printf "%s" "${{ inputs.k6_version }}"\n' },
    ];
    const extracted = extractSetup(Buffer.from(stringify(fixture)), "2.3.0");
    const scratch = mkdtempSync(join(tmpdir(), "lisa-k6-extract-"));
    try {
      const script = join(scratch, "actual.sh");
      writeFileSync(script, extracted.script);
      expect(
        boundedExecFileSync({
          label: "actual YAML k6 input substitution",
          command: "/bin/bash",
          args: ["-e", script],
        })
      ).toBe("2.3.0");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it.each(["expression", "shell", "container", "duplicate", "missing"])(
    "refuses an unresolved %s contract",
    variant => {
      const fixture = structuredClone(workflow);
      const step = fixture.jobs.k6_test.steps.find(
        (candidate: { name: string }) => candidate.name === "Set up k6"
      );
      if (variant === "expression")
        step.run += '\necho "${{ secrets.UNKNOWN }}"';
      if (variant === "shell") step.shell = "bash";
      if (variant === "container") fixture.jobs.k6_test.container = "ubuntu";
      if (variant === "duplicate") fixture.jobs.k6_test.steps.push(step);
      if (variant === "missing") fixture.jobs.k6_test.steps = [];
      expect(() => extractSetup(Buffer.from(stringify(fixture)))).toThrow();
    }
  );
});

describe("counted real loopback oracle", () => {
  it("accepts only the exact request, iteration and check counts", () => {
    expect(judgeMetrics(summary, request, 0, expected)).toEqual(expected);
  });
  it.each([
    [
      { ...summary, metrics: { ...summary.metrics, http_reqs: { count: 0 } } },
      request,
      0,
    ],
    [
      { ...summary, metrics: { ...summary.metrics, iterations: { count: 2 } } },
      request,
      0,
    ],
    [
      {
        ...summary,
        metrics: { ...summary.metrics, checks: { passes: 2, fails: 1 } },
      },
      request,
      0,
    ],
    [{ metrics: {} }, request, 0],
    [summary, "", 0],
    [summary, request + request, 0],
    [summary, request, 99],
  ])(
    "rejects skipped, extra, failing or unobserved execution",
    (actual, log, exit) => {
      expect(() => judgeMetrics(actual, log, exit, expected)).toThrow();
    }
  );
});

it("does not turn setup/network failures or arbitrary nonzero exits into historical RED", () => {
  const oracles = JSON.parse(
    readFileSync("tests/fixtures/k6-installation/baseline-oracles.json", "utf8")
  );
  for (const observation of [
    { stdout: "", stderr: "keyserver receive failed", exitCode: 2 },
    {
      stdout: "NO_PUBKEY C780D0BDB1A69C86 https://dl.k6.io/deb",
      stderr: "",
      exitCode: 100,
    },
  ])
    expect(
      classifyBaseline(
        {
          ...observation,
          timedOut: false,
          preconditionsVerified: true,
          frozenInputsVerified: true,
        },
        oracles
      ).outcome
    ).not.toBe("genuine-red");
});

it("wires three fresh native hosted jobs to the actual PR head and executable counted judge", () => {
  const hosted = parse(
    readFileSync(".github/workflows/k6-installation-regression.yml", "utf8")
  );
  const job = hosted.jobs.installation;
  expect(job["runs-on"]).toBe("ubuntu-latest");
  expect(job.strategy.matrix.control).toEqual([
    "latest",
    "explicit",
    "negative",
  ]);
  expect(hosted.permissions).toEqual({ contents: "read" });
  expect(job.steps[0].with.ref).toBe(
    "${{ github.event.pull_request.head.sha }}"
  );
  expect(job.steps[0].with["persist-credentials"]).toBe(false);
  const commands = job.steps
    .map((step: { run?: string }) => step.run ?? "")
    .join("\n");
  expect(commands).toContain("tests/fixtures/k6-installation/prepare.mjs");
  expect(commands).toContain('"$key" --strict');
  expect(commands).toContain('python3 "$proof/harness/qualify.py" "$proof"');
  expect(commands).toContain('node "$proof/harness/finish.mjs" "$proof"');
});
