/**
 * Unit tests for the .codex/hooks.json tagged-merge writer.
 *
 * These tests pin the ownership-by-marker invariant: a Lisa-managed entry
 * is identifiable by `_lisaManaged: true` on the inner handler, and on every
 * install pass Lisa replaces ALL its entries while leaving host entries
 * untouched.
 */
import { describe, expect, it } from "vitest";
import {
  LISA_ID_MARKER,
  LISA_MANAGED_MARKER,
  type HooksFile,
  type LisaHookSpec,
  mergeLisaHooks,
  parseHooksFile,
  serializeHooksFile,
} from "../../../src/codex/hooks-merger.js";

/** Hook id reused across multiple test cases */
const INJECT_RULES_ID = "inject-rules";
/** Command string used for the sample inject-rules hook */
const INJECT_RULES_COMMAND = "bash /path/to/inject-rules.sh";

const SAMPLE_LISA_SPEC: LisaHookSpec = {
  id: INJECT_RULES_ID,
  event: "SessionStart",
  matcher: "",
  command: INJECT_RULES_COMMAND,
  statusMessage: "Injecting Lisa rules",
};

const SAMPLE_HOST_HOOK: HooksFile = {
  hooks: {
    PostToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [
          { type: "command", command: "./scripts/host-format-on-edit.sh" },
        ],
      },
    ],
  },
};

