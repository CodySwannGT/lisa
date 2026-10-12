/**
 * Prose contract for the session manager when Telegram cannot carry a
 * question (CodySwannGT/lisa#4448 live-verification defect D5).
 *
 * Live, with the bot not yet paired, the manager asked its question in its
 * own tmux terminal. Nobody watches that terminal, and an open question there
 * stops the `/loop`, so no further cycle ran. The rules pinned here:
 * - the manager never asks anything in its terminal;
 * - when Telegram is unavailable or unpaired it records the question as
 *   pending without a Telegram message id, ends the cycle
 *   `recovery-required` with a one-line "Telegram not paired: run …"
 *   summary, and keeps looping;
 * - every cycle (re)sends a pending question that has no `telegramMessageId`,
 *   so a question recorded while Telegram was down still reaches the operator.
 * Pinned in the source and every runtime projection, like the other skill
 * contract suites.
 * @module tests/unit/strategies/session-manager-telegram-contract
 */
import { describe, expect, it } from "vitest";

import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

const MANAGER = "lisa-session-manager";

describe.each(ALL_ROOTS)(
  "lisa-session-manager Telegram fallback contract (%s)",
  root => {
    const skill = read(`${root}/${MANAGER}/SKILL.md`);
    const rules = section(skill, "## Telegram rules");

    it("never asks the operator in the manager's terminal", () => {
      expect(rules).toContain("**Never ask in this terminal.**");
      expect(rules).toContain("a question there stops\n  the `/loop`");
    });

    it("records the question as pending and ends recovery-required when Telegram is unavailable or unpaired", () => {
      expect(rules).toContain("**Telegram unavailable or unpaired.**");
      expect(rules).toContain(
        "`ledger set-question <ref>` without `--telegram-message-id`"
      );
      expect(rules).toContain("end it with outcome `recovery-required`");
      expect(rules).toContain(
        "`Telegram not paired: run tmux attach -t <name> and pair with /telegram:access pair <code>.`"
      );
      expect(rules).toContain("The `/loop` keeps running");
    });

    it("re-sends every pending question that has no telegramMessageId at the start of a cycle", () => {
      const cycle = section(skill, "## The cycle");
      expect(cycle).toContain("**Unsent questions.**");
      expect(cycle).toContain("`telegramMessageId: null`");
      expect(cycle).toContain(
        "(Re)send each\nto Telegram now and re-record it with " +
          "`ledger set-question <ref> --telegram-message-id <id>`"
      );
    });

    it("lists an unavailable or unpaired Telegram as recovery-required", () => {
      const outcome = section(skill, "## Run outcome");
      expect(outcome).toContain(
        "Telegram was unavailable or unpaired (a question stayed pending with no Telegram message id)"
      );
    });

    it("sends a worker's question through the same fallback", () => {
      const handling = section(
        skill,
        "## Handling messages (any time, not only during a cycle)"
      );
      expect(handling).toContain(
        'If Telegram is unavailable or unpaired, follow "Telegram rules"'
      );
    });
  }
);
