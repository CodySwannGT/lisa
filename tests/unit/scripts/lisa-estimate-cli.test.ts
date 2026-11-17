/**
 * The `lisa-estimate` command (CodySwannGT/lisa#4954): what every agent runs
 * to render an estimate and run gate S21, reading `.lisa.config.json` and the
 * `.lisa.config.local.json` override from the project root.
 * @module tests/unit/scripts/lisa-estimate-cli
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../../all/copy-overwrite/scripts/lisa-estimate.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A project root holding the given configs and an item body.
 * @param committed - `.lisa.config.json` contents.
 * @param local - `.lisa.config.local.json` contents, when present.
 * @returns Root path and body file path.
 */
function project(
  committed: object,
  local?: object
): { root: string; body: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-estimate-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify(committed)
  );
  if (local)
    writeFileSync(
      path.join(root, ".lisa.config.local.json"),
      JSON.stringify(local)
    );
  const body = path.join(root, "body.md");
  writeFileSync(body, "## Context\n\nWork.\n");
  return { root, body };
}

/**
 * Run the CLI and capture its output.
 * @param argv - Arguments after the script name.
 * @returns Exit code and captured streams.
 */
function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
  });
  return { code, out: out.join(""), err: err.join("") };
}

const render = (
  root: string,
  body: string,
  model: string
): ReturnType<typeof run> =>
  run([
    "render",
    "--tokens-low",
    "2M",
    "--tokens-high",
    "4M",
    "--model",
    model,
    "--body-file",
    body,
    "--cwd",
    root,
  ]);

const check = (root: string, body: string): ReturnType<typeof run> =>
  run(["check", "--body-file", body, "--cwd", root]);

describe("lisa-estimate", () => {
  it("renders an estimate into the body and passes S21 on it", () => {
    const { root, body } = project({});
    const rendered = render(root, body, "claude-opus-5-5");
    expect(rendered.code).toBe(0);
    expect(rendered.out).toMatch(/^## Context[\s\S]*## Lisa Estimate/);
    writeFileSync(body, rendered.out);
    expect(check(root, body)).toMatchObject({
      code: 0,
      out: "S21 token estimate: PASS\nThe estimate is well formed.\n",
    });
  });

  it("exits 1 when S21 fails", () => {
    const { root, body } = project({});
    writeFileSync(
      body,
      render(root, body, "opus").out.replace("model=opus", "model=gpt-9")
    );
    const result = check(root, body);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^S21 token estimate: FAIL/);
  });

  it("reports N/A and exits 0 when the local override turns the requirement off", () => {
    const { root, body } = project(
      {},
      { workItem: { estimate: { required: false } } }
    );
    expect(check(root, body)).toMatchObject({
      code: 0,
      out: expect.stringMatching(/^S21 token estimate: N\/A/),
    });
  });

  it("refuses a model the project does not allow, and bad arguments, with exit 2", () => {
    const { root, body } = project({
      workItem: { estimate: { models: ["sonnet"] } },
    });
    expect(render(root, body, "opus")).toMatchObject({
      code: 2,
      err: expect.stringMatching(/not in workItem\.estimate\.models: sonnet/),
    });
    expect(run(["check", "--nope", "x"]).code).toBe(2);
    expect(run(["nothing"]).code).toBe(2);
  });

  it("prints the effective settings and the shipped price table", () => {
    const { root } = project({});
    const result = run(["config", "--cwd", root]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({
      required: true,
      defaultPricing: { source: "anthropic-api-list-prices" },
    });
  });
});
