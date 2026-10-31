/**
 * Prose contract for how the session manager asks and notifies, with and
 * without a notification channel (CodySwannGT/lisa#4448 live-verification
 * defect D5; CodySwannGT/lisa#4555 part 1).
 *
 * Live, with the bot not yet paired, the manager once asked its question in
 * its own tmux terminal. Nobody watches that terminal, and an open question
 * there stops the `/loop`, so no further cycle ran. Telegram is now optional,
 * which splits the old fallback in two. The rules pinned here:
 * - the manager never asks anything in its terminal, with or without a
 *   channel;
 * - with no channel (`notify` is `none`, or the block is absent) a question is
 *   recorded as pending with no Telegram message id, every Telegram post is
 *   skipped, and the cycle is never `recovery-required` just because there is
 *   no channel;
 * - only a configured-but-broken Telegram (tools missing, a failed send, no
 *   paired chat) ends a cycle `recovery-required` with the pairing summary;
 * - every cycle (re)sends a pending question that has no `telegramMessageId`
 *   when Telegram is configured, so a question recorded while it was down
 *   still reaches the operator.
 * Pinned in the source and every runtime projection, like the other skill
 * contract suites.
 * @module tests/unit/strategies/session-manager-telegram-contract
 */
import { describe, expect, it } from "vitest";

import { USAGE } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/cli-usage.mjs";
import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

const MANAGER = "lisa-session-manager";
const RULES = "## Questions and notifications";

describe.each(ALL_ROOTS)(
  "lisa-session-manager notification contract (%s)",
  root => {
    const skill = read(`${root}/${MANAGER}/SKILL.md`);
    const rules = section(skill, RULES);

    it("never asks the operator in the manager's terminal", () => {
      expect(rules).toContain("**Never ask in this terminal.**");
      expect(rules).toContain("a question there stops the `/loop`");
      expect(rules).toContain(
        "Never use `AskUserQuestion`, and never end a turn on a question."
      );
    });

    it("learns whether a channel exists from status, and treats none as normal", () => {
      const facts = section(skill, "## Fixed facts");
      expect(facts).toContain("**Notification channel.**");
      expect(facts).toContain("`notify` from `status`");
      expect(facts).toContain(
        "Having no channel is a normal configuration, never a failure."
      );
    });

    it("records a question as pending and posts nothing when there is no channel", () => {
      expect(rules).toContain("**No channel (`notify` is `none`).**");
      expect(rules).toContain(
        "`ledger set-question <ref>` without `--telegram-message-id`"
      );
      expect(rules).toContain(
        'every "post to Telegram" and "notify Telegram" step is skipped'
      );
      expect(rules).toContain(
        "having no channel never makes a cycle `recovery-required`"
      );
    });

    it("ends recovery-required only for a configured Telegram that is broken", () => {
      expect(rules).toContain("**Telegram configured but broken.**");
      expect(rules).toContain("end it with outcome `recovery-required`");
      expect(rules).toContain(
        "`Telegram not paired: run tmux attach -t <name> and pair with /telegram:access pair <code>.`"
      );
      expect(rules).toContain("The `/loop` keeps running");
    });

    it("re-sends every pending question that has no telegramMessageId, only when Telegram is configured", () => {
      const cycle = section(skill, "## The cycle");
      expect(cycle).toContain(
        "**Unsent questions** (only when `notify` is `telegram`)."
      );
      expect(cycle).toContain("`telegramMessageId: null`");
      expect(cycle).toContain(
        "(Re)send each\nto Telegram now and re-record it with " +
          "`ledger set-question <ref> --telegram-message-id <id>`"
      );
      expect(cycle).toContain(
        "With no channel there is nothing to send: pending questions stay in the ledger"
      );
    });

    it("keeps no-channel cycles out of recovery-required in the outcome table", () => {
      const outcome = section(skill, "## Run outcome");
      expect(outcome).toContain(
        "Telegram is configured but was unavailable or unpaired (a question stayed pending with no Telegram message id)"
      );
      expect(outcome).toContain(
        "A missing channel is never a reason for `recovery-required`"
      );
    });

    it("lets setup skip the token, plugin and pairing steps with no channel", () => {
      const setup = read(`${root}/lisa-setup-session-manager/SKILL.md`);
      expect(section(setup, "## Step 2: Write the config block")).toContain(
        "init-config --notify <notify>"
      );
      expect(section(setup, "## Step 3: Store the bot token")).toContain(
        "skip Steps 3 and 4 and go to Step 5"
      );
      expect(section(setup, "## Step 9: Start and pair")).toContain(
        "with no channel there is no\n   pairing, so skip to Step 10"
      );
      expect(section(setup, "## Step 10: Verify")).toContain(
        'the "Session manager notifications?" check'
      );
      expect(setup).not.toContain("Telegram isolation?");
    });

    it("sends a worker's question through the same rules", () => {
      const handling = section(
        skill,
        "## Handling messages (any time, not only during a cycle)"
      );
      expect(handling).toContain(
        'With no channel, or a configured Telegram that is unavailable or unpaired, follow "Questions and notifications"'
      );
    });
  }
);

describe("session-manager --help documents the optional channel", () => {
  it("lists init-config --notify and the no-channel start", () => {
    expect(USAGE).toContain(
      "init-config [--slug <slug>] [--notify none|telegram] [--write]"
    );
    expect(USAGE).toContain('With notify.provider "none" (or no notify block)');
    expect(USAGE).toContain("launches with no --channels");
  });
});
