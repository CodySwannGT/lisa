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
  probeVersion,
  reconcile,
  VERDICT,
} from "../../../scripts/reconcile-release-tags.mjs";

/** Minimal `Response` stand-ins, shaped for the shared probe's reads. */
const served = (version: string) => ({
  status: 200,
  ok: true,
  json: async () => ({ version }),
});
const notFound = { status: 404, ok: false };
const serverError = { status: 503, ok: false };

/** A fetch double that counts calls and records the URL it was handed. */
const recordingFetch = (
  answer: (call: number) => unknown
): { impl: typeof fetch; calls: () => number; urls: () => string[] } => {
  let calls = 0;
  const urls: string[] = [];
  const impl = (async (url: string) => {
    calls += 1;
    urls.push(String(url));
    const outcome = answer(calls);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls, urls: () => urls };
};

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
  it("carries the shared probe's three verdicts through unchanged", () => {
    expect(classifyProbe({ verdict: "published" })).toBe(VERDICT.PUBLISHED);
    expect(classifyProbe({ verdict: "missing" })).toBe(VERDICT.MISSING);
    expect(classifyProbe({ verdict: "unprovable" })).toBe(VERDICT.UNPROVABLE);
  });

  it("never reports anything it does not recognise as missing", () => {
    // THE ASSERTION THIS FILE EXISTS FOR, now at the boundary with the shared
    // module. A verdict this sweep cannot read says nothing about whether the
    // release happened, and letting it fall through to `missing` is how a good
    // release gets retracted. A fourth verdict added upstream must land in the
    // harmless bucket by construction, not by someone remembering to update
    // this function.
    for (const verdict of ["skipped", "PUBLISHED", "", "unknown"])
      expect(classifyProbe({ verdict }), verdict).toBe(VERDICT.UNPROVABLE);
  });

  it("treats an absent verdict as unprovable rather than assuming either way", () => {
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
      probe: always({ verdict: "published" }),
    });
    expect(rows.map(r => r.verdict)).toEqual([
      VERDICT.PUBLISHED,
      VERDICT.PUBLISHED,
    ]);
  });

  it("finds an orphan under either tag convention", () => {
    const { rows } = reconcile({
      tags: ["v4.33.7", "vv1.83.2"],
      probe: always({ verdict: "missing" }),
    });
    expect(rows.map(r => r.version)).toEqual(["4.33.7", "1.83.2"]);
    expect(rows.every(r => r.verdict === VERDICT.MISSING)).toBe(true);
  });

  it("keeps non-release refs out of the report entirely", () => {
    const { rows, ignored } = reconcile({
      tags: ["v1.0.0", ...NON_RELEASE_REFS.slice(0, 2)],
      probe: always({ verdict: "published" }),
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
      probe: always({ verdict: "unprovable" }),
    });
    expect(rows.every(r => r.verdict === VERDICT.UNPROVABLE)).toBe(true);
    expect(rows.some(r => r.verdict === VERDICT.MISSING)).toBe(false);
  });

  it("distinguishes the two per version rather than flattening to one verdict", () => {
    const published = new Set(["4.34.5"]);
    const { rows } = reconcile({
      tags: ["v4.34.5", "v4.33.7", "v9.9.9"],
      probe: (version: string) => {
        if (published.has(version)) return { verdict: "published" };
        if (version === "9.9.9") return { verdict: "unprovable" };
        return { verdict: "missing" };
      },
    });
    expect(rows).toEqual([
      { tag: "v4.34.5", version: "4.34.5", verdict: VERDICT.PUBLISHED },
      { tag: "v4.33.7", version: "4.33.7", verdict: VERDICT.MISSING },
      { tag: "v9.9.9", version: "9.9.9", verdict: VERDICT.UNPROVABLE },
    ]);
  });
});

