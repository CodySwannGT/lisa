/**
 * Work-item token estimates (CodySwannGT/lisa#4954): the config, the
 * `## Lisa Estimate` section, and the ready-time gate S21.
 *
 * The gate must pass a well-formed estimate, refuse a malformed one, let an
 * item without an estimate reach ready (the claim step fills it), and do
 * nothing at all when the project turns the requirement off.
 * @module tests/unit/scripts/work-item-estimate
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ESTIMATE_MODELS,
  DEFAULT_ESTIMATE_PRICING,
  resolveEstimateConfig,
  validateEstimateConfig,
} from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import {
  buildEstimate,
  formatTokens,
  parseEstimateSection,
  parseTokenCount,
  renderEstimateSection,
  upsertEstimateSection,
} from "../../../all/copy-overwrite/scripts/lib/work-item-estimate.mjs";
import { checkEstimate } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-check.mjs";

const OPUS = "claude-opus-5-5";
const ON = resolveEstimateConfig({});
const OFF = resolveEstimateConfig({
  workItem: { estimate: { required: false } },
});
const BODY = "## Context\n\nFix the thing.\n";
const OPUS_SECTION = renderEstimateSection(
  buildEstimate(
    { tokensLow: 2_000_000, tokensHigh: 4_000_000, model: OPUS },
    ON
  )
);
const withEstimate = upsertEstimateSection(BODY, OPUS_SECTION);
const COST_LOW = "cost_low=3.14";

describe("workItem.estimate config", () => {
  it("is required by default with the shipped model list", () => {
    expect(ON.required).toBe(true);
    expect(ON.models).toEqual(DEFAULT_ESTIMATE_MODELS);
    expect(ON.warnings).toEqual([]);
  });

  it("is off only when required is exactly false", () => {
    expect(OFF.required).toBe(false);
  });

  it("fails safe to required when the value is not a boolean", () => {
    const settings = resolveEstimateConfig({
      workItem: { estimate: { required: "no" } },
    });
    expect(settings.required).toBe(true);
    expect(settings.warnings[0]).toMatch(/treating it as true/);
  });

  it("takes the allowed models from config, any vendor", () => {
    const settings = resolveEstimateConfig({
      workItem: { estimate: { models: ["gpt-5", "gemini"] } },
    });
    expect(settings.models).toEqual(["gpt-5", "gemini"]);
  });

  it("validates what lisa sync keeps", () => {
    expect(
      validateEstimateConfig({ required: true, models: ["opus"] })
    ).toEqual({
      required: true,
      models: ["opus"],
    });
    expect(() => validateEstimateConfig({ required: "yes" })).toThrow(
      /required/
    );
    expect(() => validateEstimateConfig({ models: [] })).toThrow(/models/);
    expect(() =>
      validateEstimateConfig({
        tokenMix: { input: 1, cachedInput: 1, output: 0 },
      })
    ).toThrow(/tokenMix/);
  });

  it("names where the shipped prices come from", () => {
    expect(DEFAULT_ESTIMATE_PRICING).toMatchObject({
      currency: "USD",
      source: "anthropic-api-list-prices",
      snapshot: "2026-11-03",
    });
  });
});

describe("estimate section", () => {
  it("prices the range from the shipped table and token mix", () => {
    expect(OPUS_SECTION).toContain(
      "| Estimate | 2M–4M | $3.14–$6.28 USD | claude-opus-5-5 |"
    );
    expect(parseEstimateSection(withEstimate).estimate).toMatchObject({
      tokensLow: 2_000_000,
      tokensHigh: 4_000_000,
      costLow: 314,
      costHigh: 628,
      currency: "USD",
      pricingSource: "anthropic-api-list-prices@2026-11-03",
      model: OPUS,
      basis: "no calibration history",
    });
  });

  it("prefers configured usage.pricing over the shipped table", () => {
    const settings = resolveEstimateConfig({
      workItem: { estimate: { models: ["openai/gpt-5"] } },
      usage: {
        pricing: {
          currency: "USD",
          source: "openai-api-pricing",
          snapshot: "2026-05-25",
          models: {
            "openai/gpt-5": {
              inputPer1M: 1,
              cachedInputPer1M: 1,
              outputPer1M: 1,
            },
          },
        },
      },
    });
    const estimate = buildEstimate(
      { tokensLow: 1_000_000, tokensHigh: 1_000_000, model: "openai/gpt-5" },
      settings
    );
    expect(estimate).toMatchObject({
      costLow: 100,
      pricingSource: "openai-api-pricing@2026-05-25",
    });
  });

  it("leaves an unpriced model without a dollar range rather than guessing", () => {
    const settings = resolveEstimateConfig({
      workItem: { estimate: { models: ["gemini"] } },
    });
    const section = renderEstimateSection(
      buildEstimate(
        { tokensLow: 1000, tokensHigh: 2000, model: "gemini" },
        settings
      )
    );
    expect(section).toContain("| unpriced |");
    expect(
      checkEstimate(upsertEstimateSection(BODY, section), settings).verdict
    ).toBe("PASS");
  });

  it("refuses a model outside the allowed list and an inverted range", () => {
    expect(() =>
      buildEstimate({ tokensLow: 1, tokensHigh: 2, model: "gpt-9" }, ON)
    ).toThrow(/not in workItem\.estimate\.models/);
    expect(() =>
      buildEstimate({ tokensLow: 3, tokensHigh: 2, model: "opus" }, ON)
    ).toThrow(/above the high end/);
  });

  it("rewrites the section in place instead of appending a second", () => {
    const again = upsertEstimateSection(
      `${withEstimate}\n## Lisa Usage\n\nrows\n`,
      renderEstimateSection(
        buildEstimate({ tokensLow: 1000, tokensHigh: 1000, model: "haiku" }, ON)
      )
    );
    expect(parseEstimateSection(again).count).toBe(1);
    expect(again).toContain("## Lisa Usage\n\nrows");
    expect(parseEstimateSection(again).estimate?.model).toBe("haiku");
  });

  it("keeps text a person added inside the section when re-rendering", () => {
    const edited = withEstimate.replace(
      "Basis:",
      "Also cover the admin screen.\n\nBasis:"
    );
    const again = upsertEstimateSection(
      edited,
      renderEstimateSection(
        buildEstimate({ tokensLow: 1000, tokensHigh: 1000, model: "haiku" }, ON)
      )
    );
    expect(again).toContain("Also cover the admin screen.");
    expect(again).not.toContain(OPUS);
    expect(again.match(/^Basis:/gm)).toHaveLength(1);
    expect(parseEstimateSection(again).estimate?.model).toBe("haiku");
  });

  it("reads and writes token counts in short form", () => {
    expect(parseTokenCount("2.5M")).toBe(2_500_000);
    expect(parseTokenCount("500k")).toBe(500_000);
    expect(parseTokenCount("1200")).toBe(1200);
    expect(() => parseTokenCount("lots")).toThrow(/not a token count/);
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(1500)).toBe("1.5k");
  });
});

describe("gate S21 at ready time", () => {
  it("passes a well-formed estimate", () => {
    expect(checkEstimate(withEstimate, ON)).toEqual({
      verdict: "PASS",
      lines: ["The estimate is well formed."],
    });
  });

  it("fails a model the project does not allow", () => {
    const result = checkEstimate(
      withEstimate.replace("model=claude-opus-5-5", "model=gpt-9"),
      ON
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(
      /"gpt-9" is not in workItem\.estimate\.models/
    );
  });

  it("fails an inverted range", () => {
    const result = checkEstimate(
      withEstimate.replace("tokens_low=2000000", "tokens_low=9000000"),
      ON
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(/above the high end/);
  });

  it("fails a dollar range that disagrees with the price table it names", () => {
    const result = checkEstimate(
      withEstimate.replace("cost_high=6.28", "cost_high=9.00"),
      ON
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(/expected 3\.14–6\.28 USD/);
  });

  it("does not fail an estimate priced from an older price table", () => {
    const old = withEstimate
      .replace("cost_high=6.28", "cost_high=9.00")
      .replace("%402026-11-03", "%402026-01-01");
    expect(checkEstimate(old, ON).verdict).toBe("PASS");
  });

  it.each([
    ["an unreadable cost", COST_LOW, "cost_low=abc", /finite amounts/],
    ["a negative cost", COST_LOW, "cost_low=-1.00", /finite amounts/],
    ["an inverted cost range", COST_LOW, "cost_low=9.00", /above/],
    ["an unknown currency", "currency=USD", "currency=dollars", /currency/],
  ])(
    "fails %s even when its price table has moved on",
    (_label, from, to, message) => {
      const stale = withEstimate
        .replace("%402026-11-03", "%402026-01-01")
        .replace(from, to);
      const result = checkEstimate(stale, ON);
      expect(result.verdict).toBe("FAIL");
      expect(result.lines.join("\n")).toMatch(message);
    }
  );

  it("fails a currency that differs from the price table it names", () => {
    const result = checkEstimate(
      withEstimate.replace("currency=USD", "currency=EUR"),
      ON
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(/USD/);
  });

  it("fails, rather than throws, on a malformed percent escape", () => {
    const result = checkEstimate(
      withEstimate.replace(/basis=\S+/, "basis=%ZZ"),
      ON
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(/no parseable/);
  });

  it("ignores a section quoted inside a code fence", () => {
    const quoted = `${withEstimate}\n\n\`\`\`markdown\n${OPUS_SECTION}\`\`\`\n`;
    expect(parseEstimateSection(quoted).count).toBe(1);
    expect(checkEstimate(quoted, ON).verdict).toBe("PASS");
  });

  it("fails a section with no parseable token, and duplicate sections", () => {
    expect(
      checkEstimate(`${BODY}\n## Lisa Estimate\n\nsoon\n`, ON).verdict
    ).toBe("FAIL");
    expect(
      checkEstimate(`${withEstimate}\n${OPUS_SECTION}`, ON).lines.join("\n")
    ).toMatch(/2 Lisa Estimate sections/);
  });

  it("lets an item without an estimate reach ready", () => {
    const result = checkEstimate(BODY, ON);
    expect(result.verdict).toBe("PASS");
    expect(result.lines.join("\n")).toMatch(/claiming agent estimates it/);
  });

  it("is N/A when the requirement is off, whatever the body says", () => {
    expect(checkEstimate(BODY, OFF).verdict).toBe("N/A");
    expect(
      checkEstimate(
        withEstimate.replace("model=claude-opus-5-5", "model=gpt-9"),
        OFF
      ).verdict
    ).toBe("N/A");
  });

  it("refuses an unknown phase", () => {
    expect(() => checkEstimate(BODY, ON, "someday")).toThrow(/Unknown phase/);
  });
});
