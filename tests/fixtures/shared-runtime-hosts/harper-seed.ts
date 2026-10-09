/** Actual Harper component build; resource seam tests do not claim server proof. */
import { write } from "./host.js";

const HEALTH_SOURCE = `export function healthRecord(id: string): { id: string; name: string; node: string; abi: string | undefined } {
  if (id !== "runtime") throw Object.assign(new Error("Unknown health record"), { statusCode: 404 });
  return { id, name: "Packed Harper Node24 component", node: process.versions.node, abi: process.versions.modules };
}
`;

const RESOURCE_SOURCE = `import { healthRecord } from "./health.js";

// Harper supplies this runtime base while loading the built jsResource module.
declare const Resource: new () => object;
export class Health extends Resource {
  static async get(target: { id: string }): Promise<ReturnType<typeof healthRecord>> {
    return healthRecord(target.id);
  }
}
`;

const BUILD_SOURCE = `import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["src/resource-health.ts"],
  outfile: "harper-app/resources.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "external",
});
await mkdir(join(root, "harper-app/web"), { recursive: true });
await copyFile(join(root, "src/web/index.html"), join(root, "harper-app/web/index.html"));
`;

const RESOURCE_TEST = `import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("executes Harper resource source through the documented unit seam", async () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  // Harper injects Resource in production. This is a unit seam, not a server.
  vi.stubGlobal("Resource", class {});
  const { Health } = await import("../src/resource-health.js");
  await expect(Health.get({ id: "runtime" })).resolves.toEqual({ id: "runtime", name: "Packed Harper Node24 component", node: "24.21.0", abi: "137" });
  await expect(Health.get({ id: "missing" })).rejects.toMatchObject({ statusCode: 404 });
});

it("executes the actual bundled Harper component through the same unit seam", async () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  vi.stubGlobal("Resource", class {});
  const { Health } = await import("../harper-app/resources.js");
  await expect(Health.get({ id: "runtime" })).resolves.toMatchObject({ name: "Packed Harper Node24 component", node: "24.21.0", abi: "137" });
  await expect(Health.get({ id: "missing" })).rejects.toMatchObject({ statusCode: 404 });
});
`;

/**
 * Seed source, component config, real bundler build and bounded native unit work.
 * @param root - Owned disposable host directory
 */
export function seedHarperHost(root: string): void {
  write(root, "package.json", {
    name: "packed-runtime-harper-fabric",
    version: "1.0.0",
    private: true,
    type: "module",
  });
  write(root, "tsconfig.json", {
    extends: [
      "@codyswann/lisa/tsconfig/harper-fabric",
      "./tsconfig.local.json",
    ],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  // The shipped build executes dist/build/build.js, so source is rooted at src.
  write(root, "tsconfig.local.json", {
    compilerOptions: { rootDir: "src", outDir: "dist" },
    include: ["src/**/*.ts"],
    exclude: ["node_modules", "dist", "tests", "harper-app"],
    files: [],
  });
  write(
    root,
    "harper-app/config.yaml",
    `rest: true
graphqlSchema:
  files: schema.graphql
jsResource:
  files: resources.js
static:
  files: web/**
`
  );
  write(root, "harper-app/schema.graphql", "type Query { health: String! }\n");
  write(root, "src/health.ts", HEALTH_SOURCE);
  write(root, "src/resource-health.ts", RESOURCE_SOURCE);
  write(root, "src/build/build.ts", BUILD_SOURCE);
  write(
    root,
    "src/web/index.html",
    `<!doctype html>
<html><head><title>Packed Harper component</title></head>
<body><h1>Packed Harper Node24 component</h1></body></html>
`
  );
  write(root, "tests/health.test.ts", RESOURCE_TEST);
}
