/**
 * The one question both the seed guard and the installed-base check ask.
 *
 * The seed fix stopped a NEW adoption inheriting a bare commented-out `main`
 * entry, and it is a `create-only` file, so every project seeded before it
 * still carries the bare marker with nothing saying whether production was
 * withheld on purpose. Two surfaces have to agree on what "bare" means — the
 * template regression guard and the `lisa doctor` check that lets an already
 * seeded project find itself — so both call this classifier and neither
 * restates the signature (CodySwannGT/lisa#3779).
 * @module tests/unit/core/rails-deploy-production-intent
 */
import { describe, expect, it } from "vitest";

import {
  classifyProductionDeployIntent,
  PRODUCTION_ACCOUNT_SECRET,
} from "../../../src/core/rails-deploy-production-intent.js";

/** The trigger block a project seeded before the fix still carries. */
const BARE = `name: Release and Deploy

on:
  push:
    branches:
      - staging
      # - main
  workflow_dispatch:
`;

describe("classifyProductionDeployIntent", () => {
  it("reads a bare commented-out production entry as unstated", () => {
    expect(classifyProductionDeployIntent(BARE)).toBe("unstated");
  });

  it("reads a live production entry as a deliberate opt-in", () => {
    expect(
      classifyProductionDeployIntent(BARE.replace("# - main", "- main"))
    ).toBe("triggers");
  });

  it("reads a commented-out entry beside the precondition as explained", () => {
    const explained = BARE.replace(
      "      # - main",
      `      # Production is opt-in: it needs a ${PRODUCTION_ACCOUNT_SECRET} secret.
      # - main`
    );

    expect(classifyProductionDeployIntent(explained)).toBe("explained");
  });

  it("stays silent about a workflow that never mentions production", () => {
    expect(
      classifyProductionDeployIntent(BARE.replace("      # - main\n", ""))
    ).toBe("unmentioned");
  });

  it("sees a quoted commented-out entry", () => {
    expect(
      classifyProductionDeployIntent(BARE.replace("# - main", '# - "main"'))
    ).toBe("unstated");
  });

  it("sees a commented-out entry on CRLF line endings", () => {
    expect(classifyProductionDeployIntent(BARE.replaceAll("\n", "\r\n"))).toBe(
      "unstated"
    );
  });

  it("reads a single-string branches value as a live entry", () => {
    expect(
      classifyProductionDeployIntent(
        "on:\n  push:\n    branches: main\n# - main\n"
      )
    ).toBe("triggers");
  });

  it("does not mistake a `main-` prefixed branch for production", () => {
    expect(
      classifyProductionDeployIntent(
        BARE.replace("      - staging\n", "      - main-line\n")
      )
    ).toBe("unstated");
  });

  it("is not fooled by `main` appearing anywhere else in the file", () => {
    // The real seeded workflow says `main` in several unrelated places: a
    // `pre-deploy:main` gate key in a comment, reusable-workflow refs pinned
    // at `@main`, and a branch-to-stage mapping. A substring search for the
    // word would call every one of them a trigger.
    const noisy = BARE.replace(
      "  workflow_dispatch:\n",
      `  workflow_dispatch:

jobs:
  gates:
    # "runtime-web-vulnerability": { "pre-deploy:main": "required" }
    uses: CodySwannGT/lisa/.github/workflows/gates.yml@main
    steps:
      - run: echo "$([[ $GITHUB_REF_NAME == 'main' ]] && echo production)"
`
    );

    expect(classifyProductionDeployIntent(noisy)).toBe("unstated");
  });

  it("refuses to answer for a workflow it cannot parse", () => {
    // Fail closed: a document that will not parse has an unknown trigger list,
    // and guessing "no live main" from unparsed text is how an enabled
    // production deploy would get reported as withheld.
    expect(() =>
      classifyProductionDeployIntent("on:\n  push:\n  - [unbalanced\n")
    ).toThrow();
  });
});