describe("probeVersion reaches the registry through the shared probe", () => {
  it("asks for the exact version, never the latest dist-tag", async () => {
    // `dist-tags.latest` lags a successful publish by minutes, so reconciling
    // against it reports the newest release — the one under most scrutiny — as
    // absent. The sweep no longer builds this URL; the assertion moves to the
    // URL the shared module is observed to request, which is what actually
    // determines the behaviour.
    const fetcher = recordingFetch(() => notFound);
    await probeVersion(PACKAGE, ORPHAN_VERSION, { fetchImpl: fetcher.impl });
    const [url] = fetcher.urls();
    expect(url).toContain(PACKAGE);
    expect(url).toContain(ORPHAN_VERSION);
    expect(url).not.toContain("dist-tags");
    expect(url).not.toContain("latest");
  });

  it("requires the body to name the version that was asked for", async () => {
    // The one real divergence caught in review before the convergence: this
    // sweep originally accepted any HTTP 200. It now inherits the rule instead
    // of restating it, so the two surfaces cannot drift apart again.
    const fetcher = recordingFetch(() => served("9.9.9"));
    const probe = await probeVersion("p", "1.0.0", {
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });

  it("treats an unparseable body as unprovable, not published", async () => {
    const fetcher = recordingFetch(() => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("Unexpected token");
      },
    }));
    const probe = await probeVersion("p", "1.0.0", {
      attempts: 1,
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });

  it("reports published when the body names the exact version", async () => {
    const fetcher = recordingFetch(() => served("1.0.0"));
    const probe = await probeVersion("p", "1.0.0", {
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.PUBLISHED);
  });

  it("never reports an auth, throttling or 5xx answer as missing", async () => {
    const fetcher = recordingFetch(() => serverError);
    const probe = await probeVersion("p", "1.0.0", {
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
  });

  it("turns a thrown transport failure into unprovable, not missing", async () => {
    // MEASURED, NOT HYPOTHETICAL. On the first real run over 1,699 tags one
    // probe failed transiently against a version that IS published. With two
    // verdicts that run would have reported a good release as never shipped.
    const fetcher = recordingFetch(() => new Error("ETIMEDOUT"));
    const probe = await probeVersion("p", "1.0.0", {
      attempts: 1,
      fetchImpl: fetcher.impl,
    });
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

describe("probeVersion keeps the sweep's retry policy, not the module's", () => {
  // The shared module retries BOTH non-published verdicts, because at release
  // time a version that just published can lag the exact-version endpoint. The
  // sweep looks backwards at tags that are often years old, where a 404 is
  // settled. These four assertions are what keeps the convergence from
  // importing release-time retry behaviour into a 1,774-tag sweep.

  it("retries an unprovable answer and takes the settled one", async () => {
    // The measured case: v2.325.4 IS published and its probe failed in flight.
    // One retry turns a row an operator must chase into a correct verdict.
    const fetcher = recordingFetch(call =>
      call === 1 ? new Error("ETIMEDOUT") : served("2.325.4")
    );
    const probe = await probeVersion("p", "2.325.4", {
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.PUBLISHED);
    expect(fetcher.calls()).toBe(2);
  });

  it("never retries a definite 404 — the registry does not change its mind", async () => {
    // THE ONE THAT WOULD BREAK SILENTLY. Handing the module the sweep's
    // `attempts` instead of 1 would re-ask every one of the 26 orphan tags
    // five times over, and the report would look identical while doing it.
    const fetcher = recordingFetch(() => notFound);
    const probe = await probeVersion("p", "4.33.7", {
      attempts: 5,
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.MISSING);
    expect(fetcher.calls()).toBe(1);
  });

  it("never retries a success — the common case pays nothing", async () => {
    const fetcher = recordingFetch(() => served("4.34.5"));
    await probeVersion("p", "4.34.5", { attempts: 5, fetchImpl: fetcher.impl });
    expect(fetcher.calls()).toBe(1);
  });

  it("still reports unprovable when every attempt fails", async () => {
    // Exhausting the retries must not be mistaken for absence. This is the
    // same asymmetry as classifyProbe, one layer up.
    const pauses: number[] = [];
    const fetcher = recordingFetch(() => new Error("ENOTFOUND"));
    const probe = await probeVersion("p", "1.0.0", {
      attempts: 3,
      pause: async () => {
        pauses.push(1);
      },
      fetchImpl: fetcher.impl,
    });
    expect(classifyProbe(probe)).toBe(VERDICT.UNPROVABLE);
    expect(fetcher.calls()).toBe(3);
    expect(pauses).toHaveLength(2);
  });
});
