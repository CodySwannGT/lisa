/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Lighthouse CI Configuration
 *
 * This configuration file defines performance budgets and assertion rules for
 * Lighthouse CI to monitor and enforce web performance standards in CI/CD pipelines.
 *
 * ## Configuration Approach
 *
 * Uses assertions (not budget.json) for:
 * - More comprehensive checks available
 * - Better CI integration and error reporting
 * - Ability to combine preset with custom assertions
 * - Note: Cannot use both budget.json and assertions together
 *
 * ## Project-Specific Configuration
 *
 * Thresholds are loaded from `lighthouserc-config.json`. To customize for your
 * project, edit that file. This JS file can be copied between projects unchanged.
 *
 * ## Threshold Strategy
 *
 * Thresholds are set to be realistic for Expo web apps while preventing
 * significant regressions. CI environments have higher variance than local.
 *
 * Known issues that remain as "warn" (non-blocking):
 * - errors-in-console: Missing favicon.ico causes 404
 * - image-aspect-ratio: Some images have incorrect sizing
 * - meta-description: Not a priority for mobile-first app
 * - max-potential-fid: High variance in CI environments
 * - largest-contentful-paint: Expo apps struggle to meet Core Web Vital threshold
 *
 * @see {@link https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md|Lighthouse CI Configuration}
 * @see {@link https://web.dev/vitals/|Core Web Vitals}
 */

const fs = require("fs");
const path = require("path");

/**
 * Default configuration values.
 * These are used when lighthouserc-config.json doesn't specify a value.
 */
const defaults = {
  collect: {
    staticDistDir: "./dist",
    numberOfRuns: 5,
  },
  assertions: {
    buttonName: { minScore: 0.9 },
    validSourceMaps: { minScore: 0.9 },
    errorsInConsole: { minScore: 1 },
    performance: { minScore: 0.55 },
    firstContentfulPaint: { maxNumericValue: 1500 },
    largestContentfulPaint: { maxNumericValue: 4000 },
    interactive: { maxNumericValue: 6000 },
    cumulativeLayoutShift: { maxNumericValue: 0.1 },
    totalByteWeight: { maxNumericValue: 850000 },
    scriptSize: { maxNumericValue: 750000 },
    fontDisplay: { minScore: 0.9 },
    fontDisplayInsight: { minScore: 0.9 },
    imageAspectRatio: { minScore: 1 },
    metaDescription: { minScore: 1 },
    unusedJavascript: { maxLength: 2 },
    unusedCssRules: { maxLength: 0 },
    usesRelPreconnect: { maxLength: 0 },
    bootupTime: { minScore: 0.9 },
    mainthreadWorkBreakdown: { minScore: 0.9 },
    maxPotentialFid: { minScore: 1 },
    legacyJavascript: { maxLength: 2 },
    legacyJavascriptInsight: { minScore: 0.4 },
    speedIndex: { minScore: 0.9 },
    networkDependencyTreeInsight: { minScore: 0.9 },
    duplicatedJavascriptInsight: { minScore: 0.9 },
  },
};

/**
 * Load and merge project-specific configuration from lighthouserc-config.json.
 *
 * @returns {object} Merged configuration with defaults
 */
function loadConfig() {
  const configPath = path.join(__dirname, "lighthouserc-config.json");

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  const projectConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  return {
    collect: { ...defaults.collect, ...projectConfig.collect },
    assertions: {
      ...defaults.assertions,
      ...Object.fromEntries(
        Object.entries(projectConfig.assertions || {}).map(([key, value]) => [
          key,
          { ...defaults.assertions[key], ...value },
        ])
      ),
    },
  };
}

const config = loadConfig();
const { collect, assertions: a } = config;

module.exports = {
  ci: {
    collect: {
      staticDistDir: collect.staticDistDir,
      numberOfRuns: collect.numberOfRuns,
      chromePath: process.env.CHROME_PATH || undefined,
    },

    assert: {
      preset: "lighthouse:recommended",

      assertions: {
        // Accessibility
        "button-name": ["error", { minScore: a.buttonName.minScore }],
        "valid-source-maps": [
          "error",
          { minScore: a.validSourceMaps.minScore },
        ],
        "errors-in-console": ["warn", { minScore: a.errorsInConsole.minScore }],

        // Performance Score
        "categories:performance": [
          "error",
          { minScore: a.performance.minScore, aggregationMethod: "median" },
        ],

        // Core Web Vitals - Timing Metrics
        "first-contentful-paint": [
          "error",
          { maxNumericValue: a.firstContentfulPaint.maxNumericValue },
        ],
        "largest-contentful-paint": [
          "warn",
          { maxNumericValue: a.largestContentfulPaint.maxNumericValue },
        ],
        interactive: [
          "error",
          { maxNumericValue: a.interactive.maxNumericValue },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: a.cumulativeLayoutShift.maxNumericValue },
        ],

        // Resource Budgets
        "total-byte-weight": [
          "error",
          { maxNumericValue: a.totalByteWeight.maxNumericValue },
        ],
        "resource-summary:script:size": [
          "error",
          { maxNumericValue: a.scriptSize.maxNumericValue },
        ],

        // Best Practices
        "font-display": ["error", { minScore: a.fontDisplay.minScore }],
        "image-aspect-ratio": [
          "warn",
          { minScore: a.imageAspectRatio.minScore },
        ],

        // SEO
        "meta-description": ["warn", { minScore: a.metaDescription.minScore }],

        // Performance Insights
        "unused-javascript": [
          "error",
          { maxLength: a.unusedJavascript.maxLength },
        ],
        "bootup-time": ["error", { minScore: a.bootupTime.minScore }],
        "mainthread-work-breakdown": [
          "error",
          { minScore: a.mainthreadWorkBreakdown.minScore },
        ],
        "max-potential-fid": ["warn", { minScore: a.maxPotentialFid.minScore }],
        "legacy-javascript": [
          "error",
          { maxLength: a.legacyJavascript.maxLength },
        ],
        "legacy-javascript-insight": [
          "warn",
          { minScore: a.legacyJavascriptInsight.minScore },
        ],
        "speed-index": ["error", { minScore: a.speedIndex.minScore }],
        "unused-css-rules": ["warn", { maxLength: a.unusedCssRules.maxLength }],
        "uses-rel-preconnect": [
          "warn",
          { maxLength: a.usesRelPreconnect.maxLength },
        ],
        "font-display-insight": [
          "warn",
          { minScore: a.fontDisplayInsight.minScore },
        ],
        "network-dependency-tree-insight": [
          "warn",
          { minScore: a.networkDependencyTreeInsight.minScore },
        ],
        "duplicated-javascript-insight": [
          "warn",
          { minScore: a.duplicatedJavascriptInsight.minScore },
        ],
      },
    },

    upload: {
      target: "temporary-public-storage",
    },
  },
};
