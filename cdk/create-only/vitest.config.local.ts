// Seeded by Lisa on first setup — this file is YOURS.
// Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)

/**
 * Vitest Configuration - Project-Local Customizations
 *
 * Add project-specific Vitest settings here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * Example:
 * ```ts
 * import type { ViteUserConfig } from "vitest/config";
 *
 * const config: ViteUserConfig = {
 *   resolve: {
 *     alias: {
 *       "@/": new URL("./src/", import.meta.url).pathname,
 *     },
 *   },
 * };
 *
 * export default config;
 * ```
 *
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = {
  test: {
    // Scratch redirection must install before the leak guard, and the guard's
    // afterAll must run after project hooks so cleanup is attributed correctly.
    sequence: { setupFiles: "list", hooks: "stack" },
  },
};

export default config;
