/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint plugin for Phaser 4 game-development standards
 *
 * Stateful rules that enforce Phaser 4 performance and lifecycle invariants that
 * cannot be expressed as flat `no-restricted-syntax` selectors. Supports ESLint 9
 * flat config. Wired into the Phaser stack via @codyswann/lisa/eslint/phaser.
 *
 * Rules:
 * - no-create-in-update: no GameObject/tween/timer/Phaser creation in update()
 * - no-allocation-in-update: no heap allocations in update()
 * - require-shutdown-cleanup: persistent external listeners need a cleanup path
 * @module eslint-plugin-phaser
 */
const noCreateInUpdate = require("./rules/no-create-in-update");
const noAllocationInUpdate = require("./rules/no-allocation-in-update");
const requireShutdownCleanup = require("./rules/require-shutdown-cleanup");

const plugin = {
  meta: {
    name: "eslint-plugin-phaser",
    version: "1.0.0",
  },
  rules: {
    "no-create-in-update": noCreateInUpdate,
    "no-allocation-in-update": noAllocationInUpdate,
    "require-shutdown-cleanup": requireShutdownCleanup,
  },
};

module.exports = plugin;
