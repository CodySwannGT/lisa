/**
 * Vitest Configuration - Project-Local Customizations (Lisa)
 *
 * Lisa-specific Vitest settings. This file is create-only — Lisa will not overwrite it.
 *
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";
import * as path from "node:path";

const config: ViteUserConfig = {
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    alias: {
      // Expo/NestJS/CDK templates import @codyswann/lisa/* package paths so
      // downstream projects resolve via the installed npm package. In the Lisa
      // repo's own test context the package resolves to itself — redirect these
      // self-referencing imports to the local source files instead.
      "@codyswann/lisa/jest/base": path.resolve(
        import.meta.dirname,
        "src/configs/jest/base.ts"
      ),
      "@codyswann/lisa/vitest/base": path.resolve(
        import.meta.dirname,
        "src/configs/vitest/base.ts"
      ),
      "@codyswann/lisa/eslint/typescript": path.resolve(
        import.meta.dirname,
        "src/configs/eslint/typescript.ts"
      ),
      // Stack template files (expo/, nestjs/, cdk/) import ./jest.base.ts as
      // a sibling — which only exists at the project root after Lisa copies
      // the template. Redirect so tests can import these templates in-place.
      "./jest.base.ts": path.resolve(
        import.meta.dirname,
        "src/configs/jest/base.ts"
      ),
    },
  },
};

export default config;
