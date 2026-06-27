import { describe, expect, it } from "vitest";
import {
  resolveStarter,
  SETUP_TYPES,
  STARTERS,
} from "../../../src/cli/starters.js";

describe("starter registry", () => {
  it("maps every setup type to a CodySwannGT template repository", () => {
    const sortStrings = (left: string, right: string): number =>
      left.localeCompare(right);

    expect(Object.keys(STARTERS).sort(sortStrings)).toEqual(
      [...SETUP_TYPES].sort(sortStrings)
    );

    expect(STARTERS).toMatchObject({
      rails: { owner: "CodySwannGT", repo: "railsstarter", template: true },
      typescript: {
        owner: "CodySwannGT",
        repo: "typescriptstarter",
        template: true,
      },
      expo: { owner: "CodySwannGT", repo: "expostarter", template: true },
      nestjs: { owner: "CodySwannGT", repo: "nestjsstarter", template: true },
      cdk: { owner: "CodySwannGT", repo: "cdkstarter", template: true },
      phaser: { owner: "CodySwannGT", repo: "phaserstarter", template: true },
      wiki: { owner: "CodySwannGT", repo: "wikistarter", template: true },
      "harper-wiki": {
        owner: "CodySwannGT",
        repo: "harperwikistarter",
        template: true,
      },
    });
  });

  it("resolves a starter by setup type", () => {
    expect(resolveStarter("rails")).toEqual({
      owner: "CodySwannGT",
      repo: "railsstarter",
      template: true,
    });
  });
});
