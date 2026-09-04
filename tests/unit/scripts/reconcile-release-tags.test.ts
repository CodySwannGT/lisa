/**
 * Proof that the tag reconciliation tells a bad release from a bad measurement.
 *
 * Two failure directions, and the tests are weighted toward the second because
 * it is the one that does damage. Missing a genuine orphan leaves a known
 * problem unfound; reporting a GOOD release as missing invites someone to
 * retract or re-cut a release that shipped correctly. The registry is not
 * always reachable, so "not proven present" and "proven absent" cannot be the
 * same word.
 *
 * The tag-convention assertions are not housekeeping. The first draft of this
 * scan read only `v1.2.3`, reported 765 correctly-tagged releases as untagged,
 * and hid 13 genuine orphans behind that noise. A reconciliation that flags
 * everything is as useless as one that flags nothing and looks far more
 * diligent, so the convention is pinned here rather than left to the regex.
 * @module tests/unit/scripts/reconcile-release-tags
 */

import { describe, expect, it } from "vitest";

import {
  classifyProbe,
  formatReport,
  parseVersionTag,
  probeRegistry,
  probeWithRetry,
  reconcile,
  registryUrl,
  VERDICT,
} from "../../../scripts/reconcile-release-tags.mjs";

/** Refs in this repository that are not release tags. */
const NON_RELEASE_REFS = [
  "backup/2830-premerge",
  "_fleet/3524",
  "pr-assets",
  "project-workflow-eol",
] as const;

/** The published package, and a version that is a proven orphan. */
const PACKAGE = "@codyswann/lisa";
const ORPHAN_VERSION = "4.33.7";

/** A probe that answers the same way for every version. */
const always = (result: Record<string, unknown>) => () => result;

describe("parseVersionTag", () => {
  it("reads the current v1.2.3 convention", () => {
    expect(parseVersionTag("v4.33.7")).toBe("4.33.7");
  });

  it("reads the earlier vv1.2.3 convention", () => {
    // 765 releases in this repository carry this prefix. A pattern anchored to
    // a single `v` reports every one of them as an untagged publication.
    expect(parseVersionTag("vv1.82.1")).toBe("1.82.1");
    expect(parseVersionTag("vv2.189.5")).toBe("2.189.5");
  });

  it("refuses refs that are not release tags", () => {
    for (const ref of NON_RELEASE_REFS)
      expect(parseVersionTag(ref), ref).toBeNull();
  });

  it("does not guess at a prerelease or build-metadata tag", () => {
    // Reconciling these needs a rule nobody has written down. Returning null
    // leaves them out of the report; returning a version would put a row in it
    // whose verdict nothing validated.
    expect(parseVersionTag("v4.33.7-rc.1")).toBeNull();
    expect(parseVersionTag("v4.33.7+build.5")).toBeNull();
  });
});

describe("classifyProbe", () => {
  it("reports a 200 as published", () => {
    expect(classifyProbe({ status: 200 })).toBe(VERDICT.PUBLISHED);
  });

  it("reports a 404 on the exact-version endpoint as missing", () => {
    expect(classifyProbe({ status: 404 })).toBe(VERDICT.MISSING);
  });

  it("never reports a transport failure as missing", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A registry that could not be reached
    // says nothing about whether the release happened, and calling that
    // `missing` is how a good release gets retracted over a network blip.
    expect(classifyProbe({ error: "ENOTFOUND registry.npmjs.org" })).toBe(
      VERDICT.UNPROVABLE
    );
  });

  it("never reports an auth or throttling failure as missing", () => {
    for (const status of [401, 403, 429, 500, 502, 503])
      expect(classifyProbe({ status }), String(status)).toBe(
        VERDICT.UNPROVABLE
      );
  });

  it("treats an absent status as unprovable rather than assuming either way", () => {
    expect(classifyProbe({})).toBe(VERDICT.UNPROVABLE);
    expect(classifyProbe()).toBe(VERDICT.UNPROVABLE);
  });
});

