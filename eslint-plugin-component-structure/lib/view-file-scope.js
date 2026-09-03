/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Where the View half of the Container/View pattern is enforced.
 *
 * Two rules ask this question — `no-return-in-view` (no statements) and
 * `no-hooks-in-view` (no hooks) — and they must agree. A second copy of the
 * predicate is how a gate silently stops covering half the files it names, so
 * the answer lives here once and both rules require it.
 *
 * This is scope, not exemption. `components/ui/**` and `components/custom/ui/**`
 * hold vendored primitives that the pattern's own applicability table marks as
 * outside it, and that set is inherited verbatim from `require-memo-in-view` and
 * from the shipped config's `ignores` rather than invented here. There is no
 * per-file, per-site, or opt-in-flag way to leave it: a violating View is fixed
 * by migrating the View.
 * @module eslint-plugin-component-structure/lib/view-file-scope
 */

/**
 * A `components` directory anywhere in the path, as a whole path segment.
 *
 * Segment-anchored so `my-components/` is not mistaken for it, and
 * `(^|/)`-anchored so a RuleTester's repo-relative filename and a real absolute
 * one resolve identically. A bare `includes("/components/")` gets the relative
 * form wrong, which is invisible in production and silently disables every test
 * case written against a relative path.
 */
const COMPONENTS_SEGMENT = /(^|\/)components\//u;

/** The vendored-primitive directories the Container/View pattern excludes. */
const VENDORED_UI_SEGMENT = /(^|\/)components\/(custom\/)?ui\//u;

/**
 * Whether a rule should run against this file.
 * @param {string} filename - The file ESLint is linting, in any path style.
 * @returns {boolean} True when the file is a View inside the pattern's scope.
 */
function isEnforcedViewFile(filename) {
  if (!filename.endsWith("View.tsx") && !filename.endsWith("View.jsx")) {
    return false;
  }

  const normalizedPath = filename.replace(/\\/gu, "/");

  const isFeatureComponent =
    normalizedPath.includes("features/") &&
    COMPONENTS_SEGMENT.test(normalizedPath);
  const isFeatureScreen =
    normalizedPath.includes("features/") &&
    normalizedPath.includes("/screens/");
  const isComponentsDir =
    COMPONENTS_SEGMENT.test(normalizedPath) &&
    !VENDORED_UI_SEGMENT.test(normalizedPath);

  return isFeatureComponent || isFeatureScreen || isComponentsDir;
}

module.exports = { isEnforcedViewFile };
