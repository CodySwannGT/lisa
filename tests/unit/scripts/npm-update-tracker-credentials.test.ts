/**
 * AC7 of CodySwannGT/lisa#4859: a missing tracker credential fails closed,
 * names the variable for the operator, and nothing is created anywhere. Also
 * covers the operator refusal for the phases Jira and Linear do not support yet
 * (CodySwannGT/lisa#4873).
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { main } from "../../../all/copy-overwrite/scripts/lisa-npm-updater.mjs";
import {
  JIRA_CONFIG,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  committedHost,
  automation,
  policyFor,
} from "../../support/npm-update-tracker-host.js";

const FOLLOWUP =
  "The npm updater can file and claim Jira and Linear work items, but it cannot yet check their claims, publish the pull request or cancel them. That support is tracked in CodySwannGT/lisa#4873. Projects that track work in GitHub are fully supported today.";
const VARIABLES = [
  "LINEAR_API_KEY",
  "LINEAR_API_KEY_acme",
  "JIRA_API_TOKEN",
  "ATLASSIAN_API_TOKEN",
  "JIRA_LOGIN",
  "GH_TOKEN",
];

/** The thrown refusal, as the operator would read it on stderr. */
function operatorText(thunk: () => unknown) {
  try {
    thunk();
  } catch (error) {
    return publicFailure(error);
  }
  throw Error("expected a refusal");
}

describe("tracker credentials fail closed before any request", () => {
  it("names LINEAR_API_KEY and sends nothing", () => {
    const transport = vi.fn();
    const text = operatorText(() =>
      createTracker(LINEAR_CONFIG, {}, transport)
    );
    expect(text).toContain("LINEAR_API_KEY");
    expect(text).toContain("Nothing was created");
    expect(transport).not.toHaveBeenCalled();
  });

  it("names JIRA_API_TOKEN, then JIRA_LOGIN, and sends nothing", () => {
    const transport = vi.fn();
    expect(
      operatorText(() => createTracker(JIRA_CONFIG, {}, transport))
    ).toContain("JIRA_API_TOKEN");
    expect(
      operatorText(() =>
        createTracker(JIRA_CONFIG, { JIRA_API_TOKEN: "token" }, transport)
      )
    ).toContain("JIRA_LOGIN");
    expect(transport).not.toHaveBeenCalled();
  });

  it("accepts the documented aliases and fallbacks", () => {
    const transport = vi.fn();
    expect(
      createTracker(
        {
          ...JIRA_CONFIG,
          atlassian: { ...JIRA_CONFIG.atlassian, email: "bot@example.test" },
        },
        { ATLASSIAN_API_TOKEN: "token" },
        transport
      )?.provider
    ).toBe("jira");
    expect(
      createTracker(LINEAR_CONFIG, { LINEAR_API_KEY_acme: "key" }, transport)
        ?.provider
    ).toBe("linear");
    expect(createTracker({ tracker: "github" }, {}, transport)).toBeUndefined();
    expect(transport).not.toHaveBeenCalled();
  });

  it("names the Jira site when neither a cloud id nor a site is configured", () => {
    const text = operatorText(() =>
      createTracker(
        { ...JIRA_CONFIG, atlassian: {} },
        { JIRA_API_TOKEN: "token", JIRA_LOGIN: "bot@example.test" },
        vi.fn()
      )
    );
    expect(text).toContain("atlassian.site");
  });
});

describe("the allocate phase with LINEAR_API_KEY unset", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const name of VARIABLES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.GH_TOKEN = "job-token";
  });
  afterEach(() => {
    for (const name of VARIABLES)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    vi.restoreAllMocks();
  });

  /** A committed Linear host and its private phase directory holding proposal.json. */
  async function linearCheckout(root: string, env: NodeJS.ProcessEnv) {
    const policy = policyFor(LINEAR_MAINTAINER);
    const config = {
      ...LINEAR_CONFIG,
      automationProvenance: await automation(),
      npmUpdater: policy,
    };
    const host = await committedHost(root, env, LINEAR_MAINTAINER, {
      ".lisa.config.json": `${JSON.stringify(config)}\n`,
    });
    const output = join(root, "phase");
    mkdirSync(output, { mode: 0o700 });
    return { ...host, output };
  }

  it("exits non-zero naming LINEAR_API_KEY with no provider request or output", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    await withPrivateRoot(async (root, env) => {
      const { cwd, output, proposal } = await linearCheckout(root, env);
      writeFileSync(
        join(output, "proposal.json"),
        `${canonicalJson(proposal)}\n`,
        { mode: 0o600 }
      );
      const failure = await main(["allocate", cwd, output]).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).toBeDefined();
      expect(publicFailure(failure)).toContain("LINEAR_API_KEY");
      expect(readdirSync(output)).toEqual(["proposal.json"]);
    });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["gate", "publish", "cancel-prepare", "cancel-checkpoint"])(
    "refuses the %s phase for a Linear host with the follow-up sentence",
    async phase => {
      await withPrivateRoot(async (root, env) => {
        const { cwd, output } = await linearCheckout(root, env);
        const failure = await main([phase, cwd, output]).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(publicFailure(failure)).toContain(FOLLOWUP);
      });
    }
  );

  it("refuses an unsupported tracker before reading any credential", () => {
    const transport = vi.fn();
    expect(() =>
      createTracker({ ...JIRA_CONFIG, tracker: "gitlab" }, {}, transport)
    ).toThrow(/tracker/);
    expect(transport).not.toHaveBeenCalled();
  });
});
