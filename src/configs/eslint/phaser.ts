/**
 * ESLint 9 Flat Config - Phaser Stack
 *
 * Extends Lisa's TypeScript config with Phaser 4 enforcement:
 * - bans Phaser 3 rendering/API idioms removed in v4,
 * - enforces determinism (no Math.random/Date.now/performance.now in game code),
 * - enforces the architecture boundary (src/logic must be Phaser-free),
 * - bans reusing game.events, shipping physics debug:true, and raw localStorage,
 * - registers eslint-plugin-phaser for the per-frame/lifecycle rules that cannot
 *   be expressed as static selectors (no-create-in-update,
 *   no-allocation-in-update, require-shutdown-cleanup).
 * @module configs/eslint/phaser
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";

import type { Linter } from "eslint";
import {
  defaultIgnores,
  defaultThresholds,
  getTypescriptConfig,
} from "./typescript.js";

export { defaultIgnores, defaultThresholds };

// Custom plugin — loaded via relative path so it resolves from the Lisa package
// itself (eslint-plugin-* dirs are in the published files array) rather than the
// registry. Same pattern as the code-organization plugin in typescript.ts.
const require = createRequire(import.meta.url);
const phaserPlugin = require(
  fileURLToPath(
    new URL("../../../eslint-plugin-phaser/index.js", import.meta.url)
  )
);

export { phaserPlugin };

/**
 * Default ignore patterns for Phaser projects.
 */
export const defaultPhaserIgnores = [
  ...defaultIgnores,
  "*.config.local.ts",
  "public/assets/**",
  ".vite/**",
];

/**
 * Phaser 3 idioms removed in Phaser 4, banned with pointers to the v4
 * replacement. Kept in sync with the phaser-v3-migration skill table.
 */
const PHASER_3_IDIOM_BANS: readonly {
  readonly selector: string;
  readonly message: string;
}[] = [
  {
    selector: "CallExpression[callee.property.name='setPipeline']",
    message:
      "Phaser 4 removed pipelines. Custom rendering is a RenderNode (render.renderNodes); 'Light2D' is gameObject.setLighting(true).",
  },
  {
    selector: "CallExpression[callee.property.name='setPostPipeline']",
    message:
      "Phaser 4 removed post pipelines. Use the unified Filter system (gameObject.filters / camera.filters).",
  },
  {
    selector: "CallExpression[callee.property.name='resetPipeline']",
    message:
      "Phaser 4 removed pipelines. There is nothing to reset — delete this call.",
  },
  {
    selector: "CallExpression[callee.property.name='setTintFill']",
    message:
      "Phaser 4 removed setTintFill. Use setTint(color) + setTintMode(Phaser.TintModes.FILL).",
  },
  {
    selector: "MemberExpression[property.name='preFX']",
    message:
      "Phaser 4 removed preFX. Use the unified Filter system (Filters work on any GameObject and on cameras).",
  },
  {
    selector: "MemberExpression[property.name='postFX']",
    message:
      "Phaser 4 removed postFX. Use the unified Filter system (Filters work on any GameObject and on cameras).",
  },
  {
    selector:
      "MemberExpression[object.object.name='Phaser'][object.property.name='Geom'][property.name='Point']",
    message: "Phaser 4 removed Geom.Point. Use Phaser.Math.Vector2.",
  },
  {
    selector: "MemberExpression[object.name='Phaser'][property.name='Struct']",
    message: "Phaser 4 removed Phaser.Struct. Use native Set / Map.",
  },
  {
    selector:
      "NewExpression[callee.object.object.name='Phaser'][callee.object.property.name='Display'][callee.property.name='BitmapMask']",
    message: "Phaser 4 removed BitmapMask. Use the Mask filter.",
  },
  {
    selector:
      "MemberExpression[property.name='Mesh'][object.property.name='GameObjects']",
    message:
      "Phaser 4 removed Mesh. Use Sprites/Containers, or SpriteGPULayer for mass rendering.",
  },
  {
    selector:
      "MemberExpression[property.name='Plane'][object.property.name='GameObjects']",
    message: "Phaser 4 removed Plane. Use Sprites/Containers.",
  },
  {
    selector: "MemberExpression[property.name='Camera3D']",
    message: "Phaser 4 removed Camera3D. There is no 3D camera in v4.",
  },
  {
    selector: "MemberExpression[property.name='Layer3D']",
    message: "Phaser 4 removed Layer3D. There is no 3D layer in v4.",
  },
];

