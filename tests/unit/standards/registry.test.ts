import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness } from "../../../src/core/config.js";
import { resolveStandardsCheckPlan } from "../../../src/standards/registry.js";

let root: string | undefined;
const PACKAGE_JSON = "package.json";
const TYPESCRIPT_LINT_ID = "typescript.lint";
const TYPESCRIPT_TEST_ID = "typescript.test";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** Write the shared required threshold command. */
async function createThreshold(): Promise<void> {
  await mkdir(path.join(root!, "scripts"), { recursive: true });
  await writeFile(
    path.join(root!, "scripts/check-threshold-ratchet.mjs"),
    "process.exit(0);\n"
  );
}

/** Create one project with every managed required TypeScript script. */
async function createTypescript(): Promise<void> {
  root = await mkdtemp(path.join(tmpdir(), "lisa-standards-registry-"));
  await createThreshold();
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(
    path.join(root, PACKAGE_JSON),
    JSON.stringify({
      scripts: Object.fromEntries(
        [
          "lint",
          "lint:slow",
          "typecheck",
          "build",
          "test",
          "test:unit",
          "test:cov",
          "test:integration",
          "format:check",
          "knip:check",
          "sg:scan",
          "test:mutation",
        ].map(name => [name, 'node -e "process.exit(0)"'])
      ),
    })
  );
}

