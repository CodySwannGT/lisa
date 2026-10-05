# npm advisory dispositions

The 2026-10-04 maintenance snapshot reconciles all 31 distinct advisories from Lisa #4333's locked and physically installed baseline. Twenty-seven have repaired installed copies. Four remain vulnerable and explicitly unresolved. This is local source/install evidence, not a claim that a release, generated consumer, or raw audit is clean.

## Resolution and compatibility

ESLint stays on major 9 with a raised ^9.39.5 owner floor and eslintrc ^3.3.7. ESLint 9 reached upstream end of life on 2026-08-06. This is compatibility retention with patched transitive copies, not an upstream maintenance claim. A future ESLint 10 migration requires configuration, plugin and API review. The [official patch notes](https://eslint.org/blog/2026/03/eslint-v9.39.4-released/) explain the Ajv 6 repair and minimatch 3.1.5 matching fix.

SonarJS stays exactly on the baseline analyzer release 4.0.3 in runtime and applicable governance inputs. A constraints-bounded refresh had incidentally selected 4.2.2 and changed guard behavior, reporting 129 violations in unrelated public source files. The exact baseline pin preserves the existing analyzer implementation without changing rules or editing unrelated source. A future analyzer upgrade requires deliberate rule/behavior review.

Prettier remains exactly on baseline release 3.8.0 in runtime and the applicable local/stack governance. The normal fresh resolution had selected 3.9.9 and the source-visible check reported formatting differences in 44 untouched public files. This explicit pin prevents unrelated formatter churn. Those files and the formatting gate are unchanged. A formatter upgrade belongs in a deliberate formatting review.

Knip remains on the baseline release 5.82.1 in runtime/local governance. The incidental 5.88.1 refresh replaced its Bash parser and began reporting the unchanged Yarn audit subcommand as an unlisted executable. A comparison of both published parsers on the same full hook confirms that 5.82.1 skips this hook after a parse failure, while 5.88.1 scans it and exposes a pre-existing Yarn subcommand classification gap. The baseline pin preserves analyzer behavior but does not prove full-hook analysis. A deliberate parser upgrade must address that coverage gap without expanding ignored binaries.

Oxlint and eslint-plugin-oxlint stay on their matching baseline 1.62.0 releases in runtime and every existing applicable governance field. The incidental 1.86.0 preset disabled five additional ESLint JSDoc rules that the existing Oxlint configuration does not enforce. JSDoc itself remained on baseline 61.7.1. The matching pins preserve the existing enforcement implementation without weakening rules or adding unrelated configuration changes. Compatible patched children remain resolved normally.

The development Lisa self-dependency now resolves from ^4.69.1, the current supported release observed during this task. Node 22.23.3, Bun 1.3.8, the existing Actions expression pin, Vitest/coverage-v8 4.1.11 and Vite 8.3.2 controls remain in place.

A normal constraints-bounded fresh lock refresh preserves Ajv 6/8, minimatch 3/9/10, picomatch 2/4 and YAML 1/2. Existing host locks need a normal compatible refresh to pick up repaired children. Do not flatten these packages to one major or rely on nested overrides that pinned Bun 1.3.8 ignores. npm overrides also do not propagate from the installed Lisa package into a host's root manifest. Root-only audit results are insufficient consumer proof.

Stryker 9.6.1 requires typed-rest-client ~2.3.0. Its 2.3.1 release pins vulnerable qs 6.15.1 exactly. The flat qs ^6.16.0 rule in local governance and applicable TypeScript/CDK templates repairs that same-major child using syntax supported by Bun 1.3.8. Ordinary installed Stryker loading and qs 6 parse/stringify remain exercised. This is no typed-rest-client 3 migration.

Fresh Bun 1.3.8 workspace installs use an isolated layout. Stryker's default sibling-package discovery finds no test runner there; an actual loader comparison resolves the installed runner when named explicitly. The root, TypeScript and CDK configs now declare `plugins: ["@stryker-mutator/vitest-runner"]`; Expo declares its existing Jest runner. This uses Stryker's [supported plugin configuration](https://stryker-mutator.io/docs/stryker-js/configuration/#plugins), preserving mutation targets, thresholds, concurrency and deadlines. Existing hosts own these create-only configs and must add the matching runner declaration themselves. Fresh isolated-install regression tests exercise real mutation reports, including the unchanged score-failure control. This is runner registration, not a mutation-score waiver.

Independent packed TypeScript/CDK verification additionally found [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) in deepmerge-ts 7.1.6. The responsible edge is eslint-plugin-functional 9.0.5's declared ^7.1.5 dependency. The current functional 10 release also declares that vulnerable major, so an owner major upgrade alone does not repair it. Emitted TypeScript/CDK overrides and resolutions now carry the existing root/local ^8.0.1 policy. This crosses the vendor-declared child range and is an explicit compatibility disposition based on observed operation, not upstream-declared support. The actual installed functional rule/configuration and its resolved deepmerge array/nested-option API checks pass with 8.0.2. Actual planning tests prove replacement of an older consumer rule and exclusion of both vulnerable 7.1.6 and a new major 9. The finding is not part of the original 31-row baseline. Fresh packed-consumer installation and ordinary API checks observed 8.0.2; raw audits and physical inventories retain the four original residual findings. This local proof does not establish publication.

The Tailwind peer remains on ^3.4.19. An explicit peer prevents an incidental Tailwind 4 resolution admitted by the latest compatible lint-plugin patch. Its selector-parser subtree resolves 6.1.4. Expo's Tailwind 3 floor matches. No Tailwind 4 migration is claimed.

The retained jscodeshift 0.15.2 tool still transforms TypeScript/TSX through its installed API. Its compatible Babel 7 subtree is refreshed. The retained standard-version 9.5.0 release engine has an aging, unchanged upstream release line. An actual ordinary release dry run proves that it leaves the disposable manifest unchanged. Replacing either tool requires deliberate transform or changelog/tag/commit compatibility review.

Pure Rails has no TypeScript parent and receives no TypeScript tool defaults from this change. Its emitted manifest must be generated from the exact packed Lisa application and installed normally before consumer advisory status is accepted. No additional unrelated tool template is introduced for Rails. The common Lisa runtime dependency floors apply through the installed package, while host security governance only applies where actually emitted.

## Residual availability risk

Braces 3.0.3 has no published patched version for GHSA-vfj7-8cjw-p6xm. It remains behind glob consumers including Knip, Jest, jscodeshift and lint-staged. Deeply nested operator-supplied patterns can terminate a tool process. This is an unresolved availability risk, not a safe-library claim. Keep the raw finding visible and revisit when a patched release or an owner-supported replacement exists. The pre-existing repository-local exception is neither widened nor emitted into consumers.

CDK advances from 2.260.0 to 2.272.0 with matching CDK/Amplify defaults. Actual local synthesis passes without a cloud operation. The new published vendor bundle still physically contains brace-expansion 5.0.9 and retains GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p and GHSA-q2hr-2g5m-vwhr. Untrusted brace patterns can exhaust the stack or consume excessive CPU. The vendor bundle cannot be repaired by root overrides. Keep these three findings visible and revisit when a published CDK bundle contains brace-expansion 5.0.12 or later. No vendor-source rewrite, suppression or deployment is part of this work.

The final raw full and production Bun audits both exit 1 with the braces advisory. Physical inventory plus a fresh registry bulk query finds all four residuals. The physical query is necessary because the lock audit does not expose CDK's internal bundle. npm ls exits 1 with 14 layout/invalid/extraneous diagnostics, compared with 16 in the baseline. Its output is retained as evidence, not a successful npm tree validation.

## Complete baseline reconciliation

Every row is scoped to the current local installed snapshot. Packed/generated consumer verification remains a separate acceptance gate.

| Advisory | Package | Outcome | Installed repair or retained copy |
| --- | --- | --- | --- |
| [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | minimatch | Fixed in this installed snapshot | 3.1.5 / 9.0.9 / 10.2.5 / 10.2.6 |
| [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | ajv | Fixed in this installed snapshot | 6.15.0 / 8.18.0 |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | brace-expansion | Fixed in this installed snapshot | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | minimatch | Fixed in this installed snapshot | 3.1.5 / 9.0.9 / 10.2.5 / 10.2.6 |
| [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | picomatch | Fixed in this installed snapshot | 2.3.2 / 4.0.7 |
| [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) | yaml | Fixed in this installed snapshot | 1.10.3 / 2.9.1 |
| [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | qs | Fixed in this installed snapshot | 6.16.0 |
| [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | @babel/core | Fixed in this installed snapshot | 7.29.7 |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | brace-expansion | Residual disposition | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | minimatch | Fixed in this installed snapshot | 3.1.5 / 9.0.9 / 10.2.5 / 10.2.6 |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | @vitest/mocker, vitest | Fixed in this installed snapshot | 4.1.11 |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | picomatch | Fixed in this installed snapshot | 2.3.2 / 4.0.7 |
| [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | brace-expansion | Fixed in this installed snapshot | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-p498-v437-472g](https://github.com/advisories/GHSA-p498-v437-472g) | @humanfs/node | Fixed in this installed snapshot | 0.16.8 |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | brace-expansion | Residual disposition | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) | qs | Fixed in this installed snapshot | 6.16.0 |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | brace-expansion | Residual disposition | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | brace-expansion | Fixed in this installed snapshot | bundled 5.0.6 replaced by 5.0.9 |
| [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) | fast-uri | Fixed in this installed snapshot | 3.1.8 including the CDK bundle |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces | Residual disposition | 3.0.3, no published fix |
| [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) | postcss-selector-parser | Fixed in this installed snapshot | 6.1.4 |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | qs | Fixed in this installed snapshot | 6.16.0 |

## Verification limits

Automatic approval review rejected adversarial npm security/resource-exhaustion controls with “This content was flagged for possible cybersecurity risk.” Original receipts remain private. Those controls remain UNVERIFIED, receive no acceptance credit and must not be retried or recast. Separate ordinary compatibility API checks and genuine registry audits provide evidence only within their own scope. Independent verification distinguishes exact local tarball identity, emitted installation and physical/full/production audit observations from unproved release delivery.
