/**
 * Unit tests for the interactive prompt boundary (`src/cli/prompts.ts`), the
 * single module that wraps every `@inquirer/prompts` call. Before these tests
 * the interactive path was proven only by a human running setup, so a bad
 * `@inquirer/prompts` update had nothing to catch it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}));

import { confirm, select } from "@inquirer/prompts";
import type { ProjectType } from "../../../src/core/config.js";
import {
  AutoAcceptPrompter,
  InteractivePrompter,
  createPrompter,
  isInteractive,
} from "../../../src/cli/prompts.js";

const selectMock = vi.mocked(select);
const confirmMock = vi.mocked(confirm);

const OVERWRITE_PATH = "src/index.ts";

/**
 * Force `process.stdin.isTTY` to a chosen value so the TTY-gated branches of
 * `isInteractive()`/`createPrompter()` are deterministic under the test runner.
 * @param value Desired isTTY value (`true`, `false`, or `undefined`).
 */
function setTty(value: true | false | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
}

describe("cli/prompts", () => {
  const originalIsTty = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setTty(originalIsTty);
  });

  describe("InteractivePrompter", () => {
    it("promptOverwrite delegates to select and returns its decision", async () => {
      selectMock.mockResolvedValue("diff");

      const prompter = new InteractivePrompter();
      const decision = await prompter.promptOverwrite(OVERWRITE_PATH);

      expect(decision).toBe("diff");
      expect(selectMock).toHaveBeenCalledTimes(1);
      const config = selectMock.mock.calls[0]?.[0] as { message: string };
      expect(config.message).toContain(OVERWRITE_PATH);
    });

    it("confirmProjectTypes prompts and returns the detected types unchanged", async () => {
      confirmMock.mockResolvedValue(true);

      const prompter = new InteractivePrompter();
      const detected: readonly ProjectType[] = ["expo", "cdk"];
      const result = await prompter.confirmProjectTypes(detected);

      expect(result).toEqual(["expo", "cdk"]);
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });

    it("confirmDirtyGit returns the boolean the confirm prompt resolves to", async () => {
      confirmMock.mockResolvedValue(true);

      const prompter = new InteractivePrompter();
      const result = await prompter.confirmDirtyGit("M some-file.ts");

      expect(result).toBe(true);
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("AutoAcceptPrompter", () => {
    it("promptOverwrite auto-accepts without ever calling select", async () => {
      const prompter = new AutoAcceptPrompter();
      const decision = await prompter.promptOverwrite(OVERWRITE_PATH);

      expect(decision).toBe("yes");
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("confirmProjectTypes returns the detected types without prompting", async () => {
      const prompter = new AutoAcceptPrompter();
      const detected: readonly ProjectType[] = ["nestjs"];
      const result = await prompter.confirmProjectTypes(detected);

      expect(result).toEqual(["nestjs"]);
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it("confirmDirtyGit fails safe to false with no TTY and no confirm call", async () => {
      setTty(false);

      const prompter = new AutoAcceptPrompter();
      const result = await prompter.confirmDirtyGit("M some-file.ts");

      expect(result).toBe(false);
      expect(confirmMock).not.toHaveBeenCalled();
    });
  });

  describe("isInteractive", () => {
    it("is true only when stdin is a TTY", () => {
      setTty(true);
      expect(isInteractive()).toBe(true);

      setTty(false);
      expect(isInteractive()).toBe(false);

      setTty(undefined);
      expect(isInteractive()).toBe(false);
    });
  });

  describe("createPrompter", () => {
    it("returns an AutoAcceptPrompter in yes-mode even when a TTY is present", () => {
      setTty(true);
      expect(createPrompter(true)).toBeInstanceOf(AutoAcceptPrompter);
    });

    it("returns an AutoAcceptPrompter without yes-mode when stdin is not a TTY", () => {
      setTty(false);
      expect(createPrompter(false)).toBeInstanceOf(AutoAcceptPrompter);
    });

    it("returns an InteractivePrompter without yes-mode when stdin is a TTY", () => {
      setTty(true);
      expect(createPrompter(false)).toBeInstanceOf(InteractivePrompter);
    });
  });
});