describe("reconcile", () => {
  it("reports a completed release as good", () => {
    // The regression fence from the ticket: a reconciliation that flags
    // everything is as useless as one that flags nothing.
    const { rows } = reconcile({
      tags: ["v4.34.5", "vv2.40.0"],
      probe: always({ status: 200 }),
    });
    expect(rows.map(r => r.verdict)).toEqual([
      VERDICT.PUBLISHED,
      VERDICT.PUBLISHED,
    ]);
  });

  it("finds an orphan under either tag convention", () => {
    const { rows } = reconcile({
      tags: ["v4.33.7", "vv1.83.2"],
      probe: always({ status: 404 }),
    });
    expect(rows.map(r => r.version)).toEqual(["4.33.7", "1.83.2"]);
    expect(rows.every(r => r.verdict === VERDICT.MISSING)).toBe(true);
  });

  it("keeps non-release refs out of the report entirely", () => {
    const { rows, ignored } = reconcile({
      tags: ["v1.0.0", ...NON_RELEASE_REFS.slice(0, 2)],
      probe: always({ status: 200 }),
    });
    expect(rows).toHaveLength(1);
    expect(ignored).toEqual(NON_RELEASE_REFS.slice(0, 2));
  });

  it("does not convert a registry outage into a list of missing releases", () => {
    // The whole tag list against an unreachable registry. Every row must be
    // unprovable; a single `missing` here would be a report that reads as
    // "these releases never shipped" when the truth is "we could not look".
    const { rows } = reconcile({
      tags: ["v4.34.5", "v4.34.6", "vv2.40.0"],
      probe: always({ error: "ETIMEDOUT" }),
    });
    expect(rows.every(r => r.verdict === VERDICT.UNPROVABLE)).toBe(true);
    expect(rows.some(r => r.verdict === VERDICT.MISSING)).toBe(false);
  });

  it("distinguishes the two per version rather than flattening to one verdict", () => {
    const published = new Set(["4.34.5"]);
    const { rows } = reconcile({
      tags: ["v4.34.5", "v4.33.7", "v9.9.9"],
      probe: (version: string) => {
        if (published.has(version)) return { status: 200 };
        if (version === "9.9.9") return { error: "ECONNRESET" };
        return { status: 404 };
      },
    });
    expect(rows).toEqual([
      { tag: "v4.34.5", version: "4.34.5", verdict: VERDICT.PUBLISHED },
      { tag: "v4.33.7", version: "4.33.7", verdict: VERDICT.MISSING },
      { tag: "v9.9.9", version: "9.9.9", verdict: VERDICT.UNPROVABLE },
    ]);
  });
});

describe("registryUrl", () => {
  it("asks for the exact version, never the latest dist-tag", () => {
    // `dist-tags.latest` lags a successful publish by minutes, so reconciling
    // against it reports the newest release — the one under most scrutiny — as
    // absent.
    const url = registryUrl(PACKAGE, ORPHAN_VERSION);
    expect(url).toBe("https://registry.npmjs.org/@codyswann%2flisa/4.33.7");
    expect(url).not.toContain("dist-tags");
    expect(url).not.toContain("latest");
  });
});

