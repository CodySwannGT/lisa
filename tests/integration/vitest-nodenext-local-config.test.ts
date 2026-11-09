/** Shipped Vitest wrappers must resolve the host's local config in NodeNext. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../helpers/test-utils.js";
import {
  createStagedModuleFixture,
  runStagedTool,
} from "../support/staged-module-fixture.js";

useIoLatencyBudget();

const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const TYPESCRIPT = require.resolve("typescript/bin/tsc");
const CONFIG = "vitest.config.ts";
const LOCAL = "vitest.config.local.ts";
const THRESHOLDS = "vitest.thresholds.json";
const TSCONFIG = "tsconfig.json";
const RESOLUTION_PROFILES = [
  { module: "NodeNext", moduleResolution: "NodeNext" },
  { module: "ESNext", moduleResolution: "Bundler" },
] as const;

describe.each(["typescript", "cdk", "nestjs", "harper-fabric", "phaser"])(
  "%s shipped Vitest wrapper",
  stack => {
    for (const profile of RESOLUTION_PROFILES) {
      it(`typechecks ${profile.moduleResolution} with the real compiler and preserved local config`, async () => {
        const fixture = createStagedModuleFixture("emitted");
        try {
          fs.copyFileSync(
            path.join(ROOT, stack, "copy-overwrite", CONFIG),
            path.join(fixture.directory, CONFIG)
          );
          // Every wrapper accepts this real TypeScript seed as a host-owned config.
          for (const file of [LOCAL, THRESHOLDS]) {
            fs.copyFileSync(
              path.join(ROOT, "typescript/create-only", file),
              path.join(fixture.directory, file)
            );
          }
          fs.writeFileSync(
            path.join(fixture.directory, TSCONFIG),
            JSON.stringify({
              compilerOptions: {
                target: "ES2023",
                module: profile.module,
                moduleResolution: profile.moduleResolution,
                strict: true,
                noEmit: true,
                allowImportingTsExtensions: true,
                types: ["node"],
              },
              include: [CONFIG, LOCAL],
            })
          );
          const inputs = [CONFIG, LOCAL, THRESHOLDS, TSCONFIG].map(file => ({
            file,
            bytes: fs.readFileSync(path.join(fixture.directory, file)),
          }));
          const checked = runStagedTool(fixture, process.execPath, [
            TYPESCRIPT,
            "--noEmit",
            "--pretty",
            "false",
            "-p",
            TSCONFIG,
          ]);
          expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
          for (const input of inputs) {
            expect(
              fs.readFileSync(path.join(fixture.directory, input.file))
            ).toEqual(input.bytes);
          }
        } finally {
          await cleanupTempDir(fixture.directory);
        }
      });
    }
  }
);
