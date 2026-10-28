/** Related proof is a demonstrated positive, not a fabricated wrong-item record. */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  cleanupFixtures,
  cleanupTemplates,
  git,
} from "../../support/work-item-cli.js";
import { proofCli } from "../../support/work-item-proof-fixture.js";
import {
  coherentRelatedFixture,
  RELATED_REF,
  OWN_REF,
} from "../../support/work-item-coherent-related.js";
import {
  verifyLisaUsageSectionIntegrity,
  parseLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
type RelatedFixture = ReturnType<typeof coherentRelatedFixture>;
/** Preserve all state and source surfaces rather than resetting a write counter. */
function snapshot(fixture: RelatedFixture) {
  const read = (file: string) => readFileSync(file, "utf8");
  return {
    states: {
      "99": JSON.parse(read(fixture.relatedFile)),
      "42": JSON.parse(read(fixture.ownFile)),
    },
    journal: read(fixture.env.FAKE_GH_WRITES_FILE!),
    config: digest(readFileSync(path.join(fixture.root, ".lisa.config.json"))),
    head: git(fixture.root, ["rev-parse", "HEAD"], fixture.env),
    api: digest(readFileSync(fixture.env.FAKE_GH_API_FILE!)),
    registry: read(fixture.registryFile),
    assetIndex: digest(readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!)),
    assets: Object.fromEntries(
      readdirSync(fixture.env.FAKE_GH_ASSET_DIRECTORY!)
        .sort((left, right) => left.localeCompare(right))
        .map(name => [
          name,
          digest(
            readFileSync(path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, name))
          ),
        ])
    ),
  };
}

describe.each(["direct", "sweep"])(
  "coherent related-proof isolation: %s",
  route => {
    it("proves related99 completion then keeps own42 pending without any extra write", () => {
      const fixture = coherentRelatedFixture();
      const before = snapshot(fixture);
      const ownUsage = parseLisaUsageSection(before.states["42"].body).entries;
      const relatedArgs = ["complete", "--ref", RELATED_REF];
      const related = proofCli(fixture, relatedArgs);
      const positive = snapshot(fixture);
      const args =
        route === "direct"
          ? ["complete", "--ref", OWN_REF]
          : ["sweep", "--apply", "--since", fixture.merge, "--branch", "main"];
      const own = proofCli(fixture, args);
      const after = snapshot(fixture);
      const unhandled = readFileSync(
        fixture.env.FAKE_GH_UNHANDLED_FILE!,
        "utf8"
      );
      console.log(
        `COHERENT_RELATED_OBSERVATION ${JSON.stringify({
          route,
          controllerSha256: digest(
            readFileSync("all/copy-overwrite/scripts/lisa-work-item.mjs")
          ),
          commands: [
            [process.execPath, "scripts/lisa-work-item.mjs", ...relatedArgs],
            [process.execPath, "scripts/lisa-work-item.mjs", ...args],
          ],
          before,
          related: {
            status: related.status,
            stdout: related.stdout,
            stderr: related.stderr,
          },
          positive,
          own: { status: own.status, stdout: own.stdout, stderr: own.stderr },
          after,
          calls: readFileSync(fixture.env.FAKE_GH_LOG!, "utf8"),
          unhandled,
          acceptedRelatedRecord: fixture.record,
        })}`
      );
      expect(related.status).toBe(0);
      expect(before.states["99"].state).toBe("OPEN");
      expect(before.states["42"].state).toBe("OPEN");
      expect(related.stdout).toContain(`work-item completed: ${RELATED_REF}`);
      expect(positive.states["99"].state).toBe("CLOSED");
      expect(
        positive.states["99"].labels
          .map((row: { name: string }) => row.name)
          .sort((left: string, right: string) => left.localeCompare(right))
      ).toEqual(["component:ci", "status:done", "type:Bug"]);
      expect(positive.states["99"].assignees).toEqual(
        before.states["99"].assignees
      );
      expect(positive.states["99"].body).toBe(before.states["99"].body);
      expect(positive.states["42"]).toEqual(before.states["42"]);
      const relatedWrites = positive.journal
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as string[]);
      expect(relatedWrites.map(row => row.slice(0, 3))).toEqual([
        ["issue", "edit", "99"],
        ["issue", "close", "99"],
      ]);
      expect(
        verifyLisaUsageSectionIntegrity(before.states["42"].body, {
          entryIds: ["verify-42"],
        }).ok
      ).toBe(true);
      expect(ownUsage).toHaveLength(1);
      expect(ownUsage[0]).toMatchObject({
        artifactRef: "github:acme/code#42",
        parentArtifactRef: null,
      });
      expect(ownUsage[0]?.effectiveness ?? null).toBeNull();
      expect(own.status).toBe(0);
      expect(own.stdout).toContain("[pending-proof]");
      expect(own.stdout).toContain(OWN_REF);
      expect(own.stdout).toMatch(
        /canonical Verify\/evidence|accepted completion proof|retry completion/iu
      );
      expect(after).toEqual(positive);
      expect(after.states["42"].state).toBe("OPEN");
      expect(positive.config).toBe(before.config);
      expect(positive.head).toBe(before.head);
      expect(unhandled).toBe("");
    });
  }
);
