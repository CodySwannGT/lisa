/** The shared parser must run under Node in an applied host with no app dist. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";

import {
  upsertLisaUsageSection,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("portable canonical usage reader", () => {
  it("preserves the public literal heading type through both consumer entry points", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-usage-types-"));
    roots.push(root);
    const consumer = path.join(root, "consumer.mts");
    writeFileSync(
      consumer,
      [
        `import {LISA_USAGE_HEADING as shipped} from ${JSON.stringify(path.join(process.cwd(), "all/copy-overwrite/scripts/lib/usage-ledger.mjs"))};`,
        `import {LISA_USAGE_HEADING as facade} from ${JSON.stringify(path.join(process.cwd(), "src/utils/usage-accounting.js"))};`,
        'const direct: "## Lisa Usage" = shipped;',
        'const throughFacade: "## Lisa Usage" = facade;',
        "export {direct, throughFacade};",
      ].join("\n")
    );
    const config = ts.readConfigFile(
      path.join(process.cwd(), "tsconfig.json"),
      ts.sys.readFile
    );
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      process.cwd()
    );
    const options = { ...parsed.options };
    delete options.rootDir;
    delete options.outDir;
    const program = ts.createProgram([consumer], {
      ...options,
      noEmit: true,
      incremental: false,
      composite: false,
      types: [...new Set([...(parsed.options.types ?? []), "node"])],
      typeRoots: [
        ...(parsed.options.typeRoots ?? []),
        path.join(process.cwd(), "node_modules/@types"),
      ],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });

  it("parses stored Verify usage and null acceptance in an applied Node host without app dist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-usage-host-"));
    roots.push(root);
    const lib = path.join(root, "scripts/lib");
    mkdirSync(lib, { recursive: true });
    for (const file of [
      "usage-ledger.mjs",
      "usage-ledger-integrity.mjs",
      "usage-effectiveness.mjs",
    ])
      copyFileSync(
        path.join(process.cwd(), "all/copy-overwrite/scripts/lib", file),
        path.join(lib, file)
      );
    const entry: LisaUsageEntry = {
      artifactRef: "github:acme/code#42",
      cachedInputTokens: null,
      cost: null,
      currency: null,
      entryId: "verify-fixture",
      flow: "lisa-verify",
      inputTokens: null,
      model: "fixture-runtime",
      outputTokens: null,
      parentArtifactRef: null,
      pricingSource: null,
      pricingStatus: "unavailable",
      provider: "fixture",
      reasoningTokens: null,
      runId: "owned-fixture-run",
      source: "unavailable",
      totalTokens: null,
      effectiveness: {
        schema: 1,
        lisaVersion: null,
        workerConfigRevision: null,
        workerWallMs: null,
        feedbackMs: null,
        workerSource: null,
        attention: null,
        readyAt: null,
        acceptedAt: null,
        lifecycleSources: null,
        reworkSources: null,
      },
    };
    writeFileSync(
      path.join(root, "body.md"),
      upsertLisaUsageSection("# Applied host\n", { entries: [entry] })
    );
    writeFileSync(
      path.join(root, "check.mjs"),
      [
        'import {readFileSync,existsSync} from "node:fs";',
        'import assert from "node:assert/strict";',
        'import {parseLisaUsageSection} from "./scripts/lib/usage-ledger.mjs";',
        'import {verifyLisaUsageSectionIntegrity} from "./scripts/lib/usage-ledger-integrity.mjs";',
        'const body=readFileSync("body.md","utf8");',
        "const parsed=parseLisaUsageSection(body);",
        'assert.equal(verifyLisaUsageSectionIntegrity(body,{entryIds:["verify-fixture"]}).ok,true);',
        "assert.equal(parsed.entries[0].effectiveness.acceptedAt,null);",
        'assert.equal(existsSync("dist"),false);',
        'console.log(JSON.stringify({entry:parsed.entries[0],appDistPresent:existsSync("dist")}));',
      ].join("\n")
    );
    const result = boundedSpawnSync({
      label: "applied-host canonical usage reader",
      command: process.execPath,
      args: ["check.mjs"],
      cwd: root,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      entry: { ...entry, measuredSubsetTokens: null },
      appDistPresent: false,
    });
    expect(existsSync(path.join(root, "dist"))).toBe(false);
  });
});
