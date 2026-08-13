/**
 * Surface-detection and per-file classification coverage for the design-source
 * gate (WU-F, issue #2430).
 *
 * Figma is the design source of truth, but every pre-existing Lisa design
 * obligation was conditioned on a design artifact *existing* — gate S12 only
 * fires `when artifacts_attached = true`. UI invented directly in code fell
 * through the gap entirely. This gate closes it by demanding that every changed
 * UI surface declare its design source, and by failing closed when it cannot
 * prove one either way. The verdict-level assertions live in the sibling
 * `design-source-gate-verdict` suite.
 *
 * Every test here is named for the classification it asserts, never for the
 * consequence that classification carries. Issue #2492 found six named the
 * other way — "fails closed when the changed file cannot be read" while
 * asserting only `status: "unreadable"` — so a reader auditing test names
 * concluded the fail-closed behavior was covered when nothing checked it.
 * A name that promises a verdict belongs in the sibling suite, which asserts one.
 * @module tests/unit/strategies/design-source-gate
 */
import { describe, expect, it } from "vitest";

import {
  DESIGN_SOURCE_NONE_MARKER,
  classifyDesignSource,
  isUiSurface,
} from "../../../plugins/src/base/scripts/design-source-gate.mjs";

import {
  FIGMA_URL,
  MARKER,
  PATHS,
  annotated,
  changed,
  unannotated,
} from "./design-source-gate-fixtures";

describe("design-source gate — UI surface detection", () => {
  it.each([
    PATHS.button,
    "app/screens/Checkout.jsx",
    "src/ui/Card.vue",
    "src/components/Modal.svelte",
    "src/screens/checkout.html",
    "src/components/atoms/tokens.css",
  ])("treats %s as a UI surface", relPath => {
    expect(isUiSurface(relPath)).toBe(true);
  });

  it.each([
    PATHS.config,
    "src/components/atoms/index.ts",
    "scripts/build.mjs",
    "README.md",
    "src/components/Button.test.tsx",
    "src/components/Button.stories.tsx",
    "src/components/__tests__/Button.tsx",
    "node_modules/pkg/Button.tsx",
    "dist/Button.tsx",
    "src/types/props.d.ts",
  ])("treats %s as outside the UI surface", relPath => {
    expect(isUiSurface(relPath)).toBe(false);
  });

  it("honors project include/exclude overrides", () => {
    expect(
      isUiSurface("src/legacy/Widget.tsx", { exclude: ["src/legacy/**"] })
    ).toBe(false);
    expect(
      isUiSurface("src/email/welcome.mjml", { include: ["**/*.mjml"] })
    ).toBe(true);
  });
});

describe("design-source gate — per-file classification", () => {
  it("seals a UI file that names a Figma node as its source", () => {
    expect(
      classifyDesignSource(
        annotated(PATHS.button, `// DESIGN-SOURCE: ${FIGMA_URL}`)
      )
    ).toMatchObject({
      path: PATHS.button,
      uiSurface: true,
      status: "figma-source",
      evidence: FIGMA_URL,
    });
  });

  it("classifies the designated marker as an explicit, recorded exception", () => {
    expect(
      classifyDesignSource(annotated(PATHS.debugPanel, `// ${MARKER}`))
    ).toMatchObject({ uiSurface: true, status: "marked-exception" });
  });

  it("reads the marker through any comment syntax and captures its reason", () => {
    const svelte = classifyDesignSource(
      changed(
        "src/components/Toast.svelte",
        `<!-- ${MARKER} — internal-only debug affordance -->\n<div />\n`
      )
    );

    expect(svelte.status).toBe("marked-exception");
    expect(svelte.reason).toBe("internal-only debug affordance");
  });

  it("classifies a UI file that declares nothing at all as undeclared", () => {
    expect(classifyDesignSource(unannotated(PATHS.invented))).toMatchObject({
      uiSurface: true,
      status: "undeclared",
    });
  });

  it("classifies an annotation whose value is neither form as malformed", () => {
    expect(
      classifyDesignSource(
        annotated(
          "src/components/Vague.tsx",
          "// DESIGN-SOURCE: see the Slack mock"
        )
      )
    ).toMatchObject({ status: "malformed" });
  });

  it("classifies a non-Figma URL as malformed rather than accepting any link", () => {
    expect(
      classifyDesignSource(
        annotated(
          "src/components/Linked.tsx",
          "// DESIGN-SOURCE: https://example.com/mock.png"
        )
      )
    ).toMatchObject({ status: "malformed" });
  });

  it("classifies a file that both cites Figma and denies a source as conflicting", () => {
    expect(
      classifyDesignSource(
        annotated(
          "src/components/Both.tsx",
          `// DESIGN-SOURCE: ${FIGMA_URL}\n// ${MARKER}`
        )
      )
    ).toMatchObject({ status: "conflicting" });
  });

  it("classifies a changed file that cannot be read as unreadable", () => {
    expect(
      classifyDesignSource({
        path: "src/components/Gone.tsx",
        changeType: "modified",
        content: null,
      })
    ).toMatchObject({ status: "unreadable" });
  });

  it("ignores deleted UI files — a removal has no design source to declare", () => {
    expect(
      classifyDesignSource({
        path: "src/components/Removed.tsx",
        changeType: "deleted",
        content: null,
      })
    ).toMatchObject({ uiSurface: false, status: "not-applicable" });
  });

  it("ignores non-UI files entirely", () => {
    expect(
      classifyDesignSource(changed(PATHS.config, "export const a = 1;\n"))
    ).toMatchObject({ uiSurface: false, status: "not-applicable" });
  });

  it("exports the exact marker spelling the rule and review path both cite", () => {
    expect(DESIGN_SOURCE_NONE_MARKER).toBe(MARKER);
  });
});
