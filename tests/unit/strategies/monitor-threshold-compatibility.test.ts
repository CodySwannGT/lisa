/**
 * Prompt-as-code regression coverage for monitor threshold compatibility.
 *
 * `lisa-monitor` is an agent-executed skill, so its operational contract must
 * explicitly define scoped config extraction, alias precedence, defaults, and
 * observable reporting that an independent verifier can inspect.
 * @module tests/unit/strategies/monitor-threshold-compatibility
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_SKILL = "plugins/src/base/skills/lisa-monitor/SKILL.md";
const JQ_PROJECTION = /```bash\njq '(.*?)' \.lisa\.config\.json\n```/s;
/** Four byte-identical copies; Codex is the fifth copy with transformed metadata. */
const BYTE_IDENTICAL_GENERATED_SKILLS = [
  "plugins/lisa/skills/lisa-monitor/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-monitor/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-monitor/SKILL.md",
  "plugins/lisa-agy/skills/lisa-monitor/SKILL.md",
] as const;

const read = (filePath: string): string =>
  readFileSync(path.resolve(filePath), "utf8");

const source = read(SOURCE_SKILL);

describe("monitor threshold compatibility contract (#1527)", () => {
  it("requires four-key-only jq extraction from committed and local config", () => {
    expect(source).toMatch(/`\.lisa\.config\.json`.*`jq`/is);
    expect(source).toContain(".lisa.config.local.json");
    expect(source).toMatch(/fixed-path.*only.*four exact paths/is);
    expect(source).toMatch(/do not use `Read`, `cat`/i);
    expect(source).toMatch(/local.*override.*committed.*per path/is);
    expect(source).toMatch(/presence\/value.*do not inject defaults/is);
  });

  it("defines current, legacy, and default precedence for event counts", () => {
    expect(source).toMatch(
      /`monitor\.thresholds\.minEvents24h`[\s\S]*`monitor\.thresholds\.sentryMinEvents24h`[\s\S]*default[^\n]*`?1`?/i
    );
    expect(source).toMatch(/(?:current|new) key wins over (?:the )?legacy/i);
  });

  it("defines current, legacy, and default precedence for fault rates", () => {
    expect(source).toMatch(
      /`monitor\.thresholds\.faultRatePct`[\s\S]*`monitor\.thresholds\.xrayFaultRatePct`[\s\S]*default[^\n]*`?5`?/i
    );
    expect(source).toMatch(/(?:current|new) key wins over (?:the )?legacy/i);
  });

  it("requires observable resolved value and source reporting for both pairs", () => {
    expect(source).toMatch(/report.*resolved value.*source/is);
    expect(source).toContain("monitor.thresholds.minEvents24h");
    expect(source).toContain("monitor.thresholds.faultRatePct");
    expect(source).toMatch(/committed|local|legacy|default/i);
    for (const sourceName of [
      "local-current",
      "committed-current",
      "local-legacy",
      "committed-legacy",
      "default",
    ]) {
      expect(source).toContain(`\`${sourceName}\``);
    }
  });

  it("rejects invalid configured values without leaking config or falling back", () => {
    expect(source).toMatch(/finite JSON number/i);
    expect(source).toMatch(/fail threshold collection/i);
    expect(source).toMatch(/never fall through.*legacy value or default/is);
    expect(source).toMatch(/never quote.*whole config/is);
    expect(source).toMatch(/report only.*validated numeric resolved value/is);
    expect(source).toContain("isfinite");
    expect(source).toContain("isfinite and (isnan | not)");
    expect(source).toMatch(/projection itself must redact.*invalid/is);
    expect(source).toMatch(/numeric `value` field only for a finite number/is);
  });

  it("executes the canonical jq projection without exposing NaN", () => {
    const projection = JQ_PROJECTION.exec(source)?.[1];
    expect(projection).toBeDefined();
    if (!projection) throw new Error("Canonical jq projection is missing");

    const jqPath = [
      "/opt/homebrew/bin/jq",
      "/usr/local/bin/jq",
      "/usr/bin/jq",
    ].find(candidate => existsSync(candidate));
    expect(jqPath).toBeDefined();
    if (!jqPath) throw new Error("jq executable is unavailable");

    const output = execFileSync(jqPath, [projection], {
      encoding: "utf8",
      input: '{"monitor":{"thresholds":{"minEvents24h":NaN}}}',
    });
    const projected = JSON.parse(output) as Record<
      string,
      Record<string, unknown>
    >;
    const nanResult = projected["monitor.thresholds.minEvents24h"];

    expect(nanResult).toEqual({
      present: true,
      type: "non-finite-number",
      valid: false,
    });
    expect(nanResult).not.toHaveProperty("value");
  });

  it.each(BYTE_IDENTICAL_GENERATED_SKILLS)(
    "keeps generated skill content in lockstep at %s",
    generatedPath => {
      expect(read(generatedPath)).toBe(source);
    }
  );

  it("keeps the Codex skill body aligned after its generated description override", () => {
    const codex = read(
      "plugins/lisa/.codex-plugin/skills/lisa-monitor/SKILL.md"
    );
    const bodyStart = source.indexOf("\n---\n") + "\n---\n".length;
    const codexBodyStart = codex.indexOf("\n---\n") + "\n---\n".length;

    expect(codex.slice(codexBodyStart)).toBe(source.slice(bodyStart));
  });
});
