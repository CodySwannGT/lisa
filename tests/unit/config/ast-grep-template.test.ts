/**
 * Regression coverage for Lisa-managed ast-grep templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AST_GREP = path.join(REPO_ROOT, "node_modules/.bin/ast-grep");
const AST_GREP_RULES = "ast-grep/rules";

/**
 * Read a repository file as UTF-8 text.
 * @param relativePath - Path relative to the repository root
 * @returns File contents
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/** Stack templates that ship an ast-grep payload. */
type Stack = "typescript" | "rails" | "phaser";

/**
 * Copy one stack's ast-grep template payload into a temporary project root.
 * @param stack - Stack template to copy
 * @returns Temporary project root
 */
function copyTemplateAstGrep(stack: Stack): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lisa-${stack}-sg-`));
  fs.cpSync(
    path.join(REPO_ROOT, stack, "copy-overwrite", AST_GREP_RULES, ".."),
    path.join(tempDir, "ast-grep"),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, stack, "copy-overwrite", "sgconfig.yml"),
    path.join(tempDir, "sgconfig.yml")
  );
  return tempDir;
}

/**
 * Run the copied stack rules against a planted violation.
 * @param stack - Stack template under test
 * @param filePath - Project-relative file to write and scan
 * @param source - Source text containing a violation
 * @param expectedRuleId - Rule id expected in ast-grep output
 */
function scanExpectingDiagnostic(
  stack: Stack,
  filePath: string,
  source: string,
  expectedRuleId: string
): void {
  const tempDir = copyTemplateAstGrep(stack);
  const absoluteFile = path.join(tempDir, filePath);
  let status: number | null = null;
  let output = "";

  fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
  fs.writeFileSync(absoluteFile, source, "utf-8");
  ({ status, stdout: output } = boundedSpawnSync({
    label: "ast-grep scan",
    command: AST_GREP,
    args: ["scan", "--json=compact", filePath],
    cwd: tempDir,
    baseMs: 30_000,
  }));

  fs.rmSync(tempDir, { recursive: true, force: true });
  expect(status).toBe(1);
  expect(output).toContain(expectedRuleId);
}

/** One ast-grep diagnostic, narrowed to the fields these tests assert on. */
type Diagnostic = {
  readonly ruleId: string;
  readonly text: string;
};

/**
 * Scan a planted source file with one stack's rules and return the diagnostics
 * attributable to a single rule.
 *
 * Returning the matches — rather than just an exit status — lets a test assert
 * that a rule stayed silent on legitimate code while another asserts it fired
 * on a violation. A rule that matches nothing at all passes a "no diagnostics"
 * assertion just as convincingly as a correct one, so the two assertions are
 * only meaningful as a pair.
 * @param stack - Stack template under test
 * @param filePath - Project-relative file to write and scan
 * @param source - Source text to scan
 * @param ruleId - Rule whose diagnostics should be returned
 * @returns Diagnostics produced by that rule
 */
function scanForRule(
  stack: Stack,
  filePath: string,
  source: string,
  ruleId: string
): readonly Diagnostic[] {
  const tempDir = copyTemplateAstGrep(stack);
  const absoluteFile = path.join(tempDir, filePath);
  let output = "";

  fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
  fs.writeFileSync(absoluteFile, source, "utf-8");
  ({ stdout: output } = boundedSpawnSync({
    label: "ast-grep scan",
    command: AST_GREP,
    args: ["scan", "--json=compact", filePath],
    cwd: tempDir,
    baseMs: 30_000,
  }));

  fs.rmSync(tempDir, { recursive: true, force: true });
  return (JSON.parse(output || "[]") as readonly Diagnostic[]).filter(
    diagnostic => diagnostic.ruleId === ruleId
  );
}

/**
 * Rule files that must agree on which `fs-extra` members are reachable.
 *
 * Both the stack template copies that ship to host projects and the mirrored
 * copies Lisa scans itself with. Including the mirrors pins them to the
 * template as a side effect: a mirror edited out of step with its source stops
 * matching real Node and fails here, rather than quietly protecting Lisa to a
 * different standard than the fleet.
 */
const FS_EXTRA_RULES = [
  "typescript/copy-overwrite/ast-grep/rules/no-missing-fs-extra-namespace-member.yml",
  "typescript/copy-overwrite/ast-grep/rules/no-missing-fs-extra-namespace-member-js.yml",
  "ast-grep/rules/no-missing-fs-extra-namespace-member.yml",
  "ast-grep/rules/no-missing-fs-extra-namespace-member-js.yml",
] as const;

/** Rule id of the TypeScript-language `fs-extra` namespace rule. */
const FS_EXTRA_RULE_ID = "no-missing-fs-extra-namespace-member";

/**
 * A namespace call to a member `fs-extra` does not expose under real Node.
 *
 * Shared so the "fires here / stays silent there" pairs differ only by file
 * path — if the source text varied between them, the comparison would prove
 * nothing about scoping.
 */
const FS_EXTRA_VIOLATION =
  'import * as fse from "fs-extra";\n\nexport const load = async () => await fse.readJson("a.json");\n';

/**
 * Read the `fs-extra` namespace keys as real Node resolves them.
 *
 * This is the anti-rot half of the control. The shipped ast-grep rules must
 * hardcode their allow list — ast-grep cannot resolve a module — so something
 * has to notice if `fs-extra` ever changes what its namespace exposes. Lisa
 * declares `fs-extra` as a real dependency, so it can run that probe centrally
 * on behalf of every host project, none of which declare `fs-extra` at all.
 * @returns Every own key on the Node-resolved namespace object
 */
function fsExtraNamespaceMembers(): ReadonlySet<string> {
  const script =
    'import * as fse from "fs-extra"; process.stdout.write(JSON.stringify(Object.keys(fse)));';
  return new Set(
    JSON.parse(
      boundedSpawnSync({
        label: "node -e over the fs-extra namespace",
        command: process.execPath,
        args: ["--input-type=module", "-e", script],
        cwd: REPO_ROOT,
      }).stdout
    ) as readonly string[]
  );
}

/**
 * Extract the member allow list from a rule file's `MEMBER` constraint.
 *
 * Throws rather than returning an empty set when the pattern does not match:
 * an extractor that quietly yields nothing would make the comparison below
 * pass against a rule file it never actually read.
 * @param relativePath - Rule file relative to the repository root
 * @returns Members the rule treats as reachable
 */
function allowListFromRule(relativePath: string): ReadonlySet<string> {
  const matched = /regex:\s*\^\((?<body>[^)]+)\)\$/u.exec(
    readText(relativePath)
  );
  const body = matched?.groups?.["body"];
  if (body === undefined || body.length === 0) {
    throw new Error(`No MEMBER allow list found in ${relativePath}`);
  }
  return new Set(body.split("|"));
}

describe("ast-grep stack templates", () => {
  it("ships real TypeScript rules into downstream TypeScript-family projects", () => {
    expect(readText("typescript/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "typescript/copy-overwrite/ast-grep/rules/no-inline-component-in-view.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "typescript",
      "src/features/demo/components/Foo/FooView.tsx",
      'const Foo = () => null;\nFoo.displayName = "Wrong";\n',
      "no-inline-component-in-view"
    );
  });

  it("flags fs-extra namespace members Node's ESM namespace does not expose", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, FS_EXTRA_RULES[0]))).toBe(true);

    scanExpectingDiagnostic(
      "typescript",
      "src/tools/build.ts",
      FS_EXTRA_VIOLATION,
      FS_EXTRA_RULE_ID
    );
  });

  it("leaves real fs-extra members, and default imports, alone", () => {
    // Proves the rule is actually loaded and firing in this harness. Without
    // it, the silence asserted below would be indistinguishable from a rule
    // that never ran.
    const violations = scanForRule(
      "typescript",
      "src/tools/violation.ts",
      FS_EXTRA_VIOLATION,
      FS_EXTRA_RULE_ID
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.text).toBe("fse.readJson");

    // `pathExists` is genuinely on the namespace, and the DEFAULT export
    // carries every member including `readJson` — flagging either would be a
    // fleet-wide false positive at error severity.
    const clean = scanForRule(
      "typescript",
      "src/tools/clean.ts",
      [
        'import * as fse from "fs-extra";',
        'import fseDefault from "fs-extra";',
        'import * as nodePath from "node:path";',
        "",
        "export const check = async () => {",
        '  if (await fse.pathExists("a")) {',
        '    await fse.ensureDir("b");',
        '    await fse.copy("b", "c");',
        '    await fse.remove("c");',
        "  }",
        '  await fseDefault.readJson("d.json");',
        '  return nodePath.join("a", "b");',
        "};",
        "",
      ].join("\n"),
      FS_EXTRA_RULE_ID
    );
    expect(clean).toEqual([]);
  });

  it("scopes the fs-extra rule to code Node runs directly, not test trees", () => {
    // Identical source, two locations. The rule is about "works under a
    // bundler, undefined under real Node", so it can only bite code Node
    // executes directly — Vitest and Jest hand back the default export's
    // properties, which is why test files may call these members forever
    // without being wrong. This mirrors the scope
    // tests/unit/core/fs-extra-namespace-callsites.test.ts already chose.
    const inSource = scanForRule(
      "typescript",
      "src/tools/loader.ts",
      FS_EXTRA_VIOLATION,
      FS_EXTRA_RULE_ID
    );
    const inTests = scanForRule(
      "typescript",
      "tests/unit/loader.test.ts",
      FS_EXTRA_VIOLATION,
      FS_EXTRA_RULE_ID
    );

    // Asserted as a pair: the source match is what proves the exclusion below
    // narrows the rule rather than disabling it.
    expect(inSource).toHaveLength(1);
    expect(inTests).toEqual([]);
  });

  it("keeps the hardcoded fs-extra allow list equal to what real Node exposes", () => {
    const actual = fsExtraNamespaceMembers();

    // Guards the probe itself: an empty set would satisfy every subset check
    // below while proving nothing about fs-extra.
    expect(actual.size).toBeGreaterThan(10);
    expect(actual.has("pathExists")).toBe(true);
    expect(actual.has("readJson")).toBe(false);

    const byName = (left: string, right: string): number =>
      left.localeCompare(right);
    const expected = [...actual].sort(byName);

    for (const rule of FS_EXTRA_RULES) {
      expect([...allowListFromRule(rule)].sort(byName)).toEqual(expected);
    }
  });

  it("ships Ruby security rules into downstream Rails projects", () => {
    expect(readText("rails/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "rails/copy-overwrite/ast-grep/rules/ruby/no-raw-sql-in-where.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "rails",
      "app/models/user.rb",
      'class User < ApplicationRecord\n  scope :active, -> { where("name = #{params[:name]}") }\nend\n',
      "no-raw-sql-in-where"
    );
  });

  it("ships Phaser ast-grep rules with the Phaser stack", () => {
    expect(readText("phaser/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "phaser/copy-overwrite/ast-grep/rules/phaser/no-canvas-renderer.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "phaser",
      "src/game/config.ts",
      "const renderer = Phaser.CANVAS;\n",
      "phaser-no-canvas-renderer"
    );
  });
});

/**
 * The four copies of the day-truncating age-predicate rule (#3905).
 *
 * Three ship to host projects and the fourth is what Lisa scans itself with.
 * They are asserted byte-identical for the same reason the `fs-extra` mirrors
 * are: a rule edited in one channel and not the others protects part of the
 * fleet to a different standard than the rest, silently.
 */
const AGE_PREDICATE_RULES = [
  "ast-grep/rules/no-day-truncating-file-age-predicate.yml",
  "typescript/copy-overwrite/ast-grep/rules/no-day-truncating-file-age-predicate.yml",
  "rails/copy-overwrite/ast-grep/rules/no-day-truncating-file-age-predicate.yml",
  "phaser/copy-overwrite/ast-grep/rules/no-day-truncating-file-age-predicate.yml",
] as const;

/**
 * The header every copy-overwrite template carries and no root mirror does.
 *
 * Enforced repo-wide by `tests/unit/templates/template-ownership-header.test.ts`
 * (#2547); restated here because this suite compares the two channels directly
 * and has to say which difference between them is sanctioned.
 */
const TEMPLATE_OWNERSHIP_HEADER =
  "# This file is managed by Lisa and IS replaced on each `lisa` run.\n" +
  "# Do not edit directly — durable changes belong upstream in Lisa.\n\n";

/** Rule id of the day-truncating age-predicate rule. */
const AGE_PREDICATE_RULE_ID = "no-day-truncating-file-age-predicate";

/**
 * A sweep written with the truncating flag.
 *
 * `+2` reads as "older than two days" and matches only files older than three,
 * so this script silently skips the 49h-71h band. The measurement behind that
 * claim lives in `tests/unit/core/find-age-predicate-truncation.test.ts`.
 */
const TRUNCATING_SWEEP =
  '#!/usr/bin/env bash\nfind "$TMPDIR" -maxdepth 1 -name "cdk.*" -mtime +2 -delete\n';

/**
 * The same sweep asking the question it means.
 *
 * Byte-for-byte the violation above apart from the predicate, so the silent
 * arm cannot pass for a reason the firing arm does not share.
 */
const MINUTE_SWEEP =
  '#!/usr/bin/env bash\nfind "$TMPDIR" -maxdepth 1 -name "cdk.*" -mmin +2880 -delete\n';

describe("the day-truncating age predicate rule (#3905)", () => {
  it.each(["typescript", "rails", "phaser"] as const)(
    "%s: flags -mtime in a shipped shell script",
    stack => {
      // Reach as much as correctness. The rule is `language: bash`, and a rule
      // over a language the scanner never classifies is a green control that
      // proves nothing — the failure mode this repository keeps finding.
      scanExpectingDiagnostic(
        stack,
        "scripts/sweep.sh",
        TRUNCATING_SWEEP,
        AGE_PREDICATE_RULE_ID
      );
    }
  );

  it.each(["typescript", "rails", "phaser"] as const)(
    "%s: stays silent on the -mmin form the shipped hooks use",
    stack => {
      // The paired half. Without it, a rule that matched nothing at all would
      // satisfy a "no diagnostics" assertion exactly as well as a correct one —
      // and this arm is what makes a future edit of a shipped hook from `-mmin`
      // to `-mtime` a failure rather than a silent change of question.
      expect(
        scanForRule(
          stack,
          "scripts/sweep.sh",
          MINUTE_SWEEP,
          AGE_PREDICATE_RULE_ID
        )
      ).toEqual([]);
    }
  );

  it("keeps all four copies identical below the ownership header", () => {
    const [canonical, ...mirrors] = AGE_PREDICATE_RULES;
    const expected = readText(canonical);

    // Asserted against the canonical text rather than pairwise, so four copies
    // that drifted together in the same wrong direction still fail one of the
    // behavioural arms above instead of agreeing quietly here.
    //
    // The shipped copies carry the two-line ownership header that every
    // copy-overwrite template carries and the root copy does not, so the header
    // is the only sanctioned difference — spelled out rather than stripped by a
    // loose prefix trim, which would also hide a real edit made above the id.
    expect(expected).toContain("regex: ^-(mtime|atime|ctime)$");
    for (const mirror of mirrors) {
      expect(readText(mirror), `${mirror} drifted from ${canonical}`).toBe(
        TEMPLATE_OWNERSHIP_HEADER + expected
      );
    }
  });
});