/**
 * Determinism and architecture bans for Phaser game code (src/**, non-test).
 */
const PHASER_GAME_BANS: readonly {
  readonly selector: string;
  readonly message: string;
}[] = [
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      "Game code must be deterministic. Use the seeded Phaser.Math.RND (RandomDataGenerator) instead of Math.random().",
  },
  {
    selector:
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      "Game code must be deterministic. Use the scene clock (update(time, delta)) or seeded RNG, not Date.now().",
  },
  {
    selector:
      "CallExpression[callee.object.name='performance'][callee.property.name='now']",
    message:
      "Game code must be deterministic. Use the scene clock (update(time, delta)), not performance.now().",
  },
  {
    selector:
      "MemberExpression[property.name='events'][object.property.name='game'][object.object.type='ThisExpression']",
    message:
      "Do not reuse this.game.events as an app bus — it collides with Phaser internals. Create a dedicated EventsCenter (new Phaser.Events.EventEmitter()) in src/services. See the phaser-services skill.",
  },
  {
    selector:
      ":matches(Property[key.name='physics'], Property[key.name='arcade'], Property[key.name='matter']) Property[key.name='debug'][value.value=true]",
    message:
      "Never ship physics debug:true. Gate it behind an env flag (e.g. import.meta.env.DEV).",
  },
];

const LOGIC_IMPORT_MESSAGE =
  "src/logic must be Phaser-free (pure, testable game logic). Keep all Phaser usage in scenes/objects/services and pass plain data into logic.";

/**
 * Phaser-specific ESLint overrides layered on top of the TypeScript config.
 * Hoisted to module scope so the factory stays small; they close over the
 * module-level bans, plugin, and boundary message (no per-call parameters).
 */
const PHASER_OVERRIDES: Linter.Config[] = [
  // Game code: idiom bans, determinism, localStorage discipline, and the
  // stateful per-frame/lifecycle rules. Test files are excluded.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    plugins: { phaser: phaserPlugin },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...PHASER_3_IDIOM_BANS,
        ...PHASER_GAME_BANS,
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message:
            "Use the typed SaveService (src/services), not raw localStorage — it centralizes schema versioning and migration. See the phaser-services skill.",
        },
        {
          name: "sessionStorage",
          message:
            "Use a typed service (src/services), not raw sessionStorage.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "localStorage",
          message:
            "Use the typed SaveService (src/services), not window.localStorage.",
        },
        {
          object: "window",
          property: "sessionStorage",
          message:
            "Use a typed service (src/services), not window.sessionStorage.",
        },
      ],
      "phaser/no-create-in-update": "error",
      "phaser/no-allocation-in-update": "error",
      "phaser/require-shutdown-cleanup": "error",
    },
  },
  // The architecture boundary: pure logic may not import Phaser.
  {
    files: ["src/logic/**/*.ts"],
    ignores: ["src/logic/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "phaser", message: LOGIC_IMPORT_MESSAGE }],
          patterns: [
            { group: ["phaser", "phaser/*"], message: LOGIC_IMPORT_MESSAGE },
          ],
        },
      ],
    },
  },
  // Services own the persistence boundary, so they may touch storage directly.
  {
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
  // Tests can do anything (mock removed APIs, allocate freely, etc.).
  {
    files: ["tests/**/*.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off",
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
] as Linter.Config[];

/**
 * Creates the Phaser ESLint configuration.
 * @param options - Configuration options
 * @param options.tsconfigRootDir - Root directory for tsconfig.json
 * @param options.ignorePatterns - Patterns to ignore
 * @param options.thresholds - Threshold overrides
 * @returns ESLint flat config array
 */
export function getPhaserConfig({
  tsconfigRootDir,
  ignorePatterns = defaultPhaserIgnores,
  thresholds = defaultThresholds,
}: {
  tsconfigRootDir: string;
  ignorePatterns?: string[];
  thresholds?: typeof defaultThresholds;
}): Linter.Config[] {
  return [
    ...getTypescriptConfig({ tsconfigRootDir, ignorePatterns, thresholds }),
    ...PHASER_OVERRIDES,
  ];
}
