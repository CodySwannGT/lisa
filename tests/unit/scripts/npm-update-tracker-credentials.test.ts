/**
 * AC7 of CodySwannGT/lisa#4859: a missing tracker credential fails closed,
 * names the variable for the operator, and nothing is created anywhere. Also
 * covers every Jira/Linear phase reaching its own credential check now that
 * none is refused as unsupported (CodySwannGT/lisa#4873).
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { main } from "../../../all/copy-overwrite/scripts/lisa-npm-updater.mjs";
import {
  JIRA_CONFIG,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  committedHost,
  automation,
  policyFor,
} from "../../support/npm-update-tracker-host.js";

const PROPOSAL_FILE = "proposal.json";
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

  it.each([
    ["jira", JIRA_CONFIG, { JIRA_API_TOKEN: "t", JIRA_LOGIN: "b@x.test" }],
    ["linear", LINEAR_CONFIG, { LINEAR_API_KEY: "k" }],
  ] as const)(
    "refuses a %s host without a declared claimActorRef, naming the key (#4873)",
    (tracker, config, env) => {
      const transport = vi.fn();
      const section = {
        ...(config as unknown as Record<string, object>)[tracker],
        claimActorRef: undefined,
      };
      const text = operatorText(() =>
        createTracker({ ...config, [tracker]: section }, env, transport)
      );
      expect(text).toContain(`${tracker}.claimActorRef is not set`);
      expect(transport).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      "jira",
      JIRA_CONFIG,
      { JIRA_API_TOKEN: "t", JIRA_LOGIN: "b@x.test" },
      { accountId: "someone-else" },
      "JIRA_API_TOKEN",
    ],
    [
      "linear",
      LINEAR_CONFIG,
      { LINEAR_API_KEY: "k" },
      { data: { viewer: { id: "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a40" } } },
      "LINEAR_API_KEY",
    ],
  ] as const)(
    "refuses a %s credential that signs in as a different account than claimActorRef (#4873)",
    async (_tracker, config, env, reply, variable) => {
      const tracker = createTracker(config, env, async () =>
        Response.json(reply)
      )!;
      const failure = await (
        "myself" in tracker ? tracker.myself() : tracker.viewer()
      ).then(
        () => undefined,
        (error: unknown) => publicFailure(error)
      );
      expect(failure).toContain(
        `The ${variable} signs in as a different account than`
      );
    }
  );

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
        join(output, PROPOSAL_FILE),
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

  it("publish exits non-zero naming LINEAR_API_KEY before any request or output (#4873)", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    await withPrivateRoot(async (root, env) => {
      const { cwd, output, proposal } = await linearCheckout(root, env);
      const message = `chore(deps): update selected npm dependencies\n\nWork-Item: ENG-1\nAutomation-Provenance: actions/1/attempts/1\n`;
      const files: Record<string, unknown> = {
        [PROPOSAL_FILE]: proposal,
        "allocation.json": { number: 1, workItem: "ENG-1" },
        "preview.json": {
          descriptor: { workItem: "ENG-1", messageSha256: sha256(message) },
          message,
          epoch: 1,
        },
        "gated.json": { raw: "", receipt: {} },
      };
      for (const [name, value] of Object.entries(files))
        writeFileSync(join(output, name), `${canonicalJson(value)}\n`, {
          mode: 0o600,
        });
      const failure = await main(["publish", cwd, output]).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(publicFailure(failure)).toContain("LINEAR_API_KEY");
      const byName = (left: string, right: string) => left.localeCompare(right);
      expect(readdirSync(output).sort(byName)).toEqual(
        Object.keys(files).sort(byName)
      );
    });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["gate", "publish"])(
    "dispatches the %s phase for a Linear host to its signed-reference check (#4873)",
    async phase => {
      await withPrivateRoot(async (root, env) => {
        const { cwd, output, proposal } = await linearCheckout(root, env);
        const message = `chore(deps): update selected npm dependencies\n\nWork-Item: ENG-2\nAutomation-Provenance: actions/1/attempts/1\n`;
        // Allocation number 1 must carry ENG-1; ENG-2 everywhere else must refuse.
        const files: Record<string, unknown> = {
          [PROPOSAL_FILE]: proposal,
          "allocation.json": { number: 1, workItem: "ENG-2" },
          "preview.json": {
            descriptor: { workItem: "ENG-2", messageSha256: sha256(message) },
            message,
            epoch: 1,
          },
        };
        for (const [name, value] of Object.entries(files))
          writeFileSync(join(output, name), `${canonicalJson(value)}\n`, {
            mode: 0o600,
          });
        const failure = await main([phase, cwd, output]).then(
          () => undefined,
          (error: unknown) => error
        );
        expect((failure as Error).message).toContain(
          "signed work item differs from the configured tracker"
        );
        expect(publicFailure(failure)).not.toContain("not supported");
      });
    }
  );

  it.each(["cancel-prepare", "cancel-checkpoint"])(
    "%s exits non-zero naming LINEAR_API_KEY before any request",
    async phase => {
      const network = vi.spyOn(globalThis, "fetch");
      await withPrivateRoot(async (root, env) => {
        const { cwd, output, proposal } = await linearCheckout(root, env);
        writeFileSync(
          join(output, PROPOSAL_FILE),
          `${canonicalJson(proposal)}\n`,
          { mode: 0o600 }
        );
        const failure = await main([phase, cwd, output]).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(publicFailure(failure)).toContain("LINEAR_API_KEY");
      });
      expect(network).not.toHaveBeenCalled();
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
