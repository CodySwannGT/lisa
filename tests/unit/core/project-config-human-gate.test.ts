/**
 * `humanGate` is an optional, degrade-not-throw config block
 * (CodySwannGT/lisa#4687).
 *
 * `humanGate.mode` decides how wide the human gate is: `"access-only"` (the
 * default) gates only acts an agent genuinely lacks access to, and `"strict"`
 * restores the pre-#4687 gates and the stricter defaults of
 * `dependencies.humanSignOff` and `learnings.lowConfidence`. An invalid value
 * must never stop `lisa apply`; it fails safe, to `"strict"`, and is reported,
 * because a typo must never quietly loosen the gate.
 * @module tests/unit/core/project-config-human-gate
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  validateProjectConfig,
} from "../../../src/core/project-config.js";
import {
  DEFAULT_HUMAN_GATE_MODE,
  HUMAN_GATE_MODES,
  humanGateSettingsWarnings,
  resolveHumanGateSettings,
  validateHumanGateConfig,
} from "../../../src/core/project-config-human-gate.js";
import {
  DEFAULT_HUMAN_GATE_MODE as SCRIPT_DEFAULT_MODE,
  HUMAN_GATE_MODES as SCRIPT_MODES,
} from "../../../plugins/src/base/scripts/human-gate-act.mjs";
import { resolveDependencySettings } from "../../../src/core/project-config-dependencies.js";
import { resolveLearningsSettings } from "../../../src/core/project-config-learnings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SOURCE = ".lisa.config.json";
const STRICT = "strict";
const ACCESS_ONLY = "access-only";
const AUTO_MERGE = "auto-merge";
const HUMAN_TRIAGE = "human-triage";

describe("humanGate.mode vocabulary", () => {
  it("is the closed pair access-only | strict, defaulting to access-only", () => {
    expect(HUMAN_GATE_MODES).toEqual([ACCESS_ONLY, STRICT]);
    expect(DEFAULT_HUMAN_GATE_MODE).toBe(ACCESS_ONLY);
  });

  it("agrees with the shipped classifier's copy", () => {
    // The classifier ships inside a plugin payload and cannot import this
    // module, so the two vocabularies are pinned together here.
    expect([...SCRIPT_MODES]).toEqual([...HUMAN_GATE_MODES]);
    expect(SCRIPT_DEFAULT_MODE).toBe(DEFAULT_HUMAN_GATE_MODE);
  });
});

describe("resolveHumanGateSettings", () => {
  it("resolves an absent block to access-only with no classes", () => {
    expect(resolveHumanGateSettings({})).toEqual({
      mode: ACCESS_ONLY,
      humanOnly: [],
      declared: false,
      rejected: [],
    });
  });

  it.each([ACCESS_ONLY, STRICT] as const)("honours a declared %s", mode => {
    expect(
      resolveHumanGateSettings(
        validateProjectConfig({ humanGate: { mode } }, SOURCE)
      )
    ).toEqual({ mode, humanOnly: [], declared: true, rejected: [] });
  });

  it.each([" Strict ", "STRICT", "strict\n"])(
    "normalizes the declared mode %j to strict",
    mode => {
      const config = validateProjectConfig({ humanGate: { mode } }, SOURCE);
      expect(resolveHumanGateSettings(config)).toEqual({
        mode: STRICT,
        humanOnly: [],
        declared: true,
        rejected: [],
      });
      expect(resolveDependencySettings(config).humanSignOff).toBe("default");
    }
  );

  it("carries declared humanOnly classes", () => {
    expect(
      resolveHumanGateSettings(
        validateProjectConfig(
          { humanGate: { mode: STRICT, humanOnly: ["pricing", "hiring"] } },
          SOURCE
        )
      ).humanOnly
    ).toEqual(["pricing", "hiring"]);
  });

  it.each([["strcit"], ["lenient"], [""], [true], [0], [null], [[STRICT]]])(
    "fails the invalid mode %j safe, to strict, and reports it",
    mode => {
      const settings = resolveHumanGateSettings(
        validateProjectConfig({ humanGate: { mode } }, SOURCE)
      );
      expect(settings.mode).toBe(STRICT);
      expect(settings.rejected).toEqual([
        { key: "humanGate.mode", value: JSON.stringify(mode) },
      ]);
    }
  );

  it("drops non-string humanOnly entries and reports them", () => {
    const settings = resolveHumanGateSettings(
      validateProjectConfig(
        { humanGate: { humanOnly: ["pricing", 7] } },
        SOURCE
      )
    );
    expect(settings.humanOnly).toEqual(["pricing"]);
    expect(settings.rejected).toEqual([
      { key: "humanGate.humanOnly", value: '["pricing",7]' },
    ]);
  });

  it("treats a non-array humanOnly as no classes and reports it", () => {
    const settings = resolveHumanGateSettings(
      validateProjectConfig({ humanGate: { humanOnly: "pricing" } }, SOURCE)
    );
    expect(settings.humanOnly).toEqual([]);
    expect(settings.rejected).toEqual([
      { key: "humanGate.humanOnly", value: '"pricing"' },
    ]);
  });

  it.each([["strict"], [null], [[STRICT]], [7]])(
    "degrades a non-object block %j instead of throwing",
    value => {
      expect(validateHumanGateConfig(value, SOURCE)).toEqual({
        rejectedBlock: value,
      });
      const settings = resolveHumanGateSettings(
        validateProjectConfig({ humanGate: value }, SOURCE)
      );
      expect(settings.mode).toBe(STRICT);
      expect(settings.rejected).toEqual([
        { key: "humanGate", value: JSON.stringify(value) },
      ]);
    }
  );
});

describe("humanGateSettingsWarnings", () => {
  it("is silent for absent and valid blocks", () => {
    expect(humanGateSettingsWarnings({})).toEqual([]);
    expect(
      humanGateSettingsWarnings(
        validateProjectConfig(
          { humanGate: { mode: STRICT, humanOnly: ["pricing"] } },
          SOURCE
        )
      )
    ).toEqual([]);
  });

  it("names the rejected mode, the vocabulary, and the fallback", () => {
    const [warning] = humanGateSettingsWarnings(
      validateProjectConfig({ humanGate: { mode: "lenient" } }, SOURCE)
    );
    expect(warning).toContain("humanGate.mode");
    expect(warning).toContain('"lenient"');
    expect(warning).toContain('"access-only" | "strict"');
    expect(warning).toContain('treated as "strict"');
  });

  it("names a non-object block", () => {
    const [warning] = humanGateSettingsWarnings(
      validateProjectConfig({ humanGate: "strict" }, SOURCE)
    );
    expect(warning).toContain("Invalid humanGate in .lisa.config.json");
    expect(warning).toContain("is not an object");
  });
});

describe("mode-aware defaults", () => {
  it("defaults humanSignOff to none under access-only and default under strict", () => {
    expect(resolveDependencySettings({}).humanSignOff).toBe("none");
    expect(
      resolveDependencySettings(
        validateProjectConfig({ humanGate: { mode: STRICT } }, SOURCE)
      ).humanSignOff
    ).toBe("default");
  });

  it("defaults lowConfidence to auto-merge under access-only and human-triage under strict", () => {
    expect(resolveLearningsSettings({}).lowConfidence).toBe(AUTO_MERGE);
    expect(
      resolveLearningsSettings(
        validateProjectConfig({ humanGate: { mode: STRICT } }, SOURCE)
      ).lowConfidence
    ).toBe(HUMAN_TRIAGE);
  });

  it("lets an explicit value win over either mode", () => {
    const access = validateProjectConfig(
      {
        dependencies: { humanSignOff: "default" },
        learnings: { lowConfidence: HUMAN_TRIAGE },
      },
      SOURCE
    );
    expect(resolveDependencySettings(access).humanSignOff).toBe("default");
    expect(resolveLearningsSettings(access).lowConfidence).toBe(HUMAN_TRIAGE);
    const strict = validateProjectConfig(
      {
        humanGate: { mode: STRICT },
        dependencies: { humanSignOff: "none" },
        learnings: { lowConfidence: AUTO_MERGE },
      },
      SOURCE
    );
    expect(resolveDependencySettings(strict).humanSignOff).toBe("none");
    expect(resolveLearningsSettings(strict).lowConfidence).toBe(AUTO_MERGE);
  });

  it("reads an invalid mode as strict for the defaults too", () => {
    const config = validateProjectConfig({ humanGate: { mode: "x" } }, SOURCE);
    expect(resolveDependencySettings(config).humanSignOff).toBe("default");
    expect(resolveLearningsSettings(config).lowConfidence).toBe(HUMAN_TRIAGE);
  });

  it("routes an unvalidated invalid lowConfidence to human-triage", () => {
    expect(
      resolveLearningsSettings({
        learnings: { lowConfidence: "sometimes" as never },
      }).lowConfidence
    ).toBe(HUMAN_TRIAGE);
  });
});

describe("readProjectConfig carries the humanGate block", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reads a declared strict mode and an invalid one without failing", async () => {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      humanGate: { mode: STRICT },
    });
    const strict = await readProjectConfig(tempDir);
    expect(resolveHumanGateSettings(strict).mode).toBe(STRICT);
    expect(resolveDependencySettings(strict).humanSignOff).toBe("default");
    expect(resolveLearningsSettings(strict).lowConfidence).toBe(HUMAN_TRIAGE);

    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      humanGate: { mode: "sometimes" },
    });
    const invalid = await readProjectConfig(tempDir);
    expect(resolveHumanGateSettings(invalid).mode).toBe(STRICT);
    expect(humanGateSettingsWarnings(invalid)).toHaveLength(1);
  });
});
