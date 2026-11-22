/**
 * Runtime libraries Lisa stopped forcing are the host's, and the library choice
 * they encoded survives as a version floor (CodySwannGT/lisa#4932).
 *
 * The strict dead-code gate reported every runtime library Lisa forced into a
 * host that no host file imports. Lisa now stops supplying those, under two
 * rules:
 *
 * - **Never removed from a host.** No template may carry `adopt.dependencies`:
 *   a runtime library a host holds is the host's to keep or delete, so an
 *   apply never takes one away. Only retired dev-tool keys are reclaimed, and
 *   only at the exact values Lisa once wrote.
 * - **The choice is kept without installing code.** Every library Lisa used to
 *   force keeps its old minimum in the template's `minimums`. A minimum holds
 *   only a range the host itself lists, so a host that uses the library stays
 *   on Lisa's line and a host that never did installs nothing. It is never an
 *   `overrides`/`resolutions` floor: those replace the range of every copy in
 *   the tree and would move a transitive consumer of an older major onto a
 *   newer one, which the forced dependency never did. No release history
 *   records a reason beyond "the stack's standard library" — every one arrived
 *   in the initial commit — so all of them keep the minimum rather than a
 *   guess about which mattered.
 *
 * A fresh project must still install, build, lint and test, so no file Lisa
 * ships into a stack's hosts may import a library that stack is no longer
 * given — neither a de-forced runtime library nor a retired dev tool (an
 * `adopt.devDependencies` key). Either the import goes, or the library stays
 * supplied.
 * @module tests/unit/config/runtime-dependency-ownership
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";
import {
  importedPackages,
  lineage,
  namedPackages,
  REPO_ROOT,
  shippedSources,
  TEMPLATES,
} from "../../helpers/stack-templates.js";

/** The one package every host is given whatever its stack. */
const LISA_PACKAGE = "@codyswann/lisa";

/**
 * Runtime libraries each stack forced before #4932, with the minimum kept.
 * The security floors are absent on purpose, because an advisory reaches every
 * copy in the tree, so each stays an `overrides`/`resolutions` floor:
 * {@link SECURITY_FLOORS}.
 */
const DE_FORCED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  cdk: { "source-map-support": ">=0.5.21" },
  expo: {
    "@apollo/client": ">=3.10.8",
    "@hookform/resolvers": ">=3.9.0",
    "apollo-link-sentry": ">=4.4.0",
    "base-64": ">=1.0.0",
    "date-fns": ">=3.6.0",
    "date-fns-tz": ">=3.1.3",
    events: ">=3.3.0",
    graphql: ">=16.12.0",
    "i18n-js": ">=4.5.1",
    "patch-package": ">=8.0.0",
    "react-hook-form": ">=7.70.0",
    "text-encoding-polyfill": ">=0.6.7",
    "usehooks-ts": ">=3.1.1",
  },
  nestjs: {
    "@apollo/server": ">=5.4.0",
    "@as-integrations/express5": ">=1.1.2",
    "@aws-sdk/client-apigatewaymanagementapi": ">=3.967.0",
    "@aws-sdk/client-cognito-identity-provider": ">=3.969.0",
    "@aws-sdk/rds-signer": ">=3.968.0",
    "@nestjs/apollo": ">=13.2.3",
    "@nestjs/graphql": ">=13.2.3",
    "@nestjs/terminus": ">=11.0.0",
    "@nestjs/typeorm": ">=11.0.0",
    "@vendia/serverless-express": ">=4.12.6",
    "aws-jwt-verify": ">=5.1.1",
    "aws-xray-sdk-core": ">=3.12.0",
    "class-transformer": ">=0.5.1",
    dataloader: ">=2.2.3",
    "graphql-query-complexity": ">=1.1.0",
    "graphql-subscriptions": ">=3.0.0",
    "graphql-ws": ">=6.0.6",
    "typeorm-naming-strategies": ">=4.1.0",
  },
};

/**
 * Libraries Lisa stopped forcing whose floor answers a security advisory, so it
 * stays in `overrides`/`resolutions` for every copy: tar's predates #4932, zod
 * answers GHSA-mrhx-c7xc-m3w5 and `@graphql-tools/utils` GHSA-c4qx-w738-7hr3.
 */
const SECURITY_FLOORS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  expo: { tar: ">=7.5.21", zod: ">=4.6.6" },
  nestjs: { "@graphql-tools/utils": ">=12.0.2" },
};

/**
 * Packages a stack's hosts are still given.
 * @param stack - Stack directory
 * @returns Lisa itself and the package names its lineage forces or defaults
 */
function supplied(stack: string): ReadonlySet<string> {
  return new Set([
    LISA_PACKAGE,
    ...lineage(stack).flatMap(layer => {
      const template = TEMPLATES.get(layer);
      return [template?.force, template?.defaults].flatMap(section =>
        ["dependencies", "devDependencies"].flatMap(key =>
          Object.keys(section?.[key] ?? {})
        )
      );
    }),
  ]);
}

/**
 * Libraries a stack's hosts are no longer given: its de-forced runtime
 * libraries and its retired dev tools, less anything a layer still supplies.
 * @param stack - Stack directory
 * @returns Package names
 */
