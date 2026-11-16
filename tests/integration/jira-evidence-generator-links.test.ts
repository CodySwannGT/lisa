/**
 * The Jira journey generators link the asset name the evidence script uploads.
 *
 * `post-evidence.sh` stores each file in the shared `pr-assets` release as
 * `pr-<number>-<file>` (CodySwannGT/lisa#4639). A description that still links
 * the bare `<file>` would show whatever pull request last uploaded that name,
 * so the base `generate-templates.py` (the one generator every stack uses since
 * the Expo copy was retired in CodySwannGT/lisa#4921) is run here and its GitHub
 * links asserted. The Jira wiki markup keeps the bare `!file!` form: those
 * images are ticket attachments, already per ticket.
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
];
const SHOT = "01-search-step-desktop.png";
const RELEASE = "https://github.com/org/repo/releases/download/pr-assets";
const JOURNEY = {
  assertions: ["search works"],
  steps: [{ number: 1, text: "Search [SCREENSHOT: search-step]" }],
  viewports: [{ name: "desktop", width: 1440, height: 900 }],
};
const FULL_MONTH = "pr-assets-2026-11";
const OVERFLOW = `${FULL_MONTH}-2`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Run one generator for one pull request over a single screenshot.
 * @param generator - Generator path relative to the checkout.
 * @param pr - Pull request number argument.
 * @param extra - Additional evidence file names to stage beside the screenshot.
 * @param resolver - Stage a project resolver whose stub `node` answers.
 * @param journey - Parsed journey JSON the generator reads.
 * @returns The generated GitHub markdown and Jira wiki markup.
 */
function generate(
  generator: string,
  pr: string,
  extra: string[] = [],
  resolver = false,
  journey: object = JOURNEY
) {
  const { root, evidence, bin } = stageInputs(extra, resolver, journey);
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
 * @param extra - Additional evidence file names to stage.
 * @param resolver - Also stage `scripts/lisa-work-item.mjs` and a `node` stub
 *   that models a full current release: plain `evidence-release` prints the
 *   period's first release, `--ensure` the overflow release with room.
 * @param journey - Parsed journey JSON the generator reads.
 * @returns The scratch root, evidence directory and stub PATH entry.
 */
function stageInputs(extra: string[], resolver: boolean, journey: object) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-jira-links-"));
  const evidence = path.join(root, "evidence");
  const bin = path.join(root, "bin");
  roots.push(root);
  mkdirSync(evidence);
  mkdirSync(path.join(root, ".config", ".jira"), { recursive: true });
  // The generator degrades to a bare ticket key without a jira-cli config;
  // staging one keeps the ticket link path exercised too.
  writeFileSync(
    path.join(root, ".config", ".jira", ".config.yml"),
    "server: https://jira.invalid\n"
  );
  for (const name of [SHOT, ...extra])
    writeFileSync(path.join(evidence, name), "image");
  writeFileSync(path.join(root, "journey.json"), JSON.stringify(journey));
  writeStub(bin, "gh", "printf 'org/repo\\n'\n");
  if (resolver) {
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts", "lisa-work-item.mjs"), "");
    writeStub(
      bin,
      "node",
      `case "$*" in *--ensure*) printf '${OVERFLOW}\\n' ;; *) printf '${FULL_MONTH}\\n' ;; esac\n`
    );
  }
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

  it("links the release post-evidence.sh uploads to when the current one is full (#4838)", () => {
    // Without a pin both scripts must ask `evidence-release --ensure`: plain
    // `evidence-release` names the full release, while the upload rolls over.
    const { markdown } = generate(generator, "101", [], true);
    const overflow = `https://github.com/org/repo/releases/download/${OVERFLOW}`;

    expect(markdown).toContain(`(${overflow}/pr-101-${SHOT})`);
    expect(markdown).not.toContain(`/${FULL_MONTH}/`);
  });

  it("keeps the Jira attachment reference bare", () => {
    expect(generate(generator, "101").wiki).toContain(`!${SHOT}|`);
  });

  it("links only the evidence kinds post-evidence.sh uploads", () => {
    // post-evidence.sh uploads only NN-*.png images and refuses a description
    // linking anything it did not upload, so a .jpg link would fail the run.
    const jpg = "02-confirm-step-desktop.jpg";
    const { markdown, wiki } = generate(generator, "101", [jpg]);

    expect(markdown).toContain(`(${RELEASE}/pr-101-${SHOT})`);
    expect(markdown).not.toContain(jpg);
    expect(wiki).not.toContain(jpg);
  });
});

/**
 * Screenshot journeys run once per viewport and name each capture
 * `NN-<marker>-<viewport>.png`. The retired Expo generator rendered each one at
 * its viewport's width and listed the viewports; the base generator keeps that
 * so every stack's screenshot evidence reads the same (CodySwannGT/lisa#4921).
 */
describe.each(GENERATORS)("viewport-aware screenshots: %s", generator => {
  const MOBILE_SHOT = "02-search-step-mobile.png";
  const VIEWPORT_JOURNEY = {
    ...JOURNEY,
    viewports: [
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Mobile", width: 375, height: 812 },
    ],
  };

  it("sizes each Jira screenshot to its viewport, capped at 700", () => {
    const { wiki } = generate(
      generator,
      "101",
      [MOBILE_SHOT],
      false,
      VIEWPORT_JOURNEY
    );

    expect(wiki).toContain(`!${SHOT}|width=700!`);
    expect(wiki).toContain(`!${MOBILE_SHOT}|width=375!`);
  });

  it("labels a screenshot by marker and viewport", () => {
    const { markdown, wiki } = generate(
      generator,
      "101",
      [MOBILE_SHOT],
      false,
      VIEWPORT_JOURNEY
    );

    expect(markdown).toContain("**Search Step (Mobile 375x812):**");
    expect(wiki).toContain("*Search Step (Desktop 1440x900):*");
  });

  it("lists the journey viewports", () => {
    const { markdown, wiki } = generate(
      generator,
      "101",
      [],
      false,
      VIEWPORT_JOURNEY
    );

    expect(wiki).toContain(
      "||Viewport||Resolution||\n|Desktop|1440x900|\n|Mobile|375x812|"
    );
    expect(markdown).toContain("| Viewport | Resolution |");
    expect(markdown).toContain("| Mobile | 375x812 |");
  });

  it("keeps the plain label when the suffix names no journey viewport", () => {
    const { markdown } = generate(generator, "101", [], false, {
      ...JOURNEY,
      viewports: [],
    });

    expect(markdown).toContain("**Search Step Desktop:**");
    expect(markdown).not.toContain("| Viewport |");
  });
});
