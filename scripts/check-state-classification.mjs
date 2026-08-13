#!/usr/bin/env node
/**
 * Lisa's own adopter entry point for the shipped state-classification check.
 *
 * Lisa holds no persistent state of its own, so there is nothing here to
 * classify. What this file buys is that the *shipped* mechanism — the
 * copy-overwrite script plus the `🧬 State Classification` job in the reusable
 * quality workflow — runs on Lisa's own pull requests instead of only on
 * adopters. Without it, a regression in the gate would ship silently and be
 * discovered downstream.
 *
 * It points the check at `state/demo-project/`, a small worked example standing
 * in for an adopter repo: a handful of entities across all four policies,
 * including state that is not rows. A change that makes the check stop failing
 * on an unclassified or unswept entity turns Lisa's own CI red.
 *
 * This is the same path `lisa apply` writes into an adopter (`scripts/`), so
 * adopters get the file itself, not this wrapper.
 * @module scripts/check-state-classification
 */
import { main } from "../all/copy-overwrite/scripts/check-state-classification.mjs";

process.exitCode = main([
  ...process.argv.slice(2),
  "--root",
  "state/demo-project",
]);