describe("standards check registry", () => {
  it("resolves the complete TypeScript registry and opt-in tests in order", async () => {
    await createTypescript();
    const manifest = JSON.parse(
      await readFile(path.join(root!, PACKAGE_JSON), "utf8")
    );
    manifest.scripts["test:e2e"] = "vitest run e2e";
    await writeFile(path.join(root!, PACKAGE_JSON), JSON.stringify(manifest));

    const plan = await resolveStandardsCheckPlan(
      root!,
      ["typescript", "expo"],
      {}
    );

    expect(plan.checks.map(check => check.id)).toEqual([
      TYPESCRIPT_LINT_ID,
      "typescript.lint-slow",
      "typescript.typecheck",
      "typescript.build",
      TYPESCRIPT_TEST_ID,
      "typescript.test-unit",
      "typescript.test-coverage",
      "typescript.test-integration",
      "typescript.test-e2e",
      "typescript.format",
      "typescript.dead-code",
      "typescript.ast-grep",
      "shared.threshold-ratchet",
    ]);
    expect(plan.registryDigest).toMatch(/^sha256:[a-f\d]{64}$/u);
    expect(
      plan.checks.find(check => check.id === TYPESCRIPT_TEST_ID)?.testEvidence
    ).toBe("managed");
  });

  it("resolves Rails and deterministic TypeScript/Rails union checks", async () => {
    await createTypescript();
    const rails = await resolveStandardsCheckPlan(root!, ["rails"], {});
    expect(rails.checks.map(check => check.id)).toEqual(
      expect.arrayContaining(["rails.rubocop", "rails.rspec", "rails.brakeman"])
    );
    const union = await resolveStandardsCheckPlan(
      root!,
      ["typescript", "rails"],
      {}
    );
    expect(union.checks[0]?.id).toBe(TYPESCRIPT_LINT_ID);
    expect(
      union.checks.find(check => check.id === "rails.rspec")
    ).toBeDefined();
    expect(union.checks.at(-1)?.id).toBe("shared.threshold-ratchet");
  });

  it("fails when a required managed command is missing", async () => {
    await createTypescript();
    const manifest = JSON.parse(
      await readFile(path.join(root!, PACKAGE_JSON), "utf8")
    );
    delete manifest.scripts.typecheck;
    await writeFile(path.join(root!, PACKAGE_JSON), JSON.stringify(manifest));
    await expect(
      resolveStandardsCheckPlan(root!, ["typescript"], {})
    ).rejects.toThrow("typecheck");
  });

  it("uses one agent-neutral registry for every supported harness", async () => {
    await createTypescript();
    const harnesses: readonly Harness[] = [
      "claude",
      "codex",
      "cursor",
      "opencode",
      "agy",
      "copilot",
      "fleet",
    ];
    const plans = await Promise.all(
      harnesses.map(
        async harness =>
          await resolveStandardsCheckPlan(root!, ["typescript"], {
            harness,
            tracker: harness,
          })
      )
    );
    plans.forEach(current => {
      expect(current.checks.map(check => check.id)).toEqual(
        plans[0]?.checks.map(check => check.id)
      );
      expect(current.configDigest).toBe(plans[0]?.configDigest);
    });

    const qualityChanged = await resolveStandardsCheckPlan(
      root!,
      ["typescript"],
      { quality: { testCoverage: { global: { lines: 99 } } } }
    );
    expect(qualityChanged.configDigest).not.toBe(plans[0]?.configDigest);
  });

  it("includes the locally enforced Phaser verification-coverage guardrail", async () => {
    await createTypescript();
    await writeFile(
      path.join(root!, "scripts/check-verification-coverage.mjs"),
      "process.exit(0);\n"
    );

    const plan = await resolveStandardsCheckPlan(
      root!,
      ["typescript", "phaser"],
      {}
    );
    expect(
      plan.checks.find(check => check.id === "phaser.verification-coverage")
    ).toMatchObject({
      argv: ["node", "scripts/check-verification-coverage.mjs"],
      environment: {
        VERIFY_BASE_SHA: "HEAD^",
        VERIFY_HEAD_SHA: "HEAD",
      },
    });
  });

  it("matches shipped TypeScript scripts and quality workflow gates", async () => {
    await createTypescript();
    const [templateText, workflow] = await Promise.all([
      readFile(
        path.join(process.cwd(), "typescript/package-lisa/package.lisa.json"),
        "utf8"
      ),
      readFile(
        path.join(process.cwd(), ".github/workflows/quality.yml"),
        "utf8"
      ),
    ]);
    const template = JSON.parse(templateText);
    const shippedScripts = {
      ...template.force.scripts,
      ...template.defaults.scripts,
    } as Record<string, string>;
    const plan = await resolveStandardsCheckPlan(root!, ["typescript"], {});
    const requiredScripts = new Map([
      [TYPESCRIPT_LINT_ID, "lint"],
      ["typescript.lint-slow", "lint:slow"],
      ["typescript.typecheck", "typecheck"],
      ["typescript.build", "build"],
      [TYPESCRIPT_TEST_ID, "test"],
      ["typescript.test-unit", "test:unit"],
      ["typescript.test-coverage", "test:cov"],
      ["typescript.test-integration", "test:integration"],
      ["typescript.format", "format:check"],
      ["typescript.dead-code", "knip:check"],
      ["typescript.ast-grep", "sg:scan"],
    ]);

    for (const [id, script] of requiredScripts) {
      expect(shippedScripts[script], `${script} is shipped`).toBeTypeOf(
        "string"
      );
      expect(
        plan.checks.find(check => check.id === id)?.argv.at(-1),
        `${id} invokes its shipped script`
      ).toBe(script);
    }
    for (const job of [
      "lint",
      "lint_slow",
      "typecheck",
      "test",
      "verification_coverage",
      "test_unit",
      "test_integration",
      "format",
      "build",
      "dead_code",
      "sg_scan",
    ]) {
      expect(workflow).toMatch(new RegExp(`^  ${job}:`, "mu"));
    }
    expect(workflow).toContain(
      "run: node scripts/check-verification-coverage.mjs"
    );
    expect(workflow).toContain("run: ${{ inputs.package_manager }} run build");

    const phaserWorkflow = await readFile(
      path.join(
        process.cwd(),
        "phaser/copy-overwrite/.github/workflows/ci.yml"
      ),
      "utf8"
    );
    expect(phaserWorkflow).toContain("verify_enforced: true");
  });
});