describe("probeRegistry", () => {
  it("passes a status through for classification", async () => {
    const probe = await probeRegistry("p", "1.0.0", (async () => ({
      status: 404,
    })) as unknown as typeof fetch);
    expect(classifyProbe(probe)).toBe(VERDICT.MISSING);
  });

  it("requires the body to name the version that was asked for", async () => {
    // Matching the release-time check (#3684): a 200 alone is not proof. Two
    // surfaces reporting `published` about one release must mean the same
    // thing by it.
    const probe = await probeRegistry("p", "1.0.0", (async () => ({
      status: 200,
      json: async () => ({ version: "9.9.9" }),
    })) as unknown as typeof fetch);
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });

  it("treats an unparseable body as unprovable, not published", async () => {
    const probe = await probeRegistry("p", "1.0.0", (async () => ({
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    })) as unknown as typeof fetch);
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });

  it("reports published when the body names the exact version", async () => {
    const probe = await probeRegistry("p", "1.0.0", (async () => ({
      status: 200,
      json: async () => ({ version: "1.0.0" }),
    })) as unknown as typeof fetch);
    expect(classifyProbe(probe)).toBe(VERDICT.PUBLISHED);
  });

  it("turns a thrown transport failure into unprovable, not missing", async () => {
    // MEASURED, NOT HYPOTHETICAL. On the first real run over 1,699 tags one
    // probe failed transiently against a version that IS published. With two
    // verdicts that run would have reported a good release as never shipped.
    const probe = await probeRegistry("p", "1.0.0", async () => {
      throw new Error("ETIMEDOUT");
    });
    expect(probe.status).toBeNull();
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });
});

describe("formatReport", () => {
  it("says in the output that missing is about the registry, not a run", () => {
    // A bare count of orphan tags reads as a count of failed releases. Someone
    // skimming the report must not be able to take the number for an incident
    // count, so the distinction is printed rather than left in a doc comment.
    const report = formatReport({
      rows: [{ tag: "v1.0.0", version: "1.0.0", verdict: VERDICT.MISSING }],
      ignored: [],
    });
    expect(report).toContain("a claim about THE REGISTRY");
    expect(report).toContain("NOT a claim that a release run failed");
    expect(report).toContain("a claim about THIS RUN");
  });

  it("lists an unprovable tag separately from a missing one", () => {
    const report = formatReport({
      rows: [
        { tag: "v1.0.0", version: "1.0.0", verdict: VERDICT.MISSING },
        { tag: "v2.0.0", version: "2.0.0", verdict: VERDICT.UNPROVABLE },
      ],
      ignored: [],
    });
    const missingAt = report.indexOf("Tags with no published version:");
    const unprovableAt = report.indexOf("Not established by this run");
    expect(missingAt).toBeGreaterThan(-1);
    expect(unprovableAt).toBeGreaterThan(missingAt);
    expect(report.slice(missingAt, unprovableAt)).toContain("v1.0.0");
    expect(report.slice(missingAt, unprovableAt)).not.toContain("v2.0.0");
  });
});

describe("probeWithRetry", () => {
  it("retries an unprovable answer and takes the settled one", () => {
    // The measured case: v2.325.4 IS published and its probe failed in flight.
    // One retry turns a row an operator must chase into a correct verdict.
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) throw new Error("ETIMEDOUT");
      return { status: 200, json: async () => ({ version: "2.325.4" }) };
    };
    return probeWithRetry("p", "2.325.4", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).then((probe: Record<string, unknown>) => {
      expect(classifyProbe(probe)).toBe(VERDICT.PUBLISHED);
      expect(call).toBe(2);
    });
  });

  it("never retries a definite 404 — the registry does not change its mind", () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { status: 404 };
    };
    return probeWithRetry("p", "4.33.7", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).then((probe: Record<string, unknown>) => {
      expect(classifyProbe(probe)).toBe(VERDICT.MISSING);
      expect(call).toBe(1);
    });
  });

  it("never retries a success — the common case pays nothing", () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { status: 200, json: async () => ({ version: "4.34.5" }) };
    };
    return probeWithRetry("p", "4.34.5", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).then(() => expect(call).toBe(1));
  });

  it("still reports unprovable when every attempt fails", () => {
    // Exhausting the retries must not be mistaken for absence. This is the
    // same asymmetry as classifyProbe, one layer up.
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND");
    };
    return probeWithRetry("p", "1.0.0", {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).then((probe: Record<string, unknown>) => {
      expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
    });
  });
});
