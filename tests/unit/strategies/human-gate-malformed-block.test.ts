/** The writer, session context, CLI config, and ratchet agree on human-gate mode. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildContext } from "../../../plugins/src/base/hooks/inject-resolved-config.mjs";
import { humanGateModeOf } from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import { main } from "../../../plugins/src/base/scripts/human-gate-act.mjs";
import {
  resolveHumanGateSettings,
  validateHumanGateConfig,
} from "../../../src/core/project-config-human-gate.js";

const ACCESS_ONLY = "access-only";
const STRICT = "strict";

/**
 * Read the same owned config fixture through the real writer and session hook.
 * @param config - Committed configuration
 * @param local - Optional local configuration
 * @returns CLI streams, status and rendered session context
 */
function readPolicy(config: object, local?: object) {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-human-gate-block-"));
  const globalPath = path.join(project, ".lisa.config.json");
  const localPath = path.join(project, ".lisa.config.local.json");
  try {
    writeFileSync(globalPath, JSON.stringify(config));
    if (local !== undefined) writeFileSync(localPath, JSON.stringify(local));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = main(
      ["policy", "--config", globalPath, "--local", localPath],
      {
        write: text => stdout.push(text),
        error: text => stderr.push(text),
      }
    );
    return {
      code,
      policy: JSON.parse(stdout.join("")),
      warnings: stderr.join(""),
      context: buildContext(project),
    };
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
}

describe("humanGate block shape", () => {
  it.each([
    { config: {}, mode: ACCESS_ONLY, malformed: false },
    { config: { humanGate: {} }, mode: ACCESS_ONLY, malformed: false },
    {
      config: { humanGate: { mode: " Strict " } },
      mode: STRICT,
      malformed: false,
    },
    {
      config: { humanGate: { mode: ACCESS_ONLY } },
      mode: ACCESS_ONLY,
      malformed: false,
    },
    { config: { humanGate: null }, mode: STRICT, malformed: true },
    { config: { humanGate: STRICT }, mode: STRICT, malformed: true },
    { config: { humanGate: [STRICT] }, mode: STRICT, malformed: true },
    { config: { humanGate: false }, mode: STRICT, malformed: true },
  ])(
    "keeps all readers in $mode for $config",
    ({ config, mode, malformed }) => {
      const cli = readPolicy(config);
      const block = validateHumanGateConfig(
        config.humanGate,
        ".lisa.config.json"
      );
      const settings = resolveHumanGateSettings(
        block === undefined ? {} : { humanGate: block }
      );
      const rendered = cli.context
        .split("\n")
        .find(line => line.startsWith("humanGate.mode:"));

      expect(cli.code).toBe(0);
      expect(cli.policy).toEqual({ mode, humanOnly: [] });
      expect(settings.mode).toBe(mode);
      expect(humanGateModeOf(config)).toBe(mode);
      expect(rendered).toMatch(new RegExp(`^humanGate[.]mode: ${mode}(?: |$)`));
      if (malformed) {
        expect(cli.warnings).toContain(
          `Invalid humanGate: ${JSON.stringify(config.humanGate)} is not an object`
        );
      }
    }
  );

  it("uses a valid declaration when the other config has a malformed block", () => {
    const malformed = { humanGate: null };
    const valid = { humanGate: { mode: ACCESS_ONLY } };
    for (const [global, local] of [
      [malformed, valid],
      [valid, malformed],
    ] as const) {
      const cli = readPolicy(global, local);

      expect(cli.code).toBe(0);
      expect(cli.policy).toEqual({ mode: ACCESS_ONLY, humanOnly: [] });
      expect(cli.warnings).toContain(
        "Invalid humanGate: null is not an object"
      );
    }
  });
});
