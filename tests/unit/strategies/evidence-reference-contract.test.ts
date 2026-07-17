/**
 * Regression contract for #1595: cross-work-item evidence references must not
 * inflate the current work item's S14 manifest.
 *
 * @module tests/unit/strategies/evidence-reference-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const REFERENCE_GRAMMAR =
  "[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]";
const PYTHON = "/usr/bin/python3";

const VALIDATORS = [
  "plugins/src/base/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/src/base/skills/lisa-jira-validate-ticket/SKILL.md",
  "plugins/src/base/skills/lisa-linear-validate-issue/SKILL.md",
] as const;

const WRITERS = [
  "plugins/src/base/skills/lisa-github-create/SKILL.md",
  "plugins/src/base/skills/lisa-github-write-issue/SKILL.md",
  "plugins/src/base/skills/lisa-github-add-journey/SKILL.md",
  "plugins/src/base/skills/lisa-jira-create/SKILL.md",
  "plugins/src/base/skills/lisa-jira-write-ticket/SKILL.md",
  "plugins/src/base/skills/lisa-jira-add-journey/SKILL.md",
  "plugins/src/base/skills/lisa-linear-create/SKILL.md",
  "plugins/src/base/skills/lisa-linear-write-issue/SKILL.md",
  "plugins/src/base/skills/lisa-linear-add-journey/SKILL.md",
  "plugins/src/base/skills/lisa-tracker-add-journey/SKILL.md",
] as const;

const CONSUMERS = [
  "plugins/src/base/skills/lisa-github-journey/SKILL.md",
  "plugins/src/base/skills/lisa-jira-journey/SKILL.md",
  "plugins/src/base/skills/lisa-linear-journey/SKILL.md",
  "plugins/src/base/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/src/base/skills/lisa-verification-lifecycle/SKILL.md",
] as const;

const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const VALIDATOR_SKILL_NAMES = [
  "lisa-github-validate-issue",
  "lisa-jira-validate-ticket",
  "lisa-linear-validate-issue",
] as const;

describe("non-claiming evidence references (#1595)", () => {
  it("defines one deterministic cross-work-item reference grammar", () => {
    const contract = read("plugins/src/base/rules/reference/verification.md");

    expect(contract).toContain(
      "[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]"
    );
    expect(contract).toMatch(/pointer only/i);
    expect(contract).toMatch(/never satisfies S14/i);
    expect(contract).toMatch(/never participates in marker-name uniqueness/i);
    expect(contract).toMatch(/never captured or checked/i);
    expect(contract).toMatch(
      /references but no local claiming marker still fails S14/i
    );
  });

  it.each(VALIDATORS)(
    "%s excludes references from every S14 manifest operation",
    validatorPath => {
      const validator = read(validatorPath);

      expect(validator).toContain(REFERENCE_GRAMMAR);
      expect(validator).toMatch(/exact `\[EVIDENCE:` prefix/);
      expect(validator).toMatch(/exclude it from the manifest/);
      expect(validator).toMatch(/minimum-marker count/);
      expect(validator).toMatch(/duplicate-name checks/);
      expect(validator).toMatch(/malformed reference FAILs S14/);
      expect(validator).toMatch(/untyped/i);
      expect(validator).toMatch(
        /contains only `EVIDENCE-REF` entries FAILs S14/
      );
    }
  );

  it.each([
    "plugins/src/base/skills/lisa-github-add-journey/SKILL.md",
    "plugins/src/base/skills/lisa-jira-add-journey/SKILL.md",
    "plugins/src/base/skills/lisa-linear-add-journey/SKILL.md",
  ])("%s repairs a reference-only existing journey", writerPath => {
    const writer = read(writerPath);

    expect(writer).toContain(REFERENCE_GRAMMAR);
    expect(writer).toMatch(
      /Stop only when that local marker exists|counts as complete only when/i
    );
    expect(writer).toMatch(
      /references? are present without a local claiming marker|references but no local claiming marker|reference-only journey is incomplete/i
    );
    expect(writer).toMatch(/preserve all .*EVIDENCE-REF.*pointers/i);
    expect(writer).toMatch(
      /Never create a second .*Validation Journey.*heading/i
    );
  });

  it.each(GENERATED_SKILL_ROOTS)(
    "%s carries the validator contract for every checked-in agent surface",
    root => {
      for (const skillName of VALIDATOR_SKILL_NAMES) {
        const validator = read(`${root}/${skillName}/SKILL.md`);
        expect(validator).toContain(REFERENCE_GRAMMAR);
        expect(validator).toMatch(/malformed reference FAILs S14/);
        expect(validator).toMatch(
          /contains only `EVIDENCE-REF` entries FAILs S14/
        );
      }
    }
  );

  it("installs built canonical skills into OpenCode verbatim", () => {
    const installer = read("src/opencode/skills-installer.ts");

    expect(installer).toMatch(/Copy one bundled skill folder verbatim/);
    expect(installer).toContain("await copyFile(srcPath, destPath)");
  });

  it.each(WRITERS)(
    "%s authors sibling references without claiming them",
    writerPath => {
      const writer = read(writerPath);

      expect(writer).toContain(REFERENCE_GRAMMAR);
      expect(writer).toMatch(
        /(?:non-claiming|without claiming|never replace|does not replace)/i
      );
      expect(writer).toMatch(
        /(?:cannot satisfy|never satisfies|never replace|does not replace).*S14/i
      );
    }
  );

  it.each(CONSUMERS)(
    "%s ignores references for capture and completion",
    consumerPath => {
      const consumer = read(consumerPath);

      expect(consumer).toContain(REFERENCE_GRAMMAR);
      expect(consumer).toMatch(/(?:do not|never|exclude)/i);
      expect(consumer).toMatch(/(?:capture|artifact lookup|local manifest)/i);
      expect(consumer).toMatch(/(?:S14|runtime-changing leaf)/i);
    }
  );

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
    item("Keep malformed [EVIDENCE-REF: ENG-123 | nope] as prose")
]}]
print(json.dumps(module.parse_steps(nodes)))
`;
    const result = spawnSync(PYTHON, ["-c", program], {
      encoding: "utf8",
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
    const result = spawnSync(PYTHON, ["-c", program], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
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
