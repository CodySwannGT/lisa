/**
 * Unit tests for the deterministic openai.yaml serializer used by the Codex
 * artifact generator (scripts/generate-codex-plugin-artifacts.mjs).
 *
 * Covers the two acceptance-criteria scenarios from issue #546:
 *  - byte-stable output across invocations with fixed key order + trailing newline
 *  - special characters (colons, quotes) quoted safely and round-tripping
 *
 * The serializer must be pure (a function of its input only — no timestamps,
 * no filesystem, no randomness) so repeated `bun run build:plugins` runs emit
 * byte-identical artifacts and the Plugins Sync CI gate never flakes.
 */
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import { serializeInterfaceToYaml } from "../../../scripts/generate-codex-plugin-artifacts.mjs";

describe("codex/openai-yaml-serializer", () => {
  /** A representative interface object matching the real generator shape. */
  const sample = {
    display_name: "Lisa",
    short_description: "Universal project governance workflows",
    default_prompt: [
      "Plan this implementation with Lisa",
      "Review this change with Lisa",
    ],
  };

  it("is byte-stable across repeated invocations", () => {
    const first = serializeInterfaceToYaml(sample);
    const second = serializeInterfaceToYaml(sample);

    expect(first).toBe(second);
  });

  it("does not mutate input between invocations (deep equality preserved)", () => {
    const input = {
      display_name: "Lisa",
      short_description: "Universal project governance workflows",
      default_prompt: ["Plan this implementation with Lisa"],
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    serializeInterfaceToYaml(input);

    expect(input).toEqual(snapshot);
  });

  it("emits keys in the order display_name, short_description, default_prompt", () => {
    const yaml = serializeInterfaceToYaml(sample);

    const displayIndex = yaml.indexOf("display_name:");
    const shortIndex = yaml.indexOf("short_description:");
    const promptIndex = yaml.indexOf("default_prompt:");

    expect(displayIndex).toBeGreaterThanOrEqual(0);
    expect(shortIndex).toBeGreaterThan(displayIndex);
    expect(promptIndex).toBeGreaterThan(shortIndex);
  });

  it("ends with exactly one trailing newline", () => {
    const yaml = serializeInterfaceToYaml(sample);

    expect(yaml.endsWith("\n")).toBe(true);
    expect(yaml.endsWith("\n\n")).toBe(false);
  });

  it("round-trips a value containing a colon to the same string", () => {
    const withColon = {
      display_name: "Lisa: The Governor",
      short_description: "key: value pairs everywhere",
      default_prompt: ["Do this: then that"],
    };

    const yaml = serializeInterfaceToYaml(withColon);
    const parsed = parseYaml(yaml);

    expect(parsed).toEqual(withColon);
  });

  it("round-trips a value containing quotes to the same string", () => {
    const withQuotes = {
      display_name: 'The "Quoted" Plugin',
      short_description: 'It\'s got an apostrophe and "double quotes"',
      default_prompt: ['Say "hello"', "It's fine"],
    };

    const yaml = serializeInterfaceToYaml(withQuotes);
    const parsed = parseYaml(yaml);

    expect(parsed).toEqual(withQuotes);
  });

  it("round-trips special YAML indicator characters safely", () => {
    const tricky = {
      display_name: "#hashtag - @at & *star",
      short_description: "value with | pipe and > gt and { brace }",
      default_prompt: ["- looks like a list item", "[bracketed]", "yes"],
    };

    const yaml = serializeInterfaceToYaml(tricky);
    const parsed = parseYaml(yaml);

    expect(parsed).toEqual(tricky);
  });

  it("emits an empty default_prompt as an empty array, not null", () => {
    const empty = {
      display_name: "No Prompts",
      short_description: "has no default prompts",
      default_prompt: [],
    };

    const yaml = serializeInterfaceToYaml(empty);
    const parsed = parseYaml(yaml);

    expect(parsed.default_prompt).toEqual([]);
  });

  it("produces identical output for two structurally-equal inputs", () => {
    const a = {
      display_name: "Lisa",
      short_description: "desc",
      default_prompt: ["one", "two"],
    };
    const b = {
      display_name: "Lisa",
      short_description: "desc",
      default_prompt: ["one", "two"],
    };

    expect(serializeInterfaceToYaml(a)).toBe(serializeInterfaceToYaml(b));
  });
});
