#!/usr/bin/env node
/**
 * Fix test assertions and a few skill references after lisa-* skill / lisa: command namespace migration.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} file */
function patchFile(file, replacements) {
  let content = readFileSync(file, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(file, content);
    console.log("patched", path.relative(ROOT, file));
  }
}

const testPatches = [
  // The phrase-only suites this also patched were folded into the phrase
  // manifest (CodySwannGT/lisa#4609), and their wording pins were later
  // culled (CodySwannGT/lisa#4867), so they no longer appear here.
  // agent-transformer output uses normalized skill names
  [
    "tests/unit/codex/agent-transformer.test.ts",
    [
      [
        'expect(instructions).toContain("- bug-triage");',
        'expect(instructions).toContain("- lisa-bug-triage");',
      ],
      [
        'expect(instructions).toContain("- tdd-implementation");',
        'expect(instructions).toContain("- lisa-tdd-implementation");',
      ],
      [
        'expect(instructions).toContain("- jsdoc-best-practices");',
        'expect(instructions).toContain("- lisa-jsdoc-best-practices");',
      ],
    ],
  ],
  [
    "tests/unit/opencode/agent-transformer.test.ts",
    [
      [
        'expect(out).toContain("- codebase-research");',
        'expect(out).toContain("- lisa-codebase-research");',
      ],
      [
        'expect(out).toContain("- task-decomposition");',
        'expect(out).toContain("- lisa-task-decomposition");',
      ],
    ],
  ],
  // Stack / codex tests: exploratory-qa is not lisa-prefixed in frontmatter
  [
    "tests/unit/codex/skill-frontmatter-parser.test.ts",
    [['name: "lisa-exploratory-qa"', 'name: "exploratory-qa"']],
  ],
  [
    "tests/unit/codex/skill-agents-walk.test.ts",
    [
      [
        'const EXPLORATORY_QA = "lisa-exploratory-qa";',
        'const EXPLORATORY_QA = "exploratory-qa";',
      ],
    ],
  ],
  // harper-fabric template script name unchanged
  [
    "tests/unit/strategies/harper-fabric-template-no-advisory-pollution.test.ts",
    [['"lisa-verify"', '"verify"']],
  ],
  // cli doctor subcommand name unchanged
  [
    "tests/unit/cli/index.test.ts",
    [
      [
        'expect.arrayContaining(["version", "update", "lisa-doctor"])',
        'expect.arrayContaining(["version", "update", "doctor"])',
      ],
      [
        '["lisa-doctor", DEST, "--json", "--offline"]',
        '["doctor", DEST, "--json", "--offline"]',
      ],
    ],
  ],
  // usage-accounting openai token
  [
    "tests/unit/strategies/usage-accounting-skill.test.ts",
    [['"Use $usage-accounting:', '"Use $lisa-usage-accounting:']],
  ],
];

for (const [rel, replacements] of testPatches) {
  patchFile(path.join(ROOT, rel), replacements);
}

// Stack e2e-coverage-gaps: skill refs use hyphen namespace
for (const stack of ["expo", "rails", "harper-fabric"]) {
  const skillPath = path.join(
    ROOT,
    "plugins/src",
    stack,
    "skills/e2e-coverage-gaps/SKILL.md"
  );
  patchFile(skillPath, [
    ["lisa:tracker-write", "lisa-tracker-write"],
    ["`exploratory-qa`", "`lisa-exploratory-qa`"],
    ["exploratory-qa skill", "lisa-exploratory-qa skill"],
  ]);
}

// Base writer skills: reference lisa-usage-accounting skill slug
const writerSkills = [
  "lisa-tracker-write",
  "lisa-prd-source-write",
  "lisa-github-write-prd",
  "lisa-github-write-issue",
  "lisa-linear-write-prd",
  "lisa-linear-write-issue",
  "lisa-jira-write-ticket",
  "lisa-notion-write-prd",
  "lisa-confluence-write-prd",
];
for (const slug of writerSkills) {
  const skillPath = path.join(
    ROOT,
    "plugins/src/base/skills",
    slug,
    "SKILL.md"
  );
  patchFile(skillPath, [
    ["`usage-accounting`", "`lisa-usage-accounting`"],
    ["usage-accounting` contract", "lisa-usage-accounting` contract"],
    ["shared `usage-accounting`", "shared `lisa-usage-accounting`"],
  ]);
}

// prd-lifecycle-rollup Citation section skill slugs
patchFile(
  path.join(ROOT, "plugins/src/base/rules/reference/prd-lifecycle-rollup.md"),
  [
    ["(`prd-backlink`)", "(`lisa-prd-backlink`)"],
    ["(`prd-ticket-coverage`)", "(`lisa-prd-ticket-coverage`)"],
    ["(`github-prd-intake`)", "(`lisa-github-prd-intake`)"],
    [
      "(`linear-prd-intake`, `confluence-prd-intake`, `notion-prd-intake`)",
      "(`lisa-linear-prd-intake`, `lisa-confluence-prd-intake`, `lisa-notion-prd-intake`)",
    ],
    ["(`repair-intake`)", "(`lisa-repair-intake`)"],
  ]
);

console.log("done");
