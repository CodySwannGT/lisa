/**
 * Doctor coverage for host CodeRabbit configs that let the bot write Lisa's
 * lifecycle labels.
 *
 * From 2026-02-11 to 2026-03-01 Lisa wrote a `.coderabbit.yml` into every host
 * that turned `auto_apply_labels` on with no allowlist, and `deletions.json`
 * has kept that copy ever since. A downstream host watched CodeRabbit put
 * `status:ready` back onto claimed issues within minutes of each claim, and
 * nothing in `lisa doctor` read the file. These tests pin the check that lets
 * such a host find itself, and pin that a file the check could not read never
 * passes as one with nothing in it (CodySwannGT/lisa#4633).
 * @module tests/unit/cli/doctor-coderabbit-labeling
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkCoderabbitLabeling,
  CODERABBIT_LABELING_CHECK_NAME,
} from "../../../src/cli/doctor-coderabbit-labeling.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The template Lisa shipped at 41e69a0261, byte for byte. */
const SHIPPED_TEMPLATE = fse.readFileSync(
  path.resolve(
    "tests/fixtures/coderabbit-labeling/shipped-41e69a0261.coderabbit.yml.txt"
  ),
  "utf8"
);

/** How the check spells "I could not answer that". */
const UNDETERMINABLE = "Could not determine";

/** How the check says the file is the unedited copy Lisa shipped. */
const LISA_WROTE_IT = "Lisa wrote this file";

/** The first remedy, as the check names it. */
const AUTO_APPLY_OFF = "auto_apply_labels: false";

/** An allowlisted label no rule protects. */
const SAFE_LABEL = "component:doctor";

/** A human-needed label a project configured for itself. */
const CUSTOM_HUMAN_NEEDED = "needs-a-human";

/** The config file name CodeRabbit reads first. */
const CONFIG_FILE = ".coderabbit.yml";

/** A config head that turns auto-apply on. */
const AUTO_APPLY_HEAD = `reviews:
  profile: chill
issue_enrichment:
  labeling:
    auto_apply_labels: true
`;

/**
 * A config that turns auto-apply on, with the given allowlist.
 * @param labels - Allowlisted labels, or null for no `labeling_instructions`
 * @returns YAML source
 */
function autoApplyConfig(labels: readonly string[] | null): string {
  if (labels === null) return AUTO_APPLY_HEAD;
  const entries = labels
    .map(label => `      - label: "${label}"\n        instructions: x\n`)
    .join("");
  return `${AUTO_APPLY_HEAD}    labeling_instructions:\n${entries}`;
}

describe("doctor CodeRabbit labeling check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a CodeRabbit config into the temp project.
   * @param text - File contents
   * @param name - File name
   * @returns Nothing
   */
  async function seed(text: string, name = CONFIG_FILE): Promise<void> {
    await fse.outputFile(path.join(tempDir, name), text);
  }

  it("passes with no repository file, noting organisation settings are not visible", async () => {
    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.name).toBe(CODERABBIT_LABELING_CHECK_NAME);
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("organisation settings");
  });

  it("fails on the template Lisa shipped, says Lisa wrote it, and names both remedies", async () => {
    await seed(SHIPPED_TEMPLATE);

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(LISA_WROTE_IT);
    expect(check.detail).toContain(AUTO_APPLY_OFF);
    expect(check.detail).toContain("labeling_instructions");
  });

  it("recognises a CRLF copy of the shipped template as Lisa's", async () => {
    await seed(SHIPPED_TEMPLATE.replaceAll("\n", "\r\n"));

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(LISA_WROTE_IT);
  });

  it("fails on an edited file that auto-applies with no allowlist, without claiming Lisa wrote it", async () => {
    await seed(autoApplyConfig(null));

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).not.toContain(LISA_WROTE_IT);
    expect(check.detail).toContain(AUTO_APPLY_OFF);
  });

  it("fails on an empty allowlist", async () => {
    await seed(
      autoApplyConfig([]).replace(
        "labeling_instructions:\n",
        "labeling_instructions: []\n"
      )
    );

    expect((await checkCoderabbitLabeling(tempDir)).status).toBe("fail");
  });

  it.each([
    ["status:ready"],
    ["human-needed"],
    ["type:Bug"],
    ["points:3"],
    ["Status:Done"],
  ])("fails and names %s when the allowlist includes it", async label => {
    await seed(autoApplyConfig([SAFE_LABEL, label]));

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(`auto-apply \`${label}\``);
    expect(check.detail).not.toContain(SAFE_LABEL);
  });

  it("protects the project's configured human-needed label", async () => {
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      github: { labels: { build: { human_needed: CUSTOM_HUMAN_NEEDED } } },
    });
    await seed(autoApplyConfig([CUSTOM_HUMAN_NEEDED]));

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(CUSTOM_HUMAN_NEEDED);
  });

  it("passes on an allowlist naming no protected label", async () => {
    await seed(autoApplyConfig([SAFE_LABEL, "repo:lisa", "priority:high"]));

    expect((await checkCoderabbitLabeling(tempDir)).status).toBe("ok");
  });

  it("passes when auto-apply is off", async () => {
    await seed(
      SHIPPED_TEMPLATE.replace("auto_apply_labels: true", AUTO_APPLY_OFF)
    );

    expect((await checkCoderabbitLabeling(tempDir)).status).toBe("ok");
  });

  it("fails with 'Could not determine' on unparsable YAML", async () => {
    await seed("issue_enrichment:\n  labeling: [unclosed\n");

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("fails with 'Could not determine' when the file cannot be read", async () => {
    await fse.mkdirp(path.join(tempDir, CONFIG_FILE));

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("reads the .coderabbit.yaml spelling", async () => {
    await seed(autoApplyConfig(["status:ready"]), ".coderabbit.yaml");

    const check = await checkCoderabbitLabeling(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(".coderabbit.yaml");
  });

  it("runs as part of lisa doctor, which leaves the file alone", async () => {
    await seed(SHIPPED_TEMPLATE);
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });

    const result = await runDoctor(
      tempDir,
      { offline: true },
      {
        write: vi.fn(),
        setExitCode: vi.fn(),
        runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
      }
    );

    const check = result.checks.find(
      candidate => candidate.name === CODERABBIT_LABELING_CHECK_NAME
    );
    expect(check?.status).toBe("fail");
    expect(await fse.readFile(path.join(tempDir, CONFIG_FILE), "utf8")).toBe(
      SHIPPED_TEMPLATE
    );
  });
});
