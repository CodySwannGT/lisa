/**
 * The qualification's sanitized apt reading (CodySwannGT/lisa#5204): a failed
 * pinned install publishes its refusal kind and the archive names and
 * versions on apt's unmet-dependency lines, and nothing else from apt's output.
 */
import { describe, expect, it } from "vitest";
import { aptDiagnosis } from "../../fixtures/npm-update-hosted-runtime/apt-diagnosis.mjs";
import {
  PRESTATE_PACKAGES,
  packageVersionObservation,
} from "../../fixtures/npm-update-hosted-runtime/package-observations.mjs";

const HELD = "E: Unable to correct problems, you have held broken packages.\n";
const PANGO = "libpango-1.0-0";
const LIST = "The following packages have unmet dependencies:";

describe("aptDiagnosis", () => {
  it("names the refusal and each unmet dependency of a held-broken install", () => {
    const stdout = [
      "Reading package lists...",
      "Some packages could not be installed. This may mean that you have",
      LIST,
      " libgbm1 : Depends: libdrm2 (>= 2.4.125) but 2.4.120-2build1 is to be installed",
      " libnss3 : Depends: libnspr4 (>= 2:4.35) but it is not going to be installed",
      "           Breaks: firefox (<< 1:140) but it is not installable",
      "",
    ].join("\n");
    expect(aptDiagnosis(Buffer.from(stdout), Buffer.from(HELD))).toEqual({
      class: "held-broken-packages",
      unmet: [
        {
          package: "libgbm1",
          relation: "Depends",
          target: "libdrm2",
          constraint: ">= 2.4.125",
          state: "other-version",
          candidate: "2.4.120-2build1",
        },
        {
          package: "libnss3",
          relation: "Depends",
          target: "libnspr4",
          constraint: ">= 2:4.35",
          state: "not-going-to-be-installed",
        },
        {
          package: "libnss3",
          relation: "Breaks",
          target: "firefox",
          constraint: "<< 1:140",
          state: "not-installable",
        },
      ],
      unmetTruncated: false,
    });
  });

  it("classifies each apt refusal it knows, and anything else as other", () => {
    const cases: [string, string][] = [
      ["E: Version '1.2' for 'libfoo' was not found\n", "version-not-found"],
      ["E: Unable to locate package libfoo\n", "package-not-found"],
      [
        "E: Unmet dependencies. Try 'apt --fix-broken install'.\n",
        "unmet-dependencies",
      ],
      ["E: Could not get lock /var/lib/dpkg/lock-frontend\n", "lock-held"],
      [
        "E: Failed to fetch https://mirror.example/pool/x.deb\n",
        "fetch-failed",
      ],
      ["private refusal text\n", "other"],
      ["", "other"],
    ];
    for (const [stderr, expected] of cases)
      expect(aptDiagnosis("", stderr).class, stderr).toBe(expected);
  });

  it("drops every line whose tokens are not archive names and versions", () => {
    const stdout = [
      LIST,
      " libfoo : Depends: https://private.example/token (>= 1) but 2 is to be installed",
      " LIBFOO : Depends: libbar but it is not going to be installed",
      " libfoo : Depends: libbar (>= private-secret) but 1 is to be installed",
      " libfoo : Depends: libbar but private mirror said no",
      " libok : Depends: libbar (= 1.0) but 1.1 is to be installed",
      "E: something",
      " libafter : Depends: libbar but it is not installable",
    ].join("\n");
    const result = aptDiagnosis(stdout, HELD);
    expect(result.unmet).toEqual([
      {
        package: "libok",
        relation: "Depends",
        target: "libbar",
        constraint: "= 1.0",
        state: "other-version",
        candidate: "1.1",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|https|token|secret/u);
  });

  it("reads nothing before apt's unmet list starts", () => {
    expect(
      aptDiagnosis(
        " libfoo : Depends: libbar but it is not installable\n",
        HELD
      ).unmet
    ).toEqual([]);
  });

  it("caps the list and says so", () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => ` lib${i} : Depends: libbar but it is not installable`
    );
    const result = aptDiagnosis([LIST, ...lines].join("\n"), HELD);
    expect(result.unmet).toHaveLength(32);
    expect(result.unmetTruncated).toBe(true);
  });
});

describe("package pre-state", () => {
  it("observes every pinned package, and reads names with dots exactly", () => {
    expect(PRESTATE_PACKAGES).toEqual(
      expect.arrayContaining([
        "libx11-6",
        "libmariadb-dev",
        "libmariadb-dev-compat",
        "libgbm1",
        PANGO,
      ])
    );
    expect(
      packageVersionObservation(PANGO, {
        code: 0,
        stdout: Buffer.from("libpango-1.0-0:amd64\t1.52.1+ds-1build1\n"),
      })
    ).toEqual({
      name: PANGO,
      status: "installed",
      version: "1.52.1+ds-1build1",
    });
    expect(
      packageVersionObservation(PANGO, {
        code: 0,
        stdout: Buffer.from("libpangoX1X0-0\t1.52.1\n"),
      })
    ).toEqual({ name: PANGO, status: "unavailable" });
  });
});
