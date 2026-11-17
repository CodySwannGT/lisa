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
 *   force carries a floor at its old minimum in both `overrides` and
 *   `resolutions`. A floor applies only when the package is in the tree, so a
 *   host that uses the library stays on Lisa's line and a host that never did
 *   installs nothing. No release history records a reason beyond "the stack's
 *   standard library" — every one arrived in the initial commit — so all of
 *   them keep the floor rather than a guess about which mattered.
 * @module tests/unit/config/runtime-dependency-ownership
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Runtime libraries each stack forced before #4932, with the floor kept. */
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
    tar: ">=7.5.21",
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

/** The sections of a stack template this suite reads. */
interface Template {
  readonly force?: Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  readonly adopt?: Readonly<Record<string, unknown>>;
}

/**
 * Every stack template in the repository.
 * @returns Stack name and parsed template
 */
function templates(): readonly (readonly [string, Template])[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry): readonly [string, string] => [
      entry.name,
      path.join(REPO_ROOT, entry.name, "package-lisa", "package.lisa.json"),
    ])
    .filter(([, file]) => fs.existsSync(file))
    .map(([stack, file]): readonly [string, Template] => [
      stack,
      JSON.parse(fs.readFileSync(file, "utf8")) as Template,
    ]);
}

const TEMPLATES = new Map(templates());

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

  it.each(Object.entries(DE_FORCED))(
    "%s forces none of them and floors each in overrides and resolutions",
    (stack, floors) => {
      const force = TEMPLATES.get(stack)?.force ?? {};
      for (const [name, floor] of Object.entries(floors)) {
        expect(force.dependencies?.[name], `${stack} forces ${name}`).toBe(
          undefined
        );
        expect(force.overrides?.[name], `${stack} overrides.${name}`).toBe(
          floor
        );
        expect(force.resolutions?.[name], `${stack} resolutions.${name}`).toBe(
          floor
        );
      }
    }
  );
});
