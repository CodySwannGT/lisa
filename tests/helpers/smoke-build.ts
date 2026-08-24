/**
 * The build script a test is allowed to run against the real checkout.
 *
 * Lives in a helper rather than in either test file so both can name it without
 * one test module importing another — importing a `*.test.ts` executes it, and
 * the file that owns this constant registers a `beforeAll` that runs a build.
 * @module tests/helpers/smoke-build
 */

/**
 * Non-destructive: compiles and copies, and never deletes `dist/` first.
 *
 * `build:dist` opens with an `rm -rf` of this checkout's whole `dist/`, which
 * takes down every concurrent reader of it — measured at ~5.2 seconds of
 * absence per run (CodySwannGT/lisa#3054). A test runs in the real checkout, so
 * a test must not use it.
 */
export const SMOKE_BUILD_SCRIPT = "build:dist:in-place";