describe("codex/hooks-merger", () => {
  describe("mergeLisaHooks", () => {
    it("inserts a Lisa hook into an empty file", () => {
      const result = mergeLisaHooks({}, [SAMPLE_LISA_SPEC]);
      expect(result.hooks?.SessionStart).toHaveLength(1);
      const handler = result.hooks?.SessionStart?.[0]?.hooks[0];
      expect(handler?.command).toBe(INJECT_RULES_COMMAND);
      expect(handler?.[LISA_MANAGED_MARKER]).toBe(true);
      expect(handler?.[LISA_ID_MARKER]).toBe(INJECT_RULES_ID);
    });

    it("preserves host entries when adding Lisa entries", () => {
      const result = mergeLisaHooks(SAMPLE_HOST_HOOK, [SAMPLE_LISA_SPEC]);
      expect(result.hooks?.PostToolUse).toHaveLength(1);
      expect(result.hooks?.PostToolUse?.[0]?.hooks[0]?.command).toBe(
        "./scripts/host-format-on-edit.sh"
      );
      expect(result.hooks?.SessionStart).toHaveLength(1);
    });

    it("removes prior Lisa entries before adding new ones (idempotent)", () => {
      // Simulate a prior run that installed an old version of the hook
      const after1stRun = mergeLisaHooks({}, [
        { ...SAMPLE_LISA_SPEC, command: "OLD COMMAND" },
      ]);
      // 2nd run with updated command should replace, not append
      const after2ndRun = mergeLisaHooks(after1stRun, [SAMPLE_LISA_SPEC]);
      expect(after2ndRun.hooks?.SessionStart).toHaveLength(1);
      expect(after2ndRun.hooks?.SessionStart?.[0]?.hooks[0]?.command).toBe(
        INJECT_RULES_COMMAND
      );
    });

    it("removes Lisa entries when no longer shipped", () => {
      const after1stRun = mergeLisaHooks({}, [SAMPLE_LISA_SPEC]);
      // 2nd run with empty Lisa hook list should clear the Lisa entry
      const after2ndRun = mergeLisaHooks(after1stRun, []);
      expect(after2ndRun.hooks?.SessionStart).toBeUndefined();
    });

    it("preserves host entries when Lisa entries are removed", () => {
      const start: HooksFile = {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "OLD lisa cmd",
                  [LISA_MANAGED_MARKER]: true,
                  [LISA_ID_MARKER]: "old-lisa",
                },
                { type: "command", command: "host cmd" },
              ],
            },
          ],
        },
      };
      const result = mergeLisaHooks(start, []);
      expect(result.hooks?.SessionStart).toHaveLength(1);
      const handlers = result.hooks?.SessionStart?.[0]?.hooks ?? [];
      expect(handlers).toHaveLength(1);
      expect(handlers[0]?.command).toBe("host cmd");
      expect(handlers[0]?.[LISA_MANAGED_MARKER]).toBeUndefined();
    });

    it("strips Lisa handlers from groups that mix Lisa + host handlers", () => {
      const start: HooksFile = {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "lisa1",
                  [LISA_MANAGED_MARKER]: true,
                  [LISA_ID_MARKER]: "lisa1",
                },
                { type: "command", command: "host1" },
                {
                  type: "command",
                  command: "lisa2",
                  [LISA_MANAGED_MARKER]: true,
                  [LISA_ID_MARKER]: "lisa2",
                },
                { type: "command", command: "host2" },
              ],
            },
          ],
        },
      };
      const result = mergeLisaHooks(start, []);
      const handlers = result.hooks?.SessionStart?.[0]?.hooks ?? [];
      expect(handlers.map(h => h.command)).toEqual(["host1", "host2"]);
    });

    it("handles multiple Lisa hooks across different events", () => {
      const specs: readonly LisaHookSpec[] = [
        SAMPLE_LISA_SPEC,
        {
          id: "format-on-edit",
          event: "PostToolUse",
          matcher: "Edit|Write",
          command: "bash /path/to/format.sh",
        },
        {
          id: "ntfy-stop",
          event: "Stop",
          matcher: "",
          command: "bash /path/to/ntfy.sh",
          timeout: 30,
        },
      ];
      const result = mergeLisaHooks({}, specs);
      expect(result.hooks?.SessionStart).toHaveLength(1);
      expect(result.hooks?.PostToolUse).toHaveLength(1);
      expect(result.hooks?.Stop).toHaveLength(1);
      expect(result.hooks?.Stop?.[0]?.hooks[0]?.timeout).toBe(30);
    });

    it("emits timeout when provided", () => {
      const result = mergeLisaHooks({}, [{ ...SAMPLE_LISA_SPEC, timeout: 60 }]);
      expect(result.hooks?.SessionStart?.[0]?.hooks[0]?.timeout).toBe(60);
    });

    it("does not emit timeout when omitted", () => {
      const result = mergeLisaHooks({}, [SAMPLE_LISA_SPEC]);
      expect(
        result.hooks?.SessionStart?.[0]?.hooks[0]?.timeout
      ).toBeUndefined();
    });
  });

  describe("parseHooksFile + serializeHooksFile", () => {
    it("returns empty object for empty input", () => {
      expect(parseHooksFile("")).toEqual({});
      expect(parseHooksFile("   ")).toEqual({});
    });

    it("parses a valid hooks.json", () => {
      const json = JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "x" }] },
          ],
        },
      });
      const result = parseHooksFile(json);
      expect(result.hooks?.SessionStart).toHaveLength(1);
    });

    it("throws on non-object root", () => {
      expect(() => parseHooksFile(JSON.stringify("string"))).toThrow();
      expect(() => parseHooksFile(JSON.stringify([]))).not.toThrow();
      // arrays are objects in JS — we accept any object root
    });

    it("throws when hooks field is not an object", () => {
      expect(() => parseHooksFile(JSON.stringify({ hooks: "wat" }))).toThrow(
        /hooks.*object/
      );
    });

    it("preserves unknown fields on round-trip via JSON.stringify", () => {
      const original = {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "x",
                  customFutureField: { nested: 1 },
                },
              ],
            },
          ],
        },
        topLevelExtension: "preserved",
      };
      const reparsed = parseHooksFile(JSON.stringify(original));
      expect(reparsed).toEqual(original);
    });

    it("serializes with two-space indent and trailing newline", () => {
      const out = serializeHooksFile({
        hooks: {
          SessionStart: [{ matcher: "", hooks: [] }],
        },
      });
      expect(out).toContain('  "hooks":');
      expect(out.endsWith("\n")).toBe(true);
    });
  });

  describe("merge → parse round-trip", () => {
    it("preserves Lisa markers through serialize → parse", () => {
      const merged = mergeLisaHooks({}, [SAMPLE_LISA_SPEC]);
      const reparsed = parseHooksFile(serializeHooksFile(merged));
      const handler = reparsed.hooks?.SessionStart?.[0]?.hooks[0];
      expect(handler?.[LISA_MANAGED_MARKER]).toBe(true);
      expect(handler?.[LISA_ID_MARKER]).toBe(INJECT_RULES_ID);
    });
  });
});
