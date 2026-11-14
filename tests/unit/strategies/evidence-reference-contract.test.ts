/**
 * Regression contract for #1595: cross-work-item evidence references must not
 * inflate the current work item's S14 manifest.
 *
 * The executable Jira journey parser and template generator are tested as
 * code, and the OpenCode installer is guarded as source text. The skill and
 * rule prose describing the reference grammar is not pinned (#4867).
 * @module tests/unit/strategies/evidence-reference-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const PYTHON = "/usr/bin/python3";

describe("non-claiming evidence references (#1595)", () => {
  it("installs built canonical skills into OpenCode verbatim", () => {
    const installer = read("src/opencode/skills-installer.ts");

    expect(installer).toMatch(/Copy one bundled skill folder verbatim/);
    expect(installer).toContain("await copyFile(srcPath, destPath)");
  });

  it("keeps EVIDENCE-REF as prose in the executable Jira journey parser", () => {
    const parserPath = path.resolve(
      "plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py"
    );
    const program = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("parse_plan", ${JSON.stringify(parserPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def item(text):
    return {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
nodes = [{"type": "orderedList", "content": [
    item("Reuse [EVIDENCE-REF: ENG-123 | cli-output: shared-log]"),
    item("Compare [EVIDENCE-REF: ENG-123 | cli-output: shared-log] and verify [EVIDENCE: cli-output: shared-log]"),
    item("Quote \`[EVIDENCE: cli-output: quoted-local]\`"),
    item("Keep malformed [EVIDENCE-REF: ENG-123 | nope] as prose"),
    item("Reuse legacy [EVIDENCE-REF: https://github.com/acme/app/issues/12: cli-output: shipped-log]")
]}]
print(json.dumps(module.parse_steps(nodes)))
`;
    const result = boundedSpawnSync({
      label: "parse_plan under python3",
      command: PYTHON,
      args: ["-c", program],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      {
        number: 1,
        text: "Reuse [EVIDENCE-REF: ENG-123 | cli-output: shared-log]",
        screenshot: null,
      },
      {
        number: 2,
        text: "Compare [EVIDENCE-REF: ENG-123 | cli-output: shared-log] and verify",
        screenshot: "cli-output: shared-log",
      },
      {
        number: 3,
        text: "Quote ``",
        screenshot: "cli-output: quoted-local",
      },
      {
        number: 4,
        text: "Keep malformed [EVIDENCE-REF: ENG-123 | nope] as prose",
        screenshot: null,
      },
      {
        number: 5,
        text: "Reuse legacy [EVIDENCE-REF: https://github.com/acme/app/issues/12: cli-output: shipped-log]",
        screenshot: null,
      },
    ]);
  });

  it("preserves references while stripping local claims from Jira and GitHub templates", () => {
    const generatorPath = path.resolve(
      "plugins/src/base/skills/lisa-jira-journey/scripts/generate-templates.py"
    );
    const program = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("generate_templates", ${JSON.stringify(generatorPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
journey = {"steps": [{"number": 1, "text": "Compare [EVIDENCE-REF: ENG-123 | cli-output: shared-log] and verify [EVIDENCE: cli-output: local-check]"}]}
print(json.dumps({
    "jira": module.generate_jira_wiki("ENG-456", "42", "branch", [], journey, "org/repo"),
    "github": module.generate_github_md("ENG-456", "42", "branch", [], journey, "org/repo", "")
}))
`;
    const result = boundedSpawnSync({
      label: "generate_templates under python3",
      command: PYTHON,
      args: ["-c", program],
      // Pin the release so the generator never runs `evidence-release
      // --ensure`, which reads (and may create) a real GitHub release
      // (CodySwannGT/lisa#4838). This test is about reference stripping.
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        LISA_EVIDENCE_RELEASE: "pr-assets",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const rendered = JSON.parse(result.stdout) as {
      jira: string;
      github: string;
    };
    for (const template of [rendered.jira, rendered.github]) {
      expect(template).toContain(
        "[EVIDENCE-REF: ENG-123 | cli-output: shared-log]"
      );
      expect(template).not.toContain("[EVIDENCE: cli-output: local-check]");
    }
  });
});
