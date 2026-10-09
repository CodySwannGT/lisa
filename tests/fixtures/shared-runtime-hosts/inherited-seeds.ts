/** Real additional application seeds; root's bounded journey executes them. */
import { write } from "./host.js";
import { seedExpoHost, seedPhaserHost } from "./browser-seeds.js";
import { seedHarperHost } from "./harper-seed.js";

/** Additional routes discovered by the packed candidate's real detectors. */
export type InheritedStack =
  | "npm-package"
  | "nestjs"
  | "phaser"
  | "harper-fabric"
  | "expo";

/** Native commands and outputs, not assertions that execution has succeeded. */
export const INHERITED_NATIVE_SPEC = {
  "npm-package": {
    buildScript: "build",
    unitCount: 2,
    artifacts: ["dist/index.js", "dist/index.d.ts"],
    frameworkPackages: ["typescript"],
    minimumBun: "1.3.8",
  },
  nestjs: {
    buildScript: "build",
    unitCount: 2,
    artifacts: [".build/runtime.service.js", ".build/runtime.module.js"],
    frameworkPackages: ["@nestjs/core", "@nestjs/testing", "@nestjs/cli"],
    minimumBun: "1.3.8",
  },
  phaser: {
    buildScript: "build",
    unitCount: 1,
    artifacts: ["dist/index.html"],
    frameworkPackages: ["phaser", "vite"],
    minimumBun: "1.3.11",
  },
  "harper-fabric": {
    buildScript: "build",
    unitCount: 2,
    artifacts: ["harper-app/resources.js", "harper-app/web/index.html"],
    frameworkPackages: ["harperdb", "esbuild"],
    minimumBun: "1.3.11",
  },
  expo: {
    // Expo's inherited tsc build is noEmit; Metro produces the actual bundle.
    buildScript: "export:web",
    unitCount: 1,
    artifacts: ["dist/index.html"],
    frameworkPackages: ["expo", "react-native", "jest", "jest-expo"],
    minimumBun: "1.3.8",
  },
} as const;

const LIBRARY_SOURCE = `import { Buffer } from "node:buffer";

export interface EncodedName { readonly name: string; readonly hex: string }
export function encodeName(raw: string): EncodedName {
  const name = raw.trim().toUpperCase();
  return { name, hex: Buffer.from(name, "utf8").toString("hex") };
}
`;

const LIBRARY_TEST = `import { expect, it } from "vitest";
import { encodeName } from "../src/index.js";

it("executes real Node typed library source", () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  expect(encodeName("  lisa ")).toEqual({ name: "LISA", hex: "4c495341" });
});

it("imports the actual emitted distributable", async () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  const built = await import("../dist/index.js");
  expect(built.encodeName("  native ")).toEqual({ name: "NATIVE", hex: "4e4154495645" });
});
`;

const NEST_SERVICE = `import { Injectable } from "@nestjs/common";

@Injectable()
export class RuntimeService {
  describe(name: string): { name: string; node: string; abi: string | undefined } {
    return { name: name.trim().toUpperCase(), node: process.versions.node, abi: process.versions.modules };
  }
}
`;

const NEST_MODULE = `import "reflect-metadata";
import { Module } from "@nestjs/common";
import { RuntimeService } from "./runtime.service";

@Module({ providers: [RuntimeService], exports: [RuntimeService] })
export class RuntimeModule {}
`;

const NEST_TEST = `import "reflect-metadata";
import { createRequire } from "node:module";
import { Test } from "@nestjs/testing";
import { expect, it } from "vitest";
import { RuntimeModule } from "./runtime.module";
import { RuntimeService } from "./runtime.service";

it("resolves the genuine Nest source provider", async () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  const context = await Test.createTestingModule({ imports: [RuntimeModule] }).compile();
  try {
    expect(context.get(RuntimeService).describe(" lisa ")).toEqual({ name: "LISA", node: "24.21.0", abi: "137" });
  } finally {
    await context.close();
  }
});

it("resolves the genuine Nest CLI compiled provider", async () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  const requireBuilt = createRequire(new URL("../package.json", import.meta.url));
  const builtModule = requireBuilt("./.build/runtime.module.js");
  const builtService = requireBuilt("./.build/runtime.service.js");
  const context = await Test.createTestingModule({ imports: [builtModule.RuntimeModule] }).compile();
  try {
    expect(context.get(builtService.RuntimeService).describe(" compiled ")).toEqual({ name: "COMPILED", node: "24.21.0", abi: "137" });
  } finally {
    await context.close();
  }
});
`;

/**
 * Seed a real publishable library with source and emitted-entry unit checks.
 * @param root - Owned disposable host directory
 */
function seedPackage(root: string): void {
  write(root, "package.json", {
    name: "packed-runtime-npm-package",
    version: "1.0.0",
    private: false,
    type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  });
  write(root, "tsconfig.json", {
    extends: ["@codyswann/lisa/tsconfig/typescript", "./tsconfig.local.json"],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  write(root, "tsconfig.local.json", {
    compilerOptions: { rootDir: "src", outDir: "dist", types: ["node"] },
    include: ["src/**/*.ts"],
    exclude: ["node_modules", "dist", "tests"],
    files: [],
  });
  write(root, "src/index.ts", LIBRARY_SOURCE);
  write(root, "tests/index.test.ts", LIBRARY_TEST);
}

/**
 * Seed an actual decorator/container application and host-owned Nest CLI build.
 * @param root - Owned disposable host directory
 */
function seedNest(root: string): void {
  write(root, "package.json", {
    name: "packed-runtime-nestjs",
    version: "1.0.0",
    private: true,
    type: "commonjs",
    scripts: {
      build: "node scripts/lib/worktree-dependencies.mjs && nest build",
    },
  });
  write(root, "nest-cli.json", {
    collection: "@nestjs/schematics",
    sourceRoot: "src",
    compilerOptions: { tsConfigPath: "tsconfig.build.json" },
  });
  write(root, "tsconfig.json", {
    extends: ["@codyswann/lisa/tsconfig/nestjs", "./tsconfig.local.json"],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  write(root, "tsconfig.local.json", {
    compilerOptions: {
      rootDir: "src",
      outDir: ".build",
      moduleResolution: "node",
      types: ["node"],
    },
    include: ["src/**/*.ts"],
    exclude: ["node_modules", ".build", "dist", "**/*.spec.ts"],
    files: [],
  });
  write(root, "src/runtime.service.ts", NEST_SERVICE);
  write(root, "src/runtime.module.ts", NEST_MODULE);
  write(root, "src/runtime.service.spec.ts", NEST_TEST);
}

/**
 * Seed authentic extra routes without installing or executing their tooling.
 * @param root - Owned disposable host directory
 * @param stack - Route the candidate must really detect and apply
 */
export function seedInheritedHost(root: string, stack: InheritedStack): void {
  switch (stack) {
    case "npm-package":
      seedPackage(root);
      break;
    case "nestjs":
      seedNest(root);
      break;
    case "phaser":
      seedPhaserHost(root);
      break;
    case "harper-fabric":
      seedHarperHost(root);
      break;
    case "expo":
      seedExpoHost(root);
      break;
  }
}
