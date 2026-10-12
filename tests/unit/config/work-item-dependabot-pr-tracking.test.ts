/** Execute both actual workflow adapters and original Actions routing. */
import { describe, expect, it } from "vitest";
import {
  BASE,
  FILES,
  HEAD,
  URL,
  VALIDATE_STEP,
  QUALITY_WORKFLOW,
  fixture,
  steps,
  runs,
  execute,
  assertRefused,
} from "./work-item-dependabot-pr-fixture.js";

describe.each(FILES)("%s authenticated Dependabot PR record", file => {
  it("qualifies the genuine whole PR, including a maintainer-amended head", async () => {
    const result = await execute(file);
    const fallback = steps(file).find(step =>
      step.name?.includes(VALIDATE_STEP)
    );
    expect(runs(fallback?.if, "false", result.outputs.qualified ?? "")).toBe(
      false
    );
    expect(result.outputs.qualified).toBe("true");
    expect(result.messages).toEqual([
      `WORK_ITEM_PR_RECORD ${URL} number=7 head=${HEAD}`,
    ]);
    expect(result.calls).toEqual([
      {
        api: "content",
        args: {
          owner: "example",
          repo: "project",
          path: ".lisa.config.json",
          ref: BASE,
        },
      },
      {
        api: "pull",
        args: { owner: "example", repo: "project", pull_number: 7 },
      },
      {
        api: "pull",
        args: { owner: "example", repo: "project", pull_number: 7 },
      },
    ]);
  });

  it.each(["{}", '{"workItem":{"dependabotTracking":"issue"}}'])(
    "preserves default issue routing for base config %s",
    async config => {
      const input = fixture();
      input.config = config;
      const result = await execute(file, input);
      expect(result.outputs.qualified).not.toBe("true");
      expect(result.calls.filter(call => call.api === "pull")).toEqual([]);
      expect(
        runs(
          steps(file).find(step => step.name?.includes(VALIDATE_STEP))?.if,
          "false",
          result.outputs.qualified ?? ""
        )
      ).toBe(true);
    }
  );

  it("refuses malformed base64 rather than ignoring its suffix", async () => {
    const input = fixture();
    input.contentSuffix = "!";
    await assertRefused(file, input);
  });

  it("accepts the provider's base64 line breaks", async () => {
    const input = fixture();
    input.contentSuffix = "\r\n";
    expect((await execute(file, input)).outputs.qualified).toBe("true");
  });

  it("preserves a missing base configuration and cannot use a head-only opt-in", async () => {
    const input = fixture();
    input.configError = 404;
    expect((await execute(file, input)).outputs.qualified).not.toBe("true");
  });

  it("does not trust a title, branch, email, triggering actor or changed head executable", async () => {
    const input = fixture();
    input.pulls[0]!.user = {
      id: 292923,
      type: "User",
      login: "dependabot[bot]",
    };
    await assertRefused(file, input);
  });

  it.each(["id", "type", "login"] as const)(
    "refuses forged provider Bot %s",
    async field => {
      const input = fixture();
      Object.assign(input.pulls[0]!.user, {
        [field]: field === "id" ? 1 : "wrong",
      });
      await assertRefused(file, input);
    }
  );

  it.each(["base", "head"] as const)(
    "refuses wrong %s SHA or repository",
    async side => {
      const input = fixture();
      input.pulls[0]![side].sha = "c".repeat(40);
      await assertRefused(file, input);
      const fork = fixture();
      fork.pulls[0]![side].repo.id = 456;
      await assertRefused(file, fork);
    }
  );

  it.each(["number", "state", "html_url", "merged"] as const)(
    "refuses wrong PR %s",
    async field => {
      const input = fixture();
      Object.assign(input.pulls[0]!, {
        [field]: field === "number" ? 8 : field === "merged" ? true : "wrong",
      });
      await assertRefused(file, input);
    }
  );

  it("refuses a stale second read rather than reporting the first head", async () => {
    const input = fixture();
    input.pulls[1]!.head.sha = "c".repeat(40);
    await assertRefused(file, input);
  });

  it.each([403, 500])(
    "fails closed on provider content error %i",
    async status => {
      const input = fixture();
      input.configError = status;
      await assertRefused(file, input);
    }
  );

  it("fails closed on unavailable or malformed PR proof", async () => {
    const input = fixture();
    input.pullError = 1;
    await assertRefused(file, input);
    const missing = fixture();
    missing.pulls = [];
    await assertRefused(file, missing);
  });

  it.each(["{", '{"workItem":{"dependabotTracking":"unknown"}}'])(
    "refuses malformed enabled policy %s",
    async config => {
      const input = fixture();
      input.config = config;
      await assertRefused(file, input);
    }
  );

  it("refuses wrong host and malformed event SHAs", async () => {
    const host = fixture();
    host.context.serverUrl = "https://example.invalid";
    await assertRefused(file, host);
    const event = fixture();
    event.context.payload.pull_request.head.sha = "b".repeat(39);
    await assertRefused(file, event);
  });

  it("leaves ordinary human PR routing unchanged", async () => {
    const input = fixture();
    input.context.payload.pull_request.user = {
      id: 292923,
      type: "User",
      login: "maintainer",
    };
    const result = await execute(file, input);
    expect(result.outputs.qualified).not.toBe("true");
    expect(result.calls).toEqual([]);
  });
});

describe("PR record routing ownership", () => {
  it("executes identical workflow-owned proof before all PR-controlled steps", () => {
    const first = FILES.map(file => steps(file)[0]);
    expect(first[0]?.with?.script).toBeTruthy();
    expect(first[0]?.with?.script).toBe(first[1]?.with?.script);
    for (const step of first) {
      expect(step?.id).toBe("dependabot_record");
      expect(step?.uses).toBe("actions/github-script@v8");
    }
  });

  it("keeps the custom gate and off routing unchanged even with a genuine PR record", () => {
    const job = steps(QUALITY_WORKFLOW);
    const custom = job.find(
      step => step.name === "🔗 Run the traceability gate"
    );
    const fallback = job.find(step => step.name?.includes(VALIDATE_STEP));
    expect(custom?.if).toBe("steps.gate.outputs.configured == 'true'");
    expect(runs(custom?.if, "true", "true")).toBe(true);
    expect(runs(custom?.if, "off", "true")).toBe(false);
    expect(runs(fallback?.if, "off", "true")).toBe(false);
    expect(runs(fallback?.if, "true", "true")).toBe(false);
  });
});
