/**
 * Unit tests for the pure functions of scripts/check-duplicate-versions.mjs
 * (issue #1888).
 *
 * Split from `check-duplicate-versions.test.ts`, which owns the end-to-end,
 * Validation-Journey, and CI-wiring surfaces. Every expectation here is a
 * HARDCODED known value per the Test Isolation house rule — never computed by
 * calling the function under test.
 *
 * The emphasis is the bounded-false-positive acceptance criterion: most of
 * these cases assert what the detector must NOT treat as a manifest-
 * authoritative duplicate.
 *
 * @module tests/unit/scripts/check-duplicate-versions.units
 */
import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  collectManifestPins,
  findExceptionReason,
  isCommentLine,
  isGovernedFile,
  matchInstallPins,
  matchToolchainPins,
  normalizeVersion,
  parseArgs,
  scanContents,
  UsageError,
} from "../../../scripts/check-duplicate-versions.mjs";
import {
  AST_GREP_VERSION,
  BUN_VERSION,
  INDENTED_BUN_PIN,
  MANIFEST_FIELD_AST_GREP,
  MANIFEST_FIELD_BUN,
  MANIFEST_FIELD_NODE,
  NODE_VERSION,
  WORKFLOW_FILE,
} from "./check-duplicate-versions-helpers";
describe("normalizeVersion", () => {
  it("strips range operators", () => {
    expect(normalizeVersion("^0.40.4")).toBe("0.40.4");
    expect(normalizeVersion("~1.3.8")).toBe("1.3.8");
    expect(normalizeVersion(">=22.21.1")).toBe("22.21.1");
    expect(normalizeVersion("1.3.8")).toBe("1.3.8");
  });
});

describe("collectManifestPins", () => {
  it("collects dependency and engine pins from a plain manifest", () => {
    const pins = collectManifestPins(
      {
        dependencies: { "@ast-grep/cli": "^0.40.4" },
        devDependencies: { typescript: "^6.0.3" },
        engines: { bun: "1.3.8", npm: "please-use-bun" },
      },
      "package.json"
    );

    expect(pins.packages["@ast-grep/cli"]).toEqual({
      version: AST_GREP_VERSION,
      field: MANIFEST_FIELD_AST_GREP,
    });
    expect(pins.packages["typescript"]?.version).toBe("6.0.3");
    expect(pins.engines["bun"]).toEqual({
      version: BUN_VERSION,
      field: MANIFEST_FIELD_BUN,
    });
    // Non-version engine sentinels are not pins.
    expect(pins.engines["npm"]).toBeUndefined();
  });

  it("unwraps Lisa's force/defaults governance sections", () => {
    const pins = collectManifestPins(
      {
        force: { devDependencies: { eslint: "^9.0.0" } },
        defaults: { engines: { node: "22.21.1" } },
      },
      "package.lisa.json"
    );

    expect(pins.packages["eslint"]).toEqual({
      version: "9.0.0",
      field: "package.lisa.json force.devDependencies.eslint",
    });
    expect(pins.engines["node"]).toEqual({
      version: NODE_VERSION,
      field: "package.lisa.json defaults.engines.node",
    });
  });
});

describe("isGovernedFile", () => {
  it("accepts governed workflow, script, and template surfaces", () => {
    expect(isGovernedFile(".github/workflows/ci.yml")).toBe(true);
    expect(isGovernedFile("scripts/setup.sh")).toBe(true);
    expect(isGovernedFile("scripts/tool.mjs")).toBe(true);
  });

  it("rejects non-policy surfaces", () => {
    expect(isGovernedFile("bun.lock")).toBe(false);
    expect(isGovernedFile("package-lock.json")).toBe(false);
    expect(isGovernedFile("yarn.lock")).toBe(false);
    expect(isGovernedFile("README.md")).toBe(false);
    expect(isGovernedFile("package.json")).toBe(false);
    expect(isGovernedFile("package.lisa.json")).toBe(false);
    expect(isGovernedFile("node_modules/foo/index.js")).toBe(false);
    expect(isGovernedFile("dist/index.js")).toBe(false);
    expect(isGovernedFile(".lisa/PROJECT_LEARNINGS.md")).toBe(false);
    expect(isGovernedFile("evidence/upstream-evidence-manifest.json")).toBe(
      false
    );
  });
});

describe("isCommentLine", () => {
  it("recognizes comment leaders across governed languages", () => {
    expect(isCommentLine("# bun-version: '1.3.8'")).toBe(true);
    expect(isCommentLine("  // npm i -g pkg@1.2.3")).toBe(true);
    expect(isCommentLine(" * npm i -g pkg@1.2.3")).toBe(true);
    expect(isCommentLine("run: npm i -g pkg@1.2.3")).toBe(false);
  });
});

