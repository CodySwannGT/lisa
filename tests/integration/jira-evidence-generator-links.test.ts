/**
 * The Jira journey generators link the asset name the evidence script uploads.
 *
 * `post-evidence.sh` stores each file in the shared `pr-assets` release as
 * `pr-<number>-<file>` (CodySwannGT/lisa#4639). A description that still links
 * the bare `<file>` would show whatever pull request last uploaded that name,
 * so both `generate-templates.py` copies are run here and their GitHub links
 * asserted. The Jira wiki markup keeps the bare `!file!` form: those images are
 * ticket attachments, already per ticket.
 * @module tests/integration/jira-evidence-generator-links
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  REPO_ROOT,
  SYSTEM_PATH,
  writeStub,
} from "./support/shell-guard-refusal-fixture.js";

const GENERATORS = [
  "plugins/src/base/skills/lisa-jira-journey/scripts/generate-templates.py",
  "plugins/src/expo/skills/jira-journey/scripts/generate-templates.py",
];
const SHOT = "01-search-step-desktop.png";
const RELEASE = "https://github.com/org/repo/releases/download/pr-assets";
const JOURNEY = {
  assertions: ["search works"],
  steps: [{ number: 1, text: "Search [SCREENSHOT: search-step]" }],
  viewports: [{ name: "desktop", width: 1440, height: 900 }],
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Run one generator for one pull request over a single screenshot.
 * @param generator - Generator path relative to the checkout.
 * @param pr - Pull request number argument.
 * @returns The generated GitHub markdown and Jira wiki markup.
 */
function generate(generator: string, pr: string) {
  const { root, evidence, bin } = stageInputs();
  const result = boundedSpawnSync({
    label: `${generator} for PR ${pr}`,
    command: "python3",
    args: [
      "-I",
      path.join(REPO_ROOT, generator),
      "TEST-1",
      pr,
      "fix/test",
      evidence,
      path.join(root, "journey.json"),
    ],
    cwd: root,
    env: { HOME: root, PATH: `${bin}:${SYSTEM_PATH}` },
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    markdown: readFileSync(path.join(evidence, "comment.md"), "utf8"),
    wiki: readFileSync(path.join(evidence, "comment.txt"), "utf8"),
  };
}

/**
 * Stage one screenshot, a journey, a jira-cli config and a `gh` stub.
 * @returns The scratch root, evidence directory and stub PATH entry.
 */
function stageInputs() {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-jira-links-"));
  const evidence = path.join(root, "evidence");
  const bin = path.join(root, "bin");
  roots.push(root);
  mkdirSync(evidence);
  mkdirSync(path.join(root, ".config", ".jira"), { recursive: true });
  // The Expo generator refuses to run without a jira-cli config to read the
  // server from; the base one degrades to a bare ticket key.
  writeFileSync(
    path.join(root, ".config", ".jira", ".config.yml"),
    "server: https://jira.invalid\n"
  );
  writeFileSync(path.join(evidence, SHOT), "png");
  writeFileSync(path.join(root, "journey.json"), JSON.stringify(JOURNEY));
  writeStub(bin, "gh", "printf 'org/repo\\n'\n");
  return { root, evidence, bin };
}

describe.each(GENERATORS)("generated evidence links: %s", generator => {
  it("links the pull-request-scoped release asset", () => {
    const { markdown } = generate(generator, "101");

    expect(markdown).toContain(`(${RELEASE}/pr-101-${SHOT})`);
    expect(markdown).not.toContain(`(${RELEASE}/${SHOT})`);
  });

  it("links a different asset for a different pull request", () => {
    expect(generate(generator, "102").markdown).toContain(
      `(${RELEASE}/pr-102-${SHOT})`
    );
  });

  it("keeps the Jira attachment reference bare", () => {
    expect(generate(generator, "101").wiki).toContain(`!${SHOT}|`);
  });
});