function withdrawn(stack: string): ReadonlySet<string> {
  const still = supplied(stack);
  return new Set(
    lineage(stack)
      .flatMap(layer => [
        ...Object.keys(DE_FORCED[layer] ?? {}),
        ...Object.keys(SECURITY_FLOORS[layer] ?? {}),
        ...Object.keys(TEMPLATES.get(layer)?.adopt?.devDependencies ?? {}),
      ])
      .filter(name => !still.has(name))
  );
}

describe("runtime libraries Lisa stopped forcing", () => {
  it("discovers every stack this suite names", () => {
    for (const stack of Object.keys(DE_FORCED))
      expect(TEMPLATES.has(stack), stack).toBe(true);
  });

  it("are never reclaimed from a host", () => {
    const reclaiming = [...TEMPLATES]
      .filter(([, template]) => template.adopt?.dependencies !== undefined)
      .map(([stack]) => stack);
    expect(reclaiming).toEqual([]);
  });

  // A dev tool a stack reclaims is one Lisa stopped supplying. A minimum for
  // it would either reach nothing (the host still held Lisa's value, which the
  // apply takes back) or hold the host to a tool Lisa no longer has a stake in.
  it.each([...TEMPLATES.keys()])(
    "%s holds no minimum for a dev tool it reclaims",
    stack => {
      const chain = lineage(stack).map(each => TEMPLATES.get(each));
      const reclaimed = new Set(
        chain.flatMap(template =>
          Object.keys(template?.adopt?.devDependencies ?? {})
        )
      );
      const held = chain
        .flatMap(template => Object.keys(template?.minimums ?? {}))
        .filter(name => reclaimed.has(name));
      expect(held).toEqual([]);
    }
  );

  it.each(Object.entries(DE_FORCED))(
    "%s forces none of them and keeps each one's minimum for direct ranges only",
    (stack, floors) => {
      const template = TEMPLATES.get(stack);
      const force = template?.force ?? {};
      for (const [name, floor] of Object.entries(floors)) {
        expect(force.dependencies?.[name], `${stack} forces ${name}`).toBe(
          undefined
        );
        expect(template?.minimums?.[name], `${stack} minimums.${name}`).toBe(
          floor
        );
        expect(force.overrides?.[name], `${stack} overrides.${name}`).toBe(
          undefined
        );
        expect(force.resolutions?.[name], `${stack} resolutions.${name}`).toBe(
          undefined
        );
      }
    }
  );

  it.each(Object.entries(SECURITY_FLOORS))(
    "%s keeps each security floor for every copy in the tree, not as a minimum",
    (stack, floors) => {
      const template = TEMPLATES.get(stack);
      for (const [name, floor] of Object.entries(floors)) {
        expect(template?.force?.overrides?.[name], name).toBe(floor);
        expect(template?.force?.resolutions?.[name], name).toBe(floor);
        expect(template?.minimums?.[name], name).toBeUndefined();
      }
    }
  );
});

describe("shipped host files and withdrawn libraries", () => {
  it("reads the package a specifier loads", () => {
    expect(
      importedPackages(
        [
          'import { useForm } from "react-hook-form";',
          'import "events";',
          'const b = require("base-64");',
          'const z = await import("@apollo/client/core");',
          'import { join } from "node:path";',
          'import local from "./local";',
        ].join("\n")
      )
    ).toEqual(["react-hook-form", "events", "base-64", "@apollo/client"]);
  });

  it.each(Object.keys(PROJECT_TYPE_HIERARCHY).filter(s => TEMPLATES.has(s)))(
    "%s ships no file importing a library its hosts are no longer given",
    stack => {
      const gone = withdrawn(stack);
      const offending = shippedSources(stack).flatMap(file =>
        importedPackages(fs.readFileSync(file, "utf8"))
          .filter(name => gone.has(name))
          .map(name => `${path.relative(REPO_ROOT, file)} imports ${name}`)
      );
      expect(offending).toEqual([]);
    }
  );

  it.each(Object.keys(PROJECT_TYPE_HIERARCHY).filter(s => TEMPLATES.has(s)))(
    "%s ships no file naming a package its templates do not supply",
    stack => {
      // Lisa's own dependencies do not count: under an isolated layout (pnpm)
      // a host file resolves only what the host declares.
      const given = supplied(stack);
      const offending = shippedSources(stack).flatMap(file =>
        namedPackages(file)
          .filter(name => !given.has(name))
          .map(name => `${path.relative(REPO_ROOT, file)} names ${name}`)
      );
      expect(offending).toEqual([]);
    }
  );

  it("reads a Jest config loader and ignores what is not a package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-named-"));
    const file = path.join(dir, "jest.config.ts");
    fs.writeFileSync(
      file,
      [
        "/** @jest-config-loader esbuild-register */",
        '// pulled from "malformed" input',
        'import "@/lib/thing";',
        'import { join } from "path";',
        'import type { Config } from "jest";',
      ].join("\n")
    );
    const named = namedPackages(file);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(named).toEqual(["jest", "esbuild-register"]);
  });
});