describe("matchInstallPins", () => {
  const packages = {
    "@ast-grep/cli": {
      version: AST_GREP_VERSION,
      field: MANIFEST_FIELD_AST_GREP,
    },
  };

  it("matches a manifest-known package in an install command", () => {
    expect(
      matchInstallPins(
        "        run: npm install -g @ast-grep/cli@0.40.4",
        packages
      )
    ).toEqual([
      {
        package: "@ast-grep/cli",
        version: AST_GREP_VERSION,
        manifestVersion: "0.40.4",
        manifestField: MANIFEST_FIELD_AST_GREP,
        source: "install-pin",
      },
    ]);
  });

  it("matches a drifted literal for the same package", () => {
    const [match] = matchInstallPins(
      "run: bunx @ast-grep/cli@0.99.0",
      packages
    );
    expect(match?.version).toBe("0.99.0");
    expect(match?.manifestVersion).toBe("0.40.4");
  });

  it("ignores lines with no package-manager command", () => {
    expect(matchInstallPins("image: @ast-grep/cli@0.40.4", packages)).toEqual(
      []
    );
  });

  it("ignores packages the manifest does not pin", () => {
    expect(matchInstallPins("run: npm i -g other@1.2.3", packages)).toEqual([]);
  });

  it("ignores action refs and non-literal versions", () => {
    expect(matchInstallPins("run: npx @ast-grep/cli@latest", packages)).toEqual(
      []
    );
  });
});

describe("matchToolchainPins", () => {
  const engines = {
    bun: { version: BUN_VERSION, field: MANIFEST_FIELD_BUN },
    node: { version: NODE_VERSION, field: MANIFEST_FIELD_NODE },
  };

  it("matches hyphen and underscore spellings", () => {
    expect(matchToolchainPins(INDENTED_BUN_PIN, engines)).toEqual([
      {
        package: "bun",
        version: BUN_VERSION,
        manifestVersion: "1.3.8",
        manifestField: MANIFEST_FIELD_BUN,
        source: "toolchain-pin",
      },
    ]);
    expect(
      matchToolchainPins("      node_version: '22.21.1'", engines)[0]?.package
    ).toBe("node");
  });

  it("ignores loose ranges that are not literal duplicates", () => {
    expect(matchToolchainPins("node-version: '22.x'", engines)).toEqual([]);
    expect(matchToolchainPins("node-version: 'lts/*'", engines)).toEqual([]);
  });

  it("ignores engines the manifest does not pin", () => {
    expect(matchToolchainPins("bun-version: '1.3.8'", {})).toEqual([]);
  });
});

describe("findExceptionReason", () => {
  const lines = [
    "          # lisa-allow-duplicate-version: migration in flight (#1888)",
    INDENTED_BUN_PIN,
    "          node-version: '22.21.1'",
    "run: npm i -g pkg@1.2.3 # lisa-allow-duplicate-version: same-line reason",
    "          # lisa-allow-duplicate-version:",
    INDENTED_BUN_PIN,
  ];

  it("honors a marker on the line above", () => {
    expect(findExceptionReason(lines, 1)).toBe("migration in flight (#1888)");
  });

  it("honors a marker on the same line", () => {
    expect(findExceptionReason(lines, 3)).toBe("same-line reason");
  });

  it("does not leak an exception to unrelated lines", () => {
    expect(findExceptionReason(lines, 2)).toBeNull();
  });

  it("rejects a marker with no reason", () => {
    expect(findExceptionReason(lines, 5)).toBeNull();
  });
});

describe("classifyStatus", () => {
  it("classifies matching, drifted, and excepted literals", () => {
    expect(classifyStatus("1.3.8", "1.3.8", null)).toBe("duplicate");
    expect(classifyStatus("1.3.7", "1.3.8", null)).toBe("drifted");
    expect(classifyStatus("1.3.8", "1.3.8", "migration (#1888)")).toBe(
      "allowed"
    );
  });
});

describe("scanContents", () => {
  const pins = {
    packages: {
      "@ast-grep/cli": {
        version: AST_GREP_VERSION,
        field: MANIFEST_FIELD_AST_GREP,
      },
    },
    engines: { bun: { version: BUN_VERSION, field: MANIFEST_FIELD_BUN } },
  };

  it("reports one-based line numbers", () => {
    const findings = scanContents(
      ["steps:", "  - run: npm i -g @ast-grep/cli@0.40.4"].join("\n"),
      WORKFLOW_FILE,
      pins
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
    expect(findings[0]?.file).toBe(WORKFLOW_FILE);
  });

  it("skips commented pins entirely", () => {
    expect(
      scanContents("# run: npm i -g @ast-grep/cli@0.40.4", WORKFLOW_FILE, pins)
    ).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to advisory mode and the default scan set", () => {
    const options = parseArgs([]);
    expect(options.strict).toBe(false);
    expect(options.json).toBe(false);
    expect(options.scan).toContain(".github/workflows");
    expect(options.scan).toContain("scripts");
  });

  it("collects repeated --scan values", () => {
    expect(parseArgs(["--scan", "scripts", "--scan", "cdk"]).scan).toEqual([
      "scripts",
      "cdk",
    ]);
  });

  it("throws UsageError on a flag missing its value", () => {
    expect(() => parseArgs(["--scan"])).toThrow(UsageError);
    expect(() => parseArgs(["--root", "--json"])).toThrow(UsageError);
  });

  it("throws UsageError on an unknown flag", () => {
    expect(() => parseArgs(["--wat"])).toThrow(UsageError);
  });

  it("throws UsageError when --root is not a directory", () => {
    expect(() => parseArgs(["--root", "/definitely/not/here"])).toThrow(
      UsageError
    );
  });
});
