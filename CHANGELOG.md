# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [4.13.0](https://github.com/CodySwannGT/lisa/compare/v4.12.0...v4.13.0) (2026-08-25)


### Features

* **ci:** measure the two-channel delivery gap and report it to the consumer ([2013eb0](https://github.com/CodySwannGT/lisa/commit/2013eb06fcf9b2ae3681afcfa6b580671cef54ac)), closes [#3050](https://github.com/CodySwannGT/lisa/issues/3050) [#2960](https://github.com/CodySwannGT/lisa/issues/2960) [CodySwannGT/lisa#3050](https://github.com/CodySwannGT/lisa/issues/3050)

## [4.12.0](https://github.com/CodySwannGT/lisa/compare/v4.11.3...v4.12.0) (2026-08-25)


### Features

* **hooks:** make a recorded hazard reachable from its effect ([ac21350](https://github.com/CodySwannGT/lisa/commit/ac2135019b5618aaa4d9f4b3479daa262db9933b)), closes [CodySwannGT/lisa#3061](https://github.com/CodySwannGT/lisa/issues/3061)

### [4.11.3](https://github.com/CodySwannGT/lisa/compare/v4.11.2...v4.11.3) (2026-08-25)


### Bug Fixes

* **lifecycle:** make a rollup say which leaf is held and which kind of hold it is ([7829f3e](https://github.com/CodySwannGT/lisa/commit/7829f3e28a0f45f9fb987a0021131f6f66526f71)), closes [#1500](https://github.com/CodySwannGT/lisa/issues/1500) [#1515](https://github.com/CodySwannGT/lisa/issues/1515) [#1495](https://github.com/CodySwannGT/lisa/issues/1495) [#1515](https://github.com/CodySwannGT/lisa/issues/1515) [#1547](https://github.com/CodySwannGT/lisa/issues/1547) [#3101](https://github.com/CodySwannGT/lisa/issues/3101) [#1495](https://github.com/CodySwannGT/lisa/issues/1495) [CodySwannGT/lisa#3045](https://github.com/CodySwannGT/lisa/issues/3045)

### [4.11.2](https://github.com/CodySwannGT/lisa/compare/v4.11.1...v4.11.2) (2026-08-25)


### Bug Fixes

* **gates:** require evidence timestamps ([c8aeff7](https://github.com/CodySwannGT/lisa/commit/c8aeff70793e532d933c69c78764a2e76eccee59)), closes [CodySwannGT/lisa#3193](https://github.com/CodySwannGT/lisa/issues/3193)

### [4.11.1](https://github.com/CodySwannGT/lisa/compare/v4.11.0...v4.11.1) (2026-08-25)


### Bug Fixes

* **cli:** make the prune reports name their scope and count ([8ed7924](https://github.com/CodySwannGT/lisa/commit/8ed79240a6acc0579c86a20743011edcf1953894)), closes [CodySwannGT/lisa#2993](https://github.com/CodySwannGT/lisa/issues/2993)

## [4.11.0](https://github.com/CodySwannGT/lisa/compare/v4.10.15...v4.11.0) (2026-08-25)


### Features

* **cli:** add vetted worktree and stash prune verbs ([cfea425](https://github.com/CodySwannGT/lisa/commit/cfea425d64069d0c3d6f996b7a09af9ecb489273)), closes [CodySwannGT/lisa#2993](https://github.com/CodySwannGT/lisa/issues/2993)

### [4.10.15](https://github.com/CodySwannGT/lisa/compare/v4.10.14...v4.10.15) (2026-08-25)


### Bug Fixes

* **managed:** harden generated shell parsing ([a5ad3c4](https://github.com/CodySwannGT/lisa/commit/a5ad3c4fe62c669d2c8beab1851de1ca16f57678)), closes [CodySwannGT/lisa#3184](https://github.com/CodySwannGT/lisa/issues/3184) [CodySwannGT/lisa#3184](https://github.com/CodySwannGT/lisa/issues/3184)

### [4.10.14](https://github.com/CodySwannGT/lisa/compare/v4.10.13...v4.10.14) (2026-08-25)


### Bug Fixes

* **quality:** separate a shell guard the mutation gate cannot reach from one it did not select ([5ba6cd6](https://github.com/CodySwannGT/lisa/commit/5ba6cd67b1eb9285b9cdd4e8b5db59fafc4ad3e1)), closes [CodySwannGT/lisa#3111](https://github.com/CodySwannGT/lisa/issues/3111)
* **safety-net:** a guard whose scan cannot run now denies instead of allowing ([df3080b](https://github.com/CodySwannGT/lisa/commit/df3080b70983c519aa573909a2867ad256f58571)), closes [CodySwannGT/lisa#3054](https://github.com/CodySwannGT/lisa/issues/3054) [#3054](https://github.com/CodySwannGT/lisa/issues/3054) [CodySwannGT/lisa#3054](https://github.com/CodySwannGT/lisa/issues/3054)

### [4.10.13](https://github.com/CodySwannGT/lisa/compare/v4.10.12...v4.10.13) (2026-08-25)


### Bug Fixes

* **apply:** resolve apply mode in one place, and let a caller decline the reduction ([0c105da](https://github.com/CodySwannGT/lisa/commit/0c105dacbbba00caf4677caf14d18806b41cecd8)), closes [#3050](https://github.com/CodySwannGT/lisa/issues/3050) [#3021](https://github.com/CodySwannGT/lisa/issues/3021) [#3066](https://github.com/CodySwannGT/lisa/issues/3066) [#3050](https://github.com/CodySwannGT/lisa/issues/3050) [CodySwannGT/lisa#3066](https://github.com/CodySwannGT/lisa/issues/3066)
* **safety-net:** a guard whose scan cannot run now denies instead of allowing ([df3080b](https://github.com/CodySwannGT/lisa/commit/df3080b70983c519aa573909a2867ad256f58571)), closes [CodySwannGT/lisa#3054](https://github.com/CodySwannGT/lisa/issues/3054) [#3054](https://github.com/CodySwannGT/lisa/issues/3054) [CodySwannGT/lisa#3054](https://github.com/CodySwannGT/lisa/issues/3054)

### [4.10.12](https://github.com/CodySwannGT/lisa/compare/v4.10.11...v4.10.12) (2026-08-25)


### Bug Fixes

* **gates:** run the orphaned-fixture-process detector instead of only shipping it ([dd18b67](https://github.com/CodySwannGT/lisa/commit/dd18b67717d7511c63f5d1987833c9544204919f)), closes [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [#2902](https://github.com/CodySwannGT/lisa/issues/2902) [#3049](https://github.com/CodySwannGT/lisa/issues/3049) [#3053](https://github.com/CodySwannGT/lisa/issues/3053) [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)

### [4.10.11](https://github.com/CodySwannGT/lisa/compare/v4.10.10...v4.10.11) (2026-08-25)


### Bug Fixes

* **managed:** close parser and evidence edge cases ([18e1f34](https://github.com/CodySwannGT/lisa/commit/18e1f343290cce0de239045a16fb99a26dca67e1)), closes [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179) [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179)

### [4.10.10](https://github.com/CodySwannGT/lisa/compare/v4.10.9...v4.10.10) (2026-08-25)


### Bug Fixes

* **guards:** close four review findings against shipped 4.4.7 artifacts ([4c763d4](https://github.com/CodySwannGT/lisa/commit/4c763d4af4ae47a1225d85fc26a5c75b3cca7d12)), closes [#3078](https://github.com/CodySwannGT/lisa/issues/3078) [#3157](https://github.com/CodySwannGT/lisa/issues/3157) [CodySwannGT/lisa#3099](https://github.com/CodySwannGT/lisa/issues/3099)
* **managed:** close parser and evidence edge cases ([18e1f34](https://github.com/CodySwannGT/lisa/commit/18e1f343290cce0de239045a16fb99a26dca67e1)), closes [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179) [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179)

### [4.10.9](https://github.com/CodySwannGT/lisa/compare/v4.10.8...v4.10.9) (2026-08-25)


### Bug Fixes

* **guards:** close four review findings against shipped 4.4.7 artifacts ([4c763d4](https://github.com/CodySwannGT/lisa/commit/4c763d4af4ae47a1225d85fc26a5c75b3cca7d12)), closes [#3078](https://github.com/CodySwannGT/lisa/issues/3078) [#3157](https://github.com/CodySwannGT/lisa/issues/3157) [CodySwannGT/lisa#3099](https://github.com/CodySwannGT/lisa/issues/3099)
* **managed:** close remaining fleet review gaps ([2cddd70](https://github.com/CodySwannGT/lisa/commit/2cddd70c2c01cddd1bb32facd7f1391ba1edfc08)), closes [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179) [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179)

### [4.10.8](https://github.com/CodySwannGT/lisa/compare/v4.10.7...v4.10.8) (2026-08-25)


### Bug Fixes

* **ci:** detect required contexts a Lisa rename made unpostable ([051d3a2](https://github.com/CodySwannGT/lisa/commit/051d3a266d4457fb09e8c8677c7a2d5d3c856ed8)), closes [CodySwannGT/lisa#3067](https://github.com/CodySwannGT/lisa/issues/3067)
* **gates:** match a retired context by its final segment, under any caller chain ([dceab77](https://github.com/CodySwannGT/lisa/commit/dceab7769fa61c85cf708383ad61b0232a3efce8)), closes [CodySwannGT/lisa#3067](https://github.com/CodySwannGT/lisa/issues/3067)
* **managed:** close remaining fleet review gaps ([2cddd70](https://github.com/CodySwannGT/lisa/commit/2cddd70c2c01cddd1bb32facd7f1391ba1edfc08)), closes [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179) [CodySwannGT/lisa#3179](https://github.com/CodySwannGT/lisa/issues/3179)

### [4.10.7](https://github.com/CodySwannGT/lisa/compare/v4.10.6...v4.10.7) (2026-08-25)


### Bug Fixes

* **hooks:** stop the delete guard refusing commands that delete nothing ([fdec2e5](https://github.com/CodySwannGT/lisa/commit/fdec2e510ff0a57652daac060d15eff31f51145c)), closes [#3108](https://github.com/CodySwannGT/lisa/issues/3108) [CodySwannGT/lisa#3106](https://github.com/CodySwannGT/lisa/issues/3106)

### [4.10.6](https://github.com/CodySwannGT/lisa/compare/v4.10.5...v4.10.6) (2026-08-25)


### Bug Fixes

* **hooks:** stop the delete guard refusing commands that delete nothing ([fdec2e5](https://github.com/CodySwannGT/lisa/commit/fdec2e510ff0a57652daac060d15eff31f51145c)), closes [#3108](https://github.com/CodySwannGT/lisa/issues/3108) [CodySwannGT/lisa#3106](https://github.com/CodySwannGT/lisa/issues/3106)
* **skills:** consume the jira-cli config the setup hook writes ([4b333b9](https://github.com/CodySwannGT/lisa/commit/4b333b999c90f30fcd79d5fa91a187cf9df1737a)), closes [#2767](https://github.com/CodySwannGT/lisa/issues/2767) [#2768](https://github.com/CodySwannGT/lisa/issues/2768) [CodySwannGT/lisa#2767](https://github.com/CodySwannGT/lisa/issues/2767)

### [4.10.5](https://github.com/CodySwannGT/lisa/compare/v4.10.4...v4.10.5) (2026-08-25)


### Bug Fixes

* **tests:** let a declared early child exit report its verdict ([ceca1ab](https://github.com/CodySwannGT/lisa/commit/ceca1ab1b8f82a40a121c45c1ea7f75447ef9a7a)), closes [#2949](https://github.com/CodySwannGT/lisa/issues/2949) [#3020](https://github.com/CodySwannGT/lisa/issues/3020) [#3120](https://github.com/CodySwannGT/lisa/issues/3120) [CodySwannGT/lisa#3122](https://github.com/CodySwannGT/lisa/issues/3122)

### [4.10.4](https://github.com/CodySwannGT/lisa/compare/v4.10.3...v4.10.4) (2026-08-25)


### Bug Fixes

* **managed:** harden provenance and hook parsing ([1e4cae5](https://github.com/CodySwannGT/lisa/commit/1e4cae5bc722a257a5060ca614559924ceeac517)), closes [CodySwannGT/lisa#3171](https://github.com/CodySwannGT/lisa/issues/3171)

### [4.10.3](https://github.com/CodySwannGT/lisa/compare/v4.10.2...v4.10.3) (2026-08-25)


### Bug Fixes

* **managed:** harden provenance and hook parsing ([1e4cae5](https://github.com/CodySwannGT/lisa/commit/1e4cae5bc722a257a5060ca614559924ceeac517)), closes [CodySwannGT/lisa#3171](https://github.com/CodySwannGT/lisa/issues/3171)
* **nightly-e2e:** report a gate armed with no bypass label as a defect ([d9e0b58](https://github.com/CodySwannGT/lisa/commit/d9e0b58e5cb7cc5011fa42c398a39e16d0922ec3)), closes [CodySwannGT/lisa#2773](https://github.com/CodySwannGT/lisa/issues/2773)


### Code Refactoring

* **nightly-e2e:** hoist the default bypass label to one constant ([7904baa](https://github.com/CodySwannGT/lisa/commit/7904baa301529c5c099db3460f10a3c027a8b289)), closes [CodySwannGT/lisa#2773](https://github.com/CodySwannGT/lisa/issues/2773)

### [4.10.2](https://github.com/CodySwannGT/lisa/compare/v4.10.1...v4.10.2) (2026-08-25)


### Bug Fixes

* **nightly-e2e:** report a gate armed with no bypass label as a defect ([d9e0b58](https://github.com/CodySwannGT/lisa/commit/d9e0b58e5cb7cc5011fa42c398a39e16d0922ec3)), closes [CodySwannGT/lisa#2773](https://github.com/CodySwannGT/lisa/issues/2773)
* **plugins:** resolve setup-jira-cli's Lisa config from the project root ([166e001](https://github.com/CodySwannGT/lisa/commit/166e00129cb8102de94d7cc4bedcb7fd7adb4bd3)), closes [#2767](https://github.com/CodySwannGT/lisa/issues/2767) [CodySwannGT/lisa#2768](https://github.com/CodySwannGT/lisa/issues/2768)


### Code Refactoring

* **nightly-e2e:** hoist the default bypass label to one constant ([7904baa](https://github.com/CodySwannGT/lisa/commit/7904baa301529c5c099db3460f10a3c027a8b289)), closes [CodySwannGT/lisa#2773](https://github.com/CodySwannGT/lisa/issues/2773)

### [4.10.1](https://github.com/CodySwannGT/lisa/compare/v4.10.0...v4.10.1) (2026-08-25)


### Bug Fixes

* **gates:** tolerate malformed evidence inputs ([68db137](https://github.com/CodySwannGT/lisa/commit/68db1378061585949f444b5d7a9be84d90162a92)), closes [CodySwannGT/lisa#3165](https://github.com/CodySwannGT/lisa/issues/3165)

## [4.10.0](https://github.com/CodySwannGT/lisa/compare/v4.9.4...v4.10.0) (2026-08-25)


### Features

* **gates:** add the fail-closed release evidence-reuse verifier ([a9b3075](https://github.com/CodySwannGT/lisa/commit/a9b3075b97c266ace3b97c3796542bbc775845e0)), closes [CodySwannGT/lisa#3013](https://github.com/CodySwannGT/lisa/issues/3013)


### Bug Fixes

* **gates:** name the reuse classes through the enum, not by literal ([d332277](https://github.com/CodySwannGT/lisa/commit/d332277a398a86119c1d4884bfa4bb1c92bfd096)), closes [CodySwannGT/lisa#3013](https://github.com/CodySwannGT/lisa/issues/3013)


### Documentation

* **ci:** design release evidence reuse against the shipped envelope ([f3d545b](https://github.com/CodySwannGT/lisa/commit/f3d545b806211890f23b7ebd1b8a7b0e082e4fe8)), closes [#3022](https://github.com/CodySwannGT/lisa/issues/3022) [CodySwannGT/lisa#3013](https://github.com/CodySwannGT/lisa/issues/3013)

### [4.9.4](https://github.com/CodySwannGT/lisa/compare/v4.9.3...v4.9.4) (2026-08-25)


### Bug Fixes

* **ci:** reconstruct generated artifacts on merge instead of conflicting ([2d05bee](https://github.com/CodySwannGT/lisa/commit/2d05bee850bcc4d6bc39bbdd7b747a23404d4408)), closes [#3046](https://github.com/CodySwannGT/lisa/issues/3046) [#3046](https://github.com/CodySwannGT/lisa/issues/3046) [CodySwannGT/lisa#3084](https://github.com/CodySwannGT/lisa/issues/3084)

### [4.9.3](https://github.com/CodySwannGT/lisa/compare/v4.9.2...v4.9.3) (2026-08-25)


### Bug Fixes

* **gates:** spell refusal inventory literally ([fcb3de7](https://github.com/CodySwannGT/lisa/commit/fcb3de75c3df80866f9f7499586c96f65317536f)), closes [CodySwannGT/lisa#3160](https://github.com/CodySwannGT/lisa/issues/3160) [CodySwannGT/lisa#3160](https://github.com/CodySwannGT/lisa/issues/3160)

### [4.9.2](https://github.com/CodySwannGT/lisa/compare/v4.9.1...v4.9.2) (2026-08-25)


### Bug Fixes

* **gates:** keep evidence refusals stable ([97066c6](https://github.com/CodySwannGT/lisa/commit/97066c60a327289703323b15a8e8365a19247a68)), closes [CodySwannGT/lisa#3160](https://github.com/CodySwannGT/lisa/issues/3160) [CodySwannGT/lisa#3160](https://github.com/CodySwannGT/lisa/issues/3160)

### [4.9.1](https://github.com/CodySwannGT/lisa/compare/v4.9.0...v4.9.1) (2026-08-25)


### Bug Fixes

* **guards:** close three review findings against Lisa-owned artifacts ([1efbd66](https://github.com/CodySwannGT/lisa/commit/1efbd66265e29865aff7f678debca19a83a12fbc)), closes [CodySwannGT/lisa#3078](https://github.com/CodySwannGT/lisa/issues/3078)

## [4.9.0](https://github.com/CodySwannGT/lisa/compare/v4.8.4...v4.9.0) (2026-08-25)


### Features

* **gates:** refuse an unrecognised verdict, and say what this envelope is not ([00f245e](https://github.com/CodySwannGT/lisa/commit/00f245eb24499e0f70c72e757d925ef3bcf4a7b3)), closes [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [CodySwannGT/lisa#3158](https://github.com/CodySwannGT/lisa/issues/3158)

### [4.8.4](https://github.com/CodySwannGT/lisa/compare/v4.8.3...v4.8.4) (2026-08-25)


### Code Refactoring

* **gates:** conform the evidence envelope to the shared lisa.gate-evidence/v1 schema ([2dc5079](https://github.com/CodySwannGT/lisa/commit/2dc50793f7a691c476e9e8a195c3fe6cec31d113)), closes [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [CodySwannGT/lisa#3022](https://github.com/CodySwannGT/lisa/issues/3022)

### [4.8.3](https://github.com/CodySwannGT/lisa/compare/v4.8.2...v4.8.3) (2026-08-25)


### Bug Fixes

* **gates:** let a declaration name its own check-run chain, and a ruleset its extra-approval rule ([ed4b636](https://github.com/CodySwannGT/lisa/commit/ed4b6364543a0b0bc8501c26c0aa88642f09c00a)), closes [#3039](https://github.com/CodySwannGT/lisa/issues/3039) [CodySwannGT/lisa#3096](https://github.com/CodySwannGT/lisa/issues/3096)


### Code Refactoring

* **gates:** conform the evidence envelope to the shared lisa.gate-evidence/v1 schema ([2dc5079](https://github.com/CodySwannGT/lisa/commit/2dc50793f7a691c476e9e8a195c3fe6cec31d113)), closes [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [CodySwannGT/lisa#3022](https://github.com/CodySwannGT/lisa/issues/3022)

### [4.8.2](https://github.com/CodySwannGT/lisa/compare/v4.8.1...v4.8.2) (2026-08-25)


### Bug Fixes

* **expo:** align Lighthouse and nightly caller precedence ([0c8b4db](https://github.com/CodySwannGT/lisa/commit/0c8b4dba8640a8ea2a9fb4c8948189dda51c7461)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)
* **gates:** let a declaration name its own check-run chain, and a ruleset its extra-approval rule ([ed4b636](https://github.com/CodySwannGT/lisa/commit/ed4b6364543a0b0bc8501c26c0aa88642f09c00a)), closes [#3039](https://github.com/CodySwannGT/lisa/issues/3039) [CodySwannGT/lisa#3096](https://github.com/CodySwannGT/lisa/issues/3096)

### [4.8.1](https://github.com/CodySwannGT/lisa/compare/v4.8.0...v4.8.1) (2026-08-25)


### Bug Fixes

* **expo:** align Lighthouse and nightly caller precedence ([0c8b4db](https://github.com/CodySwannGT/lisa/commit/0c8b4dba8640a8ea2a9fb4c8948189dda51c7461)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)
* **plugins:** govern the two PreToolUse refusal hooks, and fail closed ([7bbafd1](https://github.com/CodySwannGT/lisa/commit/7bbafd1a1d7ad56b82b596e08304ec949eff04cf)), closes [#2957](https://github.com/CodySwannGT/lisa/issues/2957) [#2957](https://github.com/CodySwannGT/lisa/issues/2957) [CodySwannGT/lisa#3007](https://github.com/CodySwannGT/lisa/issues/3007)

## [4.8.0](https://github.com/CodySwannGT/lisa/compare/v4.7.0...v4.8.0) (2026-08-25)


### Features

* **gates:** record what deploy-moment gates proved, and fail when nothing was recorded ([b8dada0](https://github.com/CodySwannGT/lisa/commit/b8dada0974aa0103f1098d8fe5dfc07d105ba489)), closes [CodySwannGT/lisa#3013](https://github.com/CodySwannGT/lisa/issues/3013) [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [CodySwannGT/lisa#3022](https://github.com/CodySwannGT/lisa/issues/3022)


### Bug Fixes

* **plugins:** govern the two PreToolUse refusal hooks, and fail closed ([7bbafd1](https://github.com/CodySwannGT/lisa/commit/7bbafd1a1d7ad56b82b596e08304ec949eff04cf)), closes [#2957](https://github.com/CodySwannGT/lisa/issues/2957) [#2957](https://github.com/CodySwannGT/lisa/issues/2957) [CodySwannGT/lisa#3007](https://github.com/CodySwannGT/lisa/issues/3007)

## [4.7.0](https://github.com/CodySwannGT/lisa/compare/v4.6.13...v4.7.0) (2026-08-25)


### Features

* **gates:** record what deploy-moment gates proved, and fail when nothing was recorded ([b8dada0](https://github.com/CodySwannGT/lisa/commit/b8dada0974aa0103f1098d8fe5dfc07d105ba489)), closes [CodySwannGT/lisa#3013](https://github.com/CodySwannGT/lisa/issues/3013) [#3013](https://github.com/CodySwannGT/lisa/issues/3013) [CodySwannGT/lisa#3022](https://github.com/CodySwannGT/lisa/issues/3022)


### Bug Fixes

* **package-lisa:** stop forcing test:integration at a literal path ([0b59c02](https://github.com/CodySwannGT/lisa/commit/0b59c0252e96358dbcf9ce87050f31c060b2d175)), closes [#297](https://github.com/CodySwannGT/lisa/issues/297) [#301](https://github.com/CodySwannGT/lisa/issues/301) [#302](https://github.com/CodySwannGT/lisa/issues/302) [#2603](https://github.com/CodySwannGT/lisa/issues/2603) [#2952](https://github.com/CodySwannGT/lisa/issues/2952) [CodySwannGT/lisa#3070](https://github.com/CodySwannGT/lisa/issues/3070)

### [4.6.13](https://github.com/CodySwannGT/lisa/compare/v4.6.12...v4.6.13) (2026-08-25)


### Bug Fixes

* **apply:** compare host pin ceilings under one semver convention ([c27200c](https://github.com/CodySwannGT/lisa/commit/c27200c5daefc6e9a6e27700922d243e2a04c6b9)), closes [CodySwannGT/lisa#3068](https://github.com/CodySwannGT/lisa/issues/3068)

### [4.6.12](https://github.com/CodySwannGT/lisa/compare/v4.6.11...v4.6.12) (2026-08-25)


### Bug Fixes

* **apply:** compare host pin ceilings under one semver convention ([c27200c](https://github.com/CodySwannGT/lisa/commit/c27200c5daefc6e9a6e27700922d243e2a04c6b9)), closes [CodySwannGT/lisa#3068](https://github.com/CodySwannGT/lisa/issues/3068)
* **ci:** resolve a Rails project's gate declaration without node_modules ([d867e6d](https://github.com/CodySwannGT/lisa/commit/d867e6dd8e07db869c9a538feafd28333bf01ac7)), closes [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [CodySwannGT/lisa#3018](https://github.com/CodySwannGT/lisa/issues/3018)
* **gates:** collapse verify_enforced into the coverage-adequacy declaration ([6035f5e](https://github.com/CodySwannGT/lisa/commit/6035f5e09048dc7d7a2bb5f2b07d32d998a3f2f6)), closes [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#3147](https://github.com/CodySwannGT/lisa/issues/3147) [#3147](https://github.com/CodySwannGT/lisa/issues/3147) [#3147](https://github.com/CodySwannGT/lisa/issues/3147) [CodySwannGT/lisa#3021](https://github.com/CodySwannGT/lisa/issues/3021)
* **gates:** point the verification_coverage dual-control at a live owner ([e125ebf](https://github.com/CodySwannGT/lisa/commit/e125ebfb0d05ba55f9e268c52c98a7d7c48b5042)), closes [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#3021](https://github.com/CodySwannGT/lisa/issues/3021) [CodySwannGT/lisa#3021](https://github.com/CodySwannGT/lisa/issues/3021)

### [4.6.11](https://github.com/CodySwannGT/lisa/compare/v4.6.10...v4.6.11) (2026-08-25)


### Bug Fixes

* **ci:** resolve a Rails project's gate declaration without node_modules ([d867e6d](https://github.com/CodySwannGT/lisa/commit/d867e6dd8e07db869c9a538feafd28333bf01ac7)), closes [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [CodySwannGT/lisa#3018](https://github.com/CodySwannGT/lisa/issues/3018)
* **lighthouse:** migrate existing collect configs ([5eea32a](https://github.com/CodySwannGT/lisa/commit/5eea32a208f2d325afd603e7a9bfc7ae379cd090)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)
* **lighthouse:** preserve collect discovery options ([8640d67](https://github.com/CodySwannGT/lisa/commit/8640d67e960b6f98ad6cd05ec5c2df4c168e2088)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)

### [4.6.10](https://github.com/CodySwannGT/lisa/compare/v4.6.9...v4.6.10) (2026-08-25)


### Bug Fixes

* hold every step of a multi-step transform to account ([232f469](https://github.com/CodySwannGT/lisa/commit/232f46913b649ae7f7b885a79a8750aafd64c489)), closes [#3076](https://github.com/CodySwannGT/lisa/issues/3076) [#3090](https://github.com/CodySwannGT/lisa/issues/3090) [CodySwannGT/lisa#3081](https://github.com/CodySwannGT/lisa/issues/3081)
* **lighthouse:** migrate existing collect configs ([5eea32a](https://github.com/CodySwannGT/lisa/commit/5eea32a208f2d325afd603e7a9bfc7ae379cd090)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)
* **lighthouse:** preserve collect discovery options ([8640d67](https://github.com/CodySwannGT/lisa/commit/8640d67e960b6f98ad6cd05ec5c2df4c168e2088)), closes [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146) [CodySwannGT/lisa#3146](https://github.com/CodySwannGT/lisa/issues/3146)

### [4.6.9](https://github.com/CodySwannGT/lisa/compare/v4.6.8...v4.6.9) (2026-08-25)


### Bug Fixes

* hold every step of a multi-step transform to account ([232f469](https://github.com/CodySwannGT/lisa/commit/232f46913b649ae7f7b885a79a8750aafd64c489)), closes [#3076](https://github.com/CodySwannGT/lisa/issues/3076) [#3090](https://github.com/CodySwannGT/lisa/issues/3090) [CodySwannGT/lisa#3081](https://github.com/CodySwannGT/lisa/issues/3081)

### [4.6.8](https://github.com/CodySwannGT/lisa/compare/v4.6.7...v4.6.8) (2026-08-25)


### Bug Fixes

* **doctor:** stop advising a gate be declared off when a second caller resolves the moment ([762bcd0](https://github.com/CodySwannGT/lisa/commit/762bcd021181a456705e396431b52cef02ce025e)), closes [#3101](https://github.com/CodySwannGT/lisa/issues/3101) [CodySwannGT/lisa#3100](https://github.com/CodySwannGT/lisa/issues/3100)

### [4.6.7](https://github.com/CodySwannGT/lisa/compare/v4.6.6...v4.6.7) (2026-08-25)


### Bug Fixes

* **doctor:** gitignore the derived readiness report and report a checkout that still tracks one ([a6b7a21](https://github.com/CodySwannGT/lisa/commit/a6b7a2198cb78c7f3333c64b65b2b0a21af9a90b)), closes [#3048](https://github.com/CodySwannGT/lisa/issues/3048) [CodySwannGT/lisa#3046](https://github.com/CodySwannGT/lisa/issues/3046)

### [4.6.6](https://github.com/CodySwannGT/lisa/compare/v4.6.5...v4.6.6) (2026-08-25)


### Bug Fixes

* **doctor:** gitignore the derived readiness report and report a checkout that still tracks one ([a6b7a21](https://github.com/CodySwannGT/lisa/commit/a6b7a2198cb78c7f3333c64b65b2b0a21af9a90b)), closes [#3048](https://github.com/CodySwannGT/lisa/issues/3048) [CodySwannGT/lisa#3046](https://github.com/CodySwannGT/lisa/issues/3046)
* **doctor:** stop recommending a gate declaration for tokens no gate governs ([dda58b5](https://github.com/CodySwannGT/lisa/commit/dda58b57f5b965f841f6cb84e769ca714c7e4d21)), closes [#3100](https://github.com/CodySwannGT/lisa/issues/3100) [CodySwannGT/lisa#3101](https://github.com/CodySwannGT/lisa/issues/3101)

### [4.6.5](https://github.com/CodySwannGT/lisa/compare/v4.6.4...v4.6.5) (2026-08-25)


### Bug Fixes

* **doctor:** stop recommending a gate declaration for tokens no gate governs ([dda58b5](https://github.com/CodySwannGT/lisa/commit/dda58b57f5b965f841f6cb84e769ca714c7e4d21)), closes [#3100](https://github.com/CodySwannGT/lisa/issues/3100) [CodySwannGT/lisa#3101](https://github.com/CodySwannGT/lisa/issues/3101)
* **nightly-e2e:** read the bypass label and trailer live, not from the frozen event payload ([8a44da0](https://github.com/CodySwannGT/lisa/commit/8a44da0fe96f447fbd52301f1bc01d08d95b481f)), closes [CodySwannGT/lisa#3030](https://github.com/CodySwannGT/lisa/issues/3030)

### [4.6.4](https://github.com/CodySwannGT/lisa/compare/v4.6.3...v4.6.4) (2026-08-25)


### Bug Fixes

* **learnings:** report a saturated ledger instead of calling it passed ([a7703ae](https://github.com/CodySwannGT/lisa/commit/a7703ae8852aaf587e4424490a7924177e5142b0))
* **nightly-e2e:** read the bypass label and trailer live, not from the frozen event payload ([8a44da0](https://github.com/CodySwannGT/lisa/commit/8a44da0fe96f447fbd52301f1bc01d08d95b481f)), closes [CodySwannGT/lisa#3030](https://github.com/CodySwannGT/lisa/issues/3030)

### [4.6.3](https://github.com/CodySwannGT/lisa/compare/v4.6.2...v4.6.3) (2026-08-25)


### Bug Fixes

* **gates:** recognise threshold ratchet config ([6cfcb80](https://github.com/CodySwannGT/lisa/commit/6cfcb80ed1b8f097f13f994cb1d84740de267ffa)), closes [CodySwannGT/lisa#3136](https://github.com/CodySwannGT/lisa/issues/3136) [CodySwannGT/lisa#3136](https://github.com/CodySwannGT/lisa/issues/3136)
* **learnings:** report a saturated ledger instead of calling it passed ([a7703ae](https://github.com/CodySwannGT/lisa/commit/a7703ae8852aaf587e4424490a7924177e5142b0))

### [4.6.2](https://github.com/CodySwannGT/lisa/compare/v4.6.1...v4.6.2) (2026-08-25)


### Bug Fixes

* **gates:** derive the caller chain a nested run posts, and prove it against a real run ([a9ba1f9](https://github.com/CodySwannGT/lisa/commit/a9ba1f96ad9a5481b5ec94889916c86df3e8fe06)), closes [#3129](https://github.com/CodySwannGT/lisa/issues/3129) [CodySwannGT/lisa#3039](https://github.com/CodySwannGT/lisa/issues/3039)
* **gates:** hoist the verify-contexts missing list out of a concatenation ([92f8a69](https://github.com/CodySwannGT/lisa/commit/92f8a6999589cdeeae87403391df4d8e417e24ec)), closes [CodySwannGT/lisa#3039](https://github.com/CodySwannGT/lisa/issues/3039)

### [4.6.1](https://github.com/CodySwannGT/lisa/compare/v4.6.0...v4.6.1) (2026-08-25)


### Bug Fixes

* **gates:** derive the caller chain a nested run posts, and prove it against a real run ([a9ba1f9](https://github.com/CodySwannGT/lisa/commit/a9ba1f96ad9a5481b5ec94889916c86df3e8fe06)), closes [#3129](https://github.com/CodySwannGT/lisa/issues/3129) [CodySwannGT/lisa#3039](https://github.com/CodySwannGT/lisa/issues/3039)
* **gates:** hoist the verify-contexts missing list out of a concatenation ([92f8a69](https://github.com/CodySwannGT/lisa/commit/92f8a6999589cdeeae87403391df4d8e417e24ec)), closes [CodySwannGT/lisa#3039](https://github.com/CodySwannGT/lisa/issues/3039)
* **tests:** check the withheld guards were contributing before concluding ([39e8df4](https://github.com/CodySwannGT/lisa/commit/39e8df47d86dcf763f0c8f5a58a8d7f39485af01)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [CodySwannGT/lisa#2992](https://github.com/CodySwannGT/lisa/issues/2992)

## [4.6.0](https://github.com/CodySwannGT/lisa/compare/v4.5.0...v4.6.0) (2026-08-25)


### Features

* **ci:** prove the artifact at a workflow's package path still honours its contract ([1ba988b](https://github.com/CodySwannGT/lisa/commit/1ba988bf689a949cf06b10620d9e763486b2eb19)), closes [#2960](https://github.com/CodySwannGT/lisa/issues/2960) [#2951](https://github.com/CodySwannGT/lisa/issues/2951) [CodySwannGT/lisa#2982](https://github.com/CodySwannGT/lisa/issues/2982)

## [4.5.0](https://github.com/CodySwannGT/lisa/compare/v4.4.21...v4.5.0) (2026-08-25)


### Features

* **ci:** prove the artifact at a workflow's package path still honours its contract ([1ba988b](https://github.com/CodySwannGT/lisa/commit/1ba988bf689a949cf06b10620d9e763486b2eb19)), closes [#2960](https://github.com/CodySwannGT/lisa/issues/2960) [#2951](https://github.com/CodySwannGT/lisa/issues/2951) [CodySwannGT/lisa#2982](https://github.com/CodySwannGT/lisa/issues/2982)


### Bug Fixes

* **ci:** name the last vendor-bearing job for the property it proves ([b074762](https://github.com/CodySwannGT/lisa/commit/b074762421d5d54ae9952d6c35487e4648b6971a)), closes [CodySwannGT/lisa#3005](https://github.com/CodySwannGT/lisa/issues/3005)
* **gates:** refuse to run a configuration `validate` calls blocking ([88f777e](https://github.com/CodySwannGT/lisa/commit/88f777e8bb87a1cc0db2ff6c09687d55dd3b9d87)), closes [CodySwannGT/lisa#3042](https://github.com/CodySwannGT/lisa/issues/3042)
* **mutation:** name the floor a passing verdict cleared, and its value ([8e37ff9](https://github.com/CodySwannGT/lisa/commit/8e37ff94834086fc1f99691c8f31ac79d085d0ac)), closes [CodySwannGT/lisa#2978](https://github.com/CodySwannGT/lisa/issues/2978)

### [4.4.21](https://github.com/CodySwannGT/lisa/compare/v4.4.20...v4.4.21) (2026-08-25)


### Bug Fixes

* **ci:** name the last vendor-bearing job for the property it proves ([b074762](https://github.com/CodySwannGT/lisa/commit/b074762421d5d54ae9952d6c35487e4648b6971a)), closes [CodySwannGT/lisa#3005](https://github.com/CodySwannGT/lisa/issues/3005)
* **gates:** refuse to run a configuration `validate` calls blocking ([88f777e](https://github.com/CodySwannGT/lisa/commit/88f777e8bb87a1cc0db2ff6c09687d55dd3b9d87)), closes [CodySwannGT/lisa#3042](https://github.com/CodySwannGT/lisa/issues/3042)
* **mutation:** name the floor a passing verdict cleared, and its value ([8e37ff9](https://github.com/CodySwannGT/lisa/commit/8e37ff94834086fc1f99691c8f31ac79d085d0ac)), closes [CodySwannGT/lisa#2978](https://github.com/CodySwannGT/lisa/issues/2978)
* **tests:** give each run its own ignore-patterns fixture ([5c6f3f1](https://github.com/CodySwannGT/lisa/commit/5c6f3f122ce58b5685ae130c2316549f7ed7b495)), closes [#2886](https://github.com/CodySwannGT/lisa/issues/2886) [CodySwannGT/lisa#3010](https://github.com/CodySwannGT/lisa/issues/3010)

### [4.4.20](https://github.com/CodySwannGT/lisa/compare/v4.4.19...v4.4.20) (2026-08-25)


### Bug Fixes

* **eslint:** relax Expo env rule for scripts ([b1307c4](https://github.com/CodySwannGT/lisa/commit/b1307c42298dd137539bc4adff3d249a4e6a7357)), closes [CodySwannGT/lisa#3127](https://github.com/CodySwannGT/lisa/issues/3127) [CodySwannGT/lisa#3127](https://github.com/CodySwannGT/lisa/issues/3127)

### [4.4.19](https://github.com/CodySwannGT/lisa/compare/v4.4.18...v4.4.19) (2026-08-25)


### Bug Fixes

* **ci:** wire the vacuous-required-check arm so something actually runs it ([b623cda](https://github.com/CodySwannGT/lisa/commit/b623cdac817b83757c6541f9faf6200f696c71bf)), closes [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [#2049](https://github.com/CodySwannGT/lisa/issues/2049) [#3123](https://github.com/CodySwannGT/lisa/issues/3123) [CodySwannGT/lisa#2928](https://github.com/CodySwannGT/lisa/issues/2928)
* **eslint:** relax Expo env rule for scripts ([b1307c4](https://github.com/CodySwannGT/lisa/commit/b1307c42298dd137539bc4adff3d249a4e6a7357)), closes [CodySwannGT/lisa#3127](https://github.com/CodySwannGT/lisa/issues/3127) [CodySwannGT/lisa#3127](https://github.com/CodySwannGT/lisa/issues/3127)

### [4.4.18](https://github.com/CodySwannGT/lisa/compare/v4.4.17...v4.4.18) (2026-08-25)


### Bug Fixes

* **hooks:** recognise the issues endpoint by its parsed path, not the raw argument ([4459516](https://github.com/CodySwannGT/lisa/commit/44595166722bc4655ac7a759e0e7300d8cffd8d9)), closes [CodySwannGT/lisa#2939](https://github.com/CodySwannGT/lisa/issues/2939)

### [4.4.17](https://github.com/CodySwannGT/lisa/compare/v4.4.16...v4.4.17) (2026-08-25)


### Bug Fixes

* **hooks:** recognise the issues endpoint by its parsed path, not the raw argument ([4459516](https://github.com/CodySwannGT/lisa/commit/44595166722bc4655ac7a759e0e7300d8cffd8d9)), closes [CodySwannGT/lisa#2939](https://github.com/CodySwannGT/lisa/issues/2939)
* **ratchet:** guard Lighthouse budget directions ([d5769ad](https://github.com/CodySwannGT/lisa/commit/d5769adf6995999a46aee3659706efbdfec3808d)), closes [CodySwannGT/lisa#2136](https://github.com/CodySwannGT/lisa/issues/2136)
* **tests:** make blocking harness deterministic ([90ec052](https://github.com/CodySwannGT/lisa/commit/90ec052cf852db2127b2deb876b17153d68b3319)), closes [CodySwannGT/lisa#3120](https://github.com/CodySwannGT/lisa/issues/3120)

### [4.4.16](https://github.com/CodySwannGT/lisa/compare/v4.4.15...v4.4.16) (2026-08-25)


### Bug Fixes

* make the status-capture spelling survive `set -e`, and stop calling pwsh pipefail-protected ([11633ce](https://github.com/CodySwannGT/lisa/commit/11633ce2f89cfa4a779c2e767c12bcdff862bc46)), closes [#3117](https://github.com/CodySwannGT/lisa/issues/3117) [CodySwannGT/lisa#3090](https://github.com/CodySwannGT/lisa/issues/3090)
* read a gate's own exit status, never the pager's ([b2585f3](https://github.com/CodySwannGT/lisa/commit/b2585f3be939ba8d2632836dc9a525acddd42350)), closes [CodySwannGT/lisa#3090](https://github.com/CodySwannGT/lisa/issues/3090)
* **tests:** make blocking harness deterministic ([90ec052](https://github.com/CodySwannGT/lisa/commit/90ec052cf852db2127b2deb876b17153d68b3319)), closes [CodySwannGT/lisa#3120](https://github.com/CodySwannGT/lisa/issues/3120)


### Code Refactoring

* drop the dormant `fixtures` skip from the pipeline sweep ([a0c91bf](https://github.com/CodySwannGT/lisa/commit/a0c91bf4e2fa07c0cdaabcbc3cc673d57bb16796)), closes [CodySwannGT/lisa#3090](https://github.com/CodySwannGT/lisa/issues/3090)

### [4.4.15](https://github.com/CodySwannGT/lisa/compare/v4.4.14...v4.4.15) (2026-08-25)


### Bug Fixes

* **scripts:** let a declaration's silence about its pin be authoritative ([fd39ebd](https://github.com/CodySwannGT/lisa/commit/fd39ebd8e2054e35f5eef08889721482be0905b1)), closes [CodySwannGT/lisa#3029](https://github.com/CodySwannGT/lisa/issues/3029)
* **scripts:** make a declaration a (ruleset, context) pair, and a token a token ([df38538](https://github.com/CodySwannGT/lisa/commit/df385388570baa462d4f62777f988f123972c5a0)), closes [CodySwannGT/lisa#3029](https://github.com/CodySwannGT/lisa/issues/3029)
* **scripts:** repair twelve defects in the vendored copy-overwrite scripts ([db32192](https://github.com/CodySwannGT/lisa/commit/db32192dd9aa171020e28f4f665a1751182d7261)), closes [CodySwannGT/lisa#3029](https://github.com/CodySwannGT/lisa/issues/3029)


### Code Refactoring

* **scripts:** move the three lisa-work-item defects to their own branch ([80e1d78](https://github.com/CodySwannGT/lisa/commit/80e1d7881a7f2f901ec30a9be533526edb514d85)), closes [#3087](https://github.com/CodySwannGT/lisa/issues/3087) [#3087](https://github.com/CodySwannGT/lisa/issues/3087) [#3087](https://github.com/CodySwannGT/lisa/issues/3087) [CodySwannGT/lisa#3029](https://github.com/CodySwannGT/lisa/issues/3029)

### [4.4.14](https://github.com/CodySwannGT/lisa/compare/v4.4.13...v4.4.14) (2026-08-25)


### Bug Fixes

* **package-lisa:** raise oxlint-tsgolint floor to 0.24 ([e439970](https://github.com/CodySwannGT/lisa/commit/e439970e2d9607ee1af7d51ca9a8d6a747dbbba4)), closes [CodySwannGT/lisa#3114](https://github.com/CodySwannGT/lisa/issues/3114)

### [4.4.13](https://github.com/CodySwannGT/lisa/compare/v4.4.12...v4.4.13) (2026-08-25)


### Bug Fixes

* **scripts:** read schema tables with Object.hasOwn, not the prototype chain ([d494d8c](https://github.com/CodySwannGT/lisa/commit/d494d8c634fe51b65041fb6274c04200aed81982)), closes [#3029](https://github.com/CodySwannGT/lisa/issues/3029) [CodySwannGT/lisa#3083](https://github.com/CodySwannGT/lisa/issues/3083)

### [4.4.12](https://github.com/CodySwannGT/lisa/compare/v4.4.11...v4.4.12) (2026-08-25)


### Bug Fixes

* **tests:** assert the track-plan-sessions hook actually ran ([a7ca76f](https://github.com/CodySwannGT/lisa/commit/a7ca76f7991ef6de8d332ebfe81b4b4196105d2a)), closes [CodySwannGT/lisa#3020](https://github.com/CodySwannGT/lisa/issues/3020)

### [4.4.11](https://github.com/CodySwannGT/lisa/compare/v4.4.10...v4.4.11) (2026-08-24)


### Bug Fixes

* **plugins:** check reproducibility of everything the build generates ([78b574f](https://github.com/CodySwannGT/lisa/commit/78b574f13521d5bf6e10eced4a44d51877ff1d1c)), closes [CodySwannGT/lisa#3064](https://github.com/CodySwannGT/lisa/issues/3064)

### [4.4.10](https://github.com/CodySwannGT/lisa/compare/v4.4.9...v4.4.10) (2026-08-24)


### Bug Fixes

* **plugins:** check reproducibility of everything the build generates ([78b574f](https://github.com/CodySwannGT/lisa/commit/78b574f13521d5bf6e10eced4a44d51877ff1d1c)), closes [CodySwannGT/lisa#3064](https://github.com/CodySwannGT/lisa/issues/3064)
* **safety-net:** refuse the git control plane and credential stores ([2c77935](https://github.com/CodySwannGT/lisa/commit/2c779355c58b42b4356a541cb82532cc4cbbe579)), closes [CodySwannGT/lisa#3086](https://github.com/CodySwannGT/lisa/issues/3086) [#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.4.9](https://github.com/CodySwannGT/lisa/compare/v4.4.8...v4.4.9) (2026-08-24)


### Bug Fixes

* **plugins:** resolve the plugin cache in one place, not two that agree ([c228ae4](https://github.com/CodySwannGT/lisa/commit/c228ae4cb72339f1250e81d5359d3c0661b7e605)), closes [#3085](https://github.com/CodySwannGT/lisa/issues/3085) [CodySwannGT/lisa#3093](https://github.com/CodySwannGT/lisa/issues/3093)

### [4.4.8](https://github.com/CodySwannGT/lisa/compare/v4.4.7...v4.4.8) (2026-08-24)


### Documentation

* **drive-pr-to-merge:** allow merging past rate-limited CodeRabbit as sole gate ([3a23acc](https://github.com/CodySwannGT/lisa/commit/3a23acc411dd1e8d0a6a7de59ee90cc7490d32a6)), closes [CodySwannGT/lisa#3102](https://github.com/CodySwannGT/lisa/issues/3102) [CodySwannGT/lisa#3102](https://github.com/CodySwannGT/lisa/issues/3102)

### [4.4.7](https://github.com/CodySwannGT/lisa/compare/v4.4.6...v4.4.7) (2026-08-24)


### Bug Fixes

* **plugins:** bound every child start in the plugin payloads ([53051da](https://github.com/CodySwannGT/lisa/commit/53051da43930be36843bc6d77e3ddb6a889edc50)), closes [#3082](https://github.com/CodySwannGT/lisa/issues/3082) [#3094](https://github.com/CodySwannGT/lisa/issues/3094) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.4.6](https://github.com/CodySwannGT/lisa/compare/v4.4.5...v4.4.6) (2026-08-24)


### Bug Fixes

* **plugins:** bound every child start in the plugin payloads ([53051da](https://github.com/CodySwannGT/lisa/commit/53051da43930be36843bc6d77e3ddb6a889edc50)), closes [#3082](https://github.com/CodySwannGT/lisa/issues/3082) [#3094](https://github.com/CodySwannGT/lisa/issues/3094) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)
* **tests:** derive the coverage-debris kill point from the target, not from a latency multiplier ([32cb060](https://github.com/CodySwannGT/lisa/commit/32cb060afeeecfa16d44e0f829532da1eb878540)), closes [CodySwannGT/lisa#3095](https://github.com/CodySwannGT/lisa/issues/3095)
* **tests:** kill the coverage-debris target on the sweep, not on a clock ([62b5eb3](https://github.com/CodySwannGT/lisa/commit/62b5eb33c31ddbfc895dbd45c6ed14b621878127)), closes [CodySwannGT/lisa#3095](https://github.com/CodySwannGT/lisa/issues/3095)

### [4.4.5](https://github.com/CodySwannGT/lisa/compare/v4.4.4...v4.4.5) (2026-08-24)


### Bug Fixes

* **templates:** bound the stack-lane child starts, and fix the ratchet upstream ([e07ddf8](https://github.com/CodySwannGT/lisa/commit/e07ddf82aea1efa2a91324bc773c249400b3a35a)), closes [#2777](https://github.com/CodySwannGT/lisa/issues/2777) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.4.4](https://github.com/CodySwannGT/lisa/compare/v4.4.3...v4.4.4) (2026-08-24)


### Bug Fixes

* **parity:** stop resolving the current version from orphaned cache dirs ([98bbd38](https://github.com/CodySwannGT/lisa/commit/98bbd38859222a0cec56ed6a2676304a8d833032)), closes [CodySwannGT/lisa#3085](https://github.com/CodySwannGT/lisa/issues/3085) [#3071](https://github.com/CodySwannGT/lisa/issues/3071) [#3085](https://github.com/CodySwannGT/lisa/issues/3085)

### [4.4.3](https://github.com/CodySwannGT/lisa/compare/v4.4.2...v4.4.3) (2026-08-24)

### [4.4.2](https://github.com/CodySwannGT/lisa/compare/v4.4.1...v4.4.2) (2026-08-24)


### Bug Fixes

* **scripts:** bound every child start in scripts/, one verdict at a time ([155d028](https://github.com/CodySwannGT/lisa/commit/155d0280bf8e87bfe71ad20b9ea1dd10b4a0c83d)), closes [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.4.1](https://github.com/CodySwannGT/lisa/compare/v4.4.0...v4.4.1) (2026-08-24)


### Bug Fixes

* **markers:** recognise managed blocks by family, not by one literal ([79a34ea](https://github.com/CodySwannGT/lisa/commit/79a34ea21c9cedea8c867a195f4621a5de7945be)), closes [CodySwannGT/lisa#3077](https://github.com/CodySwannGT/lisa/issues/3077)
* **scripts:** bound every child start in scripts/, one verdict at a time ([155d028](https://github.com/CodySwannGT/lisa/commit/155d0280bf8e87bfe71ad20b9ea1dd10b4a0c83d)), closes [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

## [4.4.0](https://github.com/CodySwannGT/lisa/compare/v4.3.5...v4.4.0) (2026-08-24)


### Features

* **release:** forward a moment input to quality.yml ([12fdf82](https://github.com/CodySwannGT/lisa/commit/12fdf82e65e860d070794c19bc224a5813aeb146)), closes [CodySwannGT/lisa#3071](https://github.com/CodySwannGT/lisa/issues/3071)

### [4.3.5](https://github.com/CodySwannGT/lisa/compare/v4.3.4...v4.3.5) (2026-08-24)


### Bug Fixes

* **scripts:** bound every child start in the all/ lane, one verdict at a time ([5c3bc26](https://github.com/CodySwannGT/lisa/commit/5c3bc2681a5ac3642e2d0de11d9c9f06fb034e08)), closes [#2958](https://github.com/CodySwannGT/lisa/issues/2958) [#2980](https://github.com/CodySwannGT/lisa/issues/2980) [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.3.4](https://github.com/CodySwannGT/lisa/compare/v4.3.3...v4.3.4) (2026-08-24)


### Bug Fixes

* **apply:** stop reading --yes as consent to discard curated host content ([85190c3](https://github.com/CodySwannGT/lisa/commit/85190c38d458958667fe33db97271bea9f5da0e0)), closes [CodySwannGT/lisa#3069](https://github.com/CodySwannGT/lisa/issues/3069) [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#3070](https://github.com/CodySwannGT/lisa/issues/3070)
* **scripts:** bound every child start in the all/ lane, one verdict at a time ([5c3bc26](https://github.com/CodySwannGT/lisa/commit/5c3bc2681a5ac3642e2d0de11d9c9f06fb034e08)), closes [#2958](https://github.com/CodySwannGT/lisa/issues/2958) [#2980](https://github.com/CodySwannGT/lisa/issues/2980) [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)
* **skills:** stop the fleet-update skill instructing a postinstall-safe apply ([b27dab3](https://github.com/CodySwannGT/lisa/commit/b27dab32f87abdd88b6b309f58dd93acb438dc29)), closes [#3033](https://github.com/CodySwannGT/lisa/issues/3033) [CodySwannGT/lisa#3066](https://github.com/CodySwannGT/lisa/issues/3066)

### [4.3.3](https://github.com/CodySwannGT/lisa/compare/v4.3.2...v4.3.3) (2026-08-24)


### Bug Fixes

* **apply:** stop reading --yes as consent to discard curated host content ([85190c3](https://github.com/CodySwannGT/lisa/commit/85190c38d458958667fe33db97271bea9f5da0e0)), closes [CodySwannGT/lisa#3069](https://github.com/CodySwannGT/lisa/issues/3069) [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#3070](https://github.com/CodySwannGT/lisa/issues/3070)
* **ci:** stop create-only callers passing secrets to gates.yml, which reads none ([aeeb266](https://github.com/CodySwannGT/lisa/commit/aeeb2663338becaaeae54de4e4476116e6133ed2)), closes [CodySwannGT/lisa#3065](https://github.com/CodySwannGT/lisa/issues/3065)
* **skills:** stop the fleet-update skill instructing a postinstall-safe apply ([b27dab3](https://github.com/CodySwannGT/lisa/commit/b27dab32f87abdd88b6b309f58dd93acb438dc29)), closes [#3033](https://github.com/CodySwannGT/lisa/issues/3033) [CodySwannGT/lisa#3066](https://github.com/CodySwannGT/lisa/issues/3066)

### [4.3.2](https://github.com/CodySwannGT/lisa/compare/v4.3.1...v4.3.2) (2026-08-24)


### Bug Fixes

* **tests:** stop the spawn scan calling every bounded call in a mutate target unbounded ([9d47b5a](https://github.com/CodySwannGT/lisa/commit/9d47b5aa9081fc0fabcb3bfd3869de2d44758597)), closes [#2940](https://github.com/CodySwannGT/lisa/issues/2940) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)


### Documentation

* **tests:** date the conditional tolerance with its falsifier ([e849bde](https://github.com/CodySwannGT/lisa/commit/e849bde49f7eaf9bbbb73390b719556e5bf5190f)), closes [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.3.1](https://github.com/CodySwannGT/lisa/compare/v4.3.0...v4.3.1) (2026-08-24)


### Documentation

* **scripts:** say why 30s is a floor rather than padding ([43ee9bd](https://github.com/CodySwannGT/lisa/commit/43ee9bd45b19704cad7a62f4ca6a3f13603fe967)), closes [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

## [4.3.0](https://github.com/CodySwannGT/lisa/compare/v4.2.0...v4.3.0) (2026-08-24)


### Features

* **scripts:** add the shared child-start deadline, and its lane wiring ([e8a7f19](https://github.com/CodySwannGT/lisa/commit/e8a7f192310d2ce28703aaa22fb5af100bd680d2)), closes [#2940](https://github.com/CodySwannGT/lisa/issues/2940) [#2887](https://github.com/CodySwannGT/lisa/issues/2887) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)


### Bug Fixes

* **tests:** stop the CLI smoke test wiping dist out from under the suite ([d0d0e33](https://github.com/CodySwannGT/lisa/commit/d0d0e33307549063599da439f304e838cefed3d6)), closes [#3054](https://github.com/CodySwannGT/lisa/issues/3054) [CodySwannGT/lisa#3054](https://github.com/CodySwannGT/lisa/issues/3054)


### Documentation

* **scripts:** say why 30s is a floor rather than padding ([43ee9bd](https://github.com/CodySwannGT/lisa/commit/43ee9bd45b19704cad7a62f4ca6a3f13603fe967)), closes [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

## [4.2.0](https://github.com/CodySwannGT/lisa/compare/v4.1.6...v4.2.0) (2026-08-24)


### Features

* **scripts:** add the shared child-start deadline, and its lane wiring ([e8a7f19](https://github.com/CodySwannGT/lisa/commit/e8a7f192310d2ce28703aaa22fb5af100bd680d2)), closes [#2940](https://github.com/CodySwannGT/lisa/issues/2940) [#2887](https://github.com/CodySwannGT/lisa/issues/2887) [CodySwannGT/lisa#2980](https://github.com/CodySwannGT/lisa/issues/2980)

### [4.1.6](https://github.com/CodySwannGT/lisa/compare/v4.1.5...v4.1.6) (2026-08-24)


### Bug Fixes

* **mutation:** reclaim the sandbox a killed gate leaves, and bound the gate's child ([f1ccb5b](https://github.com/CodySwannGT/lisa/commit/f1ccb5bfec069e8afbcc0a1d36f3b91799e0df62)), closes [#2961](https://github.com/CodySwannGT/lisa/issues/2961) [CodySwannGT/lisa#2995](https://github.com/CodySwannGT/lisa/issues/2995)

### [4.1.5](https://github.com/CodySwannGT/lisa/compare/v4.1.4...v4.1.5) (2026-08-24)


### Bug Fixes

* **gates:** read conflict markers at any width, and from the index ([d3cf5cc](https://github.com/CodySwannGT/lisa/commit/d3cf5cc077448966929897bba83aec953fc3c703)), closes [CodySwannGT/lisa#2958](https://github.com/CodySwannGT/lisa/issues/2958)

### [4.1.4](https://github.com/CodySwannGT/lisa/compare/v4.1.3...v4.1.4) (2026-08-24)

### [4.1.3](https://github.com/CodySwannGT/lisa/compare/v4.1.2...v4.1.3) (2026-08-24)


### Documentation

* **ci:** record the measurement behind the old-vs-broken resolver test ([1ca313a](https://github.com/CodySwannGT/lisa/commit/1ca313a01d04edb33bd815e67e0a269149c59511)), closes [CodySwannGT/lisa#2881](https://github.com/CodySwannGT/lisa/issues/2881)

### [4.1.2](https://github.com/CodySwannGT/lisa/compare/v4.1.1...v4.1.2) (2026-08-24)


### Bug Fixes

* **tests:** count only unowned entries against the scratch ceiling ([a064cfe](https://github.com/CodySwannGT/lisa/commit/a064cfe6f7d5425929365609b8e6c5c9558f1a75)), closes [#2902](https://github.com/CodySwannGT/lisa/issues/2902) [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)

### [4.1.1](https://github.com/CodySwannGT/lisa/compare/v4.1.0...v4.1.1) (2026-08-24)


### Bug Fixes

* **tests:** gate orphaned fixture process trees, and reap them by process group ([3a6f134](https://github.com/CodySwannGT/lisa/commit/3a6f1341b89e789fbcd6ac2cc8515d3bafcd8afe)), closes [CodySwannGT/lisa#2902](https://github.com/CodySwannGT/lisa/issues/2902)
* **tests:** use the shared entry guard and stop the excerpt fixture naming a temp root ([a7b4074](https://github.com/CodySwannGT/lisa/commit/a7b40742503fa59c198b2757739271ae898c8e46)), closes [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [CodySwannGT/lisa#2902](https://github.com/CodySwannGT/lisa/issues/2902)

## [4.1.0](https://github.com/CodySwannGT/lisa/compare/v4.0.2...v4.1.0) (2026-08-24)


### Features

* **ci:** run the pull-request moment's declared gates from a matrix ([7cf3d87](https://github.com/CodySwannGT/lisa/commit/7cf3d871708b66662a711f883525bcb0023dbd02)), closes [CodySwannGT/lisa#2881](https://github.com/CodySwannGT/lisa/issues/2881)
* **gates:** resolve the pull-request moment's gates from the registry ([a9238ca](https://github.com/CodySwannGT/lisa/commit/a9238caab0ccda3e81d6ceed0912a259a98c234b)), closes [CodySwannGT/lisa#2881](https://github.com/CodySwannGT/lisa/issues/2881)


### Bug Fixes

* **gates:** address the three still-valid review findings ([1c0ee06](https://github.com/CodySwannGT/lisa/commit/1c0ee063d062e19d1c09b1d1d8fc07cd16f4f9b6)), closes [CodySwannGT/lisa#2881](https://github.com/CodySwannGT/lisa/issues/2881)


### Code Refactoring

* **gates:** make the job table itself decide which gates the runner takes ([911322c](https://github.com/CodySwannGT/lisa/commit/911322cf5d3ef21ada87f899f64bdfe082bd03d8)), closes [CodySwannGT/lisa#2881](https://github.com/CodySwannGT/lisa/issues/2881)

### [4.0.2](https://github.com/CodySwannGT/lisa/compare/v4.0.1...v4.0.2) (2026-08-24)


### Bug Fixes

* **doctor:** give the readiness report a unique temp path ([9d977c8](https://github.com/CodySwannGT/lisa/commit/9d977c890a826298a6c5e8e7d299f202330cd993)), closes [CodySwannGT/lisa#3046](https://github.com/CodySwannGT/lisa/issues/3046) [#3046](https://github.com/CodySwannGT/lisa/issues/3046) [#3046](https://github.com/CodySwannGT/lisa/issues/3046)

### [4.0.1](https://github.com/CodySwannGT/lisa/compare/v4.0.0...v4.0.1) (2026-08-24)


### Bug Fixes

* **gates:** give a killed run its own state, and a refused run a summary line ([11360e6](https://github.com/CodySwannGT/lisa/commit/11360e606b4c43c17df79bed08f488a8cbd71085)), closes [#3032](https://github.com/CodySwannGT/lisa/issues/3032) [#2883](https://github.com/CodySwannGT/lisa/issues/2883) [#2813](https://github.com/CodySwannGT/lisa/issues/2813) [#3027](https://github.com/CodySwannGT/lisa/issues/3027) [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)
* **tests:** give the keychain probe a service name concurrent runs cannot share ([c2168ca](https://github.com/CodySwannGT/lisa/commit/c2168ca6644c90171b2aed15080437b47b5637b6)), closes [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)
* **tests:** stop a green run's transcript announcing a refusal ([c16c658](https://github.com/CodySwannGT/lisa/commit/c16c6585e1e050a1d0d0e891f75716ee5ec8c7eb)), closes [#3027](https://github.com/CodySwannGT/lisa/issues/3027) [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)
* **tests:** stop a passing run from announcing a refusal it never had ([e193e73](https://github.com/CodySwannGT/lisa/commit/e193e7365305739246f3497210f9aa697a9f9f49)), closes [CodySwannGT/lisa#3032](https://github.com/CodySwannGT/lisa/issues/3032)

## [4.0.0](https://github.com/CodySwannGT/lisa/compare/v3.70.6...v4.0.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* **gates:** `quality.yml` and `quality-rails.yml` no longer accept the
`zap_target_url` or `zap_rules_file` inputs, and no longer honour the
`zap_baseline` skip token. A caller still passing an input gets an
immediate, loud "invalid input" error rather than a knob that silently does
nothing. No shipped template passed either input. The standalone
`zap-baseline-*.yml` workflows are untouched and remain DAST's home.

Verified by execution, not inspection. Reverting `lisa-gates.mjs` to its
pre-fix state on main fails three tests by name:

  - leaves no token unmappable: every one resolves, is inert, or is retired
  - reports zap_baseline as retired, with the remedy, not as unmappable
  - reports zap_baseline as RETIRED and tells the operator to delete it

The first is deliberately stated over the WHOLE token table rather than a
named row: the old assertion pinned `zap_baseline` and would have said
nothing about a new ungated job appearing beside it.

`UNGATED_QUALITY_JOBS` re-derived from this tree: 0 entries.

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>

### Bug Fixes

* **gates:** delete the pull-request ZAP job rather than naming it ([ef6d753](https://github.com/CodySwannGT/lisa/commit/ef6d753664224516dabeb3459aec636d2438f0e8)), closes [CodySwannGT/lisa#3035](https://github.com/CodySwannGT/lisa/issues/3035) [#2832](https://github.com/CodySwannGT/lisa/issues/2832)


### Documentation

* **gates:** drop the retired ZAP inputs from docs and the console UI ([b276ff0](https://github.com/CodySwannGT/lisa/commit/b276ff0ceb2b649d3d11a1dfe283c5aecf517699)), closes [CodySwannGT/lisa#3035](https://github.com/CodySwannGT/lisa/issues/3035)

### [3.70.6](https://github.com/CodySwannGT/lisa/compare/v3.70.5...v3.70.6) (2026-08-24)


### Bug Fixes

* **mutation:** stop counting a timed-out mutant as one the tests caught ([98b1f9e](https://github.com/CodySwannGT/lisa/commit/98b1f9eb373cbcfd2260156a1e0ec17610e81f2c)), closes [CodySwannGT/lisa#2989](https://github.com/CodySwannGT/lisa/issues/2989)

### [3.70.5](https://github.com/CodySwannGT/lisa/compare/v3.70.4...v3.70.5) (2026-08-24)


### Bug Fixes

* **doctor:** report the managed files a bump leaves stale ([8ea8619](https://github.com/CodySwannGT/lisa/commit/8ea861945dd8f1933606e3f60d4d484acae28726)), closes [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [#3026](https://github.com/CodySwannGT/lisa/issues/3026) [CodySwannGT/lisa#3033](https://github.com/CodySwannGT/lisa/issues/3033)

### [3.70.4](https://github.com/CodySwannGT/lisa/compare/v3.70.3...v3.70.4) (2026-08-24)

### [3.70.3](https://github.com/CodySwannGT/lisa/compare/v3.70.2...v3.70.3) (2026-08-24)


### Bug Fixes

* **gates:** scan reason lines by prefix instead of a backtracking regex ([2488f6c](https://github.com/CodySwannGT/lisa/commit/2488f6cf6a22cb1bc0837a9d70e83c28f9bf3690)), closes [CodySwannGT/lisa#2883](https://github.com/CodySwannGT/lisa/issues/2883)
* **gates:** stop reporting a run that executed zero test files as a coverage shortfall ([8519bbd](https://github.com/CodySwannGT/lisa/commit/8519bbd9b2032ebf76668a4c47edf3dae2c13481)), closes [CodySwannGT/lisa#2883](https://github.com/CodySwannGT/lisa/issues/2883)

### [3.70.2](https://github.com/CodySwannGT/lisa/compare/v3.70.1...v3.70.2) (2026-08-24)


### Bug Fixes

* **apply:** stop reading a missing TTY as consent to overwrite host files ([0b559eb](https://github.com/CodySwannGT/lisa/commit/0b559eb5fc9df88b34afa009ca33cc4011c2c56c)), closes [CodySwannGT/lisa#3026](https://github.com/CodySwannGT/lisa/issues/3026)

### [3.70.1](https://github.com/CodySwannGT/lisa/compare/v3.70.0...v3.70.1) (2026-08-24)


### Bug Fixes

* **hooks:** refuse the short -n form of --no-verify on a git commit argv ([efd8790](https://github.com/CodySwannGT/lisa/commit/efd87900aa6aff834e104c6a0c8916e98b9c1f4d)), closes [CodySwannGT/lisa#2942](https://github.com/CodySwannGT/lisa/issues/2942)
* **hooks:** treat a newline as a command boundary in the short -n scan ([2c93207](https://github.com/CodySwannGT/lisa/commit/2c93207f553c57f6a726f6aae4e7b59bd658eaee)), closes [#3025](https://github.com/CodySwannGT/lisa/issues/3025) [CodySwannGT/lisa#2942](https://github.com/CodySwannGT/lisa/issues/2942)
* **tests:** make the scratch-guard readiness signal atomic and announce a refusal first ([ac69e2f](https://github.com/CodySwannGT/lisa/commit/ac69e2f6b6ca39c9583f0865d4f753b3b5ddba21)), closes [CodySwannGT/lisa#2883](https://github.com/CodySwannGT/lisa/issues/2883)

## [3.70.0](https://github.com/CodySwannGT/lisa/compare/v3.69.6...v3.70.0) (2026-08-24)


### Features

* **gates:** run the gates declared at deploy and continuous moments ([fce95fa](https://github.com/CodySwannGT/lisa/commit/fce95fab85125c69dfc26a6f8ffc8ff18b686d14)), closes [#2938](https://github.com/CodySwannGT/lisa/issues/2938) [CodySwannGT/lisa#2832](https://github.com/CodySwannGT/lisa/issues/2832)


### Bug Fixes

* **gates:** read the runner's exit code under bash -e, and test it there ([4c60fa3](https://github.com/CodySwannGT/lisa/commit/4c60fa39ccf45588436c2c32946f4242d4c6d798)), closes [CodySwannGT/lisa#2832](https://github.com/CodySwannGT/lisa/issues/2832)

### [3.69.6](https://github.com/CodySwannGT/lisa/compare/v3.69.5...v3.69.6) (2026-08-24)


### Bug Fixes

* **ci:** govern the learnings budget from one declaration in every workflow that proves it ([a7a86b5](https://github.com/CodySwannGT/lisa/commit/a7a86b57380f8572e1c7c67177bb40c0b1cd8523)), closes [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2933](https://github.com/CodySwannGT/lisa/issues/2933) [CodySwannGT/lisa#2932](https://github.com/CodySwannGT/lisa/issues/2932)
* **gates:** record the no-fourth-level ruling and refuse a second silent adoption control ([af9dbc1](https://github.com/CodySwannGT/lisa/commit/af9dbc164ae5102bd57f15e446670384e215efce)), closes [#2930](https://github.com/CodySwannGT/lisa/issues/2930) [#3016](https://github.com/CodySwannGT/lisa/issues/3016) [#2930](https://github.com/CodySwannGT/lisa/issues/2930) [CodySwannGT/lisa#2930](https://github.com/CodySwannGT/lisa/issues/2930)
* **gates:** retire the BDD grace period and collapse adoption onto one declaration ([3142400](https://github.com/CodySwannGT/lisa/commit/3142400511fa2d2ed0ff1b2ef5c7ada56235c467)), closes [CodySwannGT/lisa#3016](https://github.com/CodySwannGT/lisa/issues/3016)


### Documentation

* **ci:** measure the learnings-budget promotion's own caveat instead of arguing it ([8c58459](https://github.com/CodySwannGT/lisa/commit/8c584592b7123ae5ef805b487a87dac94fb308ee)), closes [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2932](https://github.com/CodySwannGT/lisa/issues/2932)

### [3.69.5](https://github.com/CodySwannGT/lisa/compare/v3.69.4...v3.69.5) (2026-08-23)


### Bug Fixes

* **ci:** make the skipped-required-check guard fail closed and delete its off-switch ([1646a38](https://github.com/CodySwannGT/lisa/commit/1646a389a2de3cc726325cb72e00dcbe60127863)), closes [#2933](https://github.com/CodySwannGT/lisa/issues/2933) [#2846](https://github.com/CodySwannGT/lisa/issues/2846) [CodySwannGT/lisa#2933](https://github.com/CodySwannGT/lisa/issues/2933)
* **gates:** report a deleted skip token as retired rather than unknown ([10f4778](https://github.com/CodySwannGT/lisa/commit/10f477802fb307bab54e0a6260f23680817c9739)), closes [#3014](https://github.com/CodySwannGT/lisa/issues/3014) [CodySwannGT/lisa#2933](https://github.com/CodySwannGT/lisa/issues/2933)

### [3.69.4](https://github.com/CodySwannGT/lisa/compare/v3.69.3...v3.69.4) (2026-08-23)


### Documentation

* **ci:** correct the parsed-options type for the release override ([95b0e0d](https://github.com/CodySwannGT/lisa/commit/95b0e0d4c08fd3017391a3fa609b9ddcb887bea6)), closes [CodySwannGT/lisa#2960](https://github.com/CodySwannGT/lisa/issues/2960) [CodySwannGT/lisa#2960](https://github.com/CodySwannGT/lisa/issues/2960)

### [3.69.3](https://github.com/CodySwannGT/lisa/compare/v3.69.2...v3.69.3) (2026-08-23)


### Bug Fixes

* **ci:** reject incomplete gate plans ([1433916](https://github.com/CodySwannGT/lisa/commit/1433916eed58cf7295cbe7a124cfd6740aade1b4)), closes [CodySwannGT/lisa#3011](https://github.com/CodySwannGT/lisa/issues/3011)


### Performance Improvements

* **ci:** preallocate explicitly off gates ([7b82d34](https://github.com/CodySwannGT/lisa/commit/7b82d34596012d1ce89e0291660cf62ea7df3b53)), closes [CodySwannGT/lisa#3011](https://github.com/CodySwannGT/lisa/issues/3011)

### [3.69.2](https://github.com/CodySwannGT/lisa/compare/v3.69.1...v3.69.2) (2026-08-23)


### Performance Improvements

* **tests:** tighten the liveness budget to the re-measured tail ([fe1ae1e](https://github.com/CodySwannGT/lisa/commit/fe1ae1e02ae670f3745e31c034471dd37a208c07)), closes [#2889](https://github.com/CodySwannGT/lisa/issues/2889) [#2885](https://github.com/CodySwannGT/lisa/issues/2885) [#2885](https://github.com/CodySwannGT/lisa/issues/2885) [CodySwannGT/lisa#2892](https://github.com/CodySwannGT/lisa/issues/2892)

### [3.69.1](https://github.com/CodySwannGT/lisa/compare/v3.69.0...v3.69.1) (2026-08-23)


### Bug Fixes

* read the hook payload before any stand-aside exit, and stop calling EPIPE a hang ([ae1271b](https://github.com/CodySwannGT/lisa/commit/ae1271b1a7700904998ab3986cc6d342f5ab7583)), closes [CodySwannGT/lisa#2949](https://github.com/CodySwannGT/lisa/issues/2949) [CodySwannGT/lisa#2949](https://github.com/CodySwannGT/lisa/issues/2949)


### Code Refactoring

* start the EPIPE regression cases through the bounded spawn helper ([4109c56](https://github.com/CodySwannGT/lisa/commit/4109c5670ef0e3c50c9ab1a7529193ceec4b8c45)), closes [CodySwannGT/lisa#2949](https://github.com/CodySwannGT/lisa/issues/2949) [CodySwannGT/lisa#2949](https://github.com/CodySwannGT/lisa/issues/2949)

## [3.69.0](https://github.com/CodySwannGT/lisa/compare/v3.68.0...v3.69.0) (2026-08-23)


### Features

* **hooks:** make the edit-time scripts resolve their gate before running ([4a0c000](https://github.com/CodySwannGT/lisa/commit/4a0c00051ea1de79050f88037c067ff8a2ee07a8)), closes [#2839](https://github.com/CodySwannGT/lisa/issues/2839) [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)


### Bug Fixes

* **tests:** pin the pre-façade comparison to a snapshot, not to origin/main ([2a0be54](https://github.com/CodySwannGT/lisa/commit/2a0be5441c26dfc40b1dc8da76f2cb0455a206ed)), closes [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)


### Performance Improvements

* **ci:** delete orphan dependency setup ([cd0049b](https://github.com/CodySwannGT/lisa/commit/cd0049b9b8d41e223002e9e1997408ad504b04fc)), closes [CodySwannGT/lisa#3004](https://github.com/CodySwannGT/lisa/issues/3004)
* **hooks:** do not spawn a resolver when no settings file exists ([e2e46bb](https://github.com/CodySwannGT/lisa/commit/e2e46bb0e87ce32192b1ca024f24d93014c767be)), closes [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)

## [3.68.0](https://github.com/CodySwannGT/lisa/compare/v3.67.0...v3.68.0) (2026-08-23)


### Features

* **gates:** refuse a declaration with nothing able to run it ([789592a](https://github.com/CodySwannGT/lisa/commit/789592a5a8d391fd59e80533729930be2e9fe91e)), closes [#2946](https://github.com/CodySwannGT/lisa/issues/2946) [#2843](https://github.com/CodySwannGT/lisa/issues/2843) [CodySwannGT/lisa#2948](https://github.com/CodySwannGT/lisa/issues/2948)
* **hooks:** make the edit-time scripts resolve their gate before running ([4a0c000](https://github.com/CodySwannGT/lisa/commit/4a0c00051ea1de79050f88037c067ff8a2ee07a8)), closes [#2839](https://github.com/CodySwannGT/lisa/issues/2839) [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)


### Bug Fixes

* **tests:** deduplicate job ids before comparing with the recorded tables ([cd55222](https://github.com/CodySwannGT/lisa/commit/cd55222cce311fa3b7925e7c87329e7a044fa82e)), closes [#2977](https://github.com/CodySwannGT/lisa/issues/2977) [CodySwannGT/lisa#2955](https://github.com/CodySwannGT/lisa/issues/2955)
* **tests:** pin the pre-façade comparison to a snapshot, not to origin/main ([2a0be54](https://github.com/CodySwannGT/lisa/commit/2a0be5441c26dfc40b1dc8da76f2cb0455a206ed)), closes [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)


### Performance Improvements

* **ci:** delete orphan dependency setup ([cd0049b](https://github.com/CodySwannGT/lisa/commit/cd0049b9b8d41e223002e9e1997408ad504b04fc)), closes [CodySwannGT/lisa#3004](https://github.com/CodySwannGT/lisa/issues/3004)
* **hooks:** do not spawn a resolver when no settings file exists ([e2e46bb](https://github.com/CodySwannGT/lisa/commit/e2e46bb0e87ce32192b1ca024f24d93014c767be)), closes [CodySwannGT/lisa#2957](https://github.com/CodySwannGT/lisa/issues/2957)

## [3.67.0](https://github.com/CodySwannGT/lisa/compare/v3.66.2...v3.67.0) (2026-08-23)


### Features

* **gates:** refuse a declaration with nothing able to run it ([789592a](https://github.com/CodySwannGT/lisa/commit/789592a5a8d391fd59e80533729930be2e9fe91e)), closes [#2946](https://github.com/CodySwannGT/lisa/issues/2946) [#2843](https://github.com/CodySwannGT/lisa/issues/2843) [CodySwannGT/lisa#2948](https://github.com/CodySwannGT/lisa/issues/2948)


### Bug Fixes

* **ci:** name the shard-fanout job for its property, and sweep both workflows ([5e7c0cc](https://github.com/CodySwannGT/lisa/commit/5e7c0ccc6d366e2c03aa8dcae25c9c030d611001)), closes [#2859](https://github.com/CodySwannGT/lisa/issues/2859) [CodySwannGT/lisa#2964](https://github.com/CodySwannGT/lisa/issues/2964)
* **tests:** deduplicate job ids before comparing with the recorded tables ([cd55222](https://github.com/CodySwannGT/lisa/commit/cd55222cce311fa3b7925e7c87329e7a044fa82e)), closes [#2977](https://github.com/CodySwannGT/lisa/issues/2977) [CodySwannGT/lisa#2955](https://github.com/CodySwannGT/lisa/issues/2955)

### [3.66.2](https://github.com/CodySwannGT/lisa/compare/v3.66.1...v3.66.2) (2026-08-23)


### Bug Fixes

* **ci:** name the shard-fanout job for its property, and sweep both workflows ([5e7c0cc](https://github.com/CodySwannGT/lisa/commit/5e7c0ccc6d366e2c03aa8dcae25c9c030d611001)), closes [#2859](https://github.com/CodySwannGT/lisa/issues/2859) [CodySwannGT/lisa#2964](https://github.com/CodySwannGT/lisa/issues/2964)
* **gates:** record the on-edit hooks at the moment they actually fire ([91aa546](https://github.com/CodySwannGT/lisa/commit/91aa546d34fd96b41992bb3d2b3a4ed291732cb3)), closes [#2920](https://github.com/CodySwannGT/lisa/issues/2920) [POST-#2920](https://github.com/CodySwannGT/POST-/issues/2920) [CodySwannGT/lisa#2956](https://github.com/CodySwannGT/lisa/issues/2956)

### [3.66.1](https://github.com/CodySwannGT/lisa/compare/v3.66.0...v3.66.1) (2026-08-23)


### Performance Improvements

* **ci:** move the whole-list bite to weekly, and size its deadlines for that ([6bd5935](https://github.com/CodySwannGT/lisa/commit/6bd5935374444f1551742d24cffd324bd17e0365)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [#2989](https://github.com/CodySwannGT/lisa/issues/2989) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)

## [3.66.0](https://github.com/CodySwannGT/lisa/compare/v3.65.5...v3.66.0) (2026-08-23)


### Features

* **gates:** close the four unmet criteria from the hardcoded-invocation work ([b253d91](https://github.com/CodySwannGT/lisa/commit/b253d9196bb08692ca73cdcb73ac3f413d84c2bf)), closes [#2838](https://github.com/CodySwannGT/lisa/issues/2838) [#2955](https://github.com/CodySwannGT/lisa/issues/2955) [#2929](https://github.com/CodySwannGT/lisa/issues/2929) [CodySwannGT/lisa#2955](https://github.com/CodySwannGT/lisa/issues/2955)


### Bug Fixes

* **tests:** anchor the narration keyword match and key coverage by moment ([d8ea884](https://github.com/CodySwannGT/lisa/commit/d8ea8847df18fc3200921417500ac6e331f0520b)), closes [#2977](https://github.com/CodySwannGT/lisa/issues/2977) [CodySwannGT/lisa#2955](https://github.com/CodySwannGT/lisa/issues/2955)

### [3.65.5](https://github.com/CodySwannGT/lisa/compare/v3.65.4...v3.65.5) (2026-08-23)


### Documentation

* **mutation:** the split is exonerated by a third sample; the runtime is not ([f19fe25](https://github.com/CodySwannGT/lisa/commit/f19fe252fe1b80044c8e298fd10249b43053f2e2)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [#2990](https://github.com/CodySwannGT/lisa/issues/2990) [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [#2989](https://github.com/CodySwannGT/lisa/issues/2989) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **mutation:** the split's wall-clock cost is unmeasured, not zero ([c4452da](https://github.com/CodySwannGT/lisa/commit/c4452da54b07b09d7bd11bda22874c7da8f475c6)), closes [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)

### [3.65.4](https://github.com/CodySwannGT/lisa/compare/v3.65.3...v3.65.4) (2026-08-23)


### Documentation

* **mutation:** retract the split's wall-clock claim from the code, not just the issue ([05238dd](https://github.com/CodySwannGT/lisa/commit/05238dd6760fffeca0654bbc370d4c5669838848)), closes [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)

### [3.65.3](https://github.com/CodySwannGT/lisa/compare/v3.65.2...v3.65.3) (2026-08-23)


### Documentation

* **mutation:** correct the budget's multiple against its second sample ([8dfabd5](https://github.com/CodySwannGT/lisa/commit/8dfabd59c76cbc35bbc40984e2a35399cb441586)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [#2989](https://github.com/CodySwannGT/lisa/issues/2989) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **mutation:** name the option the deadline is actually passed as ([3221dc2](https://github.com/CodySwannGT/lisa/commit/3221dc2b22c3730c244becb795befe69e0a458d0)), closes [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **mutation:** size the single-guard budget against the job it runs in ([85977b2](https://github.com/CodySwannGT/lisa/commit/85977b2db6e5913c4bd41e36428072692fbb69e0)), closes [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)

### [3.65.2](https://github.com/CodySwannGT/lisa/compare/v3.65.1...v3.65.2) (2026-08-23)

### [3.65.1](https://github.com/CodySwannGT/lisa/compare/v3.65.0...v3.65.1) (2026-08-23)

## [3.65.0](https://github.com/CodySwannGT/lisa/compare/v3.64.4...v3.65.0) (2026-08-23)


### Features

* **ci:** assert workflow package paths exist in released packages ([feea82d](https://github.com/CodySwannGT/lisa/commit/feea82db633e82ee8cae578612c277061cde6b1a)), closes [#2951](https://github.com/CodySwannGT/lisa/issues/2951) [#2951](https://github.com/CodySwannGT/lisa/issues/2951) [CodySwannGT/lisa#2960](https://github.com/CodySwannGT/lisa/issues/2960) [CodySwannGT/lisa#2960](https://github.com/CodySwannGT/lisa/issues/2960)

### [3.64.4](https://github.com/CodySwannGT/lisa/compare/v3.64.3...v3.64.4) (2026-08-23)


### Bug Fixes

* **gates:** report a failure nobody could read as unproved, not as failed ([ec01098](https://github.com/CodySwannGT/lisa/commit/ec01098ed3c99ef27f4be4f3bd2a42d8051f487d)), closes [CodySwannGT/lisa#2961](https://github.com/CodySwannGT/lisa/issues/2961)
* **tests:** pin the coverage reporter the debris case reads ([d4b0d51](https://github.com/CodySwannGT/lisa/commit/d4b0d512bddc902f50f0fcf686140ff1b772910c)), closes [CodySwannGT/lisa#2961](https://github.com/CodySwannGT/lisa/issues/2961)

### [3.64.3](https://github.com/CodySwannGT/lisa/compare/v3.64.2...v3.64.3) (2026-08-23)


### Bug Fixes

* **scratch:** remove a run's own root when its worker is reaped ([4d43113](https://github.com/CodySwannGT/lisa/commit/4d43113f929ce543e8075e1f47756b98cf415eba)), closes [CodySwannGT/lisa#2886](https://github.com/CodySwannGT/lisa/issues/2886) [CodySwannGT/lisa#2950](https://github.com/CodySwannGT/lisa/issues/2950) [CodySwannGT/lisa#2950](https://github.com/CodySwannGT/lisa/issues/2950)
* **sync:** honour a recorded mutation-floor divergence instead of blocking it ([bc32f2f](https://github.com/CodySwannGT/lisa/commit/bc32f2f1399d9ff56896182044fb3d9d275a0276)), closes [CodySwannGT/lisa#2968](https://github.com/CodySwannGT/lisa/issues/2968)
* **sync:** refuse to sync a mutation floor that disagrees with the config ([c7fe7df](https://github.com/CodySwannGT/lisa/commit/c7fe7df7b05eaafbe5dea5b2d6d31d7e1e10d1bd)), closes [CodySwannGT/lisa#2968](https://github.com/CodySwannGT/lisa/issues/2968)

### [3.64.2](https://github.com/CodySwannGT/lisa/compare/v3.64.1...v3.64.2) (2026-08-23)


### Bug Fixes

* **package-lisa:** let force win when a key is also listed as adoptable ([1d55166](https://github.com/CodySwannGT/lisa/commit/1d55166852dd82e7209fa5f8f73c30c5dc323080)), closes [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952) [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952)
* **package-lisa:** make governed gate scripts host composition points ([dcb4959](https://github.com/CodySwannGT/lisa/commit/dcb4959952cbcc62157d31ba8296fb6ba1d95bc3)), closes [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952) [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952)
* **package-lisa:** pin the version that performed the apply ([bab8e41](https://github.com/CodySwannGT/lisa/commit/bab8e41813835305231304950f46ed8b381167f6)), closes [CodySwannGT/lisa#2953](https://github.com/CodySwannGT/lisa/issues/2953) [CodySwannGT/lisa#2953](https://github.com/CodySwannGT/lisa/issues/2953)
* **package-lisa:** report an adopt migration as a handover, not a loss ([be3651e](https://github.com/CodySwannGT/lisa/commit/be3651e00b009c4c4fd218209c50e9f5c4c40765)), closes [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952) [CodySwannGT/lisa#2952](https://github.com/CodySwannGT/lisa/issues/2952)

### [3.64.1](https://github.com/CodySwannGT/lisa/compare/v3.64.0...v3.64.1) (2026-08-23)

## [3.64.0](https://github.com/CodySwannGT/lisa/compare/v3.63.0...v3.64.0) (2026-08-23)


### Features

* **ci:** fail a presence-gated job that finds neither script nor declaration ([0b23bd8](https://github.com/CodySwannGT/lisa/commit/0b23bd88daac08215578352b5b80467357b08d69)), closes [#2929](https://github.com/CodySwannGT/lisa/issues/2929) [CodySwannGT/lisa#2929](https://github.com/CodySwannGT/lisa/issues/2929)

## [3.63.0](https://github.com/CodySwannGT/lisa/compare/v3.62.0...v3.63.0) (2026-08-23)


### Features

* **governance:** generate the base ruleset from config and wire the reconciler ([ff870d3](https://github.com/CodySwannGT/lisa/commit/ff870d3b3852f4ecd4bda6d5ecf94e67b78f65f5)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)


### Bug Fixes

* **gates:** merge both halves of the resolveMoment return type ([88351d3](https://github.com/CodySwannGT/lisa/commit/88351d315de09bff3a1a0449dc46e862b432bfed)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **gates:** stop the executor sweep reporting an awaited gate as an orphan ([95cd29a](https://github.com/CodySwannGT/lisa/commit/95cd29a10d56aa1962daf658f1bcd7ba85d5a333)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **governance:** address six review findings on the config-owned ruleset ([ff4c26a](https://github.com/CodySwannGT/lisa/commit/ff4c26a357fa486e0fc0c90892af77a7163b8af2)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **health:** read the generated base ruleset, not just the shipped templates ([d7d63bf](https://github.com/CodySwannGT/lisa/commit/d7d63bf6093ac4e2d998957750d6ca4fed19c562)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)


### Performance Improvements

* **ci:** move the whole-list mutation bite case off the pull-request path ([5b41030](https://github.com/CodySwannGT/lisa/commit/5b410306886e8d906c7f406537e2b8be20f853b0)), closes [CodySwannGT/lisa#2966](https://github.com/CodySwannGT/lisa/issues/2966)


### Documentation

* **governance:** point the promotion ledger at where the vendor checks are declared ([e4135fa](https://github.com/CodySwannGT/lisa/commit/e4135faffbe22058d15adda26458ae0dbed7f949)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)

## [3.62.0](https://github.com/CodySwannGT/lisa/compare/v3.61.0...v3.62.0) (2026-08-23)


### Features

* **governance:** generate the base ruleset from config and wire the reconciler ([ff870d3](https://github.com/CodySwannGT/lisa/commit/ff870d3b3852f4ecd4bda6d5ecf94e67b78f65f5)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)


### Bug Fixes

* **gates:** merge both halves of the resolveMoment return type ([88351d3](https://github.com/CodySwannGT/lisa/commit/88351d315de09bff3a1a0449dc46e862b432bfed)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **gates:** stop the executor sweep reporting an awaited gate as an orphan ([95cd29a](https://github.com/CodySwannGT/lisa/commit/95cd29a10d56aa1962daf658f1bcd7ba85d5a333)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **governance:** address six review findings on the config-owned ruleset ([ff4c26a](https://github.com/CodySwannGT/lisa/commit/ff4c26a357fa486e0fc0c90892af77a7163b8af2)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **health:** read the generated base ruleset, not just the shipped templates ([d7d63bf](https://github.com/CodySwannGT/lisa/commit/d7d63bf6093ac4e2d998957750d6ca4fed19c562)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)
* **tests:** bound the work-item fixture children the mutation gate spawns ([02938cd](https://github.com/CodySwannGT/lisa/commit/02938cd956ef3869b8769442a73b1381ffbc9d66)), closes [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)


### Documentation

* **governance:** point the promotion ledger at where the vendor checks are declared ([e4135fa](https://github.com/CodySwannGT/lisa/commit/e4135faffbe22058d15adda26458ae0dbed7f949)), closes [CodySwannGT/lisa#2917](https://github.com/CodySwannGT/lisa/issues/2917)

## [3.61.0](https://github.com/CodySwannGT/lisa/compare/v3.60.0...v3.61.0) (2026-08-23)


### Features

* **gates:** let one gate have two provers without either faking a proof ([45dd396](https://github.com/CodySwannGT/lisa/commit/45dd3962de71a5542d3fc48744928d3bdf39a00b)), closes [#2841](https://github.com/CodySwannGT/lisa/issues/2841) [CodySwannGT/lisa#2915](https://github.com/CodySwannGT/lisa/issues/2915)
* **gates:** record the second prover in the shipped invocation inventory ([f37def8](https://github.com/CodySwannGT/lisa/commit/f37def8f7aa37c9d4ccc87873f190f7ab46a5160)), closes [CodySwannGT/lisa#2915](https://github.com/CodySwannGT/lisa/issues/2915)


### Bug Fixes

* **gates:** pick a gate's representative job by rule, not by table order ([e0b995a](https://github.com/CodySwannGT/lisa/commit/e0b995ae29d5ea4539a7c526fac3f2308f1b9115)), closes [CodySwannGT/lisa#2915](https://github.com/CodySwannGT/lisa/issues/2915)

## [3.60.0](https://github.com/CodySwannGT/lisa/compare/v3.59.2...v3.60.0) (2026-08-23)


### Features

* **gates:** rename three vendor-named labels and declare the rename in the registry ([6e95d48](https://github.com/CodySwannGT/lisa/commit/6e95d48cba875e740cb8bdd71bb45644b87f485c)), closes [CodySwannGT/lisa#2859](https://github.com/CodySwannGT/lisa/issues/2859)


### Bug Fixes

* **tests:** exempt a mention-only suite by name, not by a spawn heuristic ([b9b8807](https://github.com/CodySwannGT/lisa/commit/b9b88070e967a4e3b1aedae82a2ba5158edc73cf)), closes [CodySwannGT/lisa#2859](https://github.com/CodySwannGT/lisa/issues/2859)


### Documentation

* **ci:** correct the e2e-native façade comment after the label rename ([aed174a](https://github.com/CodySwannGT/lisa/commit/aed174a512b79f2c7a2a18daf629c6c8dc8926ff)), closes [CodySwannGT/lisa#2859](https://github.com/CodySwannGT/lisa/issues/2859)

### [3.59.2](https://github.com/CodySwannGT/lisa/compare/v3.59.1...v3.59.2) (2026-08-23)


### Bug Fixes

* **gates:** resolve a gate through the prover its template already ships ([6675a3d](https://github.com/CodySwannGT/lisa/commit/6675a3d8b9d87cc58498b34eb823f11886f611bf)), closes [#2916](https://github.com/CodySwannGT/lisa/issues/2916) [#2832](https://github.com/CodySwannGT/lisa/issues/2832) [#2916](https://github.com/CodySwannGT/lisa/issues/2916) [#2832](https://github.com/CodySwannGT/lisa/issues/2832) [CodySwannGT/lisa#2916](https://github.com/CodySwannGT/lisa/issues/2916)

### [3.59.1](https://github.com/CodySwannGT/lisa/compare/v3.59.0...v3.59.1) (2026-08-23)


### Bug Fixes

* **ci:** search the packaged prover at both released layouts ([9f643ea](https://github.com/CodySwannGT/lisa/commit/9f643ea6092238645a9689dadacd9aa607e31229)), closes [CodySwannGT/lisa#2951](https://github.com/CodySwannGT/lisa/issues/2951)
* **ci:** tell the prover which tree to scan, not just where it lives ([d04728b](https://github.com/CodySwannGT/lisa/commit/d04728b04f2e62f4994992b31c946f5aa012677e)), closes [#2951](https://github.com/CodySwannGT/lisa/issues/2951) [#2959](https://github.com/CodySwannGT/lisa/issues/2959) [CodySwannGT/lisa#2951](https://github.com/CodySwannGT/lisa/issues/2951)

## [3.59.0](https://github.com/CodySwannGT/lisa/compare/v3.58.0...v3.59.0) (2026-08-23)


### Features

* **gates:** make the agent tool boundary a declarable moment ([07fb3d4](https://github.com/CodySwannGT/lisa/commit/07fb3d4ca8d430b5165a4ac902c4f219043ef375)), closes [CodySwannGT/lisa#2839](https://github.com/CodySwannGT/lisa/issues/2839)


### Bug Fixes

* **ci:** emit the gate id before the early exit in the ratchet façade ([20fd61e](https://github.com/CodySwannGT/lisa/commit/20fd61ed09742064ddffc3e6ee4bfc659061c7c3)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **ci:** extend the façade contract to the eight jobs added during the merge ([0085637](https://github.com/CodySwannGT/lisa/commit/0085637ec292befff5c18a1078907b9ca66122e8)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **gates:** declare the two edit-moment gates as exceptions to the task contract ([39381e6](https://github.com/CodySwannGT/lisa/commit/39381e6ee691a1852dbd0293066c6953e9ea8106)), closes [CodySwannGT/lisa#2839](https://github.com/CodySwannGT/lisa/issues/2839)
* **gates:** give one orphan declaration an executor and withdraw the other ([c2e8c23](https://github.com/CodySwannGT/lisa/commit/c2e8c23ea20762332b8fd9f985d4b6eea6bc17e5)), closes [#2842](https://github.com/CodySwannGT/lisa/issues/2842) [CodySwannGT/lisa#2843](https://github.com/CodySwannGT/lisa/issues/2843)
* **gates:** hoist the knip task literal the merge took to three occurrences ([a540f8d](https://github.com/CodySwannGT/lisa/commit/a540f8dc851c27fa3914fd7c445605ca8c15472f)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **gates:** keep the unconfigured report from failing the job it reports on ([d3500d8](https://github.com/CodySwannGT/lisa/commit/d3500d883cf76858ca522706d2a1a46b2351ade8)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **gates:** report and seed the declarations the checks run without ([d2c342a](https://github.com/CodySwannGT/lisa/commit/d2c342ad9d885833cf2c8d36ca8574b8586cd1a0)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **gates:** retire the exception the shipped task made false ([3885d6a](https://github.com/CodySwannGT/lisa/commit/3885d6a411e57e5fd5bd830c1e019574a7e5c268)), closes [CodySwannGT/lisa#2843](https://github.com/CodySwannGT/lisa/issues/2843)
* **tests:** derive hook rosters from the filesystem so the sandbox can see them ([146c6ba](https://github.com/CodySwannGT/lisa/commit/146c6ba08ff52f8aaa50545a9b0020a291a44e32)), closes [CodySwannGT/lisa#2839](https://github.com/CodySwannGT/lisa/issues/2839)
* **tests:** key the truncation check on ENOBUFS, not on a missing exit status ([f8696ad](https://github.com/CodySwannGT/lisa/commit/f8696adc9fe65e417b679549942d79f22070ffd1)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **tests:** read a 128+N exit code as a kill, not as a gate verdict ([3d1ed8b](https://github.com/CodySwannGT/lisa/commit/3d1ed8b9d25593c39e0929f2146694beda22dec4)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **tests:** size the bite-test budget in the unit the case actually runs in ([03a43c9](https://github.com/CodySwannGT/lisa/commit/03a43c9e3272458a4c3019289a10b543fe9c7e96)), closes [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **tests:** stop a truncated capture from passing as the mutation gate's verdict ([6575213](https://github.com/CodySwannGT/lisa/commit/6575213993a852940f0eca945adda368a113ffcf)), closes [#2943](https://github.com/CodySwannGT/lisa/issues/2943) [#2944](https://github.com/CodySwannGT/lisa/issues/2944) [CodySwannGT/lisa#2944](https://github.com/CodySwannGT/lisa/issues/2944)
* **tests:** stop the mutation bite test reading a killed child as a verdict ([7697d4c](https://github.com/CodySwannGT/lisa/commit/7697d4cd74a3c0e28f0b50f10c8b6aadfd7d48c0)), closes [CodySwannGT/lisa#2838](https://github.com/CodySwannGT/lisa/issues/2838)
* **vitest:** bound test scratch space and reclaim it after a kill ([3e8ad11](https://github.com/CodySwannGT/lisa/commit/3e8ad115ebae3866367bb2a60fc058d98b962bd4)), closes [CodySwannGT/lisa#2886](https://github.com/CodySwannGT/lisa/issues/2886)

## [3.58.0](https://github.com/CodySwannGT/lisa/compare/v3.56.0...v3.58.0) (2026-08-22)


### Features

* **ci:** move four job names onto their gate labels and wire the façades ([ec7f102](https://github.com/CodySwannGT/lisa/commit/ec7f1029bf8d3ed63cf0012addf6446e349dae16)), closes [CodySwannGT/lisa#2914](https://github.com/CodySwannGT/lisa/issues/2914)


### Bug Fixes

* **bdd:** let a complete retirement record authorize a coverage reduction on its own ([243bda7](https://github.com/CodySwannGT/lisa/commit/243bda70f01185976ff6bf82774225ad62e67e4f)), closes [CodySwannGT/lisa#2923](https://github.com/CodySwannGT/lisa/issues/2923)
* **tests:** scale every per-case budget, and stop reading a killed gate as a failed one ([658303b](https://github.com/CodySwannGT/lisa/commit/658303b5e290d6962ecb00e0d6af1f068faf5bd2)), closes [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2894](https://github.com/CodySwannGT/lisa/issues/2894) [CodySwannGT/lisa#2897](https://github.com/CodySwannGT/lisa/issues/2897)

## [3.57.0](https://github.com/CodySwannGT/lisa/compare/v3.56.0...v3.57.0) (2026-08-22)


### Features

* **ci:** move four job names onto their gate labels and wire the façades ([ec7f102](https://github.com/CodySwannGT/lisa/commit/ec7f1029bf8d3ed63cf0012addf6446e349dae16)), closes [CodySwannGT/lisa#2914](https://github.com/CodySwannGT/lisa/issues/2914)


### Bug Fixes

* **tests:** scale every per-case budget, and stop reading a killed gate as a failed one ([658303b](https://github.com/CodySwannGT/lisa/commit/658303b5e290d6962ecb00e0d6af1f068faf5bd2)), closes [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2894](https://github.com/CodySwannGT/lisa/issues/2894) [CodySwannGT/lisa#2897](https://github.com/CodySwannGT/lisa/issues/2897)

## [3.56.0](https://github.com/CodySwannGT/lisa/compare/v3.55.0...v3.56.0) (2026-08-22)


### Features

* **gates:** name three properties the registry enforced but could not describe ([609c2c9](https://github.com/CodySwannGT/lisa/commit/609c2c94f7b42e6c9631b150a5d3f5351cabe3bf)), closes [#2930](https://github.com/CodySwannGT/lisa/issues/2930) [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [#2933](https://github.com/CodySwannGT/lisa/issues/2933) [#2841](https://github.com/CodySwannGT/lisa/issues/2841) [CodySwannGT/lisa#2846](https://github.com/CodySwannGT/lisa/issues/2846)


### Bug Fixes

* **tests:** scale every per-case budget, and stop reading a killed gate as a failed one ([658303b](https://github.com/CodySwannGT/lisa/commit/658303b5e290d6962ecb00e0d6af1f068faf5bd2)), closes [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2894](https://github.com/CodySwannGT/lisa/issues/2894) [CodySwannGT/lisa#2897](https://github.com/CodySwannGT/lisa/issues/2897)

## [3.55.0](https://github.com/CodySwannGT/lisa/compare/v3.54.7...v3.55.0) (2026-08-22)


### Features

* **gates:** name three properties the registry enforced but could not describe ([609c2c9](https://github.com/CodySwannGT/lisa/commit/609c2c94f7b42e6c9631b150a5d3f5351cabe3bf)), closes [#2930](https://github.com/CodySwannGT/lisa/issues/2930) [#2932](https://github.com/CodySwannGT/lisa/issues/2932) [#2933](https://github.com/CodySwannGT/lisa/issues/2933) [#2841](https://github.com/CodySwannGT/lisa/issues/2841) [CodySwannGT/lisa#2846](https://github.com/CodySwannGT/lisa/issues/2846)


### Bug Fixes

* **sonar-hook:** make the resolver deadline a seam so the suite stops losing to a node spawn ([f76edbf](https://github.com/CodySwannGT/lisa/commit/f76edbf344ff24e57664816896780c1ea2c7119f)), closes [CodySwannGT/lisa#2905](https://github.com/CodySwannGT/lisa/issues/2905)

### [3.54.7](https://github.com/CodySwannGT/lisa/compare/v3.54.6...v3.54.7) (2026-08-22)


### Bug Fixes

* **ci:** make the threshold ratchet job read its own gate declaration ([105e10a](https://github.com/CodySwannGT/lisa/commit/105e10a6439322454ce5e1bd2aa9dfb4d7f97308)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [#2838](https://github.com/CodySwannGT/lisa/issues/2838) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [#2914](https://github.com/CodySwannGT/lisa/issues/2914) [#2915](https://github.com/CodySwannGT/lisa/issues/2915) [#2921](https://github.com/CodySwannGT/lisa/issues/2921) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [CodySwannGT/lisa#2921](https://github.com/CodySwannGT/lisa/issues/2921)
* **sonar-hook:** make the resolver deadline a seam so the suite stops losing to a node spawn ([f76edbf](https://github.com/CodySwannGT/lisa/commit/f76edbf344ff24e57664816896780c1ea2c7119f)), closes [CodySwannGT/lisa#2905](https://github.com/CodySwannGT/lisa/issues/2905)

### [3.54.6](https://github.com/CodySwannGT/lisa/compare/v3.54.5...v3.54.6) (2026-08-22)


### Bug Fixes

* **ci:** make the threshold ratchet job read its own gate declaration ([105e10a](https://github.com/CodySwannGT/lisa/commit/105e10a6439322454ce5e1bd2aa9dfb4d7f97308)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [#2838](https://github.com/CodySwannGT/lisa/issues/2838) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [#2914](https://github.com/CodySwannGT/lisa/issues/2914) [#2915](https://github.com/CodySwannGT/lisa/issues/2915) [#2921](https://github.com/CodySwannGT/lisa/issues/2921) [#2830](https://github.com/CodySwannGT/lisa/issues/2830) [CodySwannGT/lisa#2921](https://github.com/CodySwannGT/lisa/issues/2921)
* **ci:** stop three quality.yml jobs proving nothing and reporting green ([b22bde8](https://github.com/CodySwannGT/lisa/commit/b22bde8e1bff3bce1dd6a7cbfd36a9093b94367b)), closes [#2841](https://github.com/CodySwannGT/lisa/issues/2841) [CodySwannGT/lisa#2842](https://github.com/CodySwannGT/lisa/issues/2842)
* **work-item:** compare the commit trailer to the branch when unbound ([5d0d97e](https://github.com/CodySwannGT/lisa/commit/5d0d97e8ab15a277e6b375c6e83dd25cccc94416)), closes [CodySwannGT/lisa#2918](https://github.com/CodySwannGT/lisa/issues/2918)

### [3.54.5](https://github.com/CodySwannGT/lisa/compare/v3.54.4...v3.54.5) (2026-08-22)


### Bug Fixes

* **tests:** bound every bdd fixture child so a hang can name itself ([eac1d17](https://github.com/CodySwannGT/lisa/commit/eac1d1717709780057a3381cd91c60361f64f6bd)), closes [CodySwannGT/lisa#2906](https://github.com/CodySwannGT/lisa/issues/2906)

### [3.54.4](https://github.com/CodySwannGT/lisa/compare/v3.54.3...v3.54.4) (2026-08-22)


### Bug Fixes

* **linear-access:** end read_linear_key()'s resolver ladder at the plugin's own copy ([e4d8321](https://github.com/CodySwannGT/lisa/commit/e4d832164e003fbbb89a687330df44c0e67b68ff)), closes [CodySwannGT/lisa#2890](https://github.com/CodySwannGT/lisa/issues/2890)
* **setup-linear:** bring read_linear_key()'s ladder to parity with linear-access ([58b9d24](https://github.com/CodySwannGT/lisa/commit/58b9d2460d32dc1c283c83efce52dad2c0126516)), closes [CodySwannGT/lisa#2890](https://github.com/CodySwannGT/lisa/issues/2890)
* **setup-linear:** name every path tried when the whole ladder misses ([0800445](https://github.com/CodySwannGT/lisa/commit/0800445189206d817010e039ca53705e5a2bb29a)), closes [CodySwannGT/lisa#2890](https://github.com/CodySwannGT/lisa/issues/2890)
* **tests:** calibrate the roster suite's git budget against the machine ([578c4eb](https://github.com/CodySwannGT/lisa/commit/578c4eb96b559a3d22f49b00132a3d68060763a2)), closes [#2894](https://github.com/CodySwannGT/lisa/issues/2894) [CodySwannGT/lisa#2824](https://github.com/CodySwannGT/lisa/issues/2824)
* **tests:** scope the shipped-.mjs gates to what a push carries ([69ad0f2](https://github.com/CodySwannGT/lisa/commit/69ad0f2d04edd2cf8e7d03829dcc78a7c03ac104)), closes [CodySwannGT/lisa#2824](https://github.com/CodySwannGT/lisa/issues/2824)

### [3.54.3](https://github.com/CodySwannGT/lisa/compare/v3.54.2...v3.54.3) (2026-08-22)


### Bug Fixes

* **tests:** move the git-executable import out of the fixture it landed in ([bd81f10](https://github.com/CodySwannGT/lisa/commit/bd81f101ccb98325735acc4d7b18710c9417902b)), closes [CodySwannGT/lisa#2898](https://github.com/CodySwannGT/lisa/issues/2898)
* **tests:** resolve git in the stryker budget guard main added mid-branch ([02a1845](https://github.com/CodySwannGT/lisa/commit/02a1845f1e9f65011207fb8d8345cebe51798210)), closes [CodySwannGT/lisa#2898](https://github.com/CodySwannGT/lisa/issues/2898)


### Performance Improvements

* **git:** resolve git to a binary in the fifty places still using the shim ([76d9b75](https://github.com/CodySwannGT/lisa/commit/76d9b751ef7b98b44b74be37516b0fda7baed8eb)), closes [#2889](https://github.com/CodySwannGT/lisa/issues/2889) [#2887](https://github.com/CodySwannGT/lisa/issues/2887) [#2887](https://github.com/CodySwannGT/lisa/issues/2887) [#2889](https://github.com/CodySwannGT/lisa/issues/2889) [CodySwannGT/lisa#2898](https://github.com/CodySwannGT/lisa/issues/2898)

### [3.54.2](https://github.com/CodySwannGT/lisa/compare/v3.54.1...v3.54.2) (2026-08-22)


### Bug Fixes

* **ci:** delete the duplicate browser job quality.yml never governed ([a94e6ea](https://github.com/CodySwannGT/lisa/commit/a94e6ea2358f019ccdd69e3d330285c9eabbe724)), closes [CodySwannGT/lisa#2867](https://github.com/CodySwannGT/lisa/issues/2867) [CodySwannGT/lisa#2841](https://github.com/CodySwannGT/lisa/issues/2841)

### [3.54.1](https://github.com/CodySwannGT/lisa/compare/v3.54.0...v3.54.1) (2026-08-22)


### Bug Fixes

* **mutation:** keep the new failure blocks inside the shipped ruleset ([003b479](https://github.com/CodySwannGT/lisa/commit/003b479c99b329bbc9c66361469e3508373662dc)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)
* **mutation:** state shipped Stryker timeout budgets, and stop reporting a timeout as a score ([8196937](https://github.com/CodySwannGT/lisa/commit/8196937abb7f98db513ed10e91a07854116ef1d9)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)
* **tests:** calibrate the per-case budgets that override the file-level one ([0f3c6b2](https://github.com/CodySwannGT/lisa/commit/0f3c6b2f6f7315d78f2c64747d71bcdc7dbedb5c)), closes [CodySwannGT/lisa#2888](https://github.com/CodySwannGT/lisa/issues/2888) [CodySwannGT/lisa#2822](https://github.com/CodySwannGT/lisa/issues/2822) [CodySwannGT/lisa#2894](https://github.com/CodySwannGT/lisa/issues/2894)


### Documentation

* **mutation:** say whether each Stryker timeout scales, and what it assumes ([ac94552](https://github.com/CodySwannGT/lisa/commit/ac945521bf15d67ce37c8582d3cc2bfb83de96d9)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)

## [3.54.0](https://github.com/CodySwannGT/lisa/compare/v3.53.0...v3.54.0) (2026-08-22)


### Features

* **doctor:** render the skip_jobs migration and cover the report route ([8d6aead](https://github.com/CodySwannGT/lisa/commit/8d6aead0fdd26a610fb89fda4ecb97e49e2609bf)), closes [CodySwannGT/lisa#2880](https://github.com/CodySwannGT/lisa/issues/2880)


### Bug Fixes

* **mutation:** keep the new failure blocks inside the shipped ruleset ([003b479](https://github.com/CodySwannGT/lisa/commit/003b479c99b329bbc9c66361469e3508373662dc)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)
* **mutation:** state shipped Stryker timeout budgets, and stop reporting a timeout as a score ([8196937](https://github.com/CodySwannGT/lisa/commit/8196937abb7f98db513ed10e91a07854116ef1d9)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)
* **tests:** calibrate the per-case budgets that override the file-level one ([0f3c6b2](https://github.com/CodySwannGT/lisa/commit/0f3c6b2f6f7315d78f2c64747d71bcdc7dbedb5c)), closes [CodySwannGT/lisa#2888](https://github.com/CodySwannGT/lisa/issues/2888) [CodySwannGT/lisa#2822](https://github.com/CodySwannGT/lisa/issues/2822) [CodySwannGT/lisa#2894](https://github.com/CodySwannGT/lisa/issues/2894)


### Documentation

* **mutation:** say whether each Stryker timeout scales, and what it assumes ([ac94552](https://github.com/CodySwannGT/lisa/commit/ac945521bf15d67ce37c8582d3cc2bfb83de96d9)), closes [CodySwannGT/lisa#2826](https://github.com/CodySwannGT/lisa/issues/2826)

## [3.53.0](https://github.com/CodySwannGT/lisa/compare/v3.52.0...v3.53.0) (2026-08-22)


### Features

* **doctor:** hold the gates declaration against the ruleset enforcing it ([7dfeb21](https://github.com/CodySwannGT/lisa/commit/7dfeb21d4ff8bba64da15c2d79537b2e5da4d05d)), closes [CodySwannGT/lisa#2854](https://github.com/CodySwannGT/lisa/issues/2854)
* **doctor:** render the skip_jobs migration and cover the report route ([8d6aead](https://github.com/CodySwannGT/lisa/commit/8d6aead0fdd26a610fb89fda4ecb97e49e2609bf)), closes [CodySwannGT/lisa#2880](https://github.com/CodySwannGT/lisa/issues/2880)

## [3.52.0](https://github.com/CodySwannGT/lisa/compare/v3.51.7...v3.52.0) (2026-08-22)


### Features

* **doctor:** hold the gates declaration against the ruleset enforcing it ([7dfeb21](https://github.com/CodySwannGT/lisa/commit/7dfeb21d4ff8bba64da15c2d79537b2e5da4d05d)), closes [CodySwannGT/lisa#2854](https://github.com/CodySwannGT/lisa/issues/2854)


### Bug Fixes

* **templates:** fail when a stack is handed a tool it is not given ([3ac25d5](https://github.com/CodySwannGT/lisa/commit/3ac25d55e548a8e11dcd79773373a841c35b55b4)), closes [CodySwannGT/lisa#2848](https://github.com/CodySwannGT/lisa/issues/2848)
* **tests:** read the two tool sources this check was guessing at ([d0c3e71](https://github.com/CodySwannGT/lisa/commit/d0c3e715dd2df421528878bb391c537076b5239e)), closes [CodySwannGT/lisa#2848](https://github.com/CodySwannGT/lisa/issues/2848)

### [3.51.7](https://github.com/CodySwannGT/lisa/compare/v3.51.6...v3.51.7) (2026-08-22)


### Bug Fixes

* **gates:** say which registry defaults no template ships, and why ([cceed73](https://github.com/CodySwannGT/lisa/commit/cceed737f5d8c26864f1cc5aaaa954fe9df2e168)), closes [CodySwannGT/lisa#2831](https://github.com/CodySwannGT/lisa/issues/2831)
* **templates:** fail when a stack is handed a tool it is not given ([3ac25d5](https://github.com/CodySwannGT/lisa/commit/3ac25d55e548a8e11dcd79773373a841c35b55b4)), closes [CodySwannGT/lisa#2848](https://github.com/CodySwannGT/lisa/issues/2848)
* **tests:** read the two tool sources this check was guessing at ([d0c3e71](https://github.com/CodySwannGT/lisa/commit/d0c3e715dd2df421528878bb391c537076b5239e)), closes [CodySwannGT/lisa#2848](https://github.com/CodySwannGT/lisa/issues/2848)

### [3.51.6](https://github.com/CodySwannGT/lisa/compare/v3.51.5...v3.51.6) (2026-08-22)


### Bug Fixes

* **tests:** let the measured budget reach the case that most needs it ([25dd972](https://github.com/CodySwannGT/lisa/commit/25dd972c7d271b774961dc01bf04d004d6bcf5a5)), closes [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [CodySwannGT/lisa#2895](https://github.com/CodySwannGT/lisa/issues/2895)

### [3.51.5](https://github.com/CodySwannGT/lisa/compare/v3.51.4...v3.51.5) (2026-08-22)


### Bug Fixes

* **hooks:** pin the reported cross-repo filing, and name the target as typed ([335ab00](https://github.com/CodySwannGT/lisa/commit/335ab005909d22cb6719ac6923457216ab358991)), closes [CodySwannGT/lisa#2899](https://github.com/CodySwannGT/lisa/issues/2899)

### [3.51.4](https://github.com/CodySwannGT/lisa/compare/v3.51.3...v3.51.4) (2026-08-22)


### Documentation

* **skills:** stop documenting the Sonar MCP as the only valid substrate ([0b5889e](https://github.com/CodySwannGT/lisa/commit/0b5889ef498b7014b844fc1fbeb2edc8dd60ba32)), closes [CodySwannGT/lisa#2878](https://github.com/CodySwannGT/lisa/issues/2878)

### [3.51.3](https://github.com/CodySwannGT/lisa/compare/v3.51.2...v3.51.3) (2026-08-22)


### Bug Fixes

* **hooks:** do not claim a cross-repo target the guard cannot prove ([d225bf7](https://github.com/CodySwannGT/lisa/commit/d225bf78412704f6eadcac287ccbf2c73e40965a)), closes [CodySwannGT/lisa#2850](https://github.com/CodySwannGT/lisa/issues/2850)
* **hooks:** judge a filing by the target repository's ready role ([e8d081b](https://github.com/CodySwannGT/lisa/commit/e8d081bb02c0809b5e8bddabe608c2bcfcade2ff)), closes [CodySwannGT/lisa#2850](https://github.com/CodySwannGT/lisa/issues/2850)

### [3.51.2](https://github.com/CodySwannGT/lisa/compare/v3.51.1...v3.51.2) (2026-08-22)


### Performance Improvements

* **tests:** stop the bdd fixtures dispatching git through the xcrun shim ([db8e621](https://github.com/CodySwannGT/lisa/commit/db8e621cbe64c7b8a1f2a82eae32accada4c15e4)), closes [#2883](https://github.com/CodySwannGT/lisa/issues/2883) [CodySwannGT/lisa#2887](https://github.com/CodySwannGT/lisa/issues/2887)

### [3.51.1](https://github.com/CodySwannGT/lisa/compare/v3.51.0...v3.51.1) (2026-08-22)


### Bug Fixes

* **tests:** size the suite's liveness budgets from an untruncated measurement ([45828c3](https://github.com/CodySwannGT/lisa/commit/45828c3e2925f35f4604e7e9969f7ee157383daa)), closes [#2522](https://github.com/CodySwannGT/lisa/issues/2522) [#2522](https://github.com/CodySwannGT/lisa/issues/2522) [#2522](https://github.com/CodySwannGT/lisa/issues/2522) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2829](https://github.com/CodySwannGT/lisa/issues/2829) [CodySwannGT/lisa#2885](https://github.com/CodySwannGT/lisa/issues/2885)

## [3.51.0](https://github.com/CodySwannGT/lisa/compare/v3.50.0...v3.51.0) (2026-08-21)


### Features

* **ci:** give the Android arm the per-flow retry the iOS arm already has ([1b9770a](https://github.com/CodySwannGT/lisa/commit/1b9770a70098f2970f67182cea48efc774633906)), closes [#2856](https://github.com/CodySwannGT/lisa/issues/2856) [CodySwannGT/lisa#2882](https://github.com/CodySwannGT/lisa/issues/2882)

## [3.50.0](https://github.com/CodySwannGT/lisa/compare/v3.49.0...v3.50.0) (2026-08-21)


### Features

* **doctor:** make the gate report a console tab that attributes every finding ([9147245](https://github.com/CodySwannGT/lisa/commit/9147245be2ec55e1d6fd04ff4deb48fb5b0a246a)), closes [CodySwannGT/lisa#2860](https://github.com/CodySwannGT/lisa/issues/2860)

## [3.49.0](https://github.com/CodySwannGT/lisa/compare/v3.48.7...v3.49.0) (2026-08-21)


### Features

* **doctor:** make the gate report a console tab that attributes every finding ([9147245](https://github.com/CodySwannGT/lisa/commit/9147245be2ec55e1d6fd04ff4deb48fb5b0a246a)), closes [CodySwannGT/lisa#2860](https://github.com/CodySwannGT/lisa/issues/2860)


### Bug Fixes

* **doctor:** derive the hook copy roster instead of writing it down ([eb51511](https://github.com/CodySwannGT/lisa/commit/eb51511542e06ea29172a54ac53dfe1796e0fd3f)), closes [CodySwannGT/lisa#2847](https://github.com/CodySwannGT/lisa/issues/2847)
* **tests:** budget spawn-heavy suites in units of the machine, not the clock ([475e9d2](https://github.com/CodySwannGT/lisa/commit/475e9d221eb0f512f58aba44b136fdfb556e85bf)), closes [#2867](https://github.com/CodySwannGT/lisa/issues/2867) [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [CodySwannGT/lisa#2822](https://github.com/CodySwannGT/lisa/issues/2822)

### [3.48.7](https://github.com/CodySwannGT/lisa/compare/v3.48.6...v3.48.7) (2026-08-21)


### Bug Fixes

* **doctor:** derive the hook copy roster instead of writing it down ([eb51511](https://github.com/CodySwannGT/lisa/commit/eb51511542e06ea29172a54ac53dfe1796e0fd3f)), closes [CodySwannGT/lisa#2847](https://github.com/CodySwannGT/lisa/issues/2847)
* **gates:** name the input that staled the manifest, not the manifest ([a6690de](https://github.com/CodySwannGT/lisa/commit/a6690dedc702f9f4b968894f4c98478272980ed9)), closes [CodySwannGT/lisa#2852](https://github.com/CodySwannGT/lisa/issues/2852)
* **tests:** budget spawn-heavy suites in units of the machine, not the clock ([475e9d2](https://github.com/CodySwannGT/lisa/commit/475e9d221eb0f512f58aba44b136fdfb556e85bf)), closes [#2867](https://github.com/CodySwannGT/lisa/issues/2867) [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [#2822](https://github.com/CodySwannGT/lisa/issues/2822) [CodySwannGT/lisa#2822](https://github.com/CodySwannGT/lisa/issues/2822)

### [3.48.6](https://github.com/CodySwannGT/lisa/compare/v3.48.5...v3.48.6) (2026-08-21)


### Bug Fixes

* **gates:** name the input that staled the manifest, not the manifest ([a6690de](https://github.com/CodySwannGT/lisa/commit/a6690dedc702f9f4b968894f4c98478272980ed9)), closes [CodySwannGT/lisa#2852](https://github.com/CodySwannGT/lisa/issues/2852)
* **hooks:** name every commit-msg gate family on any refusal ([284977a](https://github.com/CodySwannGT/lisa/commit/284977a4f3f7bcabf3e0619b13fabf57ac0552a1)), closes [CodySwannGT/lisa#2840](https://github.com/CodySwannGT/lisa/issues/2840)

### [3.48.5](https://github.com/CodySwannGT/lisa/compare/v3.48.4...v3.48.5) (2026-08-21)


### Bug Fixes

* **ci:** reconcile the live ruleset with the template it derives from ([e570ac9](https://github.com/CodySwannGT/lisa/commit/e570ac9502c1ccfc3d3fe661e2fbeba456fc10c0)), closes [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [CodySwannGT/lisa#2828](https://github.com/CodySwannGT/lisa/issues/2828)

### [3.48.4](https://github.com/CodySwannGT/lisa/compare/v3.48.3...v3.48.4) (2026-08-21)


### Bug Fixes

* **gates:** collect the integration tree once per push, for consumers too ([60936af](https://github.com/CodySwannGT/lisa/commit/60936af243b929227d721e1755efd09ba8e76f67)), closes [CodySwannGT/lisa#2827](https://github.com/CodySwannGT/lisa/issues/2827)

### [3.48.3](https://github.com/CodySwannGT/lisa/compare/v3.48.2...v3.48.3) (2026-08-21)


### Bug Fixes

* **gates:** declare the two contexts GitHub already requires ([109fd27](https://github.com/CodySwannGT/lisa/commit/109fd276e010b615eb8eaccdf1be57d5a0532e3a)), closes [#2862](https://github.com/CodySwannGT/lisa/issues/2862) [#2861](https://github.com/CodySwannGT/lisa/issues/2861) [#2829](https://github.com/CodySwannGT/lisa/issues/2829) [CodySwannGT/lisa#2865](https://github.com/CodySwannGT/lisa/issues/2865)

### [3.48.2](https://github.com/CodySwannGT/lisa/compare/v3.48.1...v3.48.2) (2026-08-21)


### Bug Fixes

* **doctor:** merge a gate declaration instead of replacing it ([11ec4de](https://github.com/CodySwannGT/lisa/commit/11ec4de260bf636e59eff490544633f879afa01d)), closes [CodySwannGT/lisa#2810](https://github.com/CodySwannGT/lisa/issues/2810)
* **doctor:** ship the traceability gate's task, and never recommend one Lisa cannot run ([24417eb](https://github.com/CodySwannGT/lisa/commit/24417eb318002153017350e37483d93ab2b37ef0)), closes [CodySwannGT/lisa#2810](https://github.com/CodySwannGT/lisa/issues/2810)

### [3.48.1](https://github.com/CodySwannGT/lisa/compare/v3.48.0...v3.48.1) (2026-08-21)


### Documentation

* **work-item:** say that gate 2 is listed and no longer enforced ([d3107a4](https://github.com/CodySwannGT/lisa/commit/d3107a4745dbd502cb4c5da5fdf42d1308f82099)), closes [#2681](https://github.com/CodySwannGT/lisa/issues/2681) [CodySwannGT/lisa#2821](https://github.com/CodySwannGT/lisa/issues/2821)

## [3.48.0](https://github.com/CodySwannGT/lisa/compare/v3.47.10...v3.48.0) (2026-08-21)


### Features

* **doctor:** derive the gate report instead of writing it ([34eb91d](https://github.com/CodySwannGT/lisa/commit/34eb91d49fe1823a9553db34d8b9ea2d08b48cdb)), closes [CodySwannGT/lisa#2860](https://github.com/CodySwannGT/lisa/issues/2860)
* **doctor:** render the gate report as a standalone page ([cacab03](https://github.com/CodySwannGT/lisa/commit/cacab03c2d11c11cdcc9e7542d0ce6dd0a9834a9)), closes [CodySwannGT/lisa#2860](https://github.com/CodySwannGT/lisa/issues/2860)


### Documentation

* **work-item:** say that gate 2 is listed and no longer enforced ([d3107a4](https://github.com/CodySwannGT/lisa/commit/d3107a4745dbd502cb4c5da5fdf42d1308f82099)), closes [#2681](https://github.com/CodySwannGT/lisa/issues/2681) [CodySwannGT/lisa#2821](https://github.com/CodySwannGT/lisa/issues/2821)

### [3.47.10](https://github.com/CodySwannGT/lisa/compare/v3.47.9...v3.47.10) (2026-08-21)


### Bug Fixes

* **ci:** make slow lint and dead-code detection block the merge, not just the push ([f73935c](https://github.com/CodySwannGT/lisa/commit/f73935cfe879c5f5c6cb21e0d0c9c04cebd453c5)), closes [#2496](https://github.com/CodySwannGT/lisa/issues/2496) [#2843](https://github.com/CodySwannGT/lisa/issues/2843) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2854](https://github.com/CodySwannGT/lisa/issues/2854) [#2829](https://github.com/CodySwannGT/lisa/issues/2829) [#2828](https://github.com/CodySwannGT/lisa/issues/2828) [CodySwannGT/lisa#2861](https://github.com/CodySwannGT/lisa/issues/2861)

### [3.47.9](https://github.com/CodySwannGT/lisa/compare/v3.47.8...v3.47.9) (2026-08-21)


### Bug Fixes

* **work-item:** make tracker validation optional, and delete the claim gate ([e6442b9](https://github.com/CodySwannGT/lisa/commit/e6442b9496fcb718a77ddd0faa592bd097c49ae0)), closes [CodySwannGT/lisa#2821](https://github.com/CodySwannGT/lisa/issues/2821)


### Code Refactoring

* **work-item:** drop the lifecycle set the claim check was its only reader ([f9bc24a](https://github.com/CodySwannGT/lisa/commit/f9bc24afb599df7d44df73cc6c64d3211aa1ea68)), closes [CodySwannGT/lisa#2821](https://github.com/CodySwannGT/lisa/issues/2821)

### [3.47.8](https://github.com/CodySwannGT/lisa/compare/v3.47.7...v3.47.8) (2026-08-20)


### Bug Fixes

* **apply:** classify a Lisa-owned copy on every route, not one ([47daeac](https://github.com/CodySwannGT/lisa/commit/47daeac25defab367e01909da29c7af996199713)), closes [CodySwannGT/lisa#2577](https://github.com/CodySwannGT/lisa/issues/2577)
* **apply:** keep a Lisa-owned copy that could not be read at all ([6150bf8](https://github.com/CodySwannGT/lisa/commit/6150bf8ccfeaad5f84007a429a9df6f8672c5bdf)), closes [#2833](https://github.com/CodySwannGT/lisa/issues/2833) [CodySwannGT/lisa#2577](https://github.com/CodySwannGT/lisa/issues/2577)
* **maestro:** retry the failed flows, not the whole suite ([6f61197](https://github.com/CodySwannGT/lisa/commit/6f61197bfbfb7b918ce2075849068b4dd46ddb2b)), closes [CodySwannGT/lisa#2849](https://github.com/CodySwannGT/lisa/issues/2849)

### [3.47.7](https://github.com/CodySwannGT/lisa/compare/v3.47.6...v3.47.7) (2026-08-20)


### Bug Fixes

* **automations:** quarantine a row the ledger cannot read, and say so ([3671919](https://github.com/CodySwannGT/lisa/commit/367191957aa68155fd6326fb326ad8570f009419)), closes [#2682](https://github.com/CodySwannGT/lisa/issues/2682) [CodySwannGT/lisa#2578](https://github.com/CodySwannGT/lisa/issues/2578)

### [3.47.6](https://github.com/CodySwannGT/lisa/compare/v3.47.5...v3.47.6) (2026-08-20)


### Bug Fixes

* **ci:** make the Maestro suite-scope marker decidable ([72a443a](https://github.com/CodySwannGT/lisa/commit/72a443a6e4086f3a439c96ef01a18ff3812cf2d9)), closes [CodySwannGT/lisa#2819](https://github.com/CodySwannGT/lisa/issues/2819)
* **ci:** pin bun in the one quality job that floats to latest ([1aa8a78](https://github.com/CodySwannGT/lisa/commit/1aa8a78b39d30c3d9b71df3d1b08fc4f0cf45be9)), closes [CodySwannGT/lisa#2836](https://github.com/CodySwannGT/lisa/issues/2836)
* **eslint:** declaring a typed axis arms the design rule, which nothing did ([ec779d8](https://github.com/CodySwannGT/lisa/commit/ec779d89f97ed87598a844697569d1b951c4eeb4)), closes [#2802](https://github.com/CodySwannGT/lisa/issues/2802) [CodySwannGT/lisa#2807](https://github.com/CodySwannGT/lisa/issues/2807)
* **gates:** say WHICH failure it was, and stop calling unknown "skipped" ([55fbec4](https://github.com/CodySwannGT/lisa/commit/55fbec44f2ee789c399f5e3260902203200d6d3c)), closes [CodySwannGT/lisa#2813](https://github.com/CodySwannGT/lisa/issues/2813)
* **gates:** split the passes CI already splits, and say whose failure it was ([7eeea1b](https://github.com/CodySwannGT/lisa/commit/7eeea1b9dbd0fbe603ab9db975760c0d652a96d9)), closes [CodySwannGT/lisa#2813](https://github.com/CodySwannGT/lisa/issues/2813)
* **gates:** the transcript parser must not backtrack over the transcript ([0d46391](https://github.com/CodySwannGT/lisa/commit/0d4639147382e3cfa05e5505c61c73499d0331ee)), closes [CodySwannGT/lisa#2813](https://github.com/CodySwannGT/lisa/issues/2813)
* **guard:** catch the host-name shape that was 100% of the live problem ([6ee740a](https://github.com/CodySwannGT/lisa/commit/6ee740a5fc97fa39f03207a2853e5899404e40a6)), closes [CodySwannGT/lisa#2783](https://github.com/CodySwannGT/lisa/issues/2783) [CodySwannGT/lisa#2783](https://github.com/CodySwannGT/lisa/issues/2783)
* **mutation:** give the dry run a budget the machine can actually meet ([11d22cd](https://github.com/CodySwannGT/lisa/commit/11d22cdda2b76ea7617cba03e0ca02e3df1a8b5c)), closes [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [#2823](https://github.com/CodySwannGT/lisa/issues/2823) [CodySwannGT/lisa#2813](https://github.com/CodySwannGT/lisa/issues/2813)
* **mutation:** run the diff-only gate this repository ships ([ecc3058](https://github.com/CodySwannGT/lisa/commit/ecc305867ef5ddf37cb0a918e5d95fa0addb7587)), closes [CodySwannGT/lisa#2823](https://github.com/CodySwannGT/lisa/issues/2823)
* **work-item:** count five traceability gates, not four, and say so earliest ([24a0976](https://github.com/CodySwannGT/lisa/commit/24a09767807a2eb58682271da1b15bede3280592)), closes [#2817](https://github.com/CodySwannGT/lisa/issues/2817) [#2681](https://github.com/CodySwannGT/lisa/issues/2681) [CodySwannGT/lisa#2681](https://github.com/CodySwannGT/lisa/issues/2681)


### Code Refactoring

* **work-item:** drop an unreachable guard in withGateSummary ([ab41d81](https://github.com/CodySwannGT/lisa/commit/ab41d81e8c7228f72191523fed4fb07befb9b610)), closes [CodySwannGT/lisa#2681](https://github.com/CodySwannGT/lisa/issues/2681)

### [3.47.5](https://github.com/CodySwannGT/lisa/compare/v3.47.4...v3.47.5) (2026-08-20)


### Bug Fixes

* **schema:** the keyword allowlist checks a keyword's form, not just its name ([2b816d5](https://github.com/CodySwannGT/lisa/commit/2b816d57d72e1915d1117067ed111d5143aaad7a)), closes [CodySwannGT/lisa#2791](https://github.com/CodySwannGT/lisa/issues/2791)

### [3.47.4](https://github.com/CodySwannGT/lisa/compare/v3.47.3...v3.47.4) (2026-08-20)

### [3.47.3](https://github.com/CodySwannGT/lisa/compare/v3.47.2...v3.47.3) (2026-08-20)


### Bug Fixes

* **scripts:** the entry-guard sweep sees scripts/, and sees it either way round ([836a300](https://github.com/CodySwannGT/lisa/commit/836a300ccdef48edf22ae90e94fe209fd732d7f8)), closes [CodySwannGT/lisa#2793](https://github.com/CodySwannGT/lisa/issues/2793)

### [3.47.2](https://github.com/CodySwannGT/lisa/compare/v3.47.1...v3.47.2) (2026-08-20)


### Bug Fixes

* **ratchet:** an unparseable baseline is reported, not silently skipped ([165b6d1](https://github.com/CodySwannGT/lisa/commit/165b6d1c7e7eabf38d4154f0bf5af617e8897f67)), closes [CodySwannGT/lisa#2792](https://github.com/CodySwannGT/lisa/issues/2792)
* **scripts:** the entry-guard sweep sees scripts/, and sees it either way round ([836a300](https://github.com/CodySwannGT/lisa/commit/836a300ccdef48edf22ae90e94fe209fd732d7f8)), closes [CodySwannGT/lisa#2793](https://github.com/CodySwannGT/lisa/issues/2793)

### [3.47.1](https://github.com/CodySwannGT/lisa/compare/v3.47.0...v3.47.1) (2026-08-20)


### Bug Fixes

* **hooks:** a dispatcher that resolves zero guards refuses ([a0f1eb4](https://github.com/CodySwannGT/lisa/commit/a0f1eb40bab474e67eceef51d8775c42d6be1de8)), closes [CodySwannGT/lisa#2790](https://github.com/CodySwannGT/lisa/issues/2790)

## [3.47.0](https://github.com/CodySwannGT/lisa/compare/v3.46.4...v3.47.0) (2026-08-20)


### Features

* **quality:** gate the guard scripts on whether their tests can fail ([5568781](https://github.com/CodySwannGT/lisa/commit/5568781c826c77be017f36d937e8cf36153e4f9a)), closes [CodySwannGT/lisa#2770](https://github.com/CodySwannGT/lisa/issues/2770)


### Bug Fixes

* **quality:** keep dist out of the mutation sandbox ([a9292b3](https://github.com/CodySwannGT/lisa/commit/a9292b3fda23d3814f0b3792347d80a05ad86d88)), closes [CodySwannGT/lisa#2770](https://github.com/CodySwannGT/lisa/issues/2770)
* **quality:** keep the mutation sandbox out of lint and format ([86f4018](https://github.com/CodySwannGT/lisa/commit/86f4018318e878485c89f8e4b55cc572c62218c9)), closes [CodySwannGT/lisa#2770](https://github.com/CodySwannGT/lisa/issues/2770)
* **quality:** prove the bite with the committed floor, not an invented one ([a0c5e98](https://github.com/CodySwannGT/lisa/commit/a0c5e986821f195be571cd5949d1d410b58df391)), closes [CodySwannGT/lisa#2770](https://github.com/CodySwannGT/lisa/issues/2770)

### [3.46.4](https://github.com/CodySwannGT/lisa/compare/v3.46.3...v3.46.4) (2026-08-20)


### Documentation

* **design:** the failure that made the design gate executable ([331f54b](https://github.com/CodySwannGT/lisa/commit/331f54b8165d20a7567f460e00889c1b0853f1a5)), closes [CodySwannGT/lisa#2808](https://github.com/CodySwannGT/lisa/issues/2808) [CodySwannGT/lisa#2808](https://github.com/CodySwannGT/lisa/issues/2808)

### [3.46.3](https://github.com/CodySwannGT/lisa/compare/v3.46.2...v3.46.3) (2026-08-19)


### Bug Fixes

* **ci:** write the suite-identity separator as an escape, not a raw NUL ([49df396](https://github.com/CodySwannGT/lisa/commit/49df39656cee148ee0ac3739e5d14112ecbf4cbe)), closes [CodySwannGT/lisa#2796](https://github.com/CodySwannGT/lisa/issues/2796)

### [3.46.2](https://github.com/CodySwannGT/lisa/compare/v3.46.1...v3.46.2) (2026-08-19)


### Bug Fixes

* **ci:** write the suite-identity separator as an escape, not a raw NUL ([49df396](https://github.com/CodySwannGT/lisa/commit/49df39656cee148ee0ac3739e5d14112ecbf4cbe)), closes [CodySwannGT/lisa#2796](https://github.com/CodySwannGT/lisa/issues/2796)
* **expo:** stop the shipped eslint config failing the shipped ruleset ([7a4885c](https://github.com/CodySwannGT/lisa/commit/7a4885c400bfeed25822ef249383c7baa0c0652e)), closes [#1707](https://github.com/CodySwannGT/lisa/issues/1707) [#1707](https://github.com/CodySwannGT/lisa/issues/1707) [CodySwannGT/lisa#2804](https://github.com/CodySwannGT/lisa/issues/2804)
* **knip:** teach the shipped gate that printf is a shell builtin ([0854c6f](https://github.com/CodySwannGT/lisa/commit/0854c6fabcad8a98ae1676a717ac1e4ddbbfbdc9)), closes [#2143](https://github.com/CodySwannGT/lisa/issues/2143) [CodySwannGT/lisa#2804](https://github.com/CodySwannGT/lisa/issues/2804)

### [3.46.1](https://github.com/CodySwannGT/lisa/compare/v3.46.0...v3.46.1) (2026-08-19)


### Bug Fixes

* **ci:** refuse a gates.runner that cannot run a task ([24e08ec](https://github.com/CodySwannGT/lisa/commit/24e08ec7bd80749bad35a3c637450dcccccdeced)), closes [CodySwannGT/lisa#2789](https://github.com/CodySwannGT/lisa/issues/2789)
* **security:** make the floor audit able to fail, and let it see the root ([55d01c9](https://github.com/CodySwannGT/lisa/commit/55d01c9046e2f96b3cabb3a0f8ef924fbafd6df4)), closes [CodySwannGT/lisa#2794](https://github.com/CodySwannGT/lisa/issues/2794)

## [3.46.0](https://github.com/CodySwannGT/lisa/compare/v3.45.10...v3.46.0) (2026-08-19)


### Features

* **design:** add the design-intake gate, skill, and command ([781ffd2](https://github.com/CodySwannGT/lisa/commit/781ffd21252a363ff0fb06bcaae0d32c13ab90c9)), closes [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799) [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799)
* **design:** flag unbound values in axes that publish design variables ([5fd9d89](https://github.com/CodySwannGT/lisa/commit/5fd9d89b732be5648989f0a44d0546a5c199bccb)), closes [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799) [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799)
* **design:** resolve the binding regime headlessly, from a committed id map ([8246457](https://github.com/CodySwannGT/lisa/commit/8246457ea3c7ac6ccc44ede60045a5d8ad0d36ea)), closes [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799) [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799)
* **rules:** add the design-value-binding contract ([ebb196e](https://github.com/CodySwannGT/lisa/commit/ebb196edc82da1377bd8c8e875487237305fac02)), closes [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799) [CodySwannGT/lisa#2799](https://github.com/CodySwannGT/lisa/issues/2799)

### [3.45.10](https://github.com/CodySwannGT/lisa/compare/v3.45.9...v3.45.10) (2026-08-19)


### Bug Fixes

* **lint:** make the scripts Lisa ships pass the ruleset Lisa ships ([fc570ba](https://github.com/CodySwannGT/lisa/commit/fc570ba321b96122b34d9caede2400c0c7edd56f)), closes [CodySwannGT/lisa#2797](https://github.com/CodySwannGT/lisa/issues/2797) [CodySwannGT/lisa#2797](https://github.com/CodySwannGT/lisa/issues/2797)

### [3.45.9](https://github.com/CodySwannGT/lisa/compare/v3.45.8...v3.45.9) (2026-08-19)


### Bug Fixes

* **lint:** stop emitting code Lisa's own pre-commit fixer rewrites ([772e8c5](https://github.com/CodySwannGT/lisa/commit/772e8c5d00d9b5fe3bf43b135541f26211df0678)), closes [CodySwannGT/lisa#2788](https://github.com/CodySwannGT/lisa/issues/2788)

### [3.45.8](https://github.com/CodySwannGT/lisa/compare/v3.45.7...v3.45.8) (2026-08-19)


### Documentation

* **refs:** scrub host identities from nightly-e2e comments and docs ([b14818d](https://github.com/CodySwannGT/lisa/commit/b14818dd1894058dff0c4edced40a70314b12cf3)), closes [CodySwannGT/lisa#2782](https://github.com/CodySwannGT/lisa/issues/2782)

### [3.45.7](https://github.com/CodySwannGT/lisa/compare/v3.45.6...v3.45.7) (2026-08-19)


### Bug Fixes

* **ci:** the threshold ratchet's absence is a FAILURE, never a skip ([05dfce3](https://github.com/CodySwannGT/lisa/commit/05dfce375fca562b4cc95cfa5a7d98c275e88fb0)), closes [CodySwannGT/lisa#2777](https://github.com/CodySwannGT/lisa/issues/2777)
* **migrations:** retrofit the seeded Playwright caller in existing projects ([c01f6d7](https://github.com/CodySwannGT/lisa/commit/c01f6d7e6e8654f2fe015a440c87fbd92522e5e6)), closes [#2739](https://github.com/CodySwannGT/lisa/issues/2739) [CodySwannGT/lisa#2776](https://github.com/CodySwannGT/lisa/issues/2776)
* **nightly-e2e:** deny an admin merge it cannot see, demand a second party nobody has ([d4576d1](https://github.com/CodySwannGT/lisa/commit/d4576d14c74b410d6464cd53333649cb0c9af307)), closes [CodySwannGT/lisa#2771](https://github.com/CodySwannGT/lisa/issues/2771)
* **security:** a range with no floor permits everything, not nothing ([36f57e8](https://github.com/CodySwannGT/lisa/commit/36f57e87ff2146ac189299ec89ebc5244ef6b371)), closes [CodySwannGT/lisa#2774](https://github.com/CodySwannGT/lisa/issues/2774)
* **templates:** stop distributing .github/dependabot.yml ([b3d1ce0](https://github.com/CodySwannGT/lisa/commit/b3d1ce06756e2d79a3f52363a8630fa3035e6f1d)), closes [CodySwannGT/lisa#2775](https://github.com/CodySwannGT/lisa/issues/2775)

### [3.45.6](https://github.com/CodySwannGT/lisa/compare/v3.45.5...v3.45.6) (2026-08-19)


### Bug Fixes

* **work-item:** refuse a worktree binding that belongs to another branch ([b4e2630](https://github.com/CodySwannGT/lisa/commit/b4e2630370bcb6a15d450fb91c76443bd60d6a4e)), closes [CodySwannGT/lisa#2755](https://github.com/CodySwannGT/lisa/issues/2755)

### [3.45.5](https://github.com/CodySwannGT/lisa/compare/v3.45.4...v3.45.5) (2026-08-19)


### Bug Fixes

* **environment:** type-check the task runner before pattern-matching it ([f5571f9](https://github.com/CodySwannGT/lisa/commit/f5571f94841d788765036f247a152f2d45d8029c)), closes [CodySwannGT/lisa#2765](https://github.com/CodySwannGT/lisa/issues/2765)
* **hooks:** a shellcheck directive is key=value pairs and nothing else ([c20a632](https://github.com/CodySwannGT/lisa/commit/c20a632ea5fc362f83b4e2203d4876c735e014b1)), closes [CodySwannGT/lisa#2765](https://github.com/CodySwannGT/lisa/issues/2765)
* **nightly-e2e:** trim the gate context before the fallback, not after ([35a4ad2](https://github.com/CodySwannGT/lisa/commit/35a4ad29f3dd982c4fad7c59b57a19cfcef8a223)), closes [CodySwannGT/lisa#2765](https://github.com/CodySwannGT/lisa/issues/2765)
* **state:** validate inventory ENTRIES, not just the container ([37c07e8](https://github.com/CodySwannGT/lisa/commit/37c07e854199aec42f2333b75951834ee7b7e4a8)), closes [CodySwannGT/lisa#2765](https://github.com/CodySwannGT/lisa/issues/2765)

### [3.45.4](https://github.com/CodySwannGT/lisa/compare/v3.45.3...v3.45.4) (2026-08-19)


### Bug Fixes

* **hooks:** write a jira-cli config only when the tracker is jira ([13a8b19](https://github.com/CodySwannGT/lisa/commit/13a8b19fb3524e1cf1ed283ee649556859ea81d8)), closes [CodySwannGT/lisa#2764](https://github.com/CodySwannGT/lisa/issues/2764)

### [3.45.3](https://github.com/CodySwannGT/lisa/compare/v3.45.1...v3.45.3) (2026-08-19)


### Bug Fixes

* **bootstrap:** resolve minimatch lazily via CJS so a CVE pin cannot brick the CLI ([6133828](https://github.com/CodySwannGT/lisa/commit/6133828c5c26c45bb44eaa8027792e64c0f4d11e)), closes [CodySwannGT/lisa#2759](https://github.com/CodySwannGT/lisa/issues/2759)


### Code Refactoring

* **quality:** drop the Playwright jobs now every consumer has migrated ([90d778f](https://github.com/CodySwannGT/lisa/commit/90d778fc4ae8528d7eacf93748a6a9d33aecd318)), closes [CodySwannGT/lisa#2761](https://github.com/CodySwannGT/lisa/issues/2761)

### [3.45.2](https://github.com/CodySwannGT/lisa/compare/v3.45.1...v3.45.2) (2026-08-19)


### Bug Fixes

* **bootstrap:** resolve minimatch lazily via CJS so a CVE pin cannot brick the CLI ([6133828](https://github.com/CodySwannGT/lisa/commit/6133828c5c26c45bb44eaa8027792e64c0f4d11e)), closes [CodySwannGT/lisa#2759](https://github.com/CodySwannGT/lisa/issues/2759)


### Code Refactoring

* **quality:** drop the Playwright jobs now every consumer has migrated ([90d778f](https://github.com/CodySwannGT/lisa/commit/90d778fc4ae8528d7eacf93748a6a9d33aecd318)), closes [CodySwannGT/lisa#2761](https://github.com/CodySwannGT/lisa/issues/2761)

### [3.45.1](https://github.com/CodySwannGT/lisa/compare/v3.45.0...v3.45.1) (2026-08-19)


### Documentation

* **nightly-e2e:** a rename deadlocks only where the context is required ([3ccc123](https://github.com/CodySwannGT/lisa/commit/3ccc123ddf745f89c8e0b54e10d4c1aede56a729)), closes [CodySwannGT/lisa#2757](https://github.com/CodySwannGT/lisa/issues/2757)

## [3.45.0](https://github.com/CodySwannGT/lisa/compare/v3.43.2...v3.45.0) (2026-08-19)


### Features

* **environment:** a setup seam before the verbs, at every preparation site ([c777a81](https://github.com/CodySwannGT/lisa/commit/c777a81deb24f2f1367f6341202ef968badfd4ba)), closes [CodySwannGT/lisa#2752](https://github.com/CodySwannGT/lisa/issues/2752)


### Bug Fixes

* **format:** exempt every managed script from the host format gate, not one ([d6762a1](https://github.com/CodySwannGT/lisa/commit/d6762a141bb4f0c20b913dbe6c0f8a8607364d5b)), closes [CodySwannGT/lisa#2748](https://github.com/CodySwannGT/lisa/issues/2748)

## [3.44.0](https://github.com/CodySwannGT/lisa/compare/v3.43.2...v3.44.0) (2026-08-19)


### Features

* **environment:** a setup seam before the verbs, at every preparation site ([c777a81](https://github.com/CodySwannGT/lisa/commit/c777a81deb24f2f1367f6341202ef968badfd4ba)), closes [CodySwannGT/lisa#2752](https://github.com/CodySwannGT/lisa/issues/2752)


### Bug Fixes

* **format:** exempt every managed script from the host format gate, not one ([d6762a1](https://github.com/CodySwannGT/lisa/commit/d6762a141bb4f0c20b913dbe6c0f8a8607364d5b)), closes [CodySwannGT/lisa#2748](https://github.com/CodySwannGT/lisa/issues/2748)

### [3.43.2](https://github.com/CodySwannGT/lisa/compare/v3.43.1...v3.43.2) (2026-08-19)


### Bug Fixes

* **postinstall:** a failed template apply is now loud and durable, still non-fatal ([c850361](https://github.com/CodySwannGT/lisa/commit/c850361dc1bc8d86116fe0a2ef065ba213d1a222)), closes [#318](https://github.com/CodySwannGT/lisa/issues/318) [CodySwannGT/lisa#2745](https://github.com/CodySwannGT/lisa/issues/2745)

### [3.43.1](https://github.com/CodySwannGT/lisa/compare/v3.43.0...v3.43.1) (2026-08-19)


### Documentation

* **playwright:** say that declaring the gate costs the shard matrix ([1af92d4](https://github.com/CodySwannGT/lisa/commit/1af92d48c6354733e8ffc39192e5b0b0adfa434a)), closes [CodySwannGT/lisa#2743](https://github.com/CodySwannGT/lisa/issues/2743)

## [3.43.0](https://github.com/CodySwannGT/lisa/compare/v3.42.0...v3.43.0) (2026-08-19)


### Features

* **work-item:** complete a work item at merge, with resolved roles and evidence ([6ffd471](https://github.com/CodySwannGT/lisa/commit/6ffd471a4f6f9944516a3550f7defb6ce59b5e2e)), closes [CodySwannGT/lisa#2741](https://github.com/CodySwannGT/lisa/issues/2741)

## [3.42.0](https://github.com/CodySwannGT/lisa/compare/v3.41.1...v3.42.0) (2026-08-19)


### Features

* **environment:** add the environment-prepare reusable workflow ([fbfa0d2](https://github.com/CodySwannGT/lisa/commit/fbfa0d2dd4f11c2f3fee04aebacae499d9865a29)), closes [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [#2566](https://github.com/CodySwannGT/lisa/issues/2566) [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)
* **environment:** ship the caller the facade never had ([29ef31a](https://github.com/CodySwannGT/lisa/commit/29ef31a38c4c214b3acf903c39304947dcbca42b)), closes [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)
* **maestro:** prepare the environment before each leg, not once per run ([92ec546](https://github.com/CodySwannGT/lisa/commit/92ec546858d717ea3f2661740b2ea730cd67bb0d)), closes [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)
* **playwright:** give the browser suite its own reusable workflow ([59c4e11](https://github.com/CodySwannGT/lisa/commit/59c4e1188925ccc0d75db580ab15043d42952a0c)), closes [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)


### Bug Fixes

* **environment:** refuse an environment name that could become shell syntax ([0d59b9f](https://github.com/CodySwannGT/lisa/commit/0d59b9f1589a6b9b1aa64c9b1cdc8048bfce2cbf)), closes [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)
* **playwright:** point the seeded caller at the dedicated workflow ([2f7c579](https://github.com/CodySwannGT/lisa/commit/2f7c579da89308e9ad1445b488e0ba928739d1d4)), closes [CodySwannGT/lisa#2739](https://github.com/CodySwannGT/lisa/issues/2739)

### [3.41.1](https://github.com/CodySwannGT/lisa/compare/v3.41.0...v3.41.1) (2026-08-19)


### Bug Fixes

* **apply:** never merge a host's dependency floor downwards ([d64087a](https://github.com/CodySwannGT/lisa/commit/d64087a28003a6cb89fe632121b812b106272f55)), closes [CodySwannGT/lisa#2726](https://github.com/CodySwannGT/lisa/issues/2726)
* **apply:** refuse to delete a workflow the consumer still calls ([e7e5a51](https://github.com/CodySwannGT/lisa/commit/e7e5a51210bf00389538843e8af6cc4aba3d273d)), closes [CodySwannGT/lisa#2730](https://github.com/CodySwannGT/lisa/issues/2730)

## [3.41.0](https://github.com/CodySwannGT/lisa/compare/v3.40.5...v3.41.0) (2026-08-19)


### Features

* **gates:** ship the skip_jobs → gate mapping so a consumer can migrate ([2bb2373](https://github.com/CodySwannGT/lisa/commit/2bb2373944e55ec47c8949e1db5e7adb1a69bda7)), closes [CodySwannGT/lisa#2719](https://github.com/CodySwannGT/lisa/issues/2719)


### Bug Fixes

* **apply:** never merge a host's dependency floor downwards ([d64087a](https://github.com/CodySwannGT/lisa/commit/d64087a28003a6cb89fe632121b812b106272f55)), closes [CodySwannGT/lisa#2726](https://github.com/CodySwannGT/lisa/issues/2726)
* **apply:** refuse to delete a workflow the consumer still calls ([e7e5a51](https://github.com/CodySwannGT/lisa/commit/e7e5a51210bf00389538843e8af6cc4aba3d273d)), closes [CodySwannGT/lisa#2730](https://github.com/CodySwannGT/lisa/issues/2730)

### [3.40.5](https://github.com/CodySwannGT/lisa/compare/v3.40.4...v3.40.5) (2026-08-19)


### Bug Fixes

* **ci:** fail closed when the floor-collision script is absent ([8b42869](https://github.com/CodySwannGT/lisa/commit/8b428692006de5ae263057a6af7785f044fd5209)), closes [CodySwannGT/lisa#2731](https://github.com/CodySwannGT/lisa/issues/2731)
* **ci:** resolve the floor-collision gate from the template Lisa ships ([87ca3f1](https://github.com/CodySwannGT/lisa/commit/87ca3f118de508a921e503190577c6f3ee3565ae)), closes [CodySwannGT/lisa#2731](https://github.com/CodySwannGT/lisa/issues/2731)
* **doctor:** report universal Lisa-owned artifacts that were never installed ([575caf0](https://github.com/CodySwannGT/lisa/commit/575caf0369278a956f70b4e01dfac97370f5f1a8)), closes [#2731](https://github.com/CodySwannGT/lisa/issues/2731) [CodySwannGT/lisa#2737](https://github.com/CodySwannGT/lisa/issues/2737)


### Documentation

* **e2e-contract:** align the §4a lane table with the stale-file rule ([d00c4a6](https://github.com/CodySwannGT/lisa/commit/d00c4a61c4c62e3744eb57e4c58a7d2e6c744015)), closes [#2728](https://github.com/CodySwannGT/lisa/issues/2728) [CodySwannGT/lisa#2727](https://github.com/CodySwannGT/lisa/issues/2727)
* **e2e-contract:** the lane change alone converges nobody ([84a8401](https://github.com/CodySwannGT/lisa/commit/84a8401fee6d5405795ca39abb78a5c872825e5c)), closes [CodySwannGT/lisa#2727](https://github.com/CodySwannGT/lisa/issues/2727)

### [3.40.4](https://github.com/CodySwannGT/lisa/compare/v3.40.3...v3.40.4) (2026-08-19)


### Bug Fixes

* **work-item:** prove traceability without a tracker credential ([dc8c80f](https://github.com/CodySwannGT/lisa/commit/dc8c80fef70a1fc3a5609aa9f7fc64bfe73fea38)), closes [CodySwannGT/lisa#2721](https://github.com/CodySwannGT/lisa/issues/2721) [CodySwannGT/lisa#2721](https://github.com/CodySwannGT/lisa/issues/2721)


### Documentation

* **work-item:** name one backlink producer and finish the parser rule ([7ebcdd9](https://github.com/CodySwannGT/lisa/commit/7ebcdd99fa5ca775c395c0960671cf75db4c441d)), closes [CodySwannGT/lisa#2721](https://github.com/CodySwannGT/lisa/issues/2721) [CodySwannGT/lisa#2721](https://github.com/CodySwannGT/lisa/issues/2721)

### [3.40.3](https://github.com/CodySwannGT/lisa/compare/v3.40.2...v3.40.3) (2026-08-19)


### Documentation

* **nightly-e2e:** record that `gated: false` relaxes no evidence standard ([836fcb0](https://github.com/CodySwannGT/lisa/commit/836fcb08eeb9d5653dac9cc46b303c2e3697081f)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

### [3.40.2](https://github.com/CodySwannGT/lisa/compare/v3.40.1...v3.40.2) (2026-08-19)


### Documentation

* **drive-pr:** a conflicted PR runs zero CI, not failing CI ([5438918](https://github.com/CodySwannGT/lisa/commit/5438918934ef3fd4026ec28183c4d0dd2093ddad)), closes [CodySwannGT/lisa#2722](https://github.com/CodySwannGT/lisa/issues/2722)

### [3.40.1](https://github.com/CodySwannGT/lisa/compare/v3.40.0...v3.40.1) (2026-08-19)


### Bug Fixes

* **deps:** retire the brace-expansion override that kills ESLint ([945a2be](https://github.com/CodySwannGT/lisa/commit/945a2be52f9503016a5b154dc408c0b6112b44ce)), closes [#2045](https://github.com/CodySwannGT/lisa/issues/2045) [CodySwannGT/lisa#2716](https://github.com/CodySwannGT/lisa/issues/2716)

## [3.40.0](https://github.com/CodySwannGT/lisa/compare/v3.39.0...v3.40.0) (2026-08-19)


### Features

* **nightly-e2e:** measure the reporter's blocking claim instead of asserting it ([2c5175c](https://github.com/CodySwannGT/lisa/commit/2c5175cab5fbfd368ee9f07c8267525d192b8275)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

## [3.39.0](https://github.com/CodySwannGT/lisa/compare/v3.38.5...v3.39.0) (2026-08-19)


### Features

* **gates:** make the performance budget a gate projects can decline ([dca318a](https://github.com/CodySwannGT/lisa/commit/dca318a3209d7995a646183c13ad26ae3ecd40c2)), closes [CodySwannGT/lisa#2715](https://github.com/CodySwannGT/lisa/issues/2715)


### Bug Fixes

* **gates:** do not measure a performance budget a project cannot build ([a0df4f2](https://github.com/CodySwannGT/lisa/commit/a0df4f2e5aaf6a9420b019aa9aa5a43f42b2d3b8)), closes [CodySwannGT/lisa#2715](https://github.com/CodySwannGT/lisa/issues/2715)

### [3.38.5](https://github.com/CodySwannGT/lisa/compare/v3.38.4...v3.38.5) (2026-08-19)


### Bug Fixes

* **apply:** fail authoring when a path is both delivered and deleted ([3e12587](https://github.com/CodySwannGT/lisa/commit/3e12587d0bd3e323c316c0a8a0bf7147cee17f0e)), closes [CodySwannGT/lisa#2714](https://github.com/CodySwannGT/lisa/issues/2714)

### [3.38.4](https://github.com/CodySwannGT/lisa/compare/v3.38.3...v3.38.4) (2026-08-18)


### Bug Fixes

* **package-lisa:** fail the apply on an unsubstituted $name placeholder ([353588b](https://github.com/CodySwannGT/lisa/commit/353588b12150c82f61379e6754756333b9065890)), closes [CodySwannGT/lisa#2711](https://github.com/CodySwannGT/lisa/issues/2711)

### [3.38.3](https://github.com/CodySwannGT/lisa/compare/v3.38.2...v3.38.3) (2026-08-18)


### Bug Fixes

* **ci:** reject a zero-flow run without requiring min_flows (row 39) ([f4b66e3](https://github.com/CodySwannGT/lisa/commit/f4b66e399a878178f659c6fce30617ed7a345e06)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

### [3.38.2](https://github.com/CodySwannGT/lisa/compare/v3.38.1...v3.38.2) (2026-08-18)


### Documentation

* **design:** address the two review findings I had missed, and record the fork gaps ([bbae7ce](https://github.com/CodySwannGT/lisa/commit/bbae7cec93edccf5886722221366f46fb9d2f189)), closes [#2704](https://github.com/CodySwannGT/lisa/issues/2704) [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** correct the duplicate-check-name claim, which measurement refutes ([1edd1cc](https://github.com/CodySwannGT/lisa/commit/1edd1cc1bf39f6f0f9431733511097efe5514f89)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** correct the e2e contract's delete list and answer both open questions ([7a40fa7](https://github.com/CodySwannGT/lisa/commit/7a40fa70554b2891a9a9047d54ea9b0637bce1d3)), closes [gunnertech#385](https://github.com/CodySwannGT/gunnertech/issues/385) [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** declare the e2e wiring contract ([0ac5bee](https://github.com/CodySwannGT/lisa/commit/0ac5bee3d30740ad84dabf5e5d1abad4b3b492f2)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** measure content drift, not just filenames — neither layer converges ([1f0b6ae](https://github.com/CodySwannGT/lisa/commit/1f0b6ae38582056f63b23cea8c91552aeb0aa25a)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** retract the delete list — all three entries are live ([ea6169f](https://github.com/CodySwannGT/lisa/commit/ea6169f87e09539571ed3ca018102ea2c5b301a8)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)

### [3.38.1](https://github.com/CodySwannGT/lisa/compare/v3.38.0...v3.38.1) (2026-08-18)


### Bug Fixes

* **ci:** a published flow count is not a verified scope ([447084f](https://github.com/CodySwannGT/lisa/commit/447084fe3e2c9b839bc32e9577f5f8fe294c2d3a)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)


### Documentation

* **design:** address the two review findings I had missed, and record the fork gaps ([bbae7ce](https://github.com/CodySwannGT/lisa/commit/bbae7cec93edccf5886722221366f46fb9d2f189)), closes [#2704](https://github.com/CodySwannGT/lisa/issues/2704) [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** correct the duplicate-check-name claim, which measurement refutes ([1edd1cc](https://github.com/CodySwannGT/lisa/commit/1edd1cc1bf39f6f0f9431733511097efe5514f89)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** correct the e2e contract's delete list and answer both open questions ([7a40fa7](https://github.com/CodySwannGT/lisa/commit/7a40fa70554b2891a9a9047d54ea9b0637bce1d3)), closes [gunnertech#385](https://github.com/CodySwannGT/gunnertech/issues/385) [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** declare the e2e wiring contract ([0ac5bee](https://github.com/CodySwannGT/lisa/commit/0ac5bee3d30740ad84dabf5e5d1abad4b3b492f2)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** measure content drift, not just filenames — neither layer converges ([1f0b6ae](https://github.com/CodySwannGT/lisa/commit/1f0b6ae38582056f63b23cea8c91552aeb0aa25a)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)
* **design:** retract the delete list — all three entries are live ([ea6169f](https://github.com/CodySwannGT/lisa/commit/ea6169f87e09539571ed3ca018102ea2c5b301a8)), closes [CodySwannGT/lisa#2700](https://github.com/CodySwannGT/lisa/issues/2700)

## [3.38.0](https://github.com/CodySwannGT/lisa/compare/v3.37.0...v3.38.0) (2026-08-18)


### Features

* **gates:** make the e2e-browser gate govern the Playwright suite ([9d88d77](https://github.com/CodySwannGT/lisa/commit/9d88d77b7d5010f991e0a97623e09c76fc90a5ef)), closes [CodySwannGT/lisa#2706](https://github.com/CodySwannGT/lisa/issues/2706)


### Bug Fixes

* **ci:** a published flow count is not a verified scope ([447084f](https://github.com/CodySwannGT/lisa/commit/447084fe3e2c9b839bc32e9577f5f8fe294c2d3a)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

## [3.37.0](https://github.com/CodySwannGT/lisa/compare/v3.35.1...v3.37.0) (2026-08-18)


### Features

* **ci:** give the Maestro reusable the four capabilities consumers forked for ([f374bfb](https://github.com/CodySwannGT/lisa/commit/f374bfbe7d1afaa1e019f3b02b2e746be0a20738)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)


### Bug Fixes

* **ci:** a tag-filtered run must not satisfy the nightly e2e gate ([c46b1b5](https://github.com/CodySwannGT/lisa/commit/c46b1b5ca28dfea26a73ab039c8a6c87e3bb281c)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)
* **ci:** do not tell a browser suite to declare a floor it cannot satisfy ([9035fae](https://github.com/CodySwannGT/lisa/commit/9035fae2aa751735e2d5f1b9e0b1d8d641ff4175)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)


### Documentation

* **ci:** make `min_flows` discoverable in the caller template ([6eade43](https://github.com/CodySwannGT/lisa/commit/6eade433dd377d89d7f827e4bcc5e7d85b29c15f)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)
* **ci:** record the case row 26 provably cannot catch ([40ca97b](https://github.com/CodySwannGT/lisa/commit/40ca97ba1b41e23b236888ed559910d593b39c79)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

## [3.36.0](https://github.com/CodySwannGT/lisa/compare/v3.35.1...v3.36.0) (2026-08-18)


### Features

* **ci:** give the Maestro reusable the four capabilities consumers forked for ([f374bfb](https://github.com/CodySwannGT/lisa/commit/f374bfbe7d1afaa1e019f3b02b2e746be0a20738)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)


### Bug Fixes

* **ci:** a tag-filtered run must not satisfy the nightly e2e gate ([c46b1b5](https://github.com/CodySwannGT/lisa/commit/c46b1b5ca28dfea26a73ab039c8a6c87e3bb281c)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)
* **ci:** do not tell a browser suite to declare a floor it cannot satisfy ([9035fae](https://github.com/CodySwannGT/lisa/commit/9035fae2aa751735e2d5f1b9e0b1d8d641ff4175)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)


### Documentation

* **ci:** make `min_flows` discoverable in the caller template ([6eade43](https://github.com/CodySwannGT/lisa/commit/6eade433dd377d89d7f827e4bcc5e7d85b29c15f)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)
* **ci:** record the case row 26 provably cannot catch ([40ca97b](https://github.com/CodySwannGT/lisa/commit/40ca97ba1b41e23b236888ed559910d593b39c79)), closes [CodySwannGT/lisa#2704](https://github.com/CodySwannGT/lisa/issues/2704)

### [3.35.1](https://github.com/CodySwannGT/lisa/compare/v3.35.0...v3.35.1) (2026-08-18)


### Bug Fixes

* **ci:** repin two expo templates off a ref that predates the reusable ([7cc7d52](https://github.com/CodySwannGT/lisa/commit/7cc7d52234f33f660a566359ed8b1b9e1df840ed)), closes [#2700](https://github.com/CodySwannGT/lisa/issues/2700) [CodySwannGT/lisa#2702](https://github.com/CodySwannGT/lisa/issues/2702)

## [3.35.0](https://github.com/CodySwannGT/lisa/compare/v3.34.0...v3.35.0) (2026-08-18)


### Features

* **doctor:** declare the traceability gate where no project has ([2a06c8a](https://github.com/CodySwannGT/lisa/commit/2a06c8a8ff8100cd4b4d24768701b17d34d08957)), closes [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677) [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677)


### Bug Fixes

* **doctor:** report the layer doctor cannot see, and drop a premise that expired ([9c9ace1](https://github.com/CodySwannGT/lisa/commit/9c9ace132c6e598601c16fac78ddfd2a287504c0)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677)
* **hooks:** prove lint-staged's tools can start before handing it the work ([8f41550](https://github.com/CodySwannGT/lisa/commit/8f41550e50df30f4714c0a08fc1bcf819b4c17e9)), closes [CodySwannGT/lisa#2678](https://github.com/CodySwannGT/lisa/issues/2678) [CodySwannGT/lisa#2678](https://github.com/CodySwannGT/lisa/issues/2678)

## [3.34.0](https://github.com/CodySwannGT/lisa/compare/v3.33.8...v3.34.0) (2026-08-18)


### Features

* **doctor:** declare the traceability gate where no project has ([2a06c8a](https://github.com/CodySwannGT/lisa/commit/2a06c8a8ff8100cd4b4d24768701b17d34d08957)), closes [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677) [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677)


### Bug Fixes

* **automations:** stop an append rewriting rows it did not author ([6553d7d](https://github.com/CodySwannGT/lisa/commit/6553d7d85cbfff7c67c6d9ed89bc92c76af64bc2)), closes [CodySwannGT/lisa#2682](https://github.com/CodySwannGT/lisa/issues/2682)
* **doctor:** report the layer doctor cannot see, and drop a premise that expired ([9c9ace1](https://github.com/CodySwannGT/lisa/commit/9c9ace132c6e598601c16fac78ddfd2a287504c0)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2677](https://github.com/CodySwannGT/lisa/issues/2677)
* **gates:** declare the .mjs gate off, and stop that off from rotting ([839a785](https://github.com/CodySwannGT/lisa/commit/839a7854e1a0c7e61dcbf8a73bd5d18925a187ca)), closes [CodySwannGT/lisa#2695](https://github.com/CodySwannGT/lisa/issues/2695)
* **gates:** let this repository resolve the gates it declares ([c0f843a](https://github.com/CodySwannGT/lisa/commit/c0f843a359b86eb5e9ad963f337f42f1409ff09c)), closes [CodySwannGT/lisa#2695](https://github.com/CodySwannGT/lisa/issues/2695)
* **hooks:** prove lint-staged's tools can start before handing it the work ([8f41550](https://github.com/CodySwannGT/lisa/commit/8f41550e50df30f4714c0a08fc1bcf819b4c17e9)), closes [CodySwannGT/lisa#2678](https://github.com/CodySwannGT/lisa/issues/2678) [CodySwannGT/lisa#2678](https://github.com/CodySwannGT/lisa/issues/2678)
* **intake:** sweep pre-work lanes by type, and state the denominator ([6afbec9](https://github.com/CodySwannGT/lisa/commit/6afbec93abcc34d090d1d0f9daf52412c8b071e9)), closes [CodySwannGT/lisa#2657](https://github.com/CodySwannGT/lisa/issues/2657)
* **test:** fail the .mjs gate with no runner, collect the plugin suites ([2eec70f](https://github.com/CodySwannGT/lisa/commit/2eec70feb6add0b25796eab68c45c2c4eb381e41)), closes [#2689](https://github.com/CodySwannGT/lisa/issues/2689) [CodySwannGT/lisa#2692](https://github.com/CodySwannGT/lisa/issues/2692) [CodySwannGT/lisa#2692](https://github.com/CodySwannGT/lisa/issues/2692)
* **test:** run the mjs step body under bash, as GitHub Actions does ([46ff850](https://github.com/CodySwannGT/lisa/commit/46ff850cbd62f78b0c98e2ff7c2df08b301ba272)), closes [CodySwannGT/lisa#2692](https://github.com/CodySwannGT/lisa/issues/2692) [CodySwannGT/lisa#2692](https://github.com/CodySwannGT/lisa/issues/2692)

### [3.33.8](https://github.com/CodySwannGT/lisa/compare/v3.33.7...v3.33.8) (2026-08-18)


### Bug Fixes

* **hooks:** let the declaration govern the pre-push work-item check ([c751468](https://github.com/CodySwannGT/lisa/commit/c7514689848bf59bfc1ec3f072c3fec667dd5a9e)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [#2683](https://github.com/CodySwannGT/lisa/issues/2683) [#2683](https://github.com/CodySwannGT/lisa/issues/2683) [CodySwannGT/lisa#2688](https://github.com/CodySwannGT/lisa/issues/2688) [CodySwannGT/lisa#2688](https://github.com/CodySwannGT/lisa/issues/2688)
* **lint:** fail on a swallowed exception in shipped scripts ([1153a3a](https://github.com/CodySwannGT/lisa/commit/1153a3aa31768ad51ed831e10fd02f082c7c9636)), closes [CodySwannGT/lisa#2658](https://github.com/CodySwannGT/lisa/issues/2658) [CodySwannGT/lisa#2658](https://github.com/CodySwannGT/lisa/issues/2658)

### [3.33.7](https://github.com/CodySwannGT/lisa/compare/v3.33.6...v3.33.7) (2026-08-18)


### Bug Fixes

* **work-item:** make the ticket-side backlink an executable step ([fca373f](https://github.com/CodySwannGT/lisa/commit/fca373f79c56a7600b2674a4331a02464eeb3e2b)), closes [CodySwannGT/lisa#2687](https://github.com/CodySwannGT/lisa/issues/2687) [CodySwannGT/lisa#2687](https://github.com/CodySwannGT/lisa/issues/2687)

### [3.33.6](https://github.com/CodySwannGT/lisa/compare/v3.33.5...v3.33.6) (2026-08-18)


### Bug Fixes

* **lint:** lint the .mjs files Lisa ships instead of ignoring them ([29cc713](https://github.com/CodySwannGT/lisa/commit/29cc7139d6657f106e0a5ed0f9c55561a45c2010)), closes [CodySwannGT/lisa#2658](https://github.com/CodySwannGT/lisa/issues/2658) [CodySwannGT/lisa#2658](https://github.com/CodySwannGT/lisa/issues/2658) [CodySwannGT/lisa#2658](https://github.com/CodySwannGT/lisa/issues/2658)

### [3.33.5](https://github.com/CodySwannGT/lisa/compare/v3.33.4...v3.33.5) (2026-08-18)


### Documentation

* **gates:** the install does not make a declaration readable ([5b392a7](https://github.com/CodySwannGT/lisa/commit/5b392a7cc2256d175afcb77f8dbcc29c5d6a850a)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680)

### [3.33.4](https://github.com/CodySwannGT/lisa/compare/v3.33.3...v3.33.4) (2026-08-18)


### Bug Fixes

* **work-item:** find the trailer wherever it is, and report every unmet requirement ([c77ca7f](https://github.com/CodySwannGT/lisa/commit/c77ca7f4caa212b8af1bace75fed880596d8aa3e)), closes [CodySwannGT/lisa#2672](https://github.com/CodySwannGT/lisa/issues/2672) [CodySwannGT/lisa#2672](https://github.com/CodySwannGT/lisa/issues/2672)


### Documentation

* **gates:** the install does not make a declaration readable ([5b392a7](https://github.com/CodySwannGT/lisa/commit/5b392a7cc2256d175afcb77f8dbcc29c5d6a850a)), closes [#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680)

### [3.33.3](https://github.com/CodySwannGT/lisa/compare/v3.33.2...v3.33.3) (2026-08-18)


### Bug Fixes

* **ci:** make the traceability job honor its gate level ([c980305](https://github.com/CodySwannGT/lisa/commit/c980305c435962279ca6af07af3283c119cf6501)), closes [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680) [CodySwannGT/lisa#2680](https://github.com/CodySwannGT/lisa/issues/2680)

### [3.33.2](https://github.com/CodySwannGT/lisa/compare/v3.33.1...v3.33.2) (2026-08-18)


### Bug Fixes

* **e2e-coverage:** count what runs, not what exists on disk ([79300bd](https://github.com/CodySwannGT/lisa/commit/79300bd023d332e9af3bc9a289e070833dac4d45)), closes [CodySwannGT/lisa#2673](https://github.com/CodySwannGT/lisa/issues/2673) [CodySwannGT/lisa#2673](https://github.com/CodySwannGT/lisa/issues/2673)
* **e2e-coverage:** parse a flow's tags block, not its commands ([d4de277](https://github.com/CodySwannGT/lisa/commit/d4de277ee866dfd22244d073935665ef2fd9367a)), closes [CodySwannGT/lisa#2673](https://github.com/CodySwannGT/lisa/issues/2673) [CodySwannGT/lisa#2673](https://github.com/CodySwannGT/lisa/issues/2673)

### [3.33.1](https://github.com/CodySwannGT/lisa/compare/v3.33.0...v3.33.1) (2026-08-18)


### Documentation

* **mutation-testing:** scope the mutant annotation to mutation runs ([a9b4461](https://github.com/CodySwannGT/lisa/commit/a9b4461a0266851d404aad371621cb27c52cf487)), closes [#2671](https://github.com/CodySwannGT/lisa/issues/2671) [CodySwannGT/lisa#2675](https://github.com/CodySwannGT/lisa/issues/2675) [CodySwannGT/lisa#2675](https://github.com/CodySwannGT/lisa/issues/2675)

## [3.33.0](https://github.com/CodySwannGT/lisa/compare/v3.32.1...v3.33.0) (2026-08-18)


### Features

* **maestro:** declare actions: read so leg serialization can work ([0a1081a](https://github.com/CodySwannGT/lisa/commit/0a1081a8ab6ab9b8f9e006a915b0ca915b66b519)), closes [CodySwannGT/lisa#2662](https://github.com/CodySwannGT/lisa/issues/2662) [CodySwannGT/lisa#2662](https://github.com/CodySwannGT/lisa/issues/2662)


### Bug Fixes

* **doctor:** bind the serialize parts to the job that calls the workflow ([a8d91a1](https://github.com/CodySwannGT/lisa/commit/a8d91a163471a6632f137b65cb210145f2e0b1f6)), closes [CodySwannGT/lisa#2662](https://github.com/CodySwannGT/lisa/issues/2662) [CodySwannGT/lisa#2662](https://github.com/CodySwannGT/lisa/issues/2662)


### Documentation

* **mutation-testing:** scope the mutant annotation to mutation runs ([a9b4461](https://github.com/CodySwannGT/lisa/commit/a9b4461a0266851d404aad371621cb27c52cf487)), closes [#2671](https://github.com/CodySwannGT/lisa/issues/2671) [CodySwannGT/lisa#2675](https://github.com/CodySwannGT/lisa/issues/2675) [CodySwannGT/lisa#2675](https://github.com/CodySwannGT/lisa/issues/2675)

### [3.32.1](https://github.com/CodySwannGT/lisa/compare/v3.32.0...v3.32.1) (2026-08-18)


### Documentation

* **environment:** a non-zero exit is not a refusal ([054a28c](https://github.com/CodySwannGT/lisa/commit/054a28c11034c5008d092635b50b0a7e929b3534)), closes [CodySwannGT/lisa#2664](https://github.com/CodySwannGT/lisa/issues/2664) [CodySwannGT/lisa#2664](https://github.com/CodySwannGT/lisa/issues/2664)
* **environment:** rule the two verbs independently optional ([bd7c574](https://github.com/CodySwannGT/lisa/commit/bd7c57416d6e022f691961a204018c238c448521)), closes [CodySwannGT/lisa#2664](https://github.com/CodySwannGT/lisa/issues/2664) [CodySwannGT/lisa#2664](https://github.com/CodySwannGT/lisa/issues/2664)

## [3.32.0](https://github.com/CodySwannGT/lisa/compare/v3.31.4...v3.32.0) (2026-08-17)


### Features

* **privacy:** enforce the no-downstream-names rule for every agent ([2d8385d](https://github.com/CodySwannGT/lisa/commit/2d8385d530586f13e9c5df4db44a1bcc6ff5a55d)), closes [CodySwannGT/lisa#2669](https://github.com/CodySwannGT/lisa/issues/2669) [CodySwannGT/lisa#2669](https://github.com/CodySwannGT/lisa/issues/2669)

### [3.31.4](https://github.com/CodySwannGT/lisa/compare/v3.31.3...v3.31.4) (2026-08-17)

### [3.31.3](https://github.com/CodySwannGT/lisa/compare/v3.31.2...v3.31.3) (2026-08-17)

### [3.31.2](https://github.com/CodySwannGT/lisa/compare/v3.31.1...v3.31.2) (2026-08-17)


### Bug Fixes

* **doctor:** stop certifying a serialize opt-in nothing can make work ([d6b3f4e](https://github.com/CodySwannGT/lisa/commit/d6b3f4e4d4fd874df4022d54a91a4e0828319986)), closes [CodySwannGT/lisa#2661](https://github.com/CodySwannGT/lisa/issues/2661) [CodySwannGT/lisa#2661](https://github.com/CodySwannGT/lisa/issues/2661)

### [3.31.1](https://github.com/CodySwannGT/lisa/compare/v3.31.0...v3.31.1) (2026-08-17)


### Bug Fixes

* **secrets:** resolve the project config from outside cwd ([cfc6179](https://github.com/CodySwannGT/lisa/commit/cfc6179ef9f0f89551223dcc74e9a8a519d8e5f2)), closes [CodySwannGT/lisa#2659](https://github.com/CodySwannGT/lisa/issues/2659) [CodySwannGT/lisa#2659](https://github.com/CodySwannGT/lisa/issues/2659)

## [3.31.0](https://github.com/CodySwannGT/lisa/compare/v3.30.1...v3.31.0) (2026-08-17)


### Features

* **automations:** detect a cycle that recorded nothing ([88de630](https://github.com/CodySwannGT/lisa/commit/88de63040e815b0e70e0e42f7ac2e03e80246721)), closes [CodySwannGT/lisa#2638](https://github.com/CodySwannGT/lisa/issues/2638) [CodySwannGT/lisa#2638](https://github.com/CodySwannGT/lisa/issues/2638)

### [3.30.1](https://github.com/CodySwannGT/lisa/compare/v3.30.0...v3.30.1) (2026-08-17)


### Bug Fixes

* **guard:** stop splitting quoted arguments on shell operators ([98b86d8](https://github.com/CodySwannGT/lisa/commit/98b86d8aeae153915596aa826fc8793b4f2f54df)), closes [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634) [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634)
* **hooks:** answer the quote exemption per occurrence, not per value ([1965f0f](https://github.com/CodySwannGT/lisa/commit/1965f0f219e065724d72cd58b5ca9139903a9bb9)), closes [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634) [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634)
* **hooks:** carry the quote-mask fix into the copied hook ([ea1d75f](https://github.com/CodySwannGT/lisa/commit/ea1d75f0ef36c7cef5924b310cc151fae98e4f23)), closes [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634) [CodySwannGT/lisa#2634](https://github.com/CodySwannGT/lisa/issues/2634)

## [3.30.0](https://github.com/CodySwannGT/lisa/compare/v3.29.3...v3.30.0) (2026-08-17)


### Features

* **guard:** tell a GENERATED file the opposite consequence ([478da4b](https://github.com/CodySwannGT/lisa/commit/478da4b30995be694206a08dde81aaacd348f243)), closes [#2639](https://github.com/CodySwannGT/lisa/issues/2639) [CodySwannGT/lisa#2632](https://github.com/CodySwannGT/lisa/issues/2632) [CodySwannGT/lisa#2632](https://github.com/CodySwannGT/lisa/issues/2632)

### [3.29.3](https://github.com/CodySwannGT/lisa/compare/v3.29.2...v3.29.3) (2026-08-17)


### Bug Fixes

* **doctor:** report an incomplete serialize_platform_legs opt-in ([82141a4](https://github.com/CodySwannGT/lisa/commit/82141a4e6cac65f6dd5d931f9349507b67a2fe8f)), closes [#2651](https://github.com/CodySwannGT/lisa/issues/2651) [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651) [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651)
* **security:** force deepmerge-ts past GHSA-ggr8-5vv4-36mx ([980b4b7](https://github.com/CodySwannGT/lisa/commit/980b4b7a08f7edac8c7dd463c4e113ae1783b652)), closes [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651) [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651)
* **work-item:** classify an outage as unreachable, not as a verdict ([956cb56](https://github.com/CodySwannGT/lisa/commit/956cb5650834ba03e576495462bd83ccce1639b5)), closes [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651) [CodySwannGT/lisa#2651](https://github.com/CodySwannGT/lisa/issues/2651)

### [3.29.2](https://github.com/CodySwannGT/lisa/compare/v3.29.1...v3.29.2) (2026-08-17)


### Bug Fixes

* preserve host ruleset checks ([1c5f751](https://github.com/CodySwannGT/lisa/commit/1c5f75188692713ac68322717c8e61308cf7b069)), closes [CodySwannGT/lisa#2641](https://github.com/CodySwannGT/lisa/issues/2641) [CodySwannGT/lisa#2641](https://github.com/CodySwannGT/lisa/issues/2641)

### [3.29.1](https://github.com/CodySwannGT/lisa/compare/v3.29.0...v3.29.1) (2026-08-17)


### Bug Fixes

* **lintstaged:** stop oxlint and prettier racing over the same files ([10d8b83](https://github.com/CodySwannGT/lisa/commit/10d8b83c56ef163671249e661ba136b71734d2d0)), closes [#2639](https://github.com/CodySwannGT/lisa/issues/2639) [#2647](https://github.com/CodySwannGT/lisa/issues/2647) [CodySwannGT/lisa#2648](https://github.com/CodySwannGT/lisa/issues/2648) [CodySwannGT/lisa#2648](https://github.com/CodySwannGT/lisa/issues/2648)

## [3.29.0](https://github.com/CodySwannGT/lisa/compare/v3.28.2...v3.29.0) (2026-08-17)


### Features

* **doctor:** report worktrees holding work that exists nowhere else ([fc18068](https://github.com/CodySwannGT/lisa/commit/fc180687d38e54d64b1b5a8b6147e5fbbc0cbc02)), closes [CodySwannGT/lisa#2646](https://github.com/CodySwannGT/lisa/issues/2646) [CodySwannGT/lisa#2646](https://github.com/CodySwannGT/lisa/issues/2646)


### Bug Fixes

* **doctor:** bound worktree risk inspection ([c2c9b17](https://github.com/CodySwannGT/lisa/commit/c2c9b17d4de706e694915bcdf39f836ab5348823)), closes [CodySwannGT/lisa#2646](https://github.com/CodySwannGT/lisa/issues/2646)

### [3.28.2](https://github.com/CodySwannGT/lisa/compare/v3.28.1...v3.28.2) (2026-08-17)


### Bug Fixes

* reject bare gate family moment keys ([d2c51a4](https://github.com/CodySwannGT/lisa/commit/d2c51a466dec5a83a049bcb858542993b871d5ca)), closes [CodySwannGT/lisa#2644](https://github.com/CodySwannGT/lisa/issues/2644)
* reject malformed family gate moments ([a6e3e9e](https://github.com/CodySwannGT/lisa/commit/a6e3e9ee4982cae24c40484b7d1126f8b3b0687f)), closes [CodySwannGT/lisa#2644](https://github.com/CodySwannGT/lisa/issues/2644)

### [3.28.1](https://github.com/CodySwannGT/lisa/compare/v3.28.0...v3.28.1) (2026-08-17)


### Bug Fixes

* keep literal override backing pins ([8a2ce40](https://github.com/CodySwannGT/lisa/commit/8a2ce40b0040498999a8311be5fbff24b9749de9)), closes [CodySwannGT/lisa#2642](https://github.com/CodySwannGT/lisa/issues/2642) [CodySwannGT/lisa#2642](https://github.com/CodySwannGT/lisa/issues/2642)
* report and guard self-reference override rewrites ([9169134](https://github.com/CodySwannGT/lisa/commit/91691346641273753203ebffba3c5e1886292f7e)), closes [CodySwannGT/lisa#2642](https://github.com/CodySwannGT/lisa/issues/2642)
* report and guard self-reference override rewrites ([f117844](https://github.com/CodySwannGT/lisa/commit/f1178449d24ffaaaa620c69b9bdd39a35affd829)), closes [CodySwannGT/lisa#2642](https://github.com/CodySwannGT/lisa/issues/2642) [CodySwannGT/lisa#2642](https://github.com/CodySwannGT/lisa/issues/2642)

## [3.28.0](https://github.com/CodySwannGT/lisa/compare/v3.27.0...v3.28.0) (2026-08-17)


### Features

* **doctor:** report Lisa artifact copy provenance ([9d1b9ee](https://github.com/CodySwannGT/lisa/commit/9d1b9eedc8ad4a0cb157427b4205543971247cea)), closes [CodySwannGT/lisa#2639](https://github.com/CodySwannGT/lisa/issues/2639)


### Bug Fixes

* **doctor:** preserve ignored artifact provenance ([aebbb0e](https://github.com/CodySwannGT/lisa/commit/aebbb0e0441aa318f9624c44d91cc2a941bb5f51)), closes [CodySwannGT/lisa#2639](https://github.com/CodySwannGT/lisa/issues/2639)

## [3.27.0](https://github.com/CodySwannGT/lisa/compare/v3.26.5...v3.27.0) (2026-08-17)


### Features

* **gates:** put test_mutation and verification_coverage behind the facade ([d40aec5](https://github.com/CodySwannGT/lisa/commit/d40aec5cfd85e9b5451505c48e43aea8154eb21e)), closes [CodySwannGT/lisa#2636](https://github.com/CodySwannGT/lisa/issues/2636) [CodySwannGT/lisa#2636](https://github.com/CodySwannGT/lisa/issues/2636)

### [3.26.5](https://github.com/CodySwannGT/lisa/compare/v3.26.4...v3.26.5) (2026-08-17)

### [3.26.4](https://github.com/CodySwannGT/lisa/compare/v3.26.3...v3.26.4) (2026-08-17)


### Bug Fixes

* **ignore:** `!` in .lisaignore un-ignored the whole project ([2e18c73](https://github.com/CodySwannGT/lisa/commit/2e18c73658fed814dad26a95b78731091f705f32)), closes [CodySwannGT/lisa#2628](https://github.com/CodySwannGT/lisa/issues/2628) [CodySwannGT/lisa#2628](https://github.com/CodySwannGT/lisa/issues/2628)


### Documentation

* **ignore:** the starter template invited the bug it did not document ([d530fc8](https://github.com/CodySwannGT/lisa/commit/d530fc89beb1fe55b11dd1c9cc47450192164db1)), closes [CodySwannGT/lisa#2628](https://github.com/CodySwannGT/lisa/issues/2628) [CodySwannGT/lisa#2628](https://github.com/CodySwannGT/lisa/issues/2628)

### [3.26.3](https://github.com/CodySwannGT/lisa/compare/v3.26.2...v3.26.3) (2026-08-17)


### Bug Fixes

* **hooks:** copy-overwrite preserves host edits, it does not replace them ([6877e57](https://github.com/CodySwannGT/lisa/commit/6877e573697dae8e08588807f0c7a91c7705da20)), closes [CodySwannGT/lisa#2629](https://github.com/CodySwannGT/lisa/issues/2629) [CodySwannGT/lisa#2629](https://github.com/CodySwannGT/lisa/issues/2629)


### Documentation

* **ownership:** the whole scripts/ tree is Lisa-owned, not just `lisa-` names ([60fad0e](https://github.com/CodySwannGT/lisa/commit/60fad0e51128e477ed38a7690b80e7722deb06c6)), closes [CodySwannGT/lisa#2629](https://github.com/CodySwannGT/lisa/issues/2629) [CodySwannGT/lisa#2629](https://github.com/CodySwannGT/lisa/issues/2629)

### [3.26.2](https://github.com/CodySwannGT/lisa/compare/v3.26.1...v3.26.2) (2026-08-16)


### Bug Fixes

* **scripts:** three shipped guards could report success without doing the work ([1426aa3](https://github.com/CodySwannGT/lisa/commit/1426aa3b1f15d260f3bca06fc00d679b242712b5)), closes [#2610](https://github.com/CodySwannGT/lisa/issues/2610) [CodySwannGT/lisa#2626](https://github.com/CodySwannGT/lisa/issues/2626) [CodySwannGT/lisa#2626](https://github.com/CodySwannGT/lisa/issues/2626) [CodySwannGT/lisa#2626](https://github.com/CodySwannGT/lisa/issues/2626)

### [3.26.1](https://github.com/CodySwannGT/lisa/compare/v3.26.0...v3.26.1) (2026-08-16)


### Bug Fixes

* **hooks:** the managed-file guard must honour .lisaignore ([d5984f7](https://github.com/CodySwannGT/lisa/commit/d5984f7ec26e2eacf2be5fb1b6f60b0c97625854)), closes [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624) [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624) [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624)
* **hooks:** the managed-file guard was wrong about what apply does ([d00c3f7](https://github.com/CodySwannGT/lisa/commit/d00c3f70abb0d8cf3be05796269766a9ffff8a8d)), closes [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624) [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624) [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624)
* **hooks:** treat a `!` .lisaignore pattern as a claim, not a match ([5ea1d5c](https://github.com/CodySwannGT/lisa/commit/5ea1d5c37899600035f364088433f5744b254827)), closes [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624) [CodySwannGT/lisa#2624](https://github.com/CodySwannGT/lisa/issues/2624)

## [3.26.0](https://github.com/CodySwannGT/lisa/compare/v3.24.0...v3.26.0) (2026-08-16)


### Features

* **doctor:** check reusable-workflow callers use the ref their role requires ([2af82bc](https://github.com/CodySwannGT/lisa/commit/2af82bcbd85ee2f19b3edba15eb344a874708166)), closes [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618) [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618) [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618)
* **gates:** façade the dependency audit ([142b99b](https://github.com/CodySwannGT/lisa/commit/142b99b18a0ce91496cb2a6b3d94cbdbe5f65bb2)), closes [#2612](https://github.com/CodySwannGT/lisa/issues/2612) [#2606](https://github.com/CodySwannGT/lisa/issues/2606) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622)


### Bug Fixes

* **doctor:** ignore commented reusable refs ([6682e1b](https://github.com/CodySwannGT/lisa/commit/6682e1be3086a4c590414919bae332ce5e987bc4)), closes [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618)

## [3.25.0](https://github.com/CodySwannGT/lisa/compare/v3.24.0...v3.25.0) (2026-08-16)


### Features

* **doctor:** check reusable-workflow callers use the ref their role requires ([2af82bc](https://github.com/CodySwannGT/lisa/commit/2af82bcbd85ee2f19b3edba15eb344a874708166)), closes [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618) [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618) [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618)
* **gates:** façade the dependency audit ([142b99b](https://github.com/CodySwannGT/lisa/commit/142b99b18a0ce91496cb2a6b3d94cbdbe5f65bb2)), closes [#2612](https://github.com/CodySwannGT/lisa/issues/2612) [#2606](https://github.com/CodySwannGT/lisa/issues/2606) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622) [CodySwannGT/lisa#2622](https://github.com/CodySwannGT/lisa/issues/2622)


### Bug Fixes

* **doctor:** ignore commented reusable refs ([6682e1b](https://github.com/CodySwannGT/lisa/commit/6682e1be3086a4c590414919bae332ce5e987bc4)), closes [CodySwannGT/lisa#2618](https://github.com/CodySwannGT/lisa/issues/2618)

## [3.24.0](https://github.com/CodySwannGT/lisa/compare/v3.23.2...v3.24.0) (2026-08-16)


### Features

* **hooks:** refuse agent writes to copy-overwrite templates ([57b1ac6](https://github.com/CodySwannGT/lisa/commit/57b1ac6c9599e7f31a7a98491a417d242d38060f)), closes [CodySwannGT/lisa#2620](https://github.com/CodySwannGT/lisa/issues/2620) [CodySwannGT/lisa#2620](https://github.com/CodySwannGT/lisa/issues/2620) [CodySwannGT/lisa#2620](https://github.com/CodySwannGT/lisa/issues/2620)

### [3.23.2](https://github.com/CodySwannGT/lisa/compare/v3.23.1...v3.23.2) (2026-08-16)


### Bug Fixes

* **ci:** remove claude-specific actions ([88fa97e](https://github.com/CodySwannGT/lisa/commit/88fa97e5d6c7ea873d51ba0f70088d22048c962f)), closes [CodySwannGT/lisa#2615](https://github.com/CodySwannGT/lisa/issues/2615)

### [3.23.1](https://github.com/CodySwannGT/lisa/compare/v3.23.0...v3.23.1) (2026-08-16)


### Bug Fixes

* **hooks:** let the git hooks find Lisa's scripts in the installed package ([335e0bb](https://github.com/CodySwannGT/lisa/commit/335e0bbe29bc305e765327efa601347b881c672a)), closes [#2612](https://github.com/CodySwannGT/lisa/issues/2612) [CodySwannGT/lisa#2613](https://github.com/CodySwannGT/lisa/issues/2613) [CodySwannGT/lisa#2613](https://github.com/CodySwannGT/lisa/issues/2613) [CodySwannGT/lisa#2613](https://github.com/CodySwannGT/lisa/issues/2613)

## [3.23.0](https://github.com/CodySwannGT/lisa/compare/v3.22.0...v3.23.0) (2026-08-16)


### Features

* **gates:** environment facade — reset and reseed, no implementation ([6a74057](https://github.com/CodySwannGT/lisa/commit/6a7405789031f3425673259383688f0065ad45ec)), closes [#2606](https://github.com/CodySwannGT/lisa/issues/2606) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611)


### Bug Fixes

* **gates:** make `off` actually turn a job off ([f7fcfcd](https://github.com/CodySwannGT/lisa/commit/f7fcfcd038ac17e450a772ba13c84aa0e4e6c3ca)), closes [#2604](https://github.com/CodySwannGT/lisa/issues/2604) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611)
* **gates:** resolve the registry from the package before giving up ([df91795](https://github.com/CodySwannGT/lisa/commit/df91795a18207ccfdf1a30f8a07e0ad0c797632b)), closes [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611)
* **gates:** the facade guidance named a task no gate runs ([4f1c39b](https://github.com/CodySwannGT/lisa/commit/4f1c39b8cebaf7fde26cf55ce7a8b2231522419b)), closes [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611)


### Documentation

* **gates:** argue the facade exemption on subject, not intent ([53b2e04](https://github.com/CodySwannGT/lisa/commit/53b2e040d258929208c23dc5956e80700fc0ebc6)), closes [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611) [CodySwannGT/lisa#2611](https://github.com/CodySwannGT/lisa/issues/2611)

## [3.22.0](https://github.com/CodySwannGT/lisa/compare/v3.21.0...v3.22.0) (2026-08-16)


### Features

* **e2e:** refuse an EAS profile that cannot produce a testable app ([42f45bf](https://github.com/CodySwannGT/lisa/commit/42f45bf5b88bf5405ce614edee7762b34f2d9073)), closes [CodySwannGT/lisa#2609](https://github.com/CodySwannGT/lisa/issues/2609) [CodySwannGT/lisa#2609](https://github.com/CodySwannGT/lisa/issues/2609) [CodySwannGT/lisa#2609](https://github.com/CodySwannGT/lisa/issues/2609)


### Bug Fixes

* **e2e:** pass the EAS profile by env, and realpath the script guard ([7b6e536](https://github.com/CodySwannGT/lisa/commit/7b6e536b128522c295aaf4404bf4ff4bb5b7b951)), closes [CodySwannGT/lisa#2609](https://github.com/CodySwannGT/lisa/issues/2609) [CodySwannGT/lisa#2609](https://github.com/CodySwannGT/lisa/issues/2609)

## [3.21.0](https://github.com/CodySwannGT/lisa/compare/v3.20.0...v3.21.0) (2026-08-16)


### Features

* **gates:** run the gate-config validator in CI ([b93b602](https://github.com/CodySwannGT/lisa/commit/b93b602e7d43855ba4492c81ac6ca1041388d5ab)), closes [CodySwannGT/lisa#2607](https://github.com/CodySwannGT/lisa/issues/2607) [CodySwannGT/lisa#2607](https://github.com/CodySwannGT/lisa/issues/2607) [CodySwannGT/lisa#2607](https://github.com/CodySwannGT/lisa/issues/2607)

## [3.20.0](https://github.com/CodySwannGT/lisa/compare/v3.19.1...v3.20.0) (2026-08-16)


### Features

* **gates:** resolve quality gates at a caller-chosen moment ([162763f](https://github.com/CodySwannGT/lisa/commit/162763f081ee89e740efad154b5053629cf43292)), closes [#2604](https://github.com/CodySwannGT/lisa/issues/2604) [CodySwannGT/lisa#2605](https://github.com/CodySwannGT/lisa/issues/2605) [CodySwannGT/lisa#2605](https://github.com/CodySwannGT/lisa/issues/2605) [CodySwannGT/lisa#2605](https://github.com/CodySwannGT/lisa/issues/2605)

### [3.19.1](https://github.com/CodySwannGT/lisa/compare/v3.19.0...v3.19.1) (2026-08-16)


### Bug Fixes

* **test:** fail empty .mjs suite collection ([5c33e23](https://github.com/CodySwannGT/lisa/commit/5c33e235fc65ac12225da94119f83cf29ee51768)), closes [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603)
* **test:** run the .mjs suites Lisa ships nothing to collect ([5724471](https://github.com/CodySwannGT/lisa/commit/5724471ebd71f0bd407381f53923583b38a9ae8b)), closes [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603)


### Documentation

* **gates:** a CI-skip commit is the converse case, not an instance ([94712d3](https://github.com/CodySwannGT/lisa/commit/94712d3af3c061168060e55aaca7f179d4475b72)), closes [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603)
* **gates:** a template change lands on a schedule nobody chose ([7ecb25a](https://github.com/CodySwannGT/lisa/commit/7ecb25a10d8315dcb5a3a2086651ea766674432e)), closes [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603)
* **gates:** separate what was measured from what was inferred ([655cdd9](https://github.com/CodySwannGT/lisa/commit/655cdd9e455b7a22a61ef01fb184935c9514000a)), closes [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603) [CodySwannGT/lisa#2603](https://github.com/CodySwannGT/lisa/issues/2603)

## [3.19.0](https://github.com/CodySwannGT/lisa/compare/v3.18.2...v3.19.0) (2026-08-16)


### Features

* **health:** add the scheduled drift consumer ([00ba2ed](https://github.com/CodySwannGT/lisa/commit/00ba2ed0b973ba0d006c2edad511c88e00dfce6d)), closes [#3](https://github.com/CodySwannGT/lisa/issues/3) [#1516](https://github.com/CodySwannGT/lisa/issues/1516) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530)


### Bug Fixes

* **health:** invoke the health skill, not an invented CLI flag ([2125964](https://github.com/CodySwannGT/lisa/commit/21259647d6ed4ec43df60b61d74571a9f5b06cf3)), closes [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530)


### Documentation

* **health:** correct drift planner contract ([c21351e](https://github.com/CodySwannGT/lisa/commit/c21351e46317244ce376ae9bd7a1cbd65a6a425c)), closes [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530)
* **health:** say why the drift planner collapses repeated checks ([2326487](https://github.com/CodySwannGT/lisa/commit/232648792d9a298d0ce260b4cd12f2c7723461f0)), closes [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530)
* **health:** state what the drift dedupe does not guarantee ([023eff9](https://github.com/CodySwannGT/lisa/commit/023eff9b802ed84c129475ceb2815991c203794e)), closes [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530) [CodySwannGT/lisa#1530](https://github.com/CodySwannGT/lisa/issues/1530)

### [3.18.2](https://github.com/CodySwannGT/lisa/compare/v3.18.1...v3.18.2) (2026-08-15)


### Bug Fixes

* **intake:** stop the review bot writing lifecycle labels ([b33c624](https://github.com/CodySwannGT/lisa/commit/b33c624552a69e4da1fb7782cceb062fd4118409)), closes [CodySwannGT/lisa#2589](https://github.com/CodySwannGT/lisa/issues/2589) [CodySwannGT/lisa#2589](https://github.com/CodySwannGT/lisa/issues/2589) [CodySwannGT/lisa#2589](https://github.com/CodySwannGT/lisa/issues/2589)

### [3.18.1](https://github.com/CodySwannGT/lisa/compare/v3.18.0...v3.18.1) (2026-08-15)


### Bug Fixes

* **scripts:** sweep the plugin payload for hand-rolled entry guards ([a3709ce](https://github.com/CodySwannGT/lisa/commit/a3709ce615fceb6fac2584c027ec97bcbd4d386b)), closes [#2597](https://github.com/CodySwannGT/lisa/issues/2597) [CodySwannGT/lisa#2597](https://github.com/CodySwannGT/lisa/issues/2597) [CodySwannGT/lisa#2597](https://github.com/CodySwannGT/lisa/issues/2597) [CodySwannGT/lisa#2597](https://github.com/CodySwannGT/lisa/issues/2597)

## [3.18.0](https://github.com/CodySwannGT/lisa/compare/v3.17.3...v3.18.0) (2026-08-15)


### Features

* **console,health:** surface the work-item traceability gate ([36d8880](https://github.com/CodySwannGT/lisa/commit/36d8880fae0edfb9d0b4fa283c9c149f6bc04b68)), closes [#2009](https://github.com/CodySwannGT/lisa/issues/2009) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585)


### Bug Fixes

* **intake:** a trusted claim makes an issue unclaimable ([82d9420](https://github.com/CodySwannGT/lisa/commit/82d942045bb9ac65d2abaa53d23b871a20df4b30)), closes [#2539](https://github.com/CodySwannGT/lisa/issues/2539) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585)
* **intake:** normalize trusted claim labels ([12998de](https://github.com/CodySwannGT/lisa/commit/12998de59c084438d5e0bf56cb3600734457fd92)), closes [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585)
* **work-item:** give run() a stdout, and name an out-of-date gh ([361711f](https://github.com/CodySwannGT/lisa/commit/361711f8a3807b6fb12fe3d5afb43c67696f7caf)), closes [#2180](https://github.com/CodySwannGT/lisa/issues/2180) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585) [CodySwannGT/lisa#2585](https://github.com/CodySwannGT/lisa/issues/2585)

### [3.17.3](https://github.com/CodySwannGT/lisa/compare/v3.17.2...v3.17.3) (2026-08-15)


### Bug Fixes

* **destructive-guard:** match capability names per segment, not whole ([713d689](https://github.com/CodySwannGT/lisa/commit/713d6891615691446776c3058e83abdf5928fbb9)), closes [AcmeOrgD/frontend#536](https://github.com/AcmeOrgD/frontend/issues/536) [CodySwannGT/lisa#2584](https://github.com/CodySwannGT/lisa/issues/2584) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594)
* **hooks:** read the commit message with printf, not echo ([ed172e2](https://github.com/CodySwannGT/lisa/commit/ed172e2d3e455fd63372c3a519dcf8b593e71c2d)), closes [CodySwannGT/lisa#2143](https://github.com/CodySwannGT/lisa/issues/2143) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594)
* **ratchet:** realpath both sides of the entry guard ([99b68c5](https://github.com/CodySwannGT/lisa/commit/99b68c56e7444c36a2f7091d16cf3c4bdf9450a0)), closes [#2531](https://github.com/CodySwannGT/lisa/issues/2531) [#2581](https://github.com/CodySwannGT/lisa/issues/2581) [CodySwannGT/lisa#2582](https://github.com/CodySwannGT/lisa/issues/2582) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594)
* **work-item:** compare pull-request backlinks exactly, not by substring ([16a120d](https://github.com/CodySwannGT/lisa/commit/16a120dc944ec43f1f7360f5fc0ad59a5cde884a)), closes [#123](https://github.com/CodySwannGT/lisa/issues/123) [#12](https://github.com/CodySwannGT/lisa/issues/12) [CodySwannGT/lisa#2586](https://github.com/CodySwannGT/lisa/issues/2586) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594) [CodySwannGT/lisa#2594](https://github.com/CodySwannGT/lisa/issues/2594)

### [3.17.2](https://github.com/CodySwannGT/lisa/compare/v3.17.1...v3.17.2) (2026-08-15)


### Bug Fixes

* **gates:** decide a gate's own skip before consulting a shared result ([33bcc89](https://github.com/CodySwannGT/lisa/commit/33bcc8976b0bf1853846e613bd7610ca322fcb75)), closes [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592) [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592)
* **gates:** run one command once, however many gates name it ([47b79e9](https://github.com/CodySwannGT/lisa/commit/47b79e9116857c989fbd70813788af6d6f4f46ac)), closes [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592) [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592)


### Documentation

* **gates:** record verified-then-invalidated as a sixth defect form ([4588e8f](https://github.com/CodySwannGT/lisa/commit/4588e8f63bc21c13fd498eae5c40253726db58ae)), closes [#2590](https://github.com/CodySwannGT/lisa/issues/2590) [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592) [CodySwannGT/lisa#2592](https://github.com/CodySwannGT/lisa/issues/2592)

### [3.17.1](https://github.com/CodySwannGT/lisa/compare/v3.17.0...v3.17.1) (2026-08-15)


### Bug Fixes

* **gates:** run rewriting gates before the gates that verify the tree ([247a9d7](https://github.com/CodySwannGT/lisa/commit/247a9d7c7a2d92cd87a71fd0fc102fbadaac16b7)), closes [CodySwannGT/lisa#2590](https://github.com/CodySwannGT/lisa/issues/2590) [CodySwannGT/lisa#2590](https://github.com/CodySwannGT/lisa/issues/2590)

## [3.17.0](https://github.com/CodySwannGT/lisa/compare/v3.16.0...v3.17.0) (2026-08-15)


### Features

* **gates:** assert credential and tooling readiness at session start ([891a19d](https://github.com/CodySwannGT/lisa/commit/891a19d1442712a417b37e201d0b6a30147ea453)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)
* **gates:** model gates as properties on one moment axis, plus repo policy ([820ebdf](https://github.com/CodySwannGT/lisa/commit/820ebdfa6648efdacc791edb77c07f8b0c7b87c5)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)
* **gates:** standardize the evidence envelope and add the continuous moment ([7f683f6](https://github.com/CodySwannGT/lisa/commit/7f683f6fe317c2fe77d7f6c98c32e90e23ba452d)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)


### Bug Fixes

* **ci:** give the commit-message gate the history it needs ([0bef2c0](https://github.com/CodySwannGT/lisa/commit/0bef2c0a1219fb7993c3541f18e0d3521fbdf313)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)
* **ci:** stop persisting the checkout token in plugins-sync ([7542521](https://github.com/CodySwannGT/lisa/commit/7542521d588695ab50ed4bd81040ab684f4c6e59)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)
* **gates:** address readiness gate review comments ([ba1c602](https://github.com/CodySwannGT/lisa/commit/ba1c60283b010ae1b9eb21fbd87ff5281f996b85)), closes [codyswanngt/lisa#2579](https://github.com/codyswanngt/lisa/issues/2579)
* **gates:** close the review findings, including a regression this PR introduced ([e121473](https://github.com/CodySwannGT/lisa/commit/e1214737953538d90c0730772af8771b4dfa6d3a)), closes [#2583](https://github.com/CodySwannGT/lisa/issues/2583) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)
* **security:** stop the shipped pre-push audit failing open, and wire the gates ([c83c570](https://github.com/CodySwannGT/lisa/commit/c83c5703f736d773617182584f723ff986437190)), closes [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579) [CodySwannGT/lisa#2579](https://github.com/CodySwannGT/lisa/issues/2579)

## [3.16.0](https://github.com/CodySwannGT/lisa/compare/v3.15.1...v3.16.0) (2026-08-15)


### Features

* **spec:** revise TASC to 0.7.0 and land its Annex B instrument ([fa654f1](https://github.com/CodySwannGT/lisa/commit/fa654f1208c25bcf1715a6e64110db1fca44d883)), closes [CodySwannGT/lisa#2587](https://github.com/CodySwannGT/lisa/issues/2587) [CodySwannGT/lisa#2587](https://github.com/CodySwannGT/lisa/issues/2587)

### [3.15.1](https://github.com/CodySwannGT/lisa/compare/v3.15.0...v3.15.1) (2026-08-15)


### Bug Fixes

* **scripts:** realpath both sides of the entry guard, not just argv[1] ([c5be727](https://github.com/CodySwannGT/lisa/commit/c5be727a817e4e80dedeb16f51602484d970fcc8)), closes [#2581](https://github.com/CodySwannGT/lisa/issues/2581) [CodySwannGT/lisa#2580](https://github.com/CodySwannGT/lisa/issues/2580)
* **scripts:** ship the shared entry guard and cell escaper Lisa's consumers import ([cd66132](https://github.com/CodySwannGT/lisa/commit/cd661320486681ce31e498713f338383108b583b)), closes [#2577](https://github.com/CodySwannGT/lisa/issues/2577) [CodySwannGT/lisa#2580](https://github.com/CodySwannGT/lisa/issues/2580)

## [3.15.0](https://github.com/CodySwannGT/lisa/compare/v3.14.8...v3.15.0) (2026-08-14)


### Features

* **secrets:** add a propagate contract for copying a secret into a second store ([87a2c5d](https://github.com/CodySwannGT/lisa/commit/87a2c5dbfb5648ba8a05bc0130544a4e79d41029)), closes [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [CodySwannGT/lisa#2575](https://github.com/CodySwannGT/lisa/issues/2575)

### [3.14.8](https://github.com/CodySwannGT/lisa/compare/v3.14.7...v3.14.8) (2026-08-14)


### Bug Fixes

* **ci:** separate the three causes the traceability scope-gap error collapsed ([d348658](https://github.com/CodySwannGT/lisa/commit/d348658e1b50d76fd54b2d4c6ba310eadcf30745)), closes [#2571](https://github.com/CodySwannGT/lisa/issues/2571) [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [#2566](https://github.com/CodySwannGT/lisa/issues/2566) [CodySwannGT/lisa#2573](https://github.com/CodySwannGT/lisa/issues/2573)

### [3.14.7](https://github.com/CodySwannGT/lisa/compare/v3.14.6...v3.14.7) (2026-08-14)


### Bug Fixes

* **ci:** move the permissions floor onto jobs so traceability can inherit ([f5ce729](https://github.com/CodySwannGT/lisa/commit/f5ce7294b5b36dc83f187c60d949eadfd305c2bf)), closes [AcmeOrgA/backend#976](https://github.com/AcmeOrgA/backend/issues/976) [acmeorgb/backend-v2#2999](https://github.com/acmeorgb/backend-v2/issues/2999) [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [#2566](https://github.com/CodySwannGT/lisa/issues/2566) [#1769](https://github.com/CodySwannGT/lisa/issues/1769) [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [CodySwannGT/lisa#2571](https://github.com/CodySwannGT/lisa/issues/2571)

### [3.14.6](https://github.com/CodySwannGT/lisa/compare/v3.14.5...v3.14.6) (2026-08-14)

### [3.14.5](https://github.com/CodySwannGT/lisa/compare/v3.14.4...v3.14.5) (2026-08-14)


### Bug Fixes

* **intake:** address CodeRabbit review on lifecycle-label trust ([2b506f0](https://github.com/CodySwannGT/lisa/commit/2b506f0f5a852ac0d54c811595d4634fcc04a018)), closes [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2494](https://github.com/CodySwannGT/lisa/issues/2494) [CodySwannGT/lisa#2539](https://github.com/CodySwannGT/lisa/issues/2539)
* **intake:** stop believing bot-authored lifecycle labels ([ee022e1](https://github.com/CodySwannGT/lisa/commit/ee022e168a09894c3be2263f7954085053694561)), closes [#2460](https://github.com/CodySwannGT/lisa/issues/2460) [-#2540](https://github.com/CodySwannGT/-/issues/2540) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2538](https://github.com/CodySwannGT/lisa/issues/2538) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2494](https://github.com/CodySwannGT/lisa/issues/2494) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2494](https://github.com/CodySwannGT/lisa/issues/2494) [CodySwannGT/lisa#2539](https://github.com/CodySwannGT/lisa/issues/2539)

### [3.14.4](https://github.com/CodySwannGT/lisa/compare/v3.14.3...v3.14.4) (2026-08-14)


### Bug Fixes

* **maestro:** stop leg_order escalating the caller's grant and failing on a flaky API ([37f1c5b](https://github.com/CodySwannGT/lisa/commit/37f1c5b7fd2e303d5136cc74a025eb4bd870db39)), closes [#2563](https://github.com/CodySwannGT/lisa/issues/2563) [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [CodySwannGT/lisa#2566](https://github.com/CodySwannGT/lisa/issues/2566)

### [3.14.3](https://github.com/CodySwannGT/lisa/compare/v3.14.2...v3.14.3) (2026-08-14)


### Bug Fixes

* **hooks:** gate generated artifacts at commit time, not post-merge ([8f03ccc](https://github.com/CodySwannGT/lisa/commit/8f03ccc704e4bb8401987e7cf7cf6c31a0f761d0)), closes [#2557](https://github.com/CodySwannGT/lisa/issues/2557) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [#2560](https://github.com/CodySwannGT/lisa/issues/2560) [CodySwannGT/lisa#2559](https://github.com/CodySwannGT/lisa/issues/2559)
* **maestro:** stop leg_order escalating the caller's grant and failing on a flaky API ([37f1c5b](https://github.com/CodySwannGT/lisa/commit/37f1c5b7fd2e303d5136cc74a025eb4bd870db39)), closes [#2563](https://github.com/CodySwannGT/lisa/issues/2563) [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [CodySwannGT/lisa#2566](https://github.com/CodySwannGT/lisa/issues/2566)

### [3.14.2](https://github.com/CodySwannGT/lisa/compare/v3.14.1...v3.14.2) (2026-08-14)


### Bug Fixes

* **build:** stamp the ownership header as the build generates copy-overwrite assets ([706c714](https://github.com/CodySwannGT/lisa/commit/706c71498953d2eb8bb1cb7151249ddcd308fef1)), closes [#2545](https://github.com/CodySwannGT/lisa/issues/2545) [#2545](https://github.com/CodySwannGT/lisa/issues/2545) [#2549](https://github.com/CodySwannGT/lisa/issues/2549) [#2549](https://github.com/CodySwannGT/lisa/issues/2549) [#2549](https://github.com/CodySwannGT/lisa/issues/2549) [CodySwannGT/lisa#2547](https://github.com/CodySwannGT/lisa/issues/2547)
* **hooks:** gate generated artifacts at commit time, not post-merge ([8f03ccc](https://github.com/CodySwannGT/lisa/commit/8f03ccc704e4bb8401987e7cf7cf6c31a0f761d0)), closes [#2557](https://github.com/CodySwannGT/lisa/issues/2557) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [#2560](https://github.com/CodySwannGT/lisa/issues/2560) [CodySwannGT/lisa#2559](https://github.com/CodySwannGT/lisa/issues/2559)

### [3.14.1](https://github.com/CodySwannGT/lisa/compare/v3.14.0...v3.14.1) (2026-08-14)


### Bug Fixes

* **apply:** own every enforcement script Lisa ships, not just the lisa- ones ([5285008](https://github.com/CodySwannGT/lisa/commit/5285008cf5c873e532111ac3c51725c1757a7c98)), closes [#2551](https://github.com/CodySwannGT/lisa/issues/2551) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [CodySwannGT/lisa#2551](https://github.com/CodySwannGT/lisa/issues/2551)

## [3.14.0](https://github.com/CodySwannGT/lisa/compare/v3.13.2...v3.14.0) (2026-08-14)


### Features

* **maestro:** order the platform legs so one persona is not driven twice at once ([724f373](https://github.com/CodySwannGT/lisa/commit/724f3737dfcda157a864aa9d6d9d784c7924e2f3)), closes [CodySwannGT/lisa#2540](https://github.com/CodySwannGT/lisa/issues/2540)


### Bug Fixes

* **apply:** own every enforcement script Lisa ships, not just the lisa- ones ([5285008](https://github.com/CodySwannGT/lisa/commit/5285008cf5c873e532111ac3c51725c1757a7c98)), closes [#2551](https://github.com/CodySwannGT/lisa/issues/2551) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2556](https://github.com/CodySwannGT/lisa/issues/2556) [CodySwannGT/lisa#2551](https://github.com/CodySwannGT/lisa/issues/2551)

### [3.13.2](https://github.com/CodySwannGT/lisa/compare/v3.13.1...v3.13.2) (2026-08-14)


### Bug Fixes

* **parity:** make the push gate read the artifacts it vouches for ([39a316e](https://github.com/CodySwannGT/lisa/commit/39a316e1f548c82b5b2dcea4019e5bef2b23232c)), closes [#2402](https://github.com/CodySwannGT/lisa/issues/2402) [#2546](https://github.com/CodySwannGT/lisa/issues/2546) [#2548](https://github.com/CodySwannGT/lisa/issues/2548) [CodySwannGT/lisa#2552](https://github.com/CodySwannGT/lisa/issues/2552)

### [3.13.1](https://github.com/CodySwannGT/lisa/compare/v3.13.0...v3.13.1) (2026-08-14)


### Bug Fixes

* **apply:** gate the ledger on current bytes, not byte-exact regeneration ([0a9e16b](https://github.com/CodySwannGT/lisa/commit/0a9e16b373c0a1464b22f757df48016a88c23bb3)), closes [CodySwannGT/lisa#2470](https://github.com/CodySwannGT/lisa/issues/2470)
* **apply:** stop a capability marker from authorising an overwrite ([7c69a36](https://github.com/CodySwannGT/lisa/commit/7c69a36738ab9c39fded59e36a02c3b2c8e3751d)), closes [#2554](https://github.com/CodySwannGT/lisa/issues/2554) [CodySwannGT/lisa#2470](https://github.com/CodySwannGT/lisa/issues/2470)

## [3.13.0](https://github.com/CodySwannGT/lisa/compare/v3.12.0...v3.13.0) (2026-08-14)


### Features

* **apply:** prove a Lisa-owned copy is stale before overwriting it ([8e274ba](https://github.com/CodySwannGT/lisa/commit/8e274babd704633ae6ca526315c10ba742b67119)), closes [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [#2491](https://github.com/CodySwannGT/lisa/issues/2491) [CodySwannGT/lisa#2470](https://github.com/CodySwannGT/lisa/issues/2470)


### Bug Fixes

* **state:** regenerate the stale Lisa-owned hash ledger ([0e25b98](https://github.com/CodySwannGT/lisa/commit/0e25b98960115e6fe134e1ca1df9354fb8aa8a04)), closes [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2545](https://github.com/CodySwannGT/lisa/issues/2545) [#2491](https://github.com/CodySwannGT/lisa/issues/2491) [#2470](https://github.com/CodySwannGT/lisa/issues/2470) [#2557](https://github.com/CodySwannGT/lisa/issues/2557) [CodySwannGT/lisa#2557](https://github.com/CodySwannGT/lisa/issues/2557)
* **templates:** make silence a failure, not an exemption, in create-only ([f0509a9](https://github.com/CodySwannGT/lisa/commit/f0509a92b9dedd28c165b20a3f11fad5437ae223)), closes [#2538](https://github.com/CodySwannGT/lisa/issues/2538) [#2545](https://github.com/CodySwannGT/lisa/issues/2545) [#2538](https://github.com/CodySwannGT/lisa/issues/2538) [#2545](https://github.com/CodySwannGT/lisa/issues/2545) [#2547](https://github.com/CodySwannGT/lisa/issues/2547) [CodySwannGT/lisa#2549](https://github.com/CodySwannGT/lisa/issues/2549)

## [3.12.0](https://github.com/CodySwannGT/lisa/compare/v3.11.9...v3.12.0) (2026-08-14)


### Features

* **apply:** prove a Lisa-owned copy is stale before overwriting it ([8e274ba](https://github.com/CodySwannGT/lisa/commit/8e274babd704633ae6ca526315c10ba742b67119)), closes [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [#2491](https://github.com/CodySwannGT/lisa/issues/2491) [CodySwannGT/lisa#2470](https://github.com/CodySwannGT/lisa/issues/2470)
* **state:** make the reset/reseed production refusal executable ([5142b18](https://github.com/CodySwannGT/lisa/commit/5142b180b79bd16e18fb9c545eaf08483391fa76)), closes [CodySwannGT/lisa#2491](https://github.com/CodySwannGT/lisa/issues/2491)

### [3.11.9](https://github.com/CodySwannGT/lisa/compare/v3.11.8...v3.11.9) (2026-08-14)


### Bug Fixes

* **ci:** make work-item traceability fail when it cannot verify, and repair block-less callers ([e08cd22](https://github.com/CodySwannGT/lisa/commit/e08cd22dc6930e63908fa3d0652e20cf387363ec)), closes [#2049](https://github.com/CodySwannGT/lisa/issues/2049) [#1769](https://github.com/CodySwannGT/lisa/issues/1769) [CodySwannGT/lisa#2476](https://github.com/CodySwannGT/lisa/issues/2476)
* **parity:** catch both routing artifacts up to their skill pins ([04337df](https://github.com/CodySwannGT/lisa/commit/04337df15d38407a5f5a2acecd794d2f0255dffe)), closes [CodySwannGT/lisa#2544](https://github.com/CodySwannGT/lisa/issues/2544) [CodySwannGT/lisa#2544](https://github.com/CodySwannGT/lisa/issues/2544)

### [3.11.8](https://github.com/CodySwannGT/lisa/compare/v3.11.7...v3.11.8) (2026-08-14)


### Bug Fixes

* **plans:** delete unbounded actionlint instruction and archive shipped plan ([076154f](https://github.com/CodySwannGT/lisa/commit/076154fde880a48d1f35c48e0e0f63ca05cb8ee3)), closes [#278](https://github.com/CodySwannGT/lisa/issues/278) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2520](https://github.com/CodySwannGT/lisa/issues/2520)
* **templates:** state each lane's real ownership contract in its header ([a40d58b](https://github.com/CodySwannGT/lisa/commit/a40d58b2420ea5cbebbc06ed94a45b0cb6ea7886)), closes [#2538](https://github.com/CodySwannGT/lisa/issues/2538) [CodySwannGT/lisa#2538](https://github.com/CodySwannGT/lisa/issues/2538)

### [3.11.7](https://github.com/CodySwannGT/lisa/compare/v3.11.6...v3.11.7) (2026-08-14)


### Bug Fixes

* **ci:** refuse a headroom entry sized from a run the budget terminated ([5263c31](https://github.com/CodySwannGT/lisa/commit/5263c317acb5e1b954b564b286941ab94e1d69a1)), closes [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2523](https://github.com/CodySwannGT/lisa/issues/2523) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2523](https://github.com/CodySwannGT/lisa/issues/2523) [CodySwannGT/lisa#2528](https://github.com/CodySwannGT/lisa/issues/2528)
* **templates:** state each lane's real ownership contract in its header ([a40d58b](https://github.com/CodySwannGT/lisa/commit/a40d58b2420ea5cbebbc06ed94a45b0cb6ea7886)), closes [#2538](https://github.com/CodySwannGT/lisa/issues/2538) [CodySwannGT/lisa#2538](https://github.com/CodySwannGT/lisa/issues/2538)


### Documentation

* **ci:** cite a non-test instance of a duration that measures nothing ([10dcaf9](https://github.com/CodySwannGT/lisa/commit/10dcaf93ba897cd392c943ee7aec454603d6cf5e)), closes [#2520](https://github.com/CodySwannGT/lisa/issues/2520) [CodySwannGT/lisa#2528](https://github.com/CodySwannGT/lisa/issues/2528)

### [3.11.6](https://github.com/CodySwannGT/lisa/compare/v3.11.4...v3.11.6) (2026-08-14)


### Bug Fixes

* **ci:** invoke ast-grep directly so the rule-test step is self-sufficient ([896155f](https://github.com/CodySwannGT/lisa/commit/896155fedf4d88df3170cc8bf2b9f5ca11ccca97)), closes [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [#2533](https://github.com/CodySwannGT/lisa/issues/2533) [#2530](https://github.com/CodySwannGT/lisa/issues/2530) [CodySwannGT/lisa#2530](https://github.com/CodySwannGT/lisa/issues/2530)
* **ratchet:** let a promotion carry an exemption its upstream already approved ([d5bc18d](https://github.com/CodySwannGT/lisa/commit/d5bc18d57142d010184b31fcd2fe24491a1696db)), closes [AcmeOrgD/frontend#527](https://github.com/AcmeOrgD/frontend/issues/527) [CodySwannGT/lisa#2531](https://github.com/CodySwannGT/lisa/issues/2531)

### [3.11.5](https://github.com/CodySwannGT/lisa/compare/v3.11.4...v3.11.5) (2026-08-14)


### Bug Fixes

* **ci:** invoke ast-grep directly so the rule-test step is self-sufficient ([896155f](https://github.com/CodySwannGT/lisa/commit/896155fedf4d88df3170cc8bf2b9f5ca11ccca97)), closes [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [#2533](https://github.com/CodySwannGT/lisa/issues/2533) [#2530](https://github.com/CodySwannGT/lisa/issues/2530) [CodySwannGT/lisa#2530](https://github.com/CodySwannGT/lisa/issues/2530)
* **ratchet:** let a promotion carry an exemption its upstream already approved ([d5bc18d](https://github.com/CodySwannGT/lisa/commit/d5bc18d57142d010184b31fcd2fe24491a1696db)), closes [AcmeOrgD/frontend#527](https://github.com/AcmeOrgD/frontend/issues/527) [CodySwannGT/lisa#2531](https://github.com/CodySwannGT/lisa/issues/2531)

### [3.11.4](https://github.com/CodySwannGT/lisa/compare/v3.11.3...v3.11.4) (2026-08-13)


### Bug Fixes

* **automations:** stop erasing unknown run-record fields from the whole history ([b937a56](https://github.com/CodySwannGT/lisa/commit/b937a56d6ae355522e9fc1aaf7d954a3e2a7c484)), closes [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [CodySwannGT/lisa#2524](https://github.com/CodySwannGT/lisa/issues/2524)

### [3.11.3](https://github.com/CodySwannGT/lisa/compare/v3.11.2...v3.11.3) (2026-08-13)


### Bug Fixes

* **automations:** stop erasing unknown run-record fields from the whole history ([b937a56](https://github.com/CodySwannGT/lisa/commit/b937a56d6ae355522e9fc1aaf7d954a3e2a7c484)), closes [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [CodySwannGT/lisa#2524](https://github.com/CodySwannGT/lisa/issues/2524)
* **ci:** do not run sg:test before the script exists in the host project ([4518cab](https://github.com/CodySwannGT/lisa/commit/4518cab8a35c2a575e5fb52e6cd00dd346f27aca)), closes [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [#2990](https://github.com/CodySwannGT/lisa/issues/2990) [#2505](https://github.com/CodySwannGT/lisa/issues/2505) [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [#2525](https://github.com/CodySwannGT/lisa/issues/2525) [CodySwannGT/lisa#2532](https://github.com/CodySwannGT/lisa/issues/2532)

### [3.11.2](https://github.com/CodySwannGT/lisa/compare/v3.11.1...v3.11.2) (2026-08-13)


### Bug Fixes

* **tests:** complete the health abort fix and restore the guards it dropped ([4d6b427](https://github.com/CodySwannGT/lisa/commit/4d6b427cf66e52ecda471e5939e5e964bb9721c1)), closes [CodySwannGT/lisa#2516](https://github.com/CodySwannGT/lisa/issues/2516) [CodySwannGT/lisa#2523](https://github.com/CodySwannGT/lisa/issues/2523) [#2521](https://github.com/CodySwannGT/lisa/issues/2521) [CodySwannGT/lisa#2516](https://github.com/CodySwannGT/lisa/issues/2516)

### [3.11.1](https://github.com/CodySwannGT/lisa/compare/v3.11.0...v3.11.1) (2026-08-13)


### Bug Fixes

* **ci:** correct the [#2523](https://github.com/CodySwannGT/lisa/issues/2523) headroom reading in the promotion ledger ([c02ea95](https://github.com/CodySwannGT/lisa/commit/c02ea955c98ecb5b5b0fe31b51276db3a1482ab7)), closes [#2526](https://github.com/CodySwannGT/lisa/issues/2526) [CodySwannGT/lisa#2506](https://github.com/CodySwannGT/lisa/issues/2506)
* **ci:** make the ast-grep scan block a merge instead of merely reddening ([981d654](https://github.com/CodySwannGT/lisa/commit/981d6549ad6550866914668c6866e3742dfa81b8)), closes [#2512](https://github.com/CodySwannGT/lisa/issues/2512) [#2512](https://github.com/CodySwannGT/lisa/issues/2512) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2512](https://github.com/CodySwannGT/lisa/issues/2512) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2506](https://github.com/CodySwannGT/lisa/issues/2506) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2506](https://github.com/CodySwannGT/lisa/issues/2506)

## [3.11.0](https://github.com/CodySwannGT/lisa/compare/v3.10.0...v3.11.0) (2026-08-13)


### Features

* **ci:** refuse a required status context whose headroom nobody proved ([02fb6d8](https://github.com/CodySwannGT/lisa/commit/02fb6d8e7ea59b96a7e09065ee6996f1507a4fcc)), closes [#2496](https://github.com/CodySwannGT/lisa/issues/2496) [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2509](https://github.com/CodySwannGT/lisa/issues/2509)

## [3.10.0](https://github.com/CodySwannGT/lisa/compare/v3.9.2...v3.10.0) (2026-08-13)


### Features

* **ci:** refuse a required status context whose headroom nobody proved ([02fb6d8](https://github.com/CodySwannGT/lisa/commit/02fb6d8e7ea59b96a7e09065ee6996f1507a4fcc)), closes [#2496](https://github.com/CodySwannGT/lisa/issues/2496) [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2509](https://github.com/CodySwannGT/lisa/issues/2509)


### Bug Fixes

* **ast-grep:** run the rule tests instead of only shipping them ([7b3d768](https://github.com/CodySwannGT/lisa/commit/7b3d76866ffb94fb09359e9e431f703bafa58dcd)), closes [#2494](https://github.com/CodySwannGT/lisa/issues/2494) [CodySwannGT/lisa#2505](https://github.com/CodySwannGT/lisa/issues/2505)

### [3.9.2](https://github.com/CodySwannGT/lisa/compare/v3.9.1...v3.9.2) (2026-08-13)


### Bug Fixes

* **tests:** give Lisa's own suite a liveness budget it can actually meet ([1d815ac](https://github.com/CodySwannGT/lisa/commit/1d815ac5611ebdc482d2383defb7392871e50ab2)), closes [#2509](https://github.com/CodySwannGT/lisa/issues/2509) [CodySwannGT/lisa#2522](https://github.com/CodySwannGT/lisa/issues/2522)

### [3.9.1](https://github.com/CodySwannGT/lisa/compare/v3.9.0...v3.9.1) (2026-08-13)


### Bug Fixes

* **tests:** make agentic health timeout tests scheduler-independent ([6612df0](https://github.com/CodySwannGT/lisa/commit/6612df0c180ae9f2c29550e341a5998c0b413ef5)), closes [CodySwannGT/lisa#2516](https://github.com/CodySwannGT/lisa/issues/2516)

## [3.9.0](https://github.com/CodySwannGT/lisa/compare/v3.8.2...v3.9.0) (2026-08-13)


### Features

* **maestro-e2e:** add opt-in concurrency_group so suites sharing a backend can exclude each other ([c741a7b](https://github.com/CodySwannGT/lisa/commit/c741a7bba5bd803e7d5706080258c2a4f46f879e)), closes [#1316](https://github.com/CodySwannGT/lisa/issues/1316) [CodySwannGT/lisa#2504](https://github.com/CodySwannGT/lisa/issues/2504)

### [3.8.2](https://github.com/CodySwannGT/lisa/compare/v3.8.1...v3.8.2) (2026-08-13)


### Documentation

* **plan:** record the 2026-08-13 governance findings and dogfooding audit ([f3c687a](https://github.com/CodySwannGT/lisa/commit/f3c687a10269b0ffd9a910750a0840b2edbbe5df)), closes [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [#2485](https://github.com/CodySwannGT/lisa/issues/2485) [#2492](https://github.com/CodySwannGT/lisa/issues/2492) [#2489](https://github.com/CodySwannGT/lisa/issues/2489) [#2491](https://github.com/CodySwannGT/lisa/issues/2491) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)

### [3.8.1](https://github.com/CodySwannGT/lisa/compare/v3.8.0...v3.8.1) (2026-08-13)


### Bug Fixes

* **ci:** repair the dangling `test` edges that broke workflow startup ([eebf234](https://github.com/CodySwannGT/lisa/commit/eebf23490bb55082eddce70c32e5f8f74d26baca)), closes [CodySwannGT/lisa#2485](https://github.com/CodySwannGT/lisa/issues/2485)
* **ci:** require the parity check, delete the duplicate test job ([1ee06f2](https://github.com/CodySwannGT/lisa/commit/1ee06f2260153592447b20003322ac799a713ab5)), closes [#2485](https://github.com/CodySwannGT/lisa/issues/2485) [#2469](https://github.com/CodySwannGT/lisa/issues/2469) [#2451](https://github.com/CodySwannGT/lisa/issues/2451) [#2457](https://github.com/CodySwannGT/lisa/issues/2457) [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [#2496](https://github.com/CodySwannGT/lisa/issues/2496) [#1397](https://github.com/CodySwannGT/lisa/issues/1397) [#1578](https://github.com/CodySwannGT/lisa/issues/1578) [#2456](https://github.com/CodySwannGT/lisa/issues/2456) [#2461](https://github.com/CodySwannGT/lisa/issues/2461) [CodySwannGT/lisa#2485](https://github.com/CodySwannGT/lisa/issues/2485)


### Documentation

* **plan:** record the 2026-08-13 governance findings and dogfooding audit ([f3c687a](https://github.com/CodySwannGT/lisa/commit/f3c687a10269b0ffd9a910750a0840b2edbbe5df)), closes [#2497](https://github.com/CodySwannGT/lisa/issues/2497) [#2485](https://github.com/CodySwannGT/lisa/issues/2485) [#2492](https://github.com/CodySwannGT/lisa/issues/2492) [#2489](https://github.com/CodySwannGT/lisa/issues/2489) [#2491](https://github.com/CodySwannGT/lisa/issues/2491) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)

## [3.8.0](https://github.com/CodySwannGT/lisa/compare/v3.7.0...v3.8.0) (2026-08-13)


### Features

* **ast-grep:** ban fs-extra namespace members that do not exist under Node ESM ([27c9d73](https://github.com/CodySwannGT/lisa/commit/27c9d7335c3a80254344dd547ac06850edc01bf9)), closes [#2482](https://github.com/CodySwannGT/lisa/issues/2482) [#2487](https://github.com/CodySwannGT/lisa/issues/2487) [#2500](https://github.com/CodySwannGT/lisa/issues/2500) [CodySwannGT/lisa#2494](https://github.com/CodySwannGT/lisa/issues/2494)
* **ci:** detect a required check that satisfies while doing no work ([764fd48](https://github.com/CodySwannGT/lisa/commit/764fd48a00c57fd2611f6a58ac8b9a9fb9d82039)), closes [#2483](https://github.com/CodySwannGT/lisa/issues/2483) [#2484](https://github.com/CodySwannGT/lisa/issues/2484) [#2483](https://github.com/CodySwannGT/lisa/issues/2483) [#2350](https://github.com/CodySwannGT/lisa/issues/2350) [CodySwannGT/lisa#2497](https://github.com/CodySwannGT/lisa/issues/2497)
* **rules:** name the wrong-quantifier cause of a zero cardinality ([032287c](https://github.com/CodySwannGT/lisa/commit/032287c0636f96a7a3f8160bd0306d7e25e3eb6c)), closes [CodySwannGT/lisa#2489](https://github.com/CodySwannGT/lisa/issues/2489)
* **rules:** ship the cardinality yardstick in falsifiable-checks ([3db642b](https://github.com/CodySwannGT/lisa/commit/3db642bab5e44c14e63a42c0d1202639ce0b6468)), closes [CodySwannGT/lisa#2489](https://github.com/CodySwannGT/lisa/issues/2489)
* **rules:** state the contention asymmetry for cardinality readings ([a1ba680](https://github.com/CodySwannGT/lisa/commit/a1ba68085ab84a2b6eae7a6ed9769ad3bb1412b7)), closes [#2501](https://github.com/CodySwannGT/lisa/issues/2501) [CodySwannGT/lisa#2489](https://github.com/CodySwannGT/lisa/issues/2489)


### Bug Fixes

* **ast-grep:** scope the fs-extra rule to code Node runs directly ([f7d6060](https://github.com/CodySwannGT/lisa/commit/f7d606019ec9bb4bf408dc1b7dc84c9bd2a66d23)), closes [CodySwannGT/lisa#2494](https://github.com/CodySwannGT/lisa/issues/2494)

## [3.7.0](https://github.com/CodySwannGT/lisa/compare/v3.6.2...v3.7.0) (2026-08-13)


### Features

* **doctor:** report accumulated agent worktrees with a count and repair hint ([29621c0](https://github.com/CodySwannGT/lisa/commit/29621c0ebe0c6db9d98102161b5d69c41ccbb0c9)), closes [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [CodySwannGT/lisa#2490](https://github.com/CodySwannGT/lisa/issues/2490)


### Bug Fixes

* **tests:** give five marginal-budget suites a budget that measures the code ([8495eff](https://github.com/CodySwannGT/lisa/commit/8495eff991f5805b0a02f2cc70a1dba33fa4c75d)), closes [#2499](https://github.com/CodySwannGT/lisa/issues/2499) [#2490](https://github.com/CodySwannGT/lisa/issues/2490) [CodySwannGT/lisa#2490](https://github.com/CodySwannGT/lisa/issues/2490)

### [3.6.2](https://github.com/CodySwannGT/lisa/compare/v3.6.1...v3.6.2) (2026-08-13)


### Bug Fixes

* **learnings:** wait on a wall-clock budget instead of a retry count ([6747aea](https://github.com/CodySwannGT/lisa/commit/6747aeacecb96c636f243d14a9808813991caeb0)), closes [CodySwannGT/lisa#2474](https://github.com/CodySwannGT/lisa/issues/2474)


### Code Refactoring

* **learnings:** keep the stale-reclaim call site out of this diff ([ffdef03](https://github.com/CodySwannGT/lisa/commit/ffdef039a9066f696eff482e8076534543d161cd)), closes [#2488](https://github.com/CodySwannGT/lisa/issues/2488) [CodySwannGT/lisa#2474](https://github.com/CodySwannGT/lisa/issues/2474)

### [3.6.1](https://github.com/CodySwannGT/lisa/compare/v3.6.0...v3.6.1) (2026-08-13)

## [3.6.0](https://github.com/CodySwannGT/lisa/compare/v3.5.4...v3.6.0) (2026-08-13)


### Features

* **hooks:** refuse undeclared tracker creations at the tool call ([3f7c1a6](https://github.com/CodySwannGT/lisa/commit/3f7c1a695c697922708dab66901792159f8e6e25)), closes [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486)


### Bug Fixes

* **hooks:** close two bypasses in the issue-create guard found by self-review ([c939ddb](https://github.com/CodySwannGT/lisa/commit/c939ddb6ff2624800f5dd438c14ad52fffa218de)), closes [#2469](https://github.com/CodySwannGT/lisa/issues/2469) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486)
* **hooks:** make the issue-create guard fail closed, not open ([890fb4e](https://github.com/CodySwannGT/lisa/commit/890fb4eb34ebc87fba2c4bbb3dd618a2070a0652)), closes [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486)
* **hooks:** refuse declarations made after a bare `--`, and state what binds ([dee74ce](https://github.com/CodySwannGT/lisa/commit/dee74ce32e22acb327e703bbfbb5cb77c3ceea4c)), closes [#2495](https://github.com/CodySwannGT/lisa/issues/2495) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486)
* **tracker:** persist runtime_behavior_change so S8/S11/S14/S19 are decidable ([893ada2](https://github.com/CodySwannGT/lisa/commit/893ada27718e7f97a330dc810ff93947144a6f02)), closes [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486) [CodySwannGT/lisa#2486](https://github.com/CodySwannGT/lisa/issues/2486)

### [3.5.4](https://github.com/CodySwannGT/lisa/compare/v3.5.3...v3.5.4) (2026-08-13)


### Bug Fixes

* **core:** stop two fs-extra namespace calls from failing silently in catch blocks ([639f26d](https://github.com/CodySwannGT/lisa/commit/639f26db10ed951e18af9fd21b73ebdea17ca17b)), closes [#2482](https://github.com/CodySwannGT/lisa/issues/2482) [#2484](https://github.com/CodySwannGT/lisa/issues/2484) [#2484](https://github.com/CodySwannGT/lisa/issues/2484) [CodySwannGT/lisa#2487](https://github.com/CodySwannGT/lisa/issues/2487)

### [3.5.3](https://github.com/CodySwannGT/lisa/compare/v3.5.2...v3.5.3) (2026-08-13)


### Bug Fixes

* **learnings:** make stale-lock reclaim atomic so no live lock is ever deleted ([63e645d](https://github.com/CodySwannGT/lisa/commit/63e645dedf307148f02f8e9cb8cf153e18ce183c)), closes [CodySwannGT/lisa#2488](https://github.com/CodySwannGT/lisa/issues/2488)

### [3.5.2](https://github.com/CodySwannGT/lisa/compare/v3.5.1...v3.5.2) (2026-08-13)


### Bug Fixes

* **maestro-e2e:** never let the pre-suite job conclude `skipped` ([13af671](https://github.com/CodySwannGT/lisa/commit/13af671d7942a218c56e8ae750f51a9a961265e6)), closes [#2478](https://github.com/CodySwannGT/lisa/issues/2478) [CodySwannGT/lisa#2493](https://github.com/CodySwannGT/lisa/issues/2493)

### [3.5.1](https://github.com/CodySwannGT/lisa/compare/v3.5.0...v3.5.1) (2026-08-13)


### Bug Fixes

* **maestro-e2e:** add a once-per-run pre_suite_command seam ([ce9faa5](https://github.com/CodySwannGT/lisa/commit/ce9faa50958d81be04f0e0e69a0f3f1e011d7ea1)), closes [CodySwannGT/lisa#2475](https://github.com/CodySwannGT/lisa/issues/2475)

## [3.5.0](https://github.com/CodySwannGT/lisa/compare/v3.4.1...v3.5.0) (2026-08-13)


### Features

* **access:** give four access layers a provider rung and date the keychain ramp ([fd96f5f](https://github.com/CodySwannGT/lisa/commit/fd96f5fa37f0393c350ac3ef06e46e9c655e217e)), closes [#2437](https://github.com/CodySwannGT/lisa/issues/2437) [CodySwannGT/lisa#2438](https://github.com/CodySwannGT/lisa/issues/2438) [#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)
* **doctor:** report a learnings merge driver git cannot actually run ([e117ea2](https://github.com/CodySwannGT/lisa/commit/e117ea264d11a46f7268bffe7f3bd943e101da17)), closes [CodySwannGT/lisa#2435](https://github.com/CodySwannGT/lisa/issues/2435) [#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)


### Bug Fixes

* **bdd:** repair the nine real defects in the vendored v2 gate sources ([c3c45f0](https://github.com/CodySwannGT/lisa/commit/c3c45f0088094bdb3d6c21755024a387b3e4f190)), closes [#1](https://github.com/CodySwannGT/lisa/issues/1) [#2](https://github.com/CodySwannGT/lisa/issues/2) [#4](https://github.com/CodySwannGT/lisa/issues/4) [#9](https://github.com/CodySwannGT/lisa/issues/9) [#6](https://github.com/CodySwannGT/lisa/issues/6) [#8](https://github.com/CodySwannGT/lisa/issues/8) [#10](https://github.com/CodySwannGT/lisa/issues/10) [#5](https://github.com/CodySwannGT/lisa/issues/5) [#7](https://github.com/CodySwannGT/lisa/issues/7) [#8](https://github.com/CodySwannGT/lisa/issues/8) [CodySwannGT/lisa#2468](https://github.com/CodySwannGT/lisa/issues/2468)
* **ci:** refuse to answer from an untranscribed required-checks snapshot ([56dd4e0](https://github.com/CodySwannGT/lisa/commit/56dd4e048c21e7c222d635502de2c25466995d55)), closes [#2472](https://github.com/CodySwannGT/lisa/issues/2472) [#2476](https://github.com/CodySwannGT/lisa/issues/2476) [CodySwannGT/lisa#2476](https://github.com/CodySwannGT/lisa/issues/2476)
* **ci:** run the skipped-required-check guard, and report a spaced skip_jobs token ([123336a](https://github.com/CodySwannGT/lisa/commit/123336a26011b7efc32f006a62998a3f9088be3f)), closes [CodySwannGT/lisa#2426](https://github.com/CodySwannGT/lisa/issues/2426)
* **migrations:** read and write through node:fs/promises, not the fs-extra namespace ([3533889](https://github.com/CodySwannGT/lisa/commit/3533889cfb86825c53b61f2f1fb674b122aedef9)), closes [#2471](https://github.com/CodySwannGT/lisa/issues/2471) [#2472](https://github.com/CodySwannGT/lisa/issues/2472) [#2473](https://github.com/CodySwannGT/lisa/issues/2473) [CodySwannGT/lisa#2482](https://github.com/CodySwannGT/lisa/issues/2482)
* **oxlint:** resolve extended config without node_modules so worktrees can commit ([e445dbe](https://github.com/CodySwannGT/lisa/commit/e445dbe516408b4d0ee40a20f9453858914c3184)), closes [CodySwannGT/lisa#2465](https://github.com/CodySwannGT/lisa/issues/2465)
* **postinstall:** surface failed applies instead of discarding them ([d1c66de](https://github.com/CodySwannGT/lisa/commit/d1c66de5d2565a49aca085b740f015c6bff439cc)), closes [acmeorgb/acme-product-b#734](https://github.com/acmeorgb/acme-product-b/issues/734) [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [CodySwannGT/lisa#2467](https://github.com/CodySwannGT/lisa/issues/2467)

### [3.4.1](https://github.com/CodySwannGT/lisa/compare/v3.4.0...v3.4.1) (2026-08-13)


### Bug Fixes

* **hooks:** block the GIT_CONFIG_KEY_<n> hooksPath bypass and stop colliding with `bind` ([db0b449](https://github.com/CodySwannGT/lisa/commit/db0b44946ed9985a4080865e472906df3a582fac)), closes [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [CodySwannGT/lisa#2466](https://github.com/CodySwannGT/lisa/issues/2466) [CodySwannGT/lisa#2466](https://github.com/CodySwannGT/lisa/issues/2466)
* **hooks:** close the separate-token --config-env hooksPath bypass ([c7d7b24](https://github.com/CodySwannGT/lisa/commit/c7d7b242a75448dcd3dc5389cb846cfa8ef9861e)), closes [CodySwannGT/lisa#2466](https://github.com/CodySwannGT/lisa/issues/2466) [CodySwannGT/lisa#2466](https://github.com/CodySwannGT/lisa/issues/2466)

## [3.4.0](https://github.com/CodySwannGT/lisa/compare/v3.3.0...v3.4.0) (2026-08-13)


### Features

* **design-source:** fail closed when UI ships with no Figma source (TDD GREEN) ([473c0f8](https://github.com/CodySwannGT/lisa/commit/473c0f8f54570c60230cf5a81c37d059ebc50d21)), closes [CodySwannGT/lisa#2430](https://github.com/CodySwannGT/lisa/issues/2430) [CodySwannGT/lisa#2430](https://github.com/CodySwannGT/lisa/issues/2430)

## [3.3.0](https://github.com/CodySwannGT/lisa/compare/v3.2.0...v3.3.0) (2026-08-13)


### Features

* **nightly-e2e:** bound per-suite first-seen grace so adding a suite is not an outage ([0ee3e1f](https://github.com/CodySwannGT/lisa/commit/0ee3e1fd4e808d76579031f290c3ed5ce6264b68)), closes [#2416](https://github.com/CodySwannGT/lisa/issues/2416) [#2446](https://github.com/CodySwannGT/lisa/issues/2446) [CodySwannGT/lisa#2455](https://github.com/CodySwannGT/lisa/issues/2455)
* **rules:** ship the WU-B session operating pack ([4e3ae57](https://github.com/CodySwannGT/lisa/commit/4e3ae571975f76407a60e803387802a8c3553320)), closes [CodySwannGT/lisa#2450](https://github.com/CodySwannGT/lisa/issues/2450) [CodySwannGT/lisa#2450](https://github.com/CodySwannGT/lisa/issues/2450)


### Bug Fixes

* **doctor:** commit the host-rules block doctor reconciles into AGENTS.md ([4096333](https://github.com/CodySwannGT/lisa/commit/40963333a91aede5cb58d9ab81de53e9baef062a)), closes [#2444](https://github.com/CodySwannGT/lisa/issues/2444) [#2444](https://github.com/CodySwannGT/lisa/issues/2444) [CodySwannGT/lisa#2458](https://github.com/CodySwannGT/lisa/issues/2458)
* **doctor:** stop reporting Lisa's own re-export trampolines as guard drift ([94502c0](https://github.com/CodySwannGT/lisa/commit/94502c0103f517f2d524a4b86d0d04dcf2eb71c4)), closes [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [CodySwannGT/lisa#2458](https://github.com/CodySwannGT/lisa/issues/2458)

## [3.2.0](https://github.com/CodySwannGT/lisa/compare/v3.1.0...v3.2.0) (2026-08-13)


### Features

* **bdd:** replace the coverage-floor ratchet with per-obligation non-regression ([063ace0](https://github.com/CodySwannGT/lisa/commit/063ace00276f7939d3d1aea8335e585451a0a52e)), closes [CodySwannGT/lisa#2445](https://github.com/CodySwannGT/lisa/issues/2445) [CodySwannGT/lisa#2445](https://github.com/CodySwannGT/lisa/issues/2445)
* **e2e:** classify Maestro preamble losses apart from product regressions ([a0cea8c](https://github.com/CodySwannGT/lisa/commit/a0cea8c7a9816d29d48b6141167358c98433073c)), closes [CodySwannGT/lisa#2454](https://github.com/CodySwannGT/lisa/issues/2454)


### Bug Fixes

* **doctor:** commit the host-rules block doctor reconciles into AGENTS.md ([4096333](https://github.com/CodySwannGT/lisa/commit/40963333a91aede5cb58d9ab81de53e9baef062a)), closes [#2444](https://github.com/CodySwannGT/lisa/issues/2444) [#2444](https://github.com/CodySwannGT/lisa/issues/2444) [CodySwannGT/lisa#2458](https://github.com/CodySwannGT/lisa/issues/2458)
* **doctor:** stop reporting Lisa's own re-export trampolines as guard drift ([94502c0](https://github.com/CodySwannGT/lisa/commit/94502c0103f517f2d524a4b86d0d04dcf2eb71c4)), closes [#2436](https://github.com/CodySwannGT/lisa/issues/2436) [CodySwannGT/lisa#2458](https://github.com/CodySwannGT/lisa/issues/2458)
* **rules:** add the missing eager head for credential-substrate-precedence ([83e43bd](https://github.com/CodySwannGT/lisa/commit/83e43bda0d491cfd67e2bc36a020b641126be3e5)), closes [#2451](https://github.com/CodySwannGT/lisa/issues/2451) [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447) [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447)

## [3.1.0](https://github.com/CodySwannGT/lisa/compare/v3.0.0...v3.1.0) (2026-08-13)


### Features

* **access:** put the configured-provider substrate ahead of interactive MCP ([5fe9987](https://github.com/CodySwannGT/lisa/commit/5fe9987c56a5c952eb3c53fd8224a2de49aa4b68)), closes [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447)
* **bdd:** replace the coverage-floor ratchet with per-obligation non-regression ([063ace0](https://github.com/CodySwannGT/lisa/commit/063ace00276f7939d3d1aea8335e585451a0a52e)), closes [CodySwannGT/lisa#2445](https://github.com/CodySwannGT/lisa/issues/2445) [CodySwannGT/lisa#2445](https://github.com/CodySwannGT/lisa/issues/2445)
* **nightly-e2e:** tell somebody the nightly is red, and stop when it is not ([4f6b575](https://github.com/CodySwannGT/lisa/commit/4f6b575d1fd536c9f31975c3078c702966b62846)), closes [#2446](https://github.com/CodySwannGT/lisa/issues/2446) [CodySwannGT/lisa#2448](https://github.com/CodySwannGT/lisa/issues/2448) [CodySwannGT/lisa#2448](https://github.com/CodySwannGT/lisa/issues/2448)


### Bug Fixes

* **rules:** add the missing eager head for credential-substrate-precedence ([83e43bd](https://github.com/CodySwannGT/lisa/commit/83e43bda0d491cfd67e2bc36a020b641126be3e5)), closes [#2451](https://github.com/CodySwannGT/lisa/issues/2451) [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447) [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447)

## [3.0.0](https://github.com/CodySwannGT/lisa/compare/v2.353.0...v3.0.0) (2026-08-13)


### ⚠ BREAKING CHANGES

* **tracker:** an omitted `build_ready` no longer applies the build-ready
role on GitHub or Linear. Both trackers previously treated omission as ready;
they now match JIRA, where omission has always meant not-ready. Ready is an
explicit claim rather than an accident of which tracker a project uses. Any
downstream caller that omitted `build_ready` on GitHub or Linear and relied on
implicit ready must now pass `build_ready: true`, or pass a `human_gate`
reason if the hold is deliberate — a leaf filed with neither is rejected as an
incomplete handoff. `lisa-github-validate-issue` F4's omitted-to-true
normalization is removed with it.

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>

### Features

* **access:** put the configured-provider substrate ahead of interactive MCP ([5fe9987](https://github.com/CodySwannGT/lisa/commit/5fe9987c56a5c952eb3c53fd8224a2de49aa4b68)), closes [CodySwannGT/lisa#2447](https://github.com/CodySwannGT/lisa/issues/2447)
* **bdd:** discover e2e specs and enforce exclusions in the v2 gate ([4d1907b](https://github.com/CodySwannGT/lisa/commit/4d1907bb23a031519ccc65cce31e298c786e5924)), closes [CodySwannGT/lisa#2440](https://github.com/CodySwannGT/lisa/issues/2440) [CodySwannGT/lisa#2440](https://github.com/CodySwannGT/lisa/issues/2440)
* **tracker:** make the ready role an explicit claim on every tracker ([5f0d6e4](https://github.com/CodySwannGT/lisa/commit/5f0d6e46a4a751f1ff28349a54cd1271c4641eba)), closes [CodySwannGT/lisa#2442](https://github.com/CodySwannGT/lisa/issues/2442)

## [2.353.0](https://github.com/CodySwannGT/lisa/compare/v2.352.0...v2.353.0) (2026-08-13)


### Features

* **bdd:** discover e2e specs and enforce exclusions in the v2 gate ([4d1907b](https://github.com/CodySwannGT/lisa/commit/4d1907bb23a031519ccc65cce31e298c786e5924)), closes [CodySwannGT/lisa#2440](https://github.com/CodySwannGT/lisa/issues/2440) [CodySwannGT/lisa#2440](https://github.com/CodySwannGT/lisa/issues/2440)


### Bug Fixes

* **linear:** reject a `ready` state that is the team's default created state ([67b5aa2](https://github.com/CodySwannGT/lisa/commit/67b5aa2dbecbab8f3ba744a933b9b203bea14017)), closes [CodySwannGT/lisa#2443](https://github.com/CodySwannGT/lisa/issues/2443) [CodySwannGT/lisa#2443](https://github.com/CodySwannGT/lisa/issues/2443)
* **nightly-e2e:** refuse a green run that only tested half the fleet ([8c86395](https://github.com/CodySwannGT/lisa/commit/8c86395731d87a96cfb0031bb74bc16614b2dd92)), closes [CodySwannGT/lisa#2432](https://github.com/CodySwannGT/lisa/issues/2432) [CodySwannGT/lisa#2432](https://github.com/CodySwannGT/lisa/issues/2432)

## [2.352.0](https://github.com/CodySwannGT/lisa/compare/v2.351.0...v2.352.0) (2026-08-13)


### Features

* **rules:** adopt .agents/rules/ as the canonical host-rules path ([82a69dd](https://github.com/CodySwannGT/lisa/commit/82a69dd267e38b09963c4eb2b216a0d2a1294421)), closes [CodySwannGT/lisa#2431](https://github.com/CodySwannGT/lisa/issues/2431) [CodySwannGT/lisa#2431](https://github.com/CodySwannGT/lisa/issues/2431)


### Bug Fixes

* **apply:** deliver Lisa-owned enforcement guards on a version bump ([88c7cea](https://github.com/CodySwannGT/lisa/commit/88c7ceae0cf64734a6f1d2634552cec0606c1e8f)), closes [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [CodySwannGT/lisa#2424](https://github.com/CodySwannGT/lisa/issues/2424) [CodySwannGT/lisa#2424](https://github.com/CodySwannGT/lisa/issues/2424)


### Documentation

* **plan:** address CodeRabbit review on the Phase 0 decision records ([91ebc23](https://github.com/CodySwannGT/lisa/commit/91ebc235f37f7b7700b166b9e2008bf39cd51811)), closes [#2425](https://github.com/CodySwannGT/lisa/issues/2425) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)
* **plan:** record Phase 0 decisions for the 2026-08-12 improvement notes ([1624f75](https://github.com/CodySwannGT/lisa/commit/1624f754490fed8daf3fc9f615631ed2b135dd97)), closes [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)

## [2.351.0](https://github.com/CodySwannGT/lisa/compare/v2.350.0...v2.351.0) (2026-08-13)


### Features

* **tracker:** derive a visible Branch Plan from the environment mapping ([b2e9035](https://github.com/CodySwannGT/lisa/commit/b2e90350f34987d74ca104abec4e4adfd1f5c61b)), closes [CodySwannGT/lisa#2428](https://github.com/CodySwannGT/lisa/issues/2428) [CodySwannGT/lisa#2428](https://github.com/CodySwannGT/lisa/issues/2428)


### Bug Fixes

* **apply:** deliver Lisa-owned enforcement guards on a version bump ([88c7cea](https://github.com/CodySwannGT/lisa/commit/88c7ceae0cf64734a6f1d2634552cec0606c1e8f)), closes [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [CodySwannGT/lisa#2424](https://github.com/CodySwannGT/lisa/issues/2424) [CodySwannGT/lisa#2424](https://github.com/CodySwannGT/lisa/issues/2424)
* **ci:** make a zero-flow Maestro run fail loudly and distinctly ([adcaeeb](https://github.com/CodySwannGT/lisa/commit/adcaeeb302702dce99a79846c851f079a0697a51)), closes [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409)
* **ci:** stop expanding flows_dir into the Maestro script text ([f210d0a](https://github.com/CodySwannGT/lisa/commit/f210d0ad3b691503b267fc71b3b1cbca54125173)), closes [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409) [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409)
* **secrets:** enforce the usage-note contract the prose already claims ([3af076c](https://github.com/CodySwannGT/lisa/commit/3af076c88bb27d35b7802d64b652afafc14bc4bb)), closes [CodySwannGT/lisa#2433](https://github.com/CodySwannGT/lisa/issues/2433) [CodySwannGT/lisa#2433](https://github.com/CodySwannGT/lisa/issues/2433)


### Documentation

* **plan:** address CodeRabbit review on the Phase 0 decision records ([91ebc23](https://github.com/CodySwannGT/lisa/commit/91ebc235f37f7b7700b166b9e2008bf39cd51811)), closes [#2425](https://github.com/CodySwannGT/lisa/issues/2425) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423) [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)
* **plan:** record Phase 0 decisions for the 2026-08-12 improvement notes ([1624f75](https://github.com/CodySwannGT/lisa/commit/1624f754490fed8daf3fc9f615631ed2b135dd97)), closes [CodySwannGT/lisa#2423](https://github.com/CodySwannGT/lisa/issues/2423)

## [2.350.0](https://github.com/CodySwannGT/lisa/compare/v2.349.1...v2.350.0) (2026-08-13)


### Features

* **tracker:** derive a visible Branch Plan from the environment mapping ([b2e9035](https://github.com/CodySwannGT/lisa/commit/b2e90350f34987d74ca104abec4e4adfd1f5c61b)), closes [CodySwannGT/lisa#2428](https://github.com/CodySwannGT/lisa/issues/2428) [CodySwannGT/lisa#2428](https://github.com/CodySwannGT/lisa/issues/2428)


### Bug Fixes

* **ci:** make a zero-flow Maestro run fail loudly and distinctly ([adcaeeb](https://github.com/CodySwannGT/lisa/commit/adcaeeb302702dce99a79846c851f079a0697a51)), closes [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409)
* **ci:** stop expanding flows_dir into the Maestro script text ([f210d0a](https://github.com/CodySwannGT/lisa/commit/f210d0ad3b691503b267fc71b3b1cbca54125173)), closes [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409) [CodySwannGT/lisa#2409](https://github.com/CodySwannGT/lisa/issues/2409)
* **learnings:** refuse a mis-located ledger and detect a second one ([da46d59](https://github.com/CodySwannGT/lisa/commit/da46d59db06380a05e77fb070c82d9b52f374cb8)), closes [CodySwannGT/lisa#2429](https://github.com/CodySwannGT/lisa/issues/2429)
* **secrets:** enforce the usage-note contract the prose already claims ([3af076c](https://github.com/CodySwannGT/lisa/commit/3af076c88bb27d35b7802d64b652afafc14bc4bb)), closes [CodySwannGT/lisa#2433](https://github.com/CodySwannGT/lisa/issues/2433) [CodySwannGT/lisa#2433](https://github.com/CodySwannGT/lisa/issues/2433)

### [2.349.1](https://github.com/CodySwannGT/lisa/compare/v2.349.0...v2.349.1) (2026-08-12)


### Bug Fixes

* **bdd:** close six ways the coverage gate could report what it had not proven ([b71e494](https://github.com/CodySwannGT/lisa/commit/b71e4944424f78daa98928c81be38f821bafec73)), closes [acmeorgc/frontend#388](https://github.com/acmeorgc/frontend/issues/388) [#2412](https://github.com/CodySwannGT/lisa/issues/2412) [CodySwannGT/lisa#2421](https://github.com/CodySwannGT/lisa/issues/2421)

## [2.349.0](https://github.com/CodySwannGT/lisa/compare/v2.348.0...v2.349.0) (2026-08-12)


### Features

* **ci:** ship the fail-closed nightly-e2e-health reusable gate ([9db8917](https://github.com/CodySwannGT/lisa/commit/9db8917505e0ebd0efcf8f74d40b9c334903ff53)), closes [CodySwannGT/lisa#2415](https://github.com/CodySwannGT/lisa/issues/2415)


### Bug Fixes

* **ci:** close five more fail-open paths found in review ([75c2d8f](https://github.com/CodySwannGT/lisa/commit/75c2d8fb8ec7d19751c88e332ef087db813c328b)), closes [CodySwannGT/lisa#2415](https://github.com/CodySwannGT/lisa/issues/2415)
* **ci:** make every gate limit a source constant, not an env override ([3960c5e](https://github.com/CodySwannGT/lisa/commit/3960c5ef8ae049aa7c995422b96f1e545efa8765)), closes [CodySwannGT/lisa#2415](https://github.com/CodySwannGT/lisa/issues/2415)
* **ci:** paginate bypass-label attribution, oldest-first API ([fa7a4d7](https://github.com/CodySwannGT/lisa/commit/fa7a4d7eacaa81de668472c0691d716cfff332c4)), closes [CodySwannGT/lisa#2415](https://github.com/CodySwannGT/lisa/issues/2415)
* **ci:** stop a job-scoped finding reporting the RUN's conclusion ([348a41f](https://github.com/CodySwannGT/lisa/commit/348a41ff6c905cc20c00024ef7fece68a6eed16a)), closes [CodySwannGT/lisa#2415](https://github.com/CodySwannGT/lisa/issues/2415)

## [2.348.0](https://github.com/CodySwannGT/lisa/compare/v2.346.0...v2.348.0) (2026-08-12)


### Features

* **bdd:** ship the BDD coverage gate with three-state adoption and a floor ratchet ([d8e0aef](https://github.com/CodySwannGT/lisa/commit/d8e0aef6f624b8582cbe382cc72d8a0c137fb840)), closes [#2393](https://github.com/CodySwannGT/lisa/issues/2393) [#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2412](https://github.com/CodySwannGT/lisa/issues/2412)


### Bug Fixes

* **ci:** stop the build-cache key from hashing node_modules ([89dfeda](https://github.com/CodySwannGT/lisa/commit/89dfedadc1043efed1196c5ab1cad651c77b5563)), closes [CodySwannGT/lisa#2418](https://github.com/CodySwannGT/lisa/issues/2418)


### Code Refactoring

* **bdd:** answer WS-1c's command envelope and invert the fail-open logic ([bbdaa69](https://github.com/CodySwannGT/lisa/commit/bbdaa6948a9dfef71857230d0d7875aad93c1190)), closes [#2413](https://github.com/CodySwannGT/lisa/issues/2413) [CodySwannGT/lisa#2412](https://github.com/CodySwannGT/lisa/issues/2412)

## [2.347.0](https://github.com/CodySwannGT/lisa/compare/v2.346.0...v2.347.0) (2026-08-12)


### Features

* **bdd:** ship the BDD coverage gate with three-state adoption and a floor ratchet ([d8e0aef](https://github.com/CodySwannGT/lisa/commit/d8e0aef6f624b8582cbe382cc72d8a0c137fb840)), closes [#2393](https://github.com/CodySwannGT/lisa/issues/2393) [#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2412](https://github.com/CodySwannGT/lisa/issues/2412)


### Bug Fixes

* **ci:** stop the build-cache key from hashing node_modules ([89dfeda](https://github.com/CodySwannGT/lisa/commit/89dfedadc1043efed1196c5ab1cad651c77b5563)), closes [CodySwannGT/lisa#2418](https://github.com/CodySwannGT/lisa/issues/2418)


### Code Refactoring

* **bdd:** answer WS-1c's command envelope and invert the fail-open logic ([bbdaa69](https://github.com/CodySwannGT/lisa/commit/bbdaa6948a9dfef71857230d0d7875aad93c1190)), closes [#2413](https://github.com/CodySwannGT/lisa/issues/2413) [CodySwannGT/lisa#2412](https://github.com/CodySwannGT/lisa/issues/2412)

## [2.346.0](https://github.com/CodySwannGT/lisa/compare/v2.345.1...v2.346.0) (2026-08-12)


### Features

* **rules:** ship the reset/seed coverage contract and its anti-drift check ([79c5698](https://github.com/CodySwannGT/lisa/commit/79c56982d82709acff770775736a2ef7aaa2eee2)), closes [CodySwannGT/lisa#2411](https://github.com/CodySwannGT/lisa/issues/2411)

### [2.345.1](https://github.com/CodySwannGT/lisa/compare/v2.345.0...v2.345.1) (2026-08-12)


### Bug Fixes

* **ci:** shard Playwright by default ([ef3d139](https://github.com/CodySwannGT/lisa/commit/ef3d139cbd14a55eebd657675e603732fe372660)), closes [CodySwannGT/lisa#2407](https://github.com/CodySwannGT/lisa/issues/2407)

## [2.345.0](https://github.com/CodySwannGT/lisa/compare/v2.344.2...v2.345.0) (2026-08-11)


### Features

* **maestro-e2e:** add caller flow runner seam ([980c185](https://github.com/CodySwannGT/lisa/commit/980c185704767c9a5dc16144ede9d8574b045bda)), closes [CodySwannGT/lisa#2396](https://github.com/CodySwannGT/lisa/issues/2396)

### [2.344.2](https://github.com/CodySwannGT/lisa/compare/v2.344.0...v2.344.2) (2026-08-11)


### Bug Fixes

* **ci:** stop dropping hidden paths from the Lighthouse and build uploads ([0b56f13](https://github.com/CodySwannGT/lisa/commit/0b56f13fef412e0677cb25ff59f9a0007d2012f0)), closes [#2398](https://github.com/CodySwannGT/lisa/issues/2398) [CodySwannGT/lisa#2398](https://github.com/CodySwannGT/lisa/issues/2398) [CodySwannGT/lisa#2398](https://github.com/CodySwannGT/lisa/issues/2398)
* **ci:** upload the Maestro debug artifacts that were being silently dropped ([a1cccbb](https://github.com/CodySwannGT/lisa/commit/a1cccbb109c0a8947081c7ddc6304651e89c6a26)), closes [CodySwannGT/lisa#2401](https://github.com/CodySwannGT/lisa/issues/2401)

### [2.344.1](https://github.com/CodySwannGT/lisa/compare/v2.344.0...v2.344.1) (2026-08-11)


### Bug Fixes

* **ci:** stop dropping hidden paths from the Lighthouse and build uploads ([0b56f13](https://github.com/CodySwannGT/lisa/commit/0b56f13fef412e0677cb25ff59f9a0007d2012f0)), closes [#2398](https://github.com/CodySwannGT/lisa/issues/2398) [CodySwannGT/lisa#2398](https://github.com/CodySwannGT/lisa/issues/2398) [CodySwannGT/lisa#2398](https://github.com/CodySwannGT/lisa/issues/2398)
* **ci:** upload the Maestro debug artifacts that were being silently dropped ([a1cccbb](https://github.com/CodySwannGT/lisa/commit/a1cccbb109c0a8947081c7ddc6304651e89c6a26)), closes [CodySwannGT/lisa#2401](https://github.com/CodySwannGT/lisa/issues/2401)

## [2.344.0](https://github.com/CodySwannGT/lisa/compare/v2.343.0...v2.344.0) (2026-08-11)


### Features

* **parity:** refresh the safety-net pin to 2.0.1 and correct its inventory ([3ad4f3b](https://github.com/CodySwannGT/lisa/commit/3ad4f3b64dea060e5e7aeaf67cd8ae5b2a274fe2)), closes [#1960](https://github.com/CodySwannGT/lisa/issues/1960) [CodySwannGT/lisa#2402](https://github.com/CodySwannGT/lisa/issues/2402) [CodySwannGT/lisa#2402](https://github.com/CodySwannGT/lisa/issues/2402)


### Documentation

* **parity:** correct Copilot safety-net routing claims ([2fd5cf1](https://github.com/CodySwannGT/lisa/commit/2fd5cf18f92b4568c69c3a1d853d315c52161811)), closes [#2403](https://github.com/CodySwannGT/lisa/issues/2403) [CodySwannGT/lisa#2402](https://github.com/CodySwannGT/lisa/issues/2402)
* **parity:** scope empirical-test claim to comparable safety-net probes ([b2b51de](https://github.com/CodySwannGT/lisa/commit/b2b51de234087e95536b7f1c346f30532891a748)), closes [#2403](https://github.com/CodySwannGT/lisa/issues/2403) [CodySwannGT/lisa#2402](https://github.com/CodySwannGT/lisa/issues/2402)

## [2.343.0](https://github.com/CodySwannGT/lisa/compare/v2.342.7...v2.343.0) (2026-08-09)


### Features

* **rules:** add the vendor-neutral bdd-e2e-coverage contract ([9513aff](https://github.com/CodySwannGT/lisa/commit/9513aff0e8574dfc85854768154f23a05a6a90dc)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **skills:** cite bdd-e2e-coverage from the lifecycle skills ([b2a1fe1](https://github.com/CodySwannGT/lisa/commit/b2a1fe124cf40790e48a7357a1991e24020ad822)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)


### Bug Fixes

* **bdd-e2e-coverage:** add coverageFloor/runner schema fields, close silent-N/A gap ([002d6e6](https://github.com/CodySwannGT/lisa/commit/002d6e68ffe6ab9439737d35a19ec8f797866d3c)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **bdd-e2e-coverage:** fix runner precedence, missing-runner exit, and gate proof ([7f8c41c](https://github.com/CodySwannGT/lisa/commit/7f8c41cce83b3998e7ffe1750e589e0c607e2039)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **bdd-e2e-coverage:** propagate the burndown obligation to earlier lifecycle stages ([59ec705](https://github.com/CodySwannGT/lisa/commit/59ec705b3ce1349c72b2c71dd42a4f5819d576a4)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **intent-routing:** make Validation Journey symmetric with acceptance criteria ([10fba8a](https://github.com/CodySwannGT/lisa/commit/10fba8a13ca463a700d5f2ef1755aaada81eab4a)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **spec-conformance:** require execution evidence for MATCH, fix waiver status, add provenance check ([6d75e47](https://github.com/CodySwannGT/lisa/commit/6d75e473ca1adfc60adc3d82fe93a29ce467d6db)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)
* **verification:** stop hardcoding Playwright/tests-e2e as the codification path ([0dc2c60](https://github.com/CodySwannGT/lisa/commit/0dc2c60b4831c7ef1d2403fa83789ae207878c5f)), closes [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393) [CodySwannGT/lisa#2393](https://github.com/CodySwannGT/lisa/issues/2393)

### [2.342.7](https://github.com/CodySwannGT/lisa/compare/v2.342.6...v2.342.7) (2026-08-09)


### Bug Fixes

* **hooks:** reject a threshold whose bound direction was flipped ([924cd27](https://github.com/CodySwannGT/lisa/commit/924cd272b61d87936517db00b87f500f83b4092a)), closes [acmeorgb/infrastructure-v2#351](https://github.com/acmeorgb/infrastructure-v2/issues/351) [#2391](https://github.com/CodySwannGT/lisa/issues/2391) [CodySwannGT/lisa#2389](https://github.com/CodySwannGT/lisa/issues/2389)

### [2.342.6](https://github.com/CodySwannGT/lisa/compare/v2.342.5...v2.342.6) (2026-08-09)


### Bug Fixes

* **hooks:** close two guards that passed when they had not checked ([8026b61](https://github.com/CodySwannGT/lisa/commit/8026b61e6c3f2e5a2aff79cd6aa9492edcf3e5a6)), closes [CodySwannGT/lisa#2389](https://github.com/CodySwannGT/lisa/issues/2389)

### [2.342.5](https://github.com/CodySwannGT/lisa/compare/v2.342.4...v2.342.5) (2026-08-09)


### Bug Fixes

* **work-item:** keep the trailer prefix ASCII-case-insensitive ([cfaf644](https://github.com/CodySwannGT/lisa/commit/cfaf6447ea8ed84194eaab7b30c530ef6fb30e1c)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)
* **work-item:** parse Work-Item trailers without a backtracking regex ([3fb0e1c](https://github.com/CodySwannGT/lisa/commit/3fb0e1ced85e844739c0425ffb900d79c001af8c)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)

### [2.342.4](https://github.com/CodySwannGT/lisa/compare/v2.342.3...v2.342.4) (2026-08-09)


### Bug Fixes

* **work-item:** bound tracker calls, page sub-issues, and classify failures ([b649f3e](https://github.com/CodySwannGT/lisa/commit/b649f3edd42304d8026969110c590530f0e9641e)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)
* **work-item:** make the tracker deadline one the child cannot decline ([dd680a4](https://github.com/CodySwannGT/lisa/commit/dd680a4e63778578d5b4774e03c978bce7a3aa80)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)

### [2.342.3](https://github.com/CodySwannGT/lisa/compare/v2.342.2...v2.342.3) (2026-08-09)


### Bug Fixes

* **ci:** let callers raise the Maestro per-suite timeout ([8d47aad](https://github.com/CodySwannGT/lisa/commit/8d47aadb0e27d4666f26a726156b9db4bb734536)), closes [CodySwannGT/lisa#2386](https://github.com/CodySwannGT/lisa/issues/2386)

### [2.342.2](https://github.com/CodySwannGT/lisa/compare/v2.342.1...v2.342.2) (2026-08-09)


### Bug Fixes

* **ci:** pair the Playwright blob reporter with a streaming one ([552d96d](https://github.com/CodySwannGT/lisa/commit/552d96d38bf034c6af881c3a607f170799a11390)), closes [CodySwannGT/lisa#2384](https://github.com/CodySwannGT/lisa/issues/2384)

### [2.342.1](https://github.com/CodySwannGT/lisa/compare/v2.342.0...v2.342.1) (2026-08-09)


### Bug Fixes

* **hooks:** close the remaining security findings from the guard review ([98f64c4](https://github.com/CodySwannGT/lisa/commit/98f64c45b2174862b828150e27711ba1fdcfb51e)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)

## [2.342.0](https://github.com/CodySwannGT/lisa/compare/v2.341.7...v2.342.0) (2026-08-09)


### Features

* **apply:** add --refresh-templates so a release can deliver a changed guard ([46767d2](https://github.com/CodySwannGT/lisa/commit/46767d27777dc4a80f8792348678a110dbe2152e)), closes [#2378](https://github.com/CodySwannGT/lisa/issues/2378) [#2381](https://github.com/CodySwannGT/lisa/issues/2381) [CodySwannGT/lisa#2381](https://github.com/CodySwannGT/lisa/issues/2381)

### [2.341.7](https://github.com/CodySwannGT/lisa/compare/v2.341.6...v2.341.7) (2026-08-08)


### Bug Fixes

* **apply:** report managed templates a non-interactive apply cannot update ([698a96d](https://github.com/CodySwannGT/lisa/commit/698a96d4b04a5c1575e44d1379f7d41241d688c3)), closes [#2374](https://github.com/CodySwannGT/lisa/issues/2374) [#2377](https://github.com/CodySwannGT/lisa/issues/2377) [CodySwannGT/lisa#2377](https://github.com/CodySwannGT/lisa/issues/2377)
* **apply:** report stale detail in dry-run and tighten the guard assertion ([8ee71d9](https://github.com/CodySwannGT/lisa/commit/8ee71d9e4ad463c4e4c6658423634b34e622839b)), closes [#2377](https://github.com/CodySwannGT/lisa/issues/2377) [CodySwannGT/lisa#2377](https://github.com/CodySwannGT/lisa/issues/2377)

### [2.341.6](https://github.com/CodySwannGT/lisa/compare/v2.341.5...v2.341.6) (2026-08-08)


### Bug Fixes

* **work-item:** read the Linear lifecycle from the workflow state, not labels ([c30079f](https://github.com/CodySwannGT/lisa/commit/c30079f0c9be2aab4a9f2c5681636e277d1817af)), closes [#2271](https://github.com/CodySwannGT/lisa/issues/2271) [#2277](https://github.com/CodySwannGT/lisa/issues/2277) [CodySwannGT/lisa#2379](https://github.com/CodySwannGT/lisa/issues/2379)

### [2.341.5](https://github.com/CodySwannGT/lisa/compare/v2.341.4...v2.341.5) (2026-08-08)


### Documentation

* **setup-linear:** stop claiming the build queue runs off status:* labels ([2fbac51](https://github.com/CodySwannGT/lisa/commit/2fbac5103669c24b6de88deb4d5b6b95ee7d85d7)), closes [CodySwannGT/lisa#2375](https://github.com/CodySwannGT/lisa/issues/2375)
* sync Linear setup command metadata with workflow-state migration ([0abbaec](https://github.com/CodySwannGT/lisa/commit/0abbaecc21d6b1751e85c8c149a159ec1e4b4e9b)), closes [CodySwannGT/lisa#2375](https://github.com/CodySwannGT/lisa/issues/2375)

### [2.341.4](https://github.com/CodySwannGT/lisa/compare/v2.341.3...v2.341.4) (2026-08-08)


### Bug Fixes

* **hooks:** close four fail-opens in the Bash enforcement guards ([bf3b16a](https://github.com/CodySwannGT/lisa/commit/bf3b16af79b8de0878b75ee97535707a1f16fba9)), closes [AcmeOrgA/wiki#39](https://github.com/AcmeOrgA/wiki/issues/39) [AcmeOrgA/backend#940](https://github.com/AcmeOrgA/backend/issues/940) [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)
* **hooks:** close two residual bypasses found in review round 2 ([dbc441e](https://github.com/CodySwannGT/lisa/commit/dbc441e5289b19d944c0e2106f4888a1a88175ab)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)
* **hooks:** harden the exemption and hooksPath checks from review ([bb6d6d4](https://github.com/CodySwannGT/lisa/commit/bb6d6d4a1e9dc7adf50249b0507500f3e14c7560)), closes [#2371](https://github.com/CodySwannGT/lisa/issues/2371) [CodySwannGT/lisa#2371](https://github.com/CodySwannGT/lisa/issues/2371)

### [2.341.3](https://github.com/CodySwannGT/lisa/compare/v2.341.2...v2.341.3) (2026-08-08)


### Bug Fixes

* **ci:** stop auto-fix skipping every bot-authored branch ([1bf935c](https://github.com/CodySwannGT/lisa/commit/1bf935cd6da636d0dc8d50dfaf37ae6fc51d9e11)), closes [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372) [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372)
* **deps:** pin nanoid to ^3.3.18 ([b8ff5f2](https://github.com/CodySwannGT/lisa/commit/b8ff5f257bbe2ed034f01d7d0ca823a47f37ecfd)), closes [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372) [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372)
* **review:** force nanoid floor downstream and assert guard behavior ([4ad8145](https://github.com/CodySwannGT/lisa/commit/4ad8145fe90fd60ca8873d53e9640445f77206be)), closes [#2373](https://github.com/CodySwannGT/lisa/issues/2373) [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372) [CodySwannGT/lisa#2372](https://github.com/CodySwannGT/lisa/issues/2372)

### [2.341.2](https://github.com/CodySwannGT/lisa/compare/v2.341.1...v2.341.2) (2026-08-07)


### Bug Fixes

* **debrief:** complete the category contract and the credential hand-off ([785a083](https://github.com/CodySwannGT/lisa/commit/785a0838cc5ca320b71cfc0acd9900d57e1faaac)), closes [#2370](https://github.com/CodySwannGT/lisa/issues/2370) [CodySwannGT/lisa#2369](https://github.com/CodySwannGT/lisa/issues/2369)
* **lifecycle:** reconcile drifted prose across debrief and Verify surfaces ([86a8c9c](https://github.com/CodySwannGT/lisa/commit/86a8c9cec588beb13a40cc87db2c72839a6e9218)), closes [CodySwannGT/lisa#2369](https://github.com/CodySwannGT/lisa/issues/2369)

### [2.341.1](https://github.com/CodySwannGT/lisa/compare/v2.341.0...v2.341.1) (2026-08-07)


### Documentation

* write down the onboarding order, and test it against the code ([11b188d](https://github.com/CodySwannGT/lisa/commit/11b188d684b00b77a3d537e23a41b66ce0b34590)), closes [CodySwannGT/lisa#2367](https://github.com/CodySwannGT/lisa/issues/2367)

## [2.341.0](https://github.com/CodySwannGT/lisa/compare/v2.340.0...v2.341.0) (2026-08-07)


### Features

* **secrets:** add lisa environment <surface> --tenant=<name> ([d8fbae8](https://github.com/CodySwannGT/lisa/commit/d8fbae8b741ee0bc2aeafa34d09fcb12bdec989f)), closes [CodySwannGT/lisa#2365](https://github.com/CodySwannGT/lisa/issues/2365)

## [2.340.0](https://github.com/CodySwannGT/lisa/compare/v2.339.0...v2.340.0) (2026-08-07)


### Features

* **secrets:** store the bootstrap, instead of documenting a shell command ([ebcbb31](https://github.com/CodySwannGT/lisa/commit/ebcbb3165363512f929679bf0b4ac42541317664)), closes [CodySwannGT/lisa#2363](https://github.com/CodySwannGT/lisa/issues/2363)


### Bug Fixes

* **secrets:** make the keychain write actually store the value ([847bc89](https://github.com/CodySwannGT/lisa/commit/847bc89edc7d18afd3a629962a7de220945fff0e)), closes [CodySwannGT/lisa#2363](https://github.com/CodySwannGT/lisa/issues/2363)


### Documentation

* **secrets:** correct the storeBootstrap comment to match the code ([3a85082](https://github.com/CodySwannGT/lisa/commit/3a85082a2c6720425ce1a1c441890d339a8b5747)), closes [CodySwannGT/lisa#2363](https://github.com/CodySwannGT/lisa/issues/2363)

## [2.339.0](https://github.com/CodySwannGT/lisa/compare/v2.338.5...v2.339.0) (2026-08-07)


### Features

* **secrets:** default the bootstrap block, and give containers a surface ([2ac1f1b](https://github.com/CodySwannGT/lisa/commit/2ac1f1ba8c7d4714494a60409148d1db54651512)), closes [CodySwannGT/lisa#2361](https://github.com/CodySwannGT/lisa/issues/2361)

### [2.338.5](https://github.com/CodySwannGT/lisa/compare/v2.338.4...v2.338.5) (2026-08-07)


### Bug Fixes

* **secrets:** emit a repo-less environment without a repo, and without assuming Bitwarden ([256dc79](https://github.com/CodySwannGT/lisa/commit/256dc799bc1b7d1c46ef96815c4e03f56ce289f1)), closes [CodySwannGT/lisa#2359](https://github.com/CodySwannGT/lisa/issues/2359)
* **secrets:** refuse a tenant that would emit broken shell ([e7c5225](https://github.com/CodySwannGT/lisa/commit/e7c52259be0ebfca29591b8c9bf558b16b8e6d54)), closes [CodySwannGT/lisa#2359](https://github.com/CodySwannGT/lisa/issues/2359)

### [2.338.4](https://github.com/CodySwannGT/lisa/compare/v2.338.3...v2.338.4) (2026-08-07)


### Bug Fixes

* **secrets:** report the FIRST checkout failure, as documented ([3aec228](https://github.com/CodySwannGT/lisa/commit/3aec228fa9265d3e75c7e840fb67a070e23c90ee)), closes [#2352](https://github.com/CodySwannGT/lisa/issues/2352) [CodySwannGT/lisa#2351](https://github.com/CodySwannGT/lisa/issues/2351)

### [2.338.3](https://github.com/CodySwannGT/lisa/compare/v2.338.2...v2.338.3) (2026-08-07)


### Bug Fixes

* **secrets:** emit the setup field instead of documenting a stale copy ([77964de](https://github.com/CodySwannGT/lisa/commit/77964de074f6f9199278f1e7145277ba8bccf70e)), closes [CodySwannGT/lisa#2352](https://github.com/CodySwannGT/lisa/issues/2352)

### [2.338.2](https://github.com/CodySwannGT/lisa/compare/v2.338.1...v2.338.2) (2026-08-07)


### Bug Fixes

* **workstation:** link tools installed elsewhere into ~/.local/bin ([4e9e505](https://github.com/CodySwannGT/lisa/commit/4e9e5059b5e4a0beeb9b5bf2d6b0c4a49c479963)), closes [CodySwannGT/lisa#2355](https://github.com/CodySwannGT/lisa/issues/2355)
* **workstation:** repair a link that dangles, not just one that resolves ([c2bc188](https://github.com/CodySwannGT/lisa/commit/c2bc188b8a4aca85b4b61eab8e7e0071f9c44d22)), closes [CodySwannGT/lisa#2355](https://github.com/CodySwannGT/lisa/issues/2355)

### [2.338.1](https://github.com/CodySwannGT/lisa/compare/v2.338.0...v2.338.1) (2026-08-07)


### Bug Fixes

* **secrets:** put every install directory on the setup field PATH ([59281c5](https://github.com/CodySwannGT/lisa/commit/59281c54df93c7610a1355b916169e41f2f95e47)), closes [CodySwannGT/lisa#2353](https://github.com/CodySwannGT/lisa/issues/2353)

## [2.338.0](https://github.com/CodySwannGT/lisa/compare/v2.337.3...v2.338.0) (2026-08-06)


### Features

* **secrets:** install the CLIs the vault names, and only those ([e054dc2](https://github.com/CodySwannGT/lisa/commit/e054dc2e7fc9758a7337ada99a05156d498e043e)), closes [CodySwannGT/lisa#2347](https://github.com/CodySwannGT/lisa/issues/2347)
* **secrets:** let the vault declare which CLIs a session needs ([f3dd663](https://github.com/CodySwannGT/lisa/commit/f3dd6636ce2b6aa526f8880ac9ea4030b3b4e2da)), closes [CodySwannGT/lisa#2347](https://github.com/CodySwannGT/lisa/issues/2347)


### Bug Fixes

* **secrets:** distinguish a failed tool lookup from an empty one ([2f73495](https://github.com/CodySwannGT/lisa/commit/2f73495d55a9ae80c4d950a99680880edc3b52b6)), closes [CodySwannGT/lisa#2347](https://github.com/CodySwannGT/lisa/issues/2347)
* **secrets:** regenerate the per-agent plugin artifacts ([660bef7](https://github.com/CodySwannGT/lisa/commit/660bef7dbc1fa05612a0b2ddbda808c304c58be9)), closes [CodySwannGT/lisa#2347](https://github.com/CodySwannGT/lisa/issues/2347)

### [2.337.3](https://github.com/CodySwannGT/lisa/compare/v2.337.2...v2.337.3) (2026-08-06)


### Bug Fixes

* **deps:** raise the js-yaml floor past GHSA-5p4m-2wfm-xmqj ([328617d](https://github.com/CodySwannGT/lisa/commit/328617deea224539628da9f61c01a6ccf57ce8fc)), closes [CodySwannGT/lisa#2349](https://github.com/CodySwannGT/lisa/issues/2349)

### [2.337.2](https://github.com/CodySwannGT/lisa/compare/v2.337.1...v2.337.2) (2026-08-06)


### Bug Fixes

* **secrets:** stop the setup field installing every coding agent ([d7b3933](https://github.com/CodySwannGT/lisa/commit/d7b39333cf6ec50d596a2265e08a6985051fa87e)), closes [CodySwannGT/lisa#2345](https://github.com/CodySwannGT/lisa/issues/2345)

### [2.337.1](https://github.com/CodySwannGT/lisa/compare/v2.337.0...v2.337.1) (2026-08-06)


### Bug Fixes

* **setup-remote-env:** pin the documented setup field to the released version ([7134f2b](https://github.com/CodySwannGT/lisa/commit/7134f2b2e84cd404edfe52de245cae8d22e3faf9)), closes [CodySwannGT/lisa#2340](https://github.com/CodySwannGT/lisa/issues/2340)


### Documentation

* **drive-pr-to-merge:** a watcher cannot observe a PR leaving the open set ([5306f7c](https://github.com/CodySwannGT/lisa/commit/5306f7c6572e3ef8c056bf785be0999bf225568d)), closes [CodySwannGT/lisa#2340](https://github.com/CodySwannGT/lisa/issues/2340)

## [2.337.0](https://github.com/CodySwannGT/lisa/compare/v2.336.4...v2.337.0) (2026-08-06)


### Features

* **secrets:** accept a neutrally named tenant variable ([a0cfd9c](https://github.com/CodySwannGT/lisa/commit/a0cfd9c46eca074b76d71e60d6e9e6304766b898)), closes [CodySwannGT/lisa#2342](https://github.com/CodySwannGT/lisa/issues/2342)

### [2.336.4](https://github.com/CodySwannGT/lisa/compare/v2.336.3...v2.336.4) (2026-08-06)


### Bug Fixes

* **secrets:** install the tools and put them on PATH in a repo-less session ([5e504ea](https://github.com/CodySwannGT/lisa/commit/5e504ea37467dea15305b2efe1339c60bb5cfda7)), closes [CodySwannGT/lisa#2338](https://github.com/CodySwannGT/lisa/issues/2338)
* **secrets:** pin the Lisa the setup field executes ([19cbb98](https://github.com/CodySwannGT/lisa/commit/19cbb98375203e9d135b222cb3698a3a70501130)), closes [CodySwannGT/lisa#2338](https://github.com/CodySwannGT/lisa/issues/2338)
* **secrets:** report preparation failures instead of discarding them ([6cf842e](https://github.com/CodySwannGT/lisa/commit/6cf842ec71a2fe87409455192b518694c7803c14)), closes [CodySwannGT/lisa#2338](https://github.com/CodySwannGT/lisa/issues/2338)

### [2.336.3](https://github.com/CodySwannGT/lisa/compare/v2.336.2...v2.336.3) (2026-08-06)


### Bug Fixes

* **cli:** register the remote-env command the no-checkout path calls ([6ba95fb](https://github.com/CodySwannGT/lisa/commit/6ba95fb11d4c02837481a14cf92434cd81f8e71c)), closes [CodySwannGT/lisa#2336](https://github.com/CodySwannGT/lisa/issues/2336)

### [2.336.2](https://github.com/CodySwannGT/lisa/compare/v2.336.1...v2.336.2) (2026-08-05)


### Bug Fixes

* **sonar:** make the resolver deadline stop the work, not just the waiting ([11f78b1](https://github.com/CodySwannGT/lisa/commit/11f78b1846475c3181199722f02d9ea8f9126f8e)), closes [CodySwannGT/lisa#2334](https://github.com/CodySwannGT/lisa/issues/2334)

### [2.336.1](https://github.com/CodySwannGT/lisa/compare/v2.336.0...v2.336.1) (2026-08-05)


### Bug Fixes

* **sonar:** stop capturing the resolved token through a temp file ([03c5f2c](https://github.com/CodySwannGT/lisa/commit/03c5f2cefdda018da33eb2785a8f02c4fef7fdce)), closes [CodySwannGT/lisa#2332](https://github.com/CodySwannGT/lisa/issues/2332)

## [2.336.0](https://github.com/CodySwannGT/lisa/compare/v2.335.0...v2.336.0) (2026-08-05)


### Features

* **secrets:** prepare a session that has no checkout ([2a694bf](https://github.com/CodySwannGT/lisa/commit/2a694bfa99642fbc813967351d205bbbd2e150bb)), closes [CodySwannGT/lisa#2330](https://github.com/CodySwannGT/lisa/issues/2330)


### Bug Fixes

* **sonar:** stop capturing the resolved token through a temp file ([03c5f2c](https://github.com/CodySwannGT/lisa/commit/03c5f2cefdda018da33eb2785a8f02c4fef7fdce)), closes [CodySwannGT/lisa#2332](https://github.com/CodySwannGT/lisa/issues/2332)

## [2.335.0](https://github.com/CodySwannGT/lisa/compare/v2.334.1...v2.335.0) (2026-08-05)


### Features

* **secrets:** prepare a session that has no checkout ([2a694bf](https://github.com/CodySwannGT/lisa/commit/2a694bfa99642fbc813967351d205bbbd2e150bb)), closes [CodySwannGT/lisa#2330](https://github.com/CodySwannGT/lisa/issues/2330)


### Bug Fixes

* **hooks:** run the enforcement guards unconditionally ([86bad98](https://github.com/CodySwannGT/lisa/commit/86bad987c359473b12b9cedb4555d04762d344f9)), closes [CodySwannGT/lisa#2326](https://github.com/CodySwannGT/lisa/issues/2326)

### [2.334.1](https://github.com/CodySwannGT/lisa/compare/v2.334.0...v2.334.1) (2026-08-05)


### Bug Fixes

* **sonar:** stop an unauthenticated scanner from blocking every prompt ([842e236](https://github.com/CodySwannGT/lisa/commit/842e236e611650d1a08b95d51604ea58955631e5)), closes [CodySwannGT/lisa#2324](https://github.com/CodySwannGT/lisa/issues/2324)

## [2.334.0](https://github.com/CodySwannGT/lisa/compare/v2.333.3...v2.334.0) (2026-08-05)


### Features

* **secrets:** let agents use their own AWS identity on a laptop ([32677df](https://github.com/CodySwannGT/lisa/commit/32677df66908feeedcc080b6af2df74491ead0a3)), closes [CodySwannGT/lisa#2328](https://github.com/CodySwannGT/lisa/issues/2328)

### [2.333.3](https://github.com/CodySwannGT/lisa/compare/v2.333.2...v2.333.3) (2026-08-05)


### Bug Fixes

* **skills:** refuse merge_method=rebase instead of verifying it wrongly ([8435549](https://github.com/CodySwannGT/lisa/commit/8435549107b242c625c117d0b1729f2a91e51839)), closes [#2316](https://github.com/CodySwannGT/lisa/issues/2316) [CodySwannGT/lisa#2316](https://github.com/CodySwannGT/lisa/issues/2316)

### [2.333.2](https://github.com/CodySwannGT/lisa/compare/v2.333.1...v2.333.2) (2026-08-05)


### Bug Fixes

* **secrets:** merge into ~/.aws instead of refusing when a file already exists ([d47853d](https://github.com/CodySwannGT/lisa/commit/d47853d73438dd933f188c2e6d12f216793d5c09)), closes [CodySwannGT/lisa#2319](https://github.com/CodySwannGT/lisa/issues/2319)
* **secrets:** write ~/.aws atomically so an existing file is tightened to 0600 ([994033f](https://github.com/CodySwannGT/lisa/commit/994033f7cde4f359b53d05e130efbbc860b89721)), closes [CodySwannGT/lisa#2319](https://github.com/CodySwannGT/lisa/issues/2319)

### [2.333.1](https://github.com/CodySwannGT/lisa/compare/v2.333.0...v2.333.1) (2026-08-05)

## [2.333.0](https://github.com/CodySwannGT/lisa/compare/v2.332.5...v2.333.0) (2026-08-05)


### Features

* **secrets:** assume a role per environment instead of exporting the bootstrap pair ([3b2d5d8](https://github.com/CodySwannGT/lisa/commit/3b2d5d822d9a79f615dc7126cca29387ac59ebac)), closes [CodySwannGT/lisa#2317](https://github.com/CodySwannGT/lisa/issues/2317)


### Bug Fixes

* **secrets:** address review findings on the per-environment profile change ([4d56196](https://github.com/CodySwannGT/lisa/commit/4d561968bedf936f0ab3491136b46b74a3fcbe56)), closes [CodySwannGT/lisa#2317](https://github.com/CodySwannGT/lisa/issues/2317)

### [2.332.5](https://github.com/CodySwannGT/lisa/compare/v2.332.4...v2.332.5) (2026-08-05)


### Bug Fixes

* **hooks:** block-no-verify must not fail open when jq is missing ([e12784f](https://github.com/CodySwannGT/lisa/commit/e12784f2f8fa6085d662c9f5d9b09d32244e4bd7)), closes [CodySwannGT/lisa#2304](https://github.com/CodySwannGT/lisa/issues/2304) [CodySwannGT/lisa#2308](https://github.com/CodySwannGT/lisa/issues/2308)
* **skills:** scope the armed-latch rule, and clear every stale disarm ([2be1a93](https://github.com/CodySwannGT/lisa/commit/2be1a9318c4ed8067f99f898c4ef1449f2671955)), closes [#1395](https://github.com/CodySwannGT/lisa/issues/1395) [#1071](https://github.com/CodySwannGT/lisa/issues/1071) [CodySwannGT/lisa#2299](https://github.com/CodySwannGT/lisa/issues/2299)
* **skills:** stop drive-pr-to-merge disabling auto-merge before a push ([075b4cc](https://github.com/CodySwannGT/lisa/commit/075b4cc07614840aaa5acfdd788b751b804424f8)), closes [#1393](https://github.com/CodySwannGT/lisa/issues/1393) [#1392](https://github.com/CodySwannGT/lisa/issues/1392) [#1071](https://github.com/CodySwannGT/lisa/issues/1071) [#1395](https://github.com/CodySwannGT/lisa/issues/1395) [#1395](https://github.com/CodySwannGT/lisa/issues/1395) [#1071](https://github.com/CodySwannGT/lisa/issues/1071) [CodySwannGT/lisa#2299](https://github.com/CodySwannGT/lisa/issues/2299)

### [2.332.4](https://github.com/CodySwannGT/lisa/compare/v2.332.3...v2.332.4) (2026-08-05)


### Bug Fixes

* **secrets:** source the materialized env from the shell profile ([85b6c09](https://github.com/CodySwannGT/lisa/commit/85b6c099d08c010b0fcea50979170dec352f92be)), closes [CodySwannGT/lisa#2309](https://github.com/CodySwannGT/lisa/issues/2309)

### [2.332.3](https://github.com/CodySwannGT/lisa/compare/v2.332.2...v2.332.3) (2026-08-05)


### Bug Fixes

* **secrets:** register the session-start hook at user scope on remote surfaces ([f020411](https://github.com/CodySwannGT/lisa/commit/f020411a9f2774f0ebf769fe8e42cdaf721587f4)), closes [CodySwannGT/lisa#2309](https://github.com/CodySwannGT/lisa/issues/2309)

### [2.332.2](https://github.com/CodySwannGT/lisa/compare/v2.332.1...v2.332.2) (2026-08-05)


### Bug Fixes

* **secrets:** a setup-phase secrets failure must not kill the environment ([3b185a1](https://github.com/CodySwannGT/lisa/commit/3b185a17bfe7999409cc36286b47727a681aeb93)), closes [CodySwannGT/lisa#2309](https://github.com/CodySwannGT/lisa/issues/2309)

### [2.332.1](https://github.com/CodySwannGT/lisa/compare/v2.332.0...v2.332.1) (2026-08-05)


### Bug Fixes

* **secrets:** stop the validator's install-method list drifting from the runner ([c7ab982](https://github.com/CodySwannGT/lisa/commit/c7ab982ee1b165f0ad648b667fe6c2a7d3c31733)), closes [CodySwannGT/lisa#2306](https://github.com/CodySwannGT/lisa/issues/2306)

## [2.332.0](https://github.com/CodySwannGT/lisa/compare/v2.331.3...v2.332.0) (2026-08-05)


### Features

* **secrets:** install bare release binaries via a checksummed pin ([5059f98](https://github.com/CodySwannGT/lisa/commit/5059f9814b32e54177679147cd7b9feee602e9b4)), closes [CodySwannGT/lisa#2304](https://github.com/CodySwannGT/lisa/issues/2304)

### [2.331.3](https://github.com/CodySwannGT/lisa/compare/v2.331.2...v2.331.3) (2026-08-05)


### Bug Fixes

* **secrets:** export AWS credentials over any ambient pair the host injects ([6d9f74b](https://github.com/CodySwannGT/lisa/commit/6d9f74bc29619f0f28fd478446fbbf165379581d)), closes [CodySwannGT/lisa#2301](https://github.com/CodySwannGT/lisa/issues/2301)
* **secrets:** preview derived AWS variables in the dry-run too ([c699d5a](https://github.com/CodySwannGT/lisa/commit/c699d5a2dc45186e53fa029048508e9baeafb767)), closes [CodySwannGT/lisa#2301](https://github.com/CodySwannGT/lisa/issues/2301)

### [2.331.2](https://github.com/CodySwannGT/lisa/compare/v2.331.1...v2.331.2) (2026-08-05)


### Bug Fixes

* **secrets:** claude-web must materialize at setup as well as session start ([6d0ca9e](https://github.com/CodySwannGT/lisa/commit/6d0ca9ed95f008998b9cd8f3bc3eb954b5cdf38d)), closes [CodySwannGT/lisa#2301](https://github.com/CodySwannGT/lisa/issues/2301)

### [2.331.1](https://github.com/CodySwannGT/lisa/compare/v2.331.0...v2.331.1) (2026-08-05)


### Bug Fixes

* **workstation:** agy is installable — Google ships a headless installer ([53fe55f](https://github.com/CodySwannGT/lisa/commit/53fe55f41db255efc5afb1aaf60e621b211f1ff1)), closes [#2287](https://github.com/CodySwannGT/lisa/issues/2287) [#2288](https://github.com/CodySwannGT/lisa/issues/2288) [CodySwannGT/lisa#2297](https://github.com/CodySwannGT/lisa/issues/2297)

## [2.331.0](https://github.com/CodySwannGT/lisa/compare/v2.330.1...v2.331.0) (2026-08-04)


### Features

* **toolchain:** add release-tree so tree-shaped artifacts stop installing broken ([4b93ad5](https://github.com/CodySwannGT/lisa/commit/4b93ad5a3a66e54241546b1c999e5352df20e413)), closes [CodySwannGT/lisa#2295](https://github.com/CodySwannGT/lisa/issues/2295)

### [2.330.1](https://github.com/CodySwannGT/lisa/compare/v2.330.0...v2.330.1) (2026-08-04)


### Bug Fixes

* **cli:** make the workstation bootstrap reachable without an agent or a repo ([dec9a6a](https://github.com/CodySwannGT/lisa/commit/dec9a6adb530298b3830d915e16df36afe40335d)), closes [CodySwannGT/lisa#2291](https://github.com/CodySwannGT/lisa/issues/2291)

## [2.330.0](https://github.com/CodySwannGT/lisa/compare/v2.329.0...v2.330.0) (2026-08-04)


### Features

* **hooks:** refuse agent writes to AGENTS.md and CLAUDE.md ([0ba7e65](https://github.com/CodySwannGT/lisa/commit/0ba7e65505543e8dbff81fd57648773c148f015a)), closes [CodySwannGT/lisa#2292](https://github.com/CodySwannGT/lisa/issues/2292)

## [2.329.0](https://github.com/CodySwannGT/lisa/compare/v2.328.5...v2.329.0) (2026-08-04)


### Features

* **setup:** add lisa-setup-workstation for repo-agnostic machine bootstrap ([a7fdf1f](https://github.com/CodySwannGT/lisa/commit/a7fdf1ffeea45388262e5604fa0788786de3c744)), closes [CodySwannGT/lisa#2286](https://github.com/CodySwannGT/lisa/issues/2286)

### [2.328.5](https://github.com/CodySwannGT/lisa/compare/v2.328.4...v2.328.5) (2026-08-04)


### Bug Fixes

* **detect-tooling:** discover tools no allowlist mentions, and read git hooks ([f248cdd](https://github.com/CodySwannGT/lisa/commit/f248cdd8a9313505eac5e1797f3cf2ff737723e4)), closes [CodySwannGT/lisa#2289](https://github.com/CodySwannGT/lisa/issues/2289)

### [2.328.4](https://github.com/CodySwannGT/lisa/compare/v2.328.3...v2.328.4) (2026-08-04)


### Bug Fixes

* **linear:** clear the last relabel wording and a stale Todo default ([8e7f7d6](https://github.com/CodySwannGT/lisa/commit/8e7f7d66b1d611fa0329475b307fca991b29fe85)), closes [#2277](https://github.com/CodySwannGT/lisa/issues/2277) [CodySwannGT/lisa#2276](https://github.com/CodySwannGT/lisa/issues/2276)
* **linear:** complete the state migration in the claim flow and write default ([ba3090a](https://github.com/CodySwannGT/lisa/commit/ba3090a6a4ffbf222d1a0aa2809e8fbd520b7952)), closes [#2277](https://github.com/CodySwannGT/lisa/issues/2277) [CodySwannGT/lisa#2276](https://github.com/CodySwannGT/lisa/issues/2276)
* **linear:** finish the label-to-state sweep in the sync and agent artifacts ([d008b15](https://github.com/CodySwannGT/lisa/commit/d008b15170aecffd11271b6923cba94c1a7f77ae)), closes [#2277](https://github.com/CodySwannGT/lisa/issues/2277) [CodySwannGT/lisa#2276](https://github.com/CodySwannGT/lisa/issues/2276)
* **linear:** map `ready` to a dedicated state, not the team default ([137c8c8](https://github.com/CodySwannGT/lisa/commit/137c8c87eb2c501a144ae9661ca0e44fa7ddacb8)), closes [#2271](https://github.com/CodySwannGT/lisa/issues/2271) [CodySwannGT/lisa#2276](https://github.com/CodySwannGT/lisa/issues/2276)
* **linear:** resolve build roles from linear.workflow in the queue resolver ([bc67111](https://github.com/CodySwannGT/lisa/commit/bc671119671d843fde410075ea9e29d09c72c0bd)), closes [#2277](https://github.com/CodySwannGT/lisa/issues/2277) [CodySwannGT/lisa#2276](https://github.com/CodySwannGT/lisa/issues/2276)

### [2.328.3](https://github.com/CodySwannGT/lisa/compare/v2.328.2...v2.328.3) (2026-08-04)


### Bug Fixes

* **usage-accounting:** flag missing rollup token on zero-entry sections ([260fe5d](https://github.com/CodySwannGT/lisa/commit/260fe5de908c161cc5680b002b3494e36a968d41)), closes [CodySwannGT/lisa#2283](https://github.com/CodySwannGT/lisa/issues/2283)
* **usage-accounting:** render entry tokens off the table row ([56f0a54](https://github.com/CodySwannGT/lisa/commit/56f0a54b832e42447fcd5a6f225acac6a3762d41)), closes [CodySwannGT/lisa#2283](https://github.com/CodySwannGT/lisa/issues/2283) [CodySwannGT/lisa#2283](https://github.com/CodySwannGT/lisa/issues/2283)

### [2.328.2](https://github.com/CodySwannGT/lisa/compare/v2.328.1...v2.328.2) (2026-08-04)


### Documentation

* **claude-web:** record the multi-repo config-ownership unknown as U5 ([7e7c3fb](https://github.com/CodySwannGT/lisa/commit/7e7c3fbe9df91a64e00eacae6a823e057d8da34d)), closes [CodySwannGT/lisa#2281](https://github.com/CodySwannGT/lisa/issues/2281) [CodySwannGT/lisa#2281](https://github.com/CodySwannGT/lisa/issues/2281)

### [2.328.1](https://github.com/CodySwannGT/lisa/compare/v2.328.0...v2.328.1) (2026-08-04)


### Bug Fixes

* **deps:** move the self-dependency floor off a 130-release-old pin ([9a7eb4c](https://github.com/CodySwannGT/lisa/commit/9a7eb4c91981a193779b2ba16084d12e237bc1a2)), closes [CodySwannGT/lisa#2279](https://github.com/CodySwannGT/lisa/issues/2279) [CodySwannGT/lisa#2279](https://github.com/CodySwannGT/lisa/issues/2279)

## [2.328.0](https://github.com/CodySwannGT/lisa/compare/v2.327.0...v2.328.0) (2026-08-04)


### Features

* **toolchain:** pin tools per platform and give a laptop a way to ask ([cb75f0f](https://github.com/CodySwannGT/lisa/commit/cb75f0f1760bcad68e2c1178182619bc20753ef0)), closes [CodySwannGT/lisa#1982](https://github.com/CodySwannGT/lisa/issues/1982)

## [2.327.0](https://github.com/CodySwannGT/lisa/compare/v2.326.3...v2.327.0) (2026-08-04)


### Features

* **linear:** drive the build lifecycle off native workflow states ([90400b3](https://github.com/CodySwannGT/lisa/commit/90400b3fec4dbcc08394b071ed449713fd3ab20d)), closes [CodySwannGT/lisa#2269](https://github.com/CodySwannGT/lisa/issues/2269)

### [2.326.3](https://github.com/CodySwannGT/lisa/compare/v2.326.2...v2.326.3) (2026-08-04)

### [2.326.2](https://github.com/CodySwannGT/lisa/compare/v2.325.6...v2.326.2) (2026-08-04)


### Bug Fixes

* **release:** a release may not publish a version below the registry ([928e0d2](https://github.com/CodySwannGT/lisa/commit/928e0d2fd32407058b3d6dcb426513d90a2491a6)), closes [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267)
* **release:** guard version floor against stale queued runs ([7d71553](https://github.com/CodySwannGT/lisa/commit/7d71553837701b6cf27ca7b727aad0d134534b8b)), closes [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267) [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267)

### [2.326.1](https://github.com/CodySwannGT/lisa/compare/v2.325.6...v2.326.1) (2026-08-04)


### Bug Fixes

* **release:** a release may not publish a version below the registry ([928e0d2](https://github.com/CodySwannGT/lisa/commit/928e0d2fd32407058b3d6dcb426513d90a2491a6)), closes [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267)
* **release:** guard version floor against stale queued runs ([7d71553](https://github.com/CodySwannGT/lisa/commit/7d71553837701b6cf27ca7b727aad0d134534b8b)), closes [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267) [CodySwannGT/lisa#2267](https://github.com/CodySwannGT/lisa/issues/2267)

### [2.325.6](https://github.com/CodySwannGT/lisa/compare/v2.326.0...v2.325.6) (2026-08-04)


### Bug Fixes

* **tooling:** a synced threshold is not evidence a tool is used ([6220033](https://github.com/CodySwannGT/lisa/commit/62200332a8c2d32b593fc7c7ee53409e5f7cb00a)), closes [CodySwannGT/lisa#2261](https://github.com/CodySwannGT/lisa/issues/2261)
* **tooling:** artifact corroboration must be a directory, not any entry ([69ad238](https://github.com/CodySwannGT/lisa/commit/69ad2388d79a67b5c26df14edc56d1325cd22ea8)), closes [CodySwannGT/lisa#2261](https://github.com/CodySwannGT/lisa/issues/2261)

## [2.326.0](https://github.com/CodySwannGT/lisa/compare/v2.325.5...v2.326.0) (2026-08-04)


### Features

* **quality:** fail when a security floor can be collapsed away ([6fa09aa](https://github.com/CodySwannGT/lisa/commit/6fa09aa3e8db24a29d7a175c711f66858d035f4b)), closes [CodySwannGT/lisa#2263](https://github.com/CodySwannGT/lisa/issues/2263)

### [2.325.5](https://github.com/CodySwannGT/lisa/compare/v2.325.4...v2.325.5) (2026-08-04)


### Bug Fixes

* **scripts:** resolve $name floors instead of skipping them ([582a44c](https://github.com/CodySwannGT/lisa/commit/582a44cbee4ae8022b126fa78cc839206e3a407a)), closes [#2255](https://github.com/CodySwannGT/lisa/issues/2255) [CodySwannGT/lisa#2255](https://github.com/CodySwannGT/lisa/issues/2255)

### [2.325.4](https://github.com/CodySwannGT/lisa/compare/v2.325.3...v2.325.4) (2026-08-04)


### Bug Fixes

* **remote-env:** skip the install, not the decision ([18512ba](https://github.com/CodySwannGT/lisa/commit/18512ba174196a0fc179b7cbc5e023de30da4916)), closes [CodySwannGT/lisa#2258](https://github.com/CodySwannGT/lisa/issues/2258)

### [2.325.3](https://github.com/CodySwannGT/lisa/compare/v2.325.2...v2.325.3) (2026-08-04)


### Bug Fixes

* **tooling:** surface every e2e runner, and skip what npm already provides ([1af9b8a](https://github.com/CodySwannGT/lisa/commit/1af9b8a01587ea6eeeadec8c1832d37424d3db89)), closes [CodySwannGT/lisa#2256](https://github.com/CodySwannGT/lisa/issues/2256)

### [2.325.2](https://github.com/CodySwannGT/lisa/compare/v2.325.1...v2.325.2) (2026-08-04)


### Bug Fixes

* **tooling:** an MCP-only integration is a question, not a missing CLI ([0553883](https://github.com/CodySwannGT/lisa/commit/0553883132b121df4b693bf9713dc9dde06a4f19)), closes [CodySwannGT/lisa#2253](https://github.com/CodySwannGT/lisa/issues/2253)
* **tooling:** decide by the tool, not by how it was detected ([6046c03](https://github.com/CodySwannGT/lisa/commit/6046c036559423e7249bd22726a1d2deccf4966c)), closes [CodySwannGT/lisa#2253](https://github.com/CodySwannGT/lisa/issues/2253)

### [2.325.1](https://github.com/CodySwannGT/lisa/compare/v2.325.0...v2.325.1) (2026-08-04)


### Bug Fixes

* declare Playwright remote tooling ([d6aaa32](https://github.com/CodySwannGT/lisa/commit/d6aaa3253e694a591e68b2ad753fc556ec1b8e25)), closes [CodySwannGT/lisa#2251](https://github.com/CodySwannGT/lisa/issues/2251)

## [2.325.0](https://github.com/CodySwannGT/lisa/compare/v2.324.1...v2.325.0) (2026-08-04)


### Features

* **tooling:** detect the CLIs a project needs, and provision them locally too ([bf0ee64](https://github.com/CodySwannGT/lisa/commit/bf0ee644434e7b921071d59b2bdc85d8309d2ead)), closes [CodySwannGT/lisa#2249](https://github.com/CodySwannGT/lisa/issues/2249)


### Bug Fixes

* **tooling:** address review — invoke the detector, and make it truly read-only ([6a4c2f4](https://github.com/CodySwannGT/lisa/commit/6a4c2f4f29848f0855f6b7a6b3cb66c46d46f32e)), closes [CodySwannGT/lisa#2249](https://github.com/CodySwannGT/lisa/issues/2249)

### [2.324.1](https://github.com/CodySwannGT/lisa/compare/v2.323.5...v2.324.1) (2026-08-04)


### Features

* **hooks:** give host projects the enforcement a missing plugin removes ([8494fea](https://github.com/CodySwannGT/lisa/commit/8494feab6fdaea817bdb785a04624a44f96a4744)), closes [CodySwannGT/lisa#2228](https://github.com/CodySwannGT/lisa/issues/2228)

### [2.323.5](https://github.com/CodySwannGT/lisa/compare/v2.323.4...v2.323.5) (2026-08-04)


### Bug Fixes

* **standards:** derive repository identity from configuration, not transport ([3856955](https://github.com/CodySwannGT/lisa/commit/38569551bc2627d9a4b0d4963c7fcd34a1311c34)), closes [CodySwannGT/lisa#2246](https://github.com/CodySwannGT/lisa/issues/2246)

### [2.323.4](https://github.com/CodySwannGT/lisa/compare/v2.323.3...v2.323.4) (2026-08-04)


### Documentation

* **tracked-work:** stop asserting that any tracker failure blocks work ([2c08688](https://github.com/CodySwannGT/lisa/commit/2c08688c683a7eea0f52283d71e824819efbb2c7)), closes [#2238](https://github.com/CodySwannGT/lisa/issues/2238) [CodySwannGT/lisa#2239](https://github.com/CodySwannGT/lisa/issues/2239) [CodySwannGT/lisa#2239](https://github.com/CodySwannGT/lisa/issues/2239)

### [2.323.3](https://github.com/CodySwannGT/lisa/compare/v2.323.2...v2.323.3) (2026-08-04)

### [2.323.2](https://github.com/CodySwannGT/lisa/compare/v2.324.0...v2.323.2) (2026-08-04)

## [2.324.0](https://github.com/CodySwannGT/lisa/compare/v2.323.1...v2.324.0) (2026-08-04)


### Features

* **remote-env:** pin gh so a cloud session can run the commit guardrails ([068cd03](https://github.com/CodySwannGT/lisa/commit/068cd0399475f8410893c206498dd1b7759ecb17)), closes [CodySwannGT/lisa#2229](https://github.com/CodySwannGT/lisa/issues/2229)
* **work-item:** skip live validation only when the tracker cannot be reached ([5c8a92a](https://github.com/CodySwannGT/lisa/commit/5c8a92aa9447c46a32de90c4e044e79c3d5b0703)), closes [CodySwannGT/lisa#2237](https://github.com/CodySwannGT/lisa/issues/2237)


### Bug Fixes

* **hooks:** keep enforcement when the plugin never installs ([0f75f88](https://github.com/CodySwannGT/lisa/commit/0f75f88d0da7cc8135cf316d9895aa07311d7b2f)), closes [CodySwannGT/lisa#2221](https://github.com/CodySwannGT/lisa/issues/2221)
* **package-lisa:** treat force.overrides pins as a floor, not an assignment ([700adad](https://github.com/CodySwannGT/lisa/commit/700adad9ad077d420a2381af5a1b9bf898bbae67)), closes [CodySwannGT/lisa#2223](https://github.com/CodySwannGT/lisa/issues/2223)
* **remote-env:** install the toolchain every session, not only on cache build ([e130a49](https://github.com/CodySwannGT/lisa/commit/e130a491a8286b4f1fe98b6bcd2a79988e7ff494)), closes [CodySwannGT/lisa#2233](https://github.com/CodySwannGT/lisa/issues/2233)


### Documentation

* **remote-env:** document the release-tar install kind ([7cb8e90](https://github.com/CodySwannGT/lisa/commit/7cb8e9059073fda1b484c029ec015b88fe9b2d7f)), closes [CodySwannGT/lisa#2231](https://github.com/CodySwannGT/lisa/issues/2231)

### [2.323.1](https://github.com/CodySwannGT/lisa/compare/v2.323.0...v2.323.1) (2026-08-03)


### Bug Fixes

* **work-item:** name which GitHub failure the guardrail actually hit ([6f45954](https://github.com/CodySwannGT/lisa/commit/6f45954c73e4dfe224b023acf44b724401d246ad)), closes [CodySwannGT/lisa#2202](https://github.com/CodySwannGT/lisa/issues/2202) [CodySwannGT/lisa#2218](https://github.com/CodySwannGT/lisa/issues/2218)

## [2.323.0](https://github.com/CodySwannGT/lisa/compare/v2.322.8...v2.323.0) (2026-08-03)


### Features

* **automations:** register build-intake as the first scheduled loop ([e356116](https://github.com/CodySwannGT/lisa/commit/e35611600f9a3e8bd102ebe125b238cdeb04e5d0)), closes [CodySwannGT/lisa#2219](https://github.com/CodySwannGT/lisa/issues/2219)

### [2.322.8](https://github.com/CodySwannGT/lisa/compare/v2.322.7...v2.322.8) (2026-08-03)


### Documentation

* **remote-env:** describe the setup locator the field actually prints ([6a8d92b](https://github.com/CodySwannGT/lisa/commit/6a8d92b2abaea5b10942b4784ec2c1675ae8a5bb)), closes [CodySwannGT/lisa#2202](https://github.com/CodySwannGT/lisa/issues/2202)

### [2.322.7](https://github.com/CodySwannGT/lisa/compare/v2.322.6...v2.322.7) (2026-08-03)


### Bug Fixes

* **postinstall:** leave cloud-session plugin installs to Claude Code ([a394897](https://github.com/CodySwannGT/lisa/commit/a394897a0c4ab5265b5069f504313fe5b3c6e11c)), closes [CodySwannGT/lisa#2215](https://github.com/CodySwannGT/lisa/issues/2215)

### [2.322.6](https://github.com/CodySwannGT/lisa/compare/v2.322.5...v2.322.6) (2026-08-03)


### Bug Fixes

* **remote-env:** resolve the skill from the checkout when the checkout is Lisa ([f89a251](https://github.com/CodySwannGT/lisa/commit/f89a251a363eeb11d953b528e526665f0dc19cd1)), closes [CodySwannGT/lisa#2212](https://github.com/CodySwannGT/lisa/issues/2212)
* **remote-env:** search the roots the surfaces use, and say what was there ([debf1cf](https://github.com/CodySwannGT/lisa/commit/debf1cf400476dd1460a10a28538c4feb256b7c4)), closes [CodySwannGT/lisa#2212](https://github.com/CodySwannGT/lisa/issues/2212)

### [2.322.5](https://github.com/CodySwannGT/lisa/compare/v2.322.4...v2.322.5) (2026-08-03)


### Bug Fixes

* **dispatch:** stop a dashed executionEnv from silently running locally ([3053f6d](https://github.com/CodySwannGT/lisa/commit/3053f6dedc9d3cb55e8f72846400f97b886d690d)), closes [CodySwannGT/lisa#2209](https://github.com/CodySwannGT/lisa/issues/2209)

### [2.322.4](https://github.com/CodySwannGT/lisa/compare/v2.322.3...v2.322.4) (2026-08-03)


### Bug Fixes

* **dispatch:** address each agent with the prefix it understands ([93ca62c](https://github.com/CodySwannGT/lisa/commit/93ca62c4d63c2d569625a03a94ddf1aff646a5a9)), closes [CodySwannGT/lisa#2205](https://github.com/CodySwannGT/lisa/issues/2205)
* **dispatch:** stop a dashed executionEnv from silently running locally ([3053f6d](https://github.com/CodySwannGT/lisa/commit/3053f6dedc9d3cb55e8f72846400f97b886d690d)), closes [CodySwannGT/lisa#2209](https://github.com/CodySwannGT/lisa/issues/2209)
* **remote-env:** prepare every checkout, not whichever one sorts first ([4c3caf8](https://github.com/CodySwannGT/lisa/commit/4c3caf8416e2cf62c118aaf0bb293856c668a958)), closes [#2206](https://github.com/CodySwannGT/lisa/issues/2206) [CodySwannGT/lisa#2206](https://github.com/CodySwannGT/lisa/issues/2206)

### [2.322.3](https://github.com/CodySwannGT/lisa/compare/v2.322.2...v2.322.3) (2026-08-03)


### Bug Fixes

* **automations:** resolve skill scripts the generated workflow actually runs ([68d9eee](https://github.com/CodySwannGT/lisa/commit/68d9eeee6aa64683757f9971f9fd1da8b2c7c734)), closes [CodySwannGT/lisa#2203](https://github.com/CodySwannGT/lisa/issues/2203)
* **dispatch:** address each agent with the prefix it understands ([93ca62c](https://github.com/CodySwannGT/lisa/commit/93ca62c4d63c2d569625a03a94ddf1aff646a5a9)), closes [CodySwannGT/lisa#2205](https://github.com/CodySwannGT/lisa/issues/2205)
* **remote-env:** prepare every checkout, not whichever one sorts first ([4c3caf8](https://github.com/CodySwannGT/lisa/commit/4c3caf8416e2cf62c118aaf0bb293856c668a958)), closes [#2206](https://github.com/CodySwannGT/lisa/issues/2206) [CodySwannGT/lisa#2206](https://github.com/CodySwannGT/lisa/issues/2206)

### [2.322.2](https://github.com/CodySwannGT/lisa/compare/v2.322.1...v2.322.2) (2026-08-03)


### Bug Fixes

* **remote-env:** emit the same setup field the documentation prescribes ([42c8960](https://github.com/CodySwannGT/lisa/commit/42c8960f7d65ba2a48474c8e275688b8cc46831e)), closes [CodySwannGT/lisa#2198](https://github.com/CodySwannGT/lisa/issues/2198)
* **remote-env:** refresh Lisa's own installed scripts and guard the copy ([394b876](https://github.com/CodySwannGT/lisa/commit/394b8762cf72f1ffcc0c725d0e6bdb5e5b1afb9d)), closes [CodySwannGT/lisa#2200](https://github.com/CodySwannGT/lisa/issues/2200)

### [2.322.1](https://github.com/CodySwannGT/lisa/compare/v2.322.0...v2.322.1) (2026-08-03)


### Features

* **dispatch:** route work to a Claude cloud session ([6abd41f](https://github.com/CodySwannGT/lisa/commit/6abd41f5d42a1f311720e92246dbd125ca963129)), closes [CodySwannGT/lisa#2186](https://github.com/CodySwannGT/lisa/issues/2186)


### Bug Fixes

* **dispatch:** bound the wait on the routine endpoint ([df4e1d8](https://github.com/CodySwannGT/lisa/commit/df4e1d8b24afff67bb78636fc72e97b38a05ac8a)), closes [CodySwannGT/lisa#2186](https://github.com/CodySwannGT/lisa/issues/2186)
* **remote-env:** emit the same setup field the documentation prescribes ([42c8960](https://github.com/CodySwannGT/lisa/commit/42c8960f7d65ba2a48474c8e275688b8cc46831e)), closes [CodySwannGT/lisa#2198](https://github.com/CodySwannGT/lisa/issues/2198)
* **remote-env:** make the setup field work on Codex Cloud as well as Claude web ([9f32274](https://github.com/CodySwannGT/lisa/commit/9f32274a20dd7ae8591b967bd8575afb2457510a)), closes [#2196](https://github.com/CodySwannGT/lisa/issues/2196) [CodySwannGT/lisa#2196](https://github.com/CodySwannGT/lisa/issues/2196)

## [2.322.0](https://github.com/CodySwannGT/lisa/compare/v2.321.5...v2.322.0) (2026-08-03)


### Features

* **remote-env:** make the setup field identical for every project ([d2651f7](https://github.com/CodySwannGT/lisa/commit/d2651f729f6ffcc3276b138f0b6fac876d712030)), closes [CodySwannGT/lisa#2193](https://github.com/CodySwannGT/lisa/issues/2193)


### Bug Fixes

* **remote-env:** check node first and match the project's yarn ([ee2235b](https://github.com/CodySwannGT/lisa/commit/ee2235bc22fa799fa17f8a302a50fd48847947bd)), closes [CodySwannGT/lisa#2193](https://github.com/CodySwannGT/lisa/issues/2193)
* **remote-env:** install with CI=1 so setup leaves the checkout clean ([938f6e3](https://github.com/CodySwannGT/lisa/commit/938f6e330aa32afece2ffc5bb34eae7f0df01b96)), closes [CodySwannGT/lisa#2193](https://github.com/CodySwannGT/lisa/issues/2193)

### [2.321.5](https://github.com/CodySwannGT/lisa/compare/v2.321.4...v2.321.5) (2026-08-03)


### Bug Fixes

* **automations:** generate a workflow for a surface with no repository ([663bcaf](https://github.com/CodySwannGT/lisa/commit/663bcafc4861c6afd38bfacf15804c3a39fe7a24)), closes [CodySwannGT/lisa#2190](https://github.com/CodySwannGT/lisa/issues/2190)

### [2.321.4](https://github.com/CodySwannGT/lisa/compare/v2.321.3...v2.321.4) (2026-08-03)


### Bug Fixes

* **remote-env:** put the install directory on PATH ([9d01f93](https://github.com/CodySwannGT/lisa/commit/9d01f936627d4cbec008533fb78a7b3ce80b1427)), closes [CodySwannGT/lisa#2188](https://github.com/CodySwannGT/lisa/issues/2188)

### [2.321.3](https://github.com/CodySwannGT/lisa/compare/v2.321.2...v2.321.3) (2026-08-03)


### Bug Fixes

* **secrets:** let a rotating credential be excluded from a surface ([5b0adf6](https://github.com/CodySwannGT/lisa/commit/5b0adf67af484f8f0c18e6c09be8ac9753ac58a5)), closes [#2178](https://github.com/CodySwannGT/lisa/issues/2178) [CodySwannGT/lisa#2178](https://github.com/CodySwannGT/lisa/issues/2178)

### [2.321.2](https://github.com/CodySwannGT/lisa/compare/v2.321.1...v2.321.2) (2026-08-03)


### Bug Fixes

* **remote-env:** anchor Claude setup in checkout ([2a1ac3b](https://github.com/CodySwannGT/lisa/commit/2a1ac3b7230362f1b6384151b0923d26970af409)), closes [#2181](https://github.com/CodySwannGT/lisa/issues/2181) [CodySwannGT/lisa#2181](https://github.com/CodySwannGT/lisa/issues/2181)

### [2.321.1](https://github.com/CodySwannGT/lisa/compare/v2.321.0...v2.321.1) (2026-08-03)


### Bug Fixes

* **security:** raise the brace-expansion floor past GHSA-rgw5-rvv9-x895 ([6a022b1](https://github.com/CodySwannGT/lisa/commit/6a022b12938c460876aa87ff97d8e249b6e3be2d)), closes [CodySwannGT/lisa#2182](https://github.com/CodySwannGT/lisa/issues/2182)

## [2.321.0](https://github.com/CodySwannGT/lisa/compare/v2.320.0...v2.321.0) (2026-08-03)


### Features

* **remote-env:** pin the cloud environment per project ([eb65dfa](https://github.com/CodySwannGT/lisa/commit/eb65dfa351683bfc5e970bbbadb06b4b3e3d9cf3)), closes [CodySwannGT/lisa#2175](https://github.com/CodySwannGT/lisa/issues/2175)


### Bug Fixes

* **remote-env:** install the scripts a remote environment invokes ([58cb356](https://github.com/CodySwannGT/lisa/commit/58cb3567606f1e4e12ecd0110290602599a5d32e)), closes [CodySwannGT/lisa#2175](https://github.com/CodySwannGT/lisa/issues/2175)


### Documentation

* **plan:** record that no flag selects a cloud environment ([9366a32](https://github.com/CodySwannGT/lisa/commit/9366a32c5a4b9da1b919e4b401b9d3ccc9402b56)), closes [CodySwannGT/lisa#2175](https://github.com/CodySwannGT/lisa/issues/2175)

## [2.320.0](https://github.com/CodySwannGT/lisa/compare/v2.319.0...v2.320.0) (2026-08-03)


### Features

* **remote-env:** materialize per session where setup is cached ([189c102](https://github.com/CodySwannGT/lisa/commit/189c102928ed19b32f5e84fe9c24494d26896141)), closes [CodySwannGT/lisa#2175](https://github.com/CodySwannGT/lisa/issues/2175)


### Bug Fixes

* address remote env review findings ([3e04666](https://github.com/CodySwannGT/lisa/commit/3e04666b639c2ede0352990bf14a830b64f082dd)), closes [CodySwannGT/lisa#2175](https://github.com/CodySwannGT/lisa/issues/2175)

## [2.319.0](https://github.com/CodySwannGT/lisa/compare/v2.318.0...v2.319.0) (2026-08-03)


### Features

* **secrets:** make Claude Code web a first-class surface ([8d2c940](https://github.com/CodySwannGT/lisa/commit/8d2c940c29502d7085af9a496b5aa20f005eae9b)), closes [CodySwannGT/lisa#2173](https://github.com/CodySwannGT/lisa/issues/2173)


### Bug Fixes

* **secrets:** address review on the claude-web surface ([58ae4c0](https://github.com/CodySwannGT/lisa/commit/58ae4c00e8ef29f6c0ef31b452f8b70ca6aa5c2d)), closes [CodySwannGT/lisa#2173](https://github.com/CodySwannGT/lisa/issues/2173)

## [2.318.0](https://github.com/CodySwannGT/lisa/compare/v2.317.7...v2.318.0) (2026-08-03)


### Features

* **ci:** audit force-pinned security floors against the advisory database ([86b972a](https://github.com/CodySwannGT/lisa/commit/86b972aaed98b7fef0f594d539251c5a4c2bec34)), closes [#2168](https://github.com/CodySwannGT/lisa/issues/2168) [CodySwannGT/lisa#2169](https://github.com/CodySwannGT/lisa/issues/2169)


### Bug Fixes

* **ci:** address security floor review ([3d3e4e3](https://github.com/CodySwannGT/lisa/commit/3d3e4e3b433a70152270bb6f0d07ce4cdcd767f3)), closes [CodySwannGT/lisa#2169](https://github.com/CodySwannGT/lisa/issues/2169) [CodySwannGT/lisa#2169](https://github.com/CodySwannGT/lisa/issues/2169)
* **deps:** raise three stale force-pinned security floors ([3144284](https://github.com/CodySwannGT/lisa/commit/31442845722cc0fd810c887fe970aa3ef2009497)), closes [CodySwannGT/lisa#2167](https://github.com/CodySwannGT/lisa/issues/2167)

### [2.317.7](https://github.com/CodySwannGT/lisa/compare/v2.317.6...v2.317.7) (2026-08-02)


### Bug Fixes

* **configs:** register the bare .worktrees/ root with eslint, jest and vitest ([2bf077f](https://github.com/CodySwannGT/lisa/commit/2bf077f75a00515ddc7233b62e93b15fab4838bf)), closes [CodySwannGT/lisa#2165](https://github.com/CodySwannGT/lisa/issues/2165) [CodySwannGT/lisa#2165](https://github.com/CodySwannGT/lisa/issues/2165)
* **gitignore:** exclude the bare .worktrees/ root from git and EAS ([8724b40](https://github.com/CodySwannGT/lisa/commit/8724b401ab9105910b5cf5bc8a9ff4d52819305c)), closes [CodySwannGT/lisa#2165](https://github.com/CodySwannGT/lisa/issues/2165) [CodySwannGT/lisa#2165](https://github.com/CodySwannGT/lisa/issues/2165)

### [2.317.6](https://github.com/CodySwannGT/lisa/compare/v2.317.5...v2.317.6) (2026-08-02)


### Bug Fixes

* **hooks:** allow the Skill call that loads a lifecycle skill ([15abacb](https://github.com/CodySwannGT/lisa/commit/15abacba31dd40ef3515fe9d2d5521d80a9903e7)), closes [CodySwannGT/lisa#2163](https://github.com/CodySwannGT/lisa/issues/2163)

### [2.317.5](https://github.com/CodySwannGT/lisa/compare/v2.317.4...v2.317.5) (2026-08-02)


### Bug Fixes

* **remote-env:** clarify setup skill precondition ([f755cd2](https://github.com/CodySwannGT/lisa/commit/f755cd259d3cf8e0658910116972b1a190b55587)), closes [CodySwannGT/lisa#2160](https://github.com/CodySwannGT/lisa/issues/2160)
* **remote-env:** resolve the skill from node_modules on a fresh container ([a8fa783](https://github.com/CodySwannGT/lisa/commit/a8fa783cad664ce694e111aede994d51bd4ec7e5)), closes [CodySwannGT/lisa#2160](https://github.com/CodySwannGT/lisa/issues/2160)

### [2.317.4](https://github.com/CodySwannGT/lisa/compare/v2.317.3...v2.317.4) (2026-08-02)


### Documentation

* **remote-aws:** the bootstrap bundle belongs in the configured provider ([27db437](https://github.com/CodySwannGT/lisa/commit/27db437404e7a89b2bce6b9b5a86b5aee21bbbb0)), closes [CodySwannGT/lisa#2158](https://github.com/CodySwannGT/lisa/issues/2158)

### [2.317.3](https://github.com/CodySwannGT/lisa/compare/v2.317.2...v2.317.3) (2026-08-02)


### Bug Fixes

* **secrets:** give the child exactly one bootstrap variable ([c3a9e50](https://github.com/CodySwannGT/lisa/commit/c3a9e506b7d519bbad1db6dccc17b9f6b46b3cd2)), closes [CodySwannGT/lisa#2156](https://github.com/CodySwannGT/lisa/issues/2156)
* **secrets:** separate where the bootstrap lives from what the CLI calls it ([d30df07](https://github.com/CodySwannGT/lisa/commit/d30df07901327afcc6e85aad2a25758d4ba7432d)), closes [CodySwannGT/lisa#2156](https://github.com/CodySwannGT/lisa/issues/2156)

### [2.317.2](https://github.com/CodySwannGT/lisa/compare/v2.317.1...v2.317.2) (2026-08-02)


### Documentation

* **plan:** close out the last open unknown as descoped ([7b03239](https://github.com/CodySwannGT/lisa/commit/7b03239b38dca211fa90e9ee7d3240dfc1759d25)), closes [CodySwannGT/lisa#2154](https://github.com/CodySwannGT/lisa/issues/2154)

### [2.317.1](https://github.com/CodySwannGT/lisa/compare/v2.317.0...v2.317.1) (2026-08-01)


### Documentation

* **dispatch:** -c model= does not govern a Codex Cloud task model ([0724054](https://github.com/CodySwannGT/lisa/commit/0724054390bcbcfeab3aa9d80dc5cfd48a0f747b)), closes [CodySwannGT/lisa#2152](https://github.com/CodySwannGT/lisa/issues/2152)

## [2.317.0](https://github.com/CodySwannGT/lisa/compare/v2.316.2...v2.317.0) (2026-08-01)


### Features

* **automations:** add an unattended clock that survives a closed laptop ([8ee0800](https://github.com/CodySwannGT/lisa/commit/8ee080094aad4bd6718958a378553ac9a615104b)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)
* **dispatch:** route work to a remote surface with executionEnv ([bffd58b](https://github.com/CodySwannGT/lisa/commit/bffd58b33a1e72c8fe34649368e887dd8c1136e4)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)
* **remote-env:** provision remote environments from a repo-owned manifest ([74b961c](https://github.com/CodySwannGT/lisa/commit/74b961cddd03eae417eb87b5da8eb59cd3791fab)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)
* **secrets:** model the surface axis and materialize where a lane must ([c8fe493](https://github.com/CodySwannGT/lisa/commit/c8fe493e9f6d47eafe2ecd7b9363a4ed0708b3f2)), closes [acmeorgc/frontend#165](https://github.com/acmeorgc/frontend/issues/165) [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)
* **secrets:** route the callers, and check the config that reaches them ([08df8e2](https://github.com/CodySwannGT/lisa/commit/08df8e285abee5e361406d09389a896439437750)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)


### Bug Fixes

* **docs:** replace live high-entropy values with placeholders ([30627c7](https://github.com/CodySwannGT/lisa/commit/30627c728068109a185b7ebec9575fb78234159f)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)


### Documentation

* **plan:** record what shipped and which unknowns survived ([ddd6699](https://github.com/CodySwannGT/lisa/commit/ddd66991d5136ca72f0f7329a1dfaed2a04643ca)), closes [CodySwannGT/lisa#2150](https://github.com/CodySwannGT/lisa/issues/2150)

### [2.316.2](https://github.com/CodySwannGT/lisa/compare/v2.316.1...v2.316.2) (2026-08-01)


### Documentation

* **rules:** require reports to say what the reader must act on ([4ac6090](https://github.com/CodySwannGT/lisa/commit/4ac6090793c09e66f967c5c35b4cfdb90ed0b608)), closes [#2145](https://github.com/CodySwannGT/lisa/issues/2145) [CodySwannGT/lisa#2146](https://github.com/CodySwannGT/lisa/issues/2146)

### [2.316.1](https://github.com/CodySwannGT/lisa/compare/v2.316.0...v2.316.1) (2026-08-01)


### Bug Fixes

* **skills:** state tracker intent instead of naming vendor MCP tools ([ce01b73](https://github.com/CodySwannGT/lisa/commit/ce01b732908524fdf659531236fe611a2bb91999)), closes [#2144](https://github.com/CodySwannGT/lisa/issues/2144) [CodySwannGT/lisa#2148](https://github.com/CodySwannGT/lisa/issues/2148)

## [2.316.0](https://github.com/CodySwannGT/lisa/compare/v2.315.0...v2.316.0) (2026-08-01)


### Features

* **rules:** make every flow report whether the operator is needed ([873af86](https://github.com/CodySwannGT/lisa/commit/873af869cbab58517991f4b0fc568c978f4d2a52)), closes [CodySwannGT/lisa#2144](https://github.com/CodySwannGT/lisa/issues/2144)


### Bug Fixes

* **rules:** address flow completion review gaps ([b713907](https://github.com/CodySwannGT/lisa/commit/b713907a44c852cf1ac2c5598422d577510d73c2)), closes [CodySwannGT/lisa#2144](https://github.com/CodySwannGT/lisa/issues/2144) [CodySwannGT/lisa#2144](https://github.com/CodySwannGT/lisa/issues/2144)

## [2.315.0](https://github.com/CodySwannGT/lisa/compare/v2.314.0...v2.315.0) (2026-07-30)


### Features

* **rules:** add stale-state-claims — "not yet" expires, the note does not ([6725b91](https://github.com/CodySwannGT/lisa/commit/6725b9168af8ad5e7ceb2853d9b1af2b5d73db71)), closes [CodySwannGT/lisa#2141](https://github.com/CodySwannGT/lisa/issues/2141)

## [2.314.0](https://github.com/CodySwannGT/lisa/compare/v2.313.2...v2.314.0) (2026-07-30)


### Features

* **rules:** add falsifiable-checks — a check that cannot fail is not evidence ([a882904](https://github.com/CodySwannGT/lisa/commit/a882904dc5ecee416860b8e69e53114907bab05c)), closes [CodySwannGT/lisa#2138](https://github.com/CodySwannGT/lisa/issues/2138)

### [2.313.2](https://github.com/CodySwannGT/lisa/compare/v2.313.1...v2.313.2) (2026-07-28)


### Documentation

* **wiki:** fix the stale status line and the 0.6.0 attribution ([9db3c13](https://github.com/CodySwannGT/lisa/commit/9db3c1324705001bb333038b282423c3ede2a2b9)), closes [CodySwannGT/lisa#2132](https://github.com/CodySwannGT/lisa/issues/2132) [CodySwannGT/lisa#2132](https://github.com/CodySwannGT/lisa/issues/2132)

### [2.313.1](https://github.com/CodySwannGT/lisa/compare/v2.313.0...v2.313.1) (2026-07-28)


### Documentation

* **wiki:** synthesize the TASC 0.6.0 revision ([9d895c1](https://github.com/CodySwannGT/lisa/commit/9d895c1675f4f624139a37d4b2d9677095f36406)), closes [#2129](https://github.com/CodySwannGT/lisa/issues/2129) [CodySwannGT/lisa#2130](https://github.com/CodySwannGT/lisa/issues/2130) [CodySwannGT/lisa#2130](https://github.com/CodySwannGT/lisa/issues/2130)

## [2.313.0](https://github.com/CodySwannGT/lisa/compare/v2.312.0...v2.313.0) (2026-07-28)


### Features

* **spec:** revise TASC to 0.6.0 with control declaration and output provenance ([e50edc3](https://github.com/CodySwannGT/lisa/commit/e50edc320dbf1497eaabe9229abf76ebaff64f4e)), closes [CodySwannGT/lisa#2128](https://github.com/CodySwannGT/lisa/issues/2128) [CodySwannGT/lisa#2128](https://github.com/CodySwannGT/lisa/issues/2128)


### Bug Fixes

* **spec:** address CodeRabbit findings on the 0.6.0 revision ([efe53a0](https://github.com/CodySwannGT/lisa/commit/efe53a058b6755ab250ebe341d6154b27dcdcd56)), closes [CodySwannGT/lisa#2128](https://github.com/CodySwannGT/lisa/issues/2128) [CodySwannGT/lisa#2128](https://github.com/CodySwannGT/lisa/issues/2128)

## [2.312.0](https://github.com/CodySwannGT/lisa/compare/v2.311.14...v2.312.0) (2026-07-28)


### Features

* **skills:** add lisa-secrets-access ([e480c29](https://github.com/CodySwannGT/lisa/commit/e480c29a461f7490c6d819c88c3fbec90da17235)), closes [#2126](https://github.com/CodySwannGT/lisa/issues/2126) [CodySwannGT/lisa#2126](https://github.com/CodySwannGT/lisa/issues/2126)


### Bug Fixes

* **skills:** make describe and verify resolve environment-first ([a904915](https://github.com/CodySwannGT/lisa/commit/a9049152ba2343913ba662d2a7ebc66fea32e014)), closes [CodySwannGT/lisa#2126](https://github.com/CodySwannGT/lisa/issues/2126) [CodySwannGT/lisa#2126](https://github.com/CodySwannGT/lisa/issues/2126)

### [2.311.14](https://github.com/CodySwannGT/lisa/compare/v2.311.13...v2.311.14) (2026-07-28)


### Bug Fixes

* **readiness:** require artifact integrity proof ([239b275](https://github.com/CodySwannGT/lisa/commit/239b275a506b564b40020c1fba548c10ff51632f)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** require integrity check after artifact download ([1410ef1](https://github.com/CodySwannGT/lisa/commit/1410ef17f908313d9d551116696360e0e5b4f752)), closes [#2125](https://github.com/CodySwannGT/lisa/issues/2125) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.13](https://github.com/CodySwannGT/lisa/compare/v2.311.12...v2.311.13) (2026-07-28)


### Bug Fixes

* **readiness:** report skipped B4 wrapper expansion ([acddac1](https://github.com/CodySwannGT/lisa/commit/acddac166aac72512ac7abbfe4976c99d13d7615)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** scan B4 wrapper scripts ([3d785d8](https://github.com/CodySwannGT/lisa/commit/3d785d8bae4aae2d168b94f7f434b74cc0d76310)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.12](https://github.com/CodySwannGT/lisa/compare/v2.311.11...v2.311.12) (2026-07-28)


### Bug Fixes

* **readiness:** match promoted artifact names ([4935739](https://github.com/CodySwannGT/lisa/commit/49357392eebeb73955c8aa6b201f77f57afd9156)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.11](https://github.com/CodySwannGT/lisa/compare/v2.311.10...v2.311.11) (2026-07-28)


### Bug Fixes

* **readiness:** address wrapper script review ([6be16a1](https://github.com/CodySwannGT/lisa/commit/6be16a18224732a355a09e4847057b6826266d25)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** harden B1 wrapper script expansion ([4b99c1c](https://github.com/CodySwannGT/lisa/commit/4b99c1ca58ba9b8e3da8629a76b18a41b265b370)), closes [#2122](https://github.com/CodySwannGT/lisa/issues/2122) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** scan B1 wrapper scripts ([d4ee02d](https://github.com/CodySwannGT/lisa/commit/d4ee02d75aecf2fbbfec4da700accdf3adfa3ee3)), closes [#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.10](https://github.com/CodySwannGT/lisa/compare/v2.311.9...v2.311.10) (2026-07-28)


### Bug Fixes

* **readiness:** flag kubectl namespace shorthand deletes ([7d17a1b](https://github.com/CodySwannGT/lisa/commit/7d17a1bf8747361e1921168be9ed4c3a14b46b3a)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.9](https://github.com/CodySwannGT/lisa/compare/v2.311.8...v2.311.9) (2026-07-28)


### Bug Fixes

* **readiness:** flag full pvc deletions ([2bb8e06](https://github.com/CodySwannGT/lisa/commit/2bb8e06e485081354f1e7d00983e062a99d60e16)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.8](https://github.com/CodySwannGT/lisa/compare/v2.311.7...v2.311.8) (2026-07-28)


### Bug Fixes

* **readiness:** scope B1 ephemeral screening per invocation ([6715264](https://github.com/CodySwannGT/lisa/commit/6715264416064a4c3910b38b92962ee299a45e92)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** split B1 scans on shell pipes ([35a6ddc](https://github.com/CodySwannGT/lisa/commit/35a6ddc5f319dde20192a3a6fe4c8a18ce058e15)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.7](https://github.com/CodySwannGT/lisa/compare/v2.311.6...v2.311.7) (2026-07-27)


### Bug Fixes

* **readiness:** require backup before data wipe ([e280b7c](https://github.com/CodySwannGT/lisa/commit/e280b7c3d7a66cdf0dec3886a1cb2d4585670c97)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.6](https://github.com/CodySwannGT/lisa/compare/v2.311.5...v2.311.6) (2026-07-27)


### Bug Fixes

* **readiness:** flag reusable caller action pins ([4010189](https://github.com/CodySwannGT/lisa/commit/4010189414c40a32b1bd534e9ba042714a0c4a31)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** include dual-trigger reusable callers ([9fa7c7e](https://github.com/CodySwannGT/lisa/commit/9fa7c7e117d9d1d20a5cb02121787bddd853f536)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.5](https://github.com/CodySwannGT/lisa/compare/v2.311.4...v2.311.5) (2026-07-27)


### Bug Fixes

* **readiness:** match promotion action exactly ([cfd4e50](https://github.com/CodySwannGT/lisa/commit/cfd4e508765c628069a788b87ec9a7d2ea67f68c)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** require validation for promoted artifacts ([ecd34ee](https://github.com/CodySwannGT/lisa/commit/ecd34eefaf787fee357ec3b9a451b013ed8ddbd7)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.4](https://github.com/CodySwannGT/lisa/compare/v2.311.3...v2.311.4) (2026-07-27)


### Bug Fixes

* **readiness:** flag mutable validation actions ([fd07d36](https://github.com/CodySwannGT/lisa/commit/fd07d366adf983753b9b100a8b31ddc9552d009c)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.3](https://github.com/CodySwannGT/lisa/compare/v2.311.2...v2.311.3) (2026-07-27)


### Bug Fixes

* **readiness:** flag pnpm trusted build scripts ([1ff78e9](https://github.com/CodySwannGT/lisa/commit/1ff78e997529646e09e90a8617818da2e5cc6efe)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.311.2](https://github.com/CodySwannGT/lisa/compare/v2.311.1...v2.311.2) (2026-07-27)


### Bug Fixes

* **github-sync:** correct the linkage claims left behind by the non-closing rule ([4cb2d9b](https://github.com/CodySwannGT/lisa/commit/4cb2d9ba87258f8602269cf0f1d865bccbbdb274)), closes [#2109](https://github.com/CodySwannGT/lisa/issues/2109) [CodySwannGT/lisa#2112](https://github.com/CodySwannGT/lisa/issues/2112)

### [2.311.1](https://github.com/CodySwannGT/lisa/compare/v2.311.0...v2.311.1) (2026-07-27)


### Bug Fixes

* **git-submit-pr:** use non-closing GitHub issue refs ([f46f858](https://github.com/CodySwannGT/lisa/commit/f46f85841f8a554348d56aa1df6e824f603970ec)), closes [CodySwannGT/lisa#2109](https://github.com/CodySwannGT/lisa/issues/2109) [CodySwannGT/lisa#2109](https://github.com/CodySwannGT/lisa/issues/2109)

## [2.311.0](https://github.com/CodySwannGT/lisa/compare/v2.310.5...v2.311.0) (2026-07-27)


### Features

* **governance:** force fast-check on every governed TypeScript project ([a21aa59](https://github.com/CodySwannGT/lisa/commit/a21aa597075f6eb7d7cb68de1342762513558694)), closes [CodySwannGT/lisa#2105](https://github.com/CodySwannGT/lisa/issues/2105) [CodySwannGT/lisa#2107](https://github.com/CodySwannGT/lisa/issues/2107)

### [2.310.5](https://github.com/CodySwannGT/lisa/compare/v2.310.4...v2.310.5) (2026-07-27)


### Bug Fixes

* **readiness:** assess Go module supply-chain confidence ([cee1169](https://github.com/CodySwannGT/lisa/commit/cee11693a58b5fc63241250d7c78cc3a41c4e335)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** parse commented Go require blocks ([070854a](https://github.com/CodySwannGT/lisa/commit/070854ace99d55be69c4ffb0fc4d1374ee5b58ae)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.310.4](https://github.com/CodySwannGT/lisa/compare/v2.310.3...v2.310.4) (2026-07-27)


### Bug Fixes

* **merge:** make lisa apply idempotent, found by the first SI9 property test ([228c24c](https://github.com/CodySwannGT/lisa/commit/228c24cd0bafe897703568c3fb1e51b800165ee0)), closes [#1](https://github.com/CodySwannGT/lisa/issues/1) [#2](https://github.com/CodySwannGT/lisa/issues/2) [#1](https://github.com/CodySwannGT/lisa/issues/1) [#2](https://github.com/CodySwannGT/lisa/issues/2) [CodySwannGT/lisa#2105](https://github.com/CodySwannGT/lisa/issues/2105)

### [2.310.3](https://github.com/CodySwannGT/lisa/compare/v2.310.2...v2.310.3) (2026-07-27)


### Bug Fixes

* normalize Android launcher before Maestro ([a3d2c0d](https://github.com/CodySwannGT/lisa/commit/a3d2c0d70c752058895a50ea56be29541a8dc05d)), closes [CodySwannGT/lisa#2091](https://github.com/CodySwannGT/lisa/issues/2091)

### [2.310.2](https://github.com/CodySwannGT/lisa/compare/v2.310.1...v2.310.2) (2026-07-27)


### Bug Fixes

* **readiness:** address poetry review findings ([b8f1393](https://github.com/CodySwannGT/lisa/commit/b8f1393cd73a4d73cbbff2f6d144f2f034c65a6d)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** assess poetry supply-chain confidence ([8cdfd25](https://github.com/CodySwannGT/lisa/commit/8cdfd2556d350e2f6cfd47bb3811ca29329df97e)), closes [#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.310.1](https://github.com/CodySwannGT/lisa/compare/v2.310.0...v2.310.1) (2026-07-27)


### Bug Fixes

* keep Android awake for Maestro ([dc291d5](https://github.com/CodySwannGT/lisa/commit/dc291d555b34c0abd8cc13f2a38c8adcba80663d)), closes [CodySwannGT/lisa#2091](https://github.com/CodySwannGT/lisa/issues/2091)

## [2.310.0](https://github.com/CodySwannGT/lisa/compare/v2.309.5...v2.310.0) (2026-07-26)


### Features

* **agents:** add the evaluation specialist and start Lisa's accountability record ([f401fd6](https://github.com/CodySwannGT/lisa/commit/f401fd65d6fd38d474a9296f7c042c9795083ee1)), closes [CodySwannGT/lisa#2100](https://github.com/CodySwannGT/lisa/issues/2100)

### [2.309.5](https://github.com/CodySwannGT/lisa/compare/v2.309.4...v2.309.5) (2026-07-26)

### [2.309.4](https://github.com/CodySwannGT/lisa/compare/v2.309.3...v2.309.4) (2026-07-26)


### Bug Fixes

* **agents:** restore the two-bucket headings the BCE-5 contract pins ([3f2b7ce](https://github.com/CodySwannGT/lisa/commit/3f2b7ce004658f0295aa2637d1cd95c4de563c79)), closes [CodySwannGT/lisa#2096](https://github.com/CodySwannGT/lisa/issues/2096)


### Code Refactoring

* **agents:** stop six specialists restating their own skills ([a32ae4b](https://github.com/CodySwannGT/lisa/commit/a32ae4ba61dd6efc676f2bb13921564414d44f5b)), closes [CodySwannGT/lisa#2096](https://github.com/CodySwannGT/lisa/issues/2096)

### [2.309.3](https://github.com/CodySwannGT/lisa/compare/v2.309.2...v2.309.3) (2026-07-26)


### Code Refactoring

* **skills:** rewrite the debug artifacts for the current prompting rules ([f8c610e](https://github.com/CodySwannGT/lisa/commit/f8c610e7a3329ce7409cef1ce630b05077cb3fbe)), closes [CodySwannGT/lisa#2093](https://github.com/CodySwannGT/lisa/issues/2093)

### [2.309.2](https://github.com/CodySwannGT/lisa/compare/v2.309.1...v2.309.2) (2026-07-26)


### Bug Fixes

* reconnect Android emulator before Maestro ([54b3436](https://github.com/CodySwannGT/lisa/commit/54b3436e6901167d685c7ab8418621a393b092b6)), closes [CodySwannGT/lisa#2091](https://github.com/CodySwannGT/lisa/issues/2091)

### [2.309.1](https://github.com/CodySwannGT/lisa/compare/v2.309.0...v2.309.1) (2026-07-26)


### Bug Fixes

* **readiness:** address bundler review findings ([6661b93](https://github.com/CodySwannGT/lisa/commit/6661b9359e5ef7660f6d7a7fde80f7b543c8b135)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** assess bundler supply-chain confidence ([88b4697](https://github.com/CodySwannGT/lisa/commit/88b469734e49d128db9f2420facaf296fb848734)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

## [2.309.0](https://github.com/CodySwannGT/lisa/compare/v2.308.0...v2.309.0) (2026-07-26)


### Features

* **spec:** revise TASC to 0.5.0 with agent boundaries and graduated autonomy ([86498fa](https://github.com/CodySwannGT/lisa/commit/86498fafe42b1bdabced540f94976713ce364c23)), closes [CodySwannGT/lisa#2085](https://github.com/CodySwannGT/lisa/issues/2085)


### Bug Fixes

* **spec:** correct the AC3.6 delegation rule and tighten Annex B answers ([5ac6653](https://github.com/CodySwannGT/lisa/commit/5ac66538121bf68cfccb1475ec655fa5785a60c2)), closes [CodySwannGT/lisa#2085](https://github.com/CodySwannGT/lisa/issues/2085)

## [2.308.0](https://github.com/CodySwannGT/lisa/compare/v2.307.0...v2.308.0) (2026-07-26)


### Features

* **spec:** revise TASC to 0.4.0 with standing measurement of agents ([ac0af8b](https://github.com/CodySwannGT/lisa/commit/ac0af8b452c697e4557a7e67a4f0c93911f15f94)), closes [CodySwannGT/lisa#2083](https://github.com/CodySwannGT/lisa/issues/2083)

## [2.307.0](https://github.com/CodySwannGT/lisa/compare/v2.306.0...v2.307.0) (2026-07-26)


### Features

* **spec:** revise TASC to 0.3.0 with responsibility criteria ([7e08ce2](https://github.com/CodySwannGT/lisa/commit/7e08ce277f6e80071d01a4834ed6c22034111369)), closes [CodySwannGT/lisa#2081](https://github.com/CodySwannGT/lisa/issues/2081)


### Bug Fixes

* **spec:** correct Annex D numbering and the AC1.7 answer set ([2d656f0](https://github.com/CodySwannGT/lisa/commit/2d656f0422c5cb37724875beab34581f80f570c4)), closes [CodySwannGT/lisa#2081](https://github.com/CodySwannGT/lisa/issues/2081)

## [2.306.0](https://github.com/CodySwannGT/lisa/compare/v2.305.5...v2.306.0) (2026-07-26)


### Features

* **spec:** revise TASC to 0.2.0 — evidence authenticity, finding integrity, generative testing ([5e4a2eb](https://github.com/CodySwannGT/lisa/commit/5e4a2ebb3696b3b7c45b3158aabfb63dcfaba0a9)), closes [CodySwannGT/lisa#2077](https://github.com/CodySwannGT/lisa/issues/2077)


### Bug Fixes

* **spec:** tighten TASC 0.2.0 criteria after review ([9ff33ab](https://github.com/CodySwannGT/lisa/commit/9ff33abe609772753aba0bb89c85327cccdc9365)), closes [CodySwannGT/lisa#2077](https://github.com/CodySwannGT/lisa/issues/2077)

### [2.305.5](https://github.com/CodySwannGT/lisa/compare/v2.305.4...v2.305.5) (2026-07-26)


### Documentation

* revise TASC evidence integrity ([c7c64d7](https://github.com/CodySwannGT/lisa/commit/c7c64d77508cd82ff0ded6579207a7cc4cf98b69)), closes [#2077](https://github.com/CodySwannGT/lisa/issues/2077) [CodySwannGT/lisa#2077](https://github.com/CodySwannGT/lisa/issues/2077) [CodySwannGT/lisa#2077](https://github.com/CodySwannGT/lisa/issues/2077)

### [2.305.4](https://github.com/CodySwannGT/lisa/compare/v2.305.3...v2.305.4) (2026-07-26)


### Bug Fixes

* allow coverage jobs to start service containers ([8765dfb](https://github.com/CodySwannGT/lisa/commit/8765dfb0b062a47014ed78c7718624246a3c58f2)), closes [CodySwannGT/lisa#2027](https://github.com/CodySwannGT/lisa/issues/2027) [CodySwannGT/lisa#2027](https://github.com/CodySwannGT/lisa/issues/2027)
* harden coverage workflow inputs ([a24967e](https://github.com/CodySwannGT/lisa/commit/a24967eb736672af4b5c250a93d093ff0b04dfca)), closes [CodySwannGT/lisa#2027](https://github.com/CodySwannGT/lisa/issues/2027) [CodySwannGT/lisa#2027](https://github.com/CodySwannGT/lisa/issues/2027)

### [2.305.3](https://github.com/CodySwannGT/lisa/compare/v2.305.2...v2.305.3) (2026-07-26)


### Bug Fixes

* move lisa minimatch off vulnerable brace path ([7d76deb](https://github.com/CodySwannGT/lisa/commit/7d76deb40dcd1a36f34863d97b16dd804171e8ed)), closes [CodySwannGT/lisa#2045](https://github.com/CodySwannGT/lisa/issues/2045)

### [2.305.2](https://github.com/CodySwannGT/lisa/compare/v2.305.1...v2.305.2) (2026-07-26)


### Bug Fixes

* **readiness:** flag production secret migrations ([7c4cb4d](https://github.com/CodySwannGT/lisa/commit/7c4cb4d1b2c83410d8710e1e3280d3a30fecf7f8)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** require prod secret tokens ([51f3b51](https://github.com/CodySwannGT/lisa/commit/51f3b51add8f30c290730b576741430784f8d0bf)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.305.1](https://github.com/CodySwannGT/lisa/compare/v2.305.0...v2.305.1) (2026-07-26)


### Bug Fixes

* **readiness:** flag production wrapper guardrails ([3cb3c5a](https://github.com/CodySwannGT/lisa/commit/3cb3c5a23ca91152d5cee4eb895477cd11a6bb3e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

## [2.305.0](https://github.com/CodySwannGT/lisa/compare/v2.304.1...v2.305.0) (2026-07-26)


### Features

* **spec:** absorb published governance invariants into TASC ([51687d2](https://github.com/CodySwannGT/lisa/commit/51687d232557dec298d16f4e02faf46a622f9e91)), closes [CodySwannGT/lisa#2071](https://github.com/CodySwannGT/lisa/issues/2071)


### Bug Fixes

* **spec:** address TASC invariants review findings ([be79b30](https://github.com/CodySwannGT/lisa/commit/be79b308908848805aa4743e4397541a4ac50c7a)), closes [CodySwannGT/lisa#2071](https://github.com/CodySwannGT/lisa/issues/2071)

### [2.304.1](https://github.com/CodySwannGT/lisa/compare/v2.304.0...v2.304.1) (2026-07-26)


### Bug Fixes

* **readiness:** harden report excerpt redaction ([8e0262f](https://github.com/CodySwannGT/lisa/commit/8e0262f6d663691bb4d94309fe081f7b797c2615)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** redact persisted doc excerpts ([9cdc042](https://github.com/CodySwannGT/lisa/commit/9cdc0420a0202ed9e972773baec03d458df442cf)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

## [2.304.0](https://github.com/CodySwannGT/lisa/compare/v2.303.0...v2.304.0) (2026-07-25)


### Features

* **prd:** requirement-atom definition of ready (29148/EARS/fit criteria) ([9fa5b8d](https://github.com/CodySwannGT/lisa/commit/9fa5b8dcac74db0ac3db04f9558784a45264aec5)), closes [CodySwannGT/lisa#2067](https://github.com/CodySwannGT/lisa/issues/2067)
* **validators:** type-keyed definition of ready + stateless-pickup gate ([49de984](https://github.com/CodySwannGT/lisa/commit/49de984767bb84d8df89f934e65345742ccd9804)), closes [CodySwannGT/lisa#2065](https://github.com/CodySwannGT/lisa/issues/2065)


### Bug Fixes

* **validators:** address definition-of-ready review findings ([70be1b6](https://github.com/CodySwannGT/lisa/commit/70be1b67a13f00c56e7ad18e3d94692bdff16ba6)), closes [CodySwannGT/lisa#2065](https://github.com/CodySwannGT/lisa/issues/2065)

## [2.303.0](https://github.com/CodySwannGT/lisa/compare/v2.302.0...v2.303.0) (2026-07-25)


### Features

* **ui:** key readiness intake to TASC criteria, close criterion gaps ([4f07fbe](https://github.com/CodySwannGT/lisa/commit/4f07fbe5856668e992daed45a4949dcbbf91a9c1)), closes [#2060](https://github.com/CodySwannGT/lisa/issues/2060) [CodySwannGT/lisa#2063](https://github.com/CodySwannGT/lisa/issues/2063)

## [2.302.0](https://github.com/CodySwannGT/lisa/compare/v2.301.7...v2.302.0) (2026-07-25)


### Features

* **ui:** add TASC readiness intake questionnaire to console ([05fdeda](https://github.com/CodySwannGT/lisa/commit/05fdeda2fdc7980263c97d55c5621363b88a0204)), closes [#2059](https://github.com/CodySwannGT/lisa/issues/2059) [CodySwannGT/lisa#2061](https://github.com/CodySwannGT/lisa/issues/2061)

### [2.301.7](https://github.com/CodySwannGT/lisa/compare/v2.301.6...v2.301.7) (2026-07-25)


### Documentation

* **spec:** address TASC draft review findings ([1a836b5](https://github.com/CodySwannGT/lisa/commit/1a836b5de0dc1f767a7e9af50858585a76eade65)), closes [CodySwannGT/lisa#2059](https://github.com/CodySwannGT/lisa/issues/2059)
* **wiki:** ingest TASC specification draft ([c8fc6a0](https://github.com/CodySwannGT/lisa/commit/c8fc6a0367c32f6c8953e57f660bab8d617d333e)), closes [CodySwannGT/lisa#2059](https://github.com/CodySwannGT/lisa/issues/2059)

### [2.301.6](https://github.com/CodySwannGT/lisa/compare/v2.301.5...v2.301.6) (2026-07-25)


### Bug Fixes

* **readiness:** flag mutable release action refs ([987d5cf](https://github.com/CodySwannGT/lisa/commit/987d5cf0bf7f62f632df0ccf10836b73f7f5284e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** require docker action digests ([a9993a8](https://github.com/CodySwannGT/lisa/commit/a9993a876c3f5aa2fd1ffc59719955a2bf0527f9)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.301.5](https://github.com/CodySwannGT/lisa/compare/v2.301.4...v2.301.5) (2026-07-25)


### Bug Fixes

* resolve B2 reusable workflow callers ([b471e11](https://github.com/CodySwannGT/lisa/commit/b471e11f1d85ebb0c99fa64143d6cd4e534477c8)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.301.4](https://github.com/CodySwannGT/lisa/compare/v2.301.3...v2.301.4) (2026-07-25)

### [2.301.3](https://github.com/CodySwannGT/lisa/compare/v2.301.2...v2.301.3) (2026-07-25)

### [2.301.2](https://github.com/CodySwannGT/lisa/compare/v2.301.1...v2.301.2) (2026-07-25)


### Bug Fixes

* **ci:** stop release.yml escalating, migrate installed CI callers ([f842f4a](https://github.com/CodySwannGT/lisa/commit/f842f4a4227f27e2f9342de54a8b0d2b10bf7ee7)), closes [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [#2050](https://github.com/CodySwannGT/lisa/issues/2050) [#2049](https://github.com/CodySwannGT/lisa/issues/2049) [#2051](https://github.com/CodySwannGT/lisa/issues/2051) [#2050](https://github.com/CodySwannGT/lisa/issues/2050) [#2046](https://github.com/CodySwannGT/lisa/issues/2046) [CodySwannGT/lisa#2052](https://github.com/CodySwannGT/lisa/issues/2052)

### [2.301.1](https://github.com/CodySwannGT/lisa/compare/v2.301.0...v2.301.1) (2026-07-25)


### Bug Fixes

* **release:** grant traceability issue read access ([5f1f668](https://github.com/CodySwannGT/lisa/commit/5f1f6687bed28dd5ff753183896842816b220b21)), closes [CodySwannGT/lisa#2048](https://github.com/CodySwannGT/lisa/issues/2048)
* **release:** propagate issue read to host callers ([123558f](https://github.com/CodySwannGT/lisa/commit/123558f1904875c2a4a6db754ed438098c05ae3c)), closes [CodySwannGT/lisa#2048](https://github.com/CodySwannGT/lisa/issues/2048)

## [2.301.0](https://github.com/CodySwannGT/lisa/compare/v2.300.13...v2.301.0) (2026-07-25)


### Features

* **ci:** ship the work-item traceability backstop to the fleet ([8b8f8a5](https://github.com/CodySwannGT/lisa/commit/8b8f8a514068d4f022f0d6f2c34e3ad153d1f2a9)), closes [#1978](https://github.com/CodySwannGT/lisa/issues/1978) [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [#2039](https://github.com/CodySwannGT/lisa/issues/2039) [CodySwannGT/lisa#2046](https://github.com/CodySwannGT/lisa/issues/2046)


### Bug Fixes

* **ci:** stop work_item_traceability escalating caller permissions ([0211e96](https://github.com/CodySwannGT/lisa/commit/0211e96dee073046b3a6f4d8feb7d2b90fbc22b4)), closes [#2047](https://github.com/CodySwannGT/lisa/issues/2047) [#2047](https://github.com/CodySwannGT/lisa/issues/2047) [CodySwannGT/lisa#2049](https://github.com/CodySwannGT/lisa/issues/2049)

### [2.300.13](https://github.com/CodySwannGT/lisa/compare/v2.300.12...v2.300.13) (2026-07-25)


### Bug Fixes

* **readiness:** honor git default branch in delivery checks ([7315ec4](https://github.com/CodySwannGT/lisa/commit/7315ec41838cec4355e9bc0c573274bf9588b96c)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.12](https://github.com/CodySwannGT/lisa/compare/v2.300.11...v2.300.12) (2026-07-25)


### Bug Fixes

* **readiness:** surface opaque guardrail actions ([8019692](https://github.com/CodySwannGT/lisa/commit/8019692984aaa50157d68b1d298af27ed054cca0)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.11](https://github.com/CodySwannGT/lisa/compare/v2.300.10...v2.300.11) (2026-07-25)


### Bug Fixes

* **readiness:** cover lifecycle-only install surfaces ([ad3f7d3](https://github.com/CodySwannGT/lisa/commit/ad3f7d32cbf266a6cfa32dcd8c93ddb534ff587e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** flag install-time dependency execution ([a626620](https://github.com/CodySwannGT/lisa/commit/a626620ad0a7b20889ba7aa9f354c554bca64575)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** flag install-time dependency execution ([92fe559](https://github.com/CodySwannGT/lisa/commit/92fe559347fe1eafdf0001086c522d1b9dc91a5c)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.10](https://github.com/CodySwannGT/lisa/compare/v2.300.9...v2.300.10) (2026-07-25)


### Bug Fixes

* **doctor:** detect terraform auto approve env args ([63f9711](https://github.com/CodySwannGT/lisa/commit/63f9711d978309c5c28a210448a17aeda1b728e5)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **doctor:** tighten terraform apply guardrails ([67c9b36](https://github.com/CodySwannGT/lisa/commit/67c9b36631ccff0bc33be77c725d9201941ea606)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.9](https://github.com/CodySwannGT/lisa/compare/v2.300.8...v2.300.9) (2026-07-25)


### Bug Fixes

* **readiness:** clarify B1 runbook skip reason ([af112df](https://github.com/CodySwannGT/lisa/commit/af112df1b74d3c26aa157cb5859c2d0b8090b2d4)), closes [#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.8](https://github.com/CodySwannGT/lisa/compare/v2.300.7...v2.300.8) (2026-07-25)


### Bug Fixes

* **ratchet:** stop watching audit ignore lists ([7729897](https://github.com/CodySwannGT/lisa/commit/77298970149deb756f9c040a9d531f44e3266aac)), closes [CodySwannGT/lisa#2037](https://github.com/CodySwannGT/lisa/issues/2037)

### [2.300.7](https://github.com/CodySwannGT/lisa/compare/v2.300.6...v2.300.7) (2026-07-25)


### Bug Fixes

* **deps:** keep undici on Expo-compatible v6 ([4042011](https://github.com/CodySwannGT/lisa/commit/404201109f531b924e5b66beca223ac95ba81310)), closes [CodySwannGT/lisa#2036](https://github.com/CodySwannGT/lisa/issues/2036)

### [2.300.6](https://github.com/CodySwannGT/lisa/compare/v2.300.5...v2.300.6) (2026-07-24)


### Bug Fixes

* patch brace expansion release gate ([e73de90](https://github.com/CodySwannGT/lisa/commit/e73de905dafb9e5e5fe7cf3b61daab704874bf6e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** flag poisoned pull_request_target pipelines ([43ccb54](https://github.com/CodySwannGT/lisa/commit/43ccb5420f5e711a0ea95972740479d9a498ed3a)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.5](https://github.com/CodySwannGT/lisa/compare/v2.300.4...v2.300.5) (2026-07-24)


### Bug Fixes

* **readiness:** bound production env markers ([816ea23](https://github.com/CodySwannGT/lisa/commit/816ea23ab95387b239d36514c8464dfe09babc33)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** inspect step env for destructive workflows ([ffbc8be](https://github.com/CodySwannGT/lisa/commit/ffbc8be3221fc275cf476468f61dcb9017fa0cc4)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.4](https://github.com/CodySwannGT/lisa/compare/v2.300.3...v2.300.4) (2026-07-24)


### Bug Fixes

* **readiness:** address workspace manifest review ([4825dcb](https://github.com/CodySwannGT/lisa/commit/4825dcb7a53ff7f145d804f8f9338b50ab8e8595)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** inspect workspace dependency manifests ([295ae95](https://github.com/CodySwannGT/lisa/commit/295ae953ebd84f85f754fbe04676968724e10be7)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.300.3](https://github.com/CodySwannGT/lisa/compare/v2.300.2...v2.300.3) (2026-07-24)


### Bug Fixes

* **ci:** address skip_jobs review coverage ([abd879c](https://github.com/CodySwannGT/lisa/commit/abd879cc90c12dc46ff5adac2edf24aff02e08af)), closes [CodySwannGT/lisa#2028](https://github.com/CodySwannGT/lisa/issues/2028)
* **ci:** match skipped quality jobs by token ([1ced328](https://github.com/CodySwannGT/lisa/commit/1ced328b7b688e58f48d13004401b2846e4f965a)), closes [CodySwannGT/lisa#2028](https://github.com/CodySwannGT/lisa/issues/2028) [CodySwannGT/lisa#2028](https://github.com/CodySwannGT/lisa/issues/2028)
* **ci:** raise postcss audit floor ([49f30fe](https://github.com/CodySwannGT/lisa/commit/49f30fe37bac5134e789b1d5e24b06b2fe795c9c)), closes [CodySwannGT/lisa#2028](https://github.com/CodySwannGT/lisa/issues/2028) [CodySwannGT/lisa#2028](https://github.com/CodySwannGT/lisa/issues/2028)

### [2.300.2](https://github.com/CodySwannGT/lisa/compare/v2.300.1...v2.300.2) (2026-07-24)


### Bug Fixes

* **hooks:** run whole-project typecheck on push ([bb31989](https://github.com/CodySwannGT/lisa/commit/bb319897d959775d07b3e13ed5c5703af47605d8)), closes [CodySwannGT/lisa#2030](https://github.com/CodySwannGT/lisa/issues/2030)
* **security:** require patched PostCSS ([4ab77b5](https://github.com/CodySwannGT/lisa/commit/4ab77b57ab707c488a91f0cae564b5d2440f2df1)), closes [CodySwannGT/lisa#2030](https://github.com/CodySwannGT/lisa/issues/2030)

### [2.300.1](https://github.com/CodySwannGT/lisa/compare/v2.300.0...v2.300.1) (2026-07-24)


### Bug Fixes

* **readiness:** ignore quoted lockfile install mentions ([47c10f9](https://github.com/CodySwannGT/lisa/commit/47c10f9c86ba7da33c0c01ba522361c6032515ae)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** require lockfile-enforced installs ([348c2b0](https://github.com/CodySwannGT/lisa/commit/348c2b03f967289dc601515c70e79cc4b37ed179)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

## [2.300.0](https://github.com/CodySwannGT/lisa/compare/v2.299.5...v2.300.0) (2026-07-24)


### Features

* **ui:** add factory, signals, credentials and environments console pages ([daea2f8](https://github.com/CodySwannGT/lisa/commit/daea2f878f6b97c2578fc3e9d30f9ce764f727ce)), closes [CodySwannGT/lisa#2025](https://github.com/CodySwannGT/lisa/issues/2025)

### [2.299.5](https://github.com/CodySwannGT/lisa/compare/v2.299.4...v2.299.5) (2026-07-24)


### Documentation

* **implement:** require observing a new regression spec green before shipping ([32ddcae](https://github.com/CodySwannGT/lisa/commit/32ddcaefcf7137152994034e9cd8d091529d5c0a)), closes [CodySwannGT/lisa#2022](https://github.com/CodySwannGT/lisa/issues/2022)

### [2.299.4](https://github.com/CodySwannGT/lisa/compare/v2.299.3...v2.299.4) (2026-07-24)


### Bug Fixes

* **readiness:** scope B4 service deferrals ([83e9ab5](https://github.com/CodySwannGT/lisa/commit/83e9ab513eaacfc921e905ceacea7bab163a6769)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** tighten services target evidence ([bc76ffd](https://github.com/CodySwannGT/lisa/commit/bc76ffd4f56885e07c85fe3bc160c33bdd26cc26)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.299.3](https://github.com/CodySwannGT/lisa/compare/v2.299.2...v2.299.3) (2026-07-23)


### Bug Fixes

* **readiness:** require local evidence for service deferral ([994f15f](https://github.com/CodySwannGT/lisa/commit/994f15f034ddb1e21f796d8cfcb4edca5ca4a12e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* require word-boundary match for db/database service-name corroboration ([a92fd6e](https://github.com/CodySwannGT/lisa/commit/a92fd6e515826fff239b94cd333bfa44fe9af69c)), closes [#2020](https://github.com/CodySwannGT/lisa/issues/2020) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* tighten B1 service deferral scope ([2d76b6c](https://github.com/CodySwannGT/lisa/commit/2d76b6cc2e5a6445caeb08ddb1b178960c66c79c)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.299.2](https://github.com/CodySwannGT/lisa/compare/v2.299.1...v2.299.2) (2026-07-23)


### Bug Fixes

* **readiness:** expand B1 destructive command coverage ([af18ba5](https://github.com/CodySwannGT/lisa/commit/af18ba5c1e065e92128fe326a9f344e741b56ec7)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** satisfy B1 case-insensitive review ([314d191](https://github.com/CodySwannGT/lisa/commit/314d191e08457806a1547f7631f53f54213d6f5a)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.299.1](https://github.com/CodySwannGT/lisa/compare/v2.299.0...v2.299.1) (2026-07-23)


### Bug Fixes

* **readiness:** clarify no-workflow skip reasons ([ca63891](https://github.com/CodySwannGT/lisa/commit/ca63891f5e7ca521ab5f39a53fa77fa46cc2c16e)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

## [2.299.0](https://github.com/CodySwannGT/lisa/compare/v2.298.1...v2.299.0) (2026-07-23)


### Features

* **learnings:** preserve dropped captures and keep references alive across consolidation ([78b54fb](https://github.com/CodySwannGT/lisa/commit/78b54fb0e4963d8f6da6f20511ba268f5d07f280)), closes [CodySwannGT/lisa#1996](https://github.com/CodySwannGT/lisa/issues/1996)


### Bug Fixes

* **learnings:** re-establish overflow path containment after the lock wait ([48a065e](https://github.com/CodySwannGT/lisa/commit/48a065e62b32c20be57a96ad6a1fa9f5195b25a6)), closes [CodySwannGT/lisa#1996](https://github.com/CodySwannGT/lisa/issues/1996)

### [2.298.1](https://github.com/CodySwannGT/lisa/compare/v2.298.0...v2.298.1) (2026-07-23)


### Bug Fixes

* **safety-net:** close the residual heredoc-classifier lexer divergences ([209ffc8](https://github.com/CodySwannGT/lisa/commit/209ffc82f1a82004cf4c7a2a310321292fe6f3e2)), closes [CodySwannGT/lisa#1993](https://github.com/CodySwannGT/lisa/issues/1993)

## [2.298.0](https://github.com/CodySwannGT/lisa/compare/v2.297.6...v2.298.0) (2026-07-23)


### Features

* **ci:** add the server-side work-item traceability gate ([4b71cd5](https://github.com/CodySwannGT/lisa/commit/4b71cd543349b2048844a6dbf2992e23fce6c5f8)), closes [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [CodySwannGT/lisa#1978](https://github.com/CodySwannGT/lisa/issues/1978)

### [2.297.6](https://github.com/CodySwannGT/lisa/compare/v2.297.5...v2.297.6) (2026-07-23)


### Bug Fixes

* **learnings:** stop concurrent passes corrupting and losing ledger work ([a675fc1](https://github.com/CodySwannGT/lisa/commit/a675fc11b4fb08ef67de1adeb2a0cd7d9532356a)), closes [CodySwannGT/lisa#1995](https://github.com/CodySwannGT/lisa/issues/1995)

### [2.297.5](https://github.com/CodySwannGT/lisa/compare/v2.297.4...v2.297.5) (2026-07-23)


### Bug Fixes

* tolerate learnings snapshot replacement race ([ce4e72e](https://github.com/CodySwannGT/lisa/commit/ce4e72eda2c57e4f4a484167c9fd4774b7db7df3)), closes [#1995](https://github.com/CodySwannGT/lisa/issues/1995) [CodySwannGT/lisa#1995](https://github.com/CodySwannGT/lisa/issues/1995)

### [2.297.4](https://github.com/CodySwannGT/lisa/compare/v2.297.3...v2.297.4) (2026-07-23)


### Bug Fixes

* harden learnings ledger concurrent writes ([a267c69](https://github.com/CodySwannGT/lisa/commit/a267c693cdcb3e92f73d0cca950f2ff87f492bb0)), closes [CodySwannGT/lisa#1995](https://github.com/CodySwannGT/lisa/issues/1995)

### [2.297.3](https://github.com/CodySwannGT/lisa/compare/v2.297.2...v2.297.3) (2026-07-23)


### Bug Fixes

* **safety-net:** close command-substitution blind spot in the rm content guard ([03af88d](https://github.com/CodySwannGT/lisa/commit/03af88d7fdcc947593b420f26775456528d9f1a7)), closes [#1958](https://github.com/CodySwannGT/lisa/issues/1958) [CodySwannGT/lisa#1982](https://github.com/CodySwannGT/lisa/issues/1982)

### [2.297.2](https://github.com/CodySwannGT/lisa/compare/v2.297.1...v2.297.2) (2026-07-23)


### Bug Fixes

* **ci:** check Lisa's own learnings ledger against its in-tree contract ([6477cc3](https://github.com/CodySwannGT/lisa/commit/6477cc3a1f43d2cde20c214c4f88199af676dc1f)), closes [#2001](https://github.com/CodySwannGT/lisa/issues/2001) [#1959](https://github.com/CodySwannGT/lisa/issues/1959) [CodySwannGT/lisa#2005](https://github.com/CodySwannGT/lisa/issues/2005)

### [2.297.1](https://github.com/CodySwannGT/lisa/compare/v2.297.0...v2.297.1) (2026-07-23)


### Bug Fixes

* **ci:** update learnings budget gate pin ([e0cd702](https://github.com/CodySwannGT/lisa/commit/e0cd702e8c2b4004d1b7344b1f3378e50f42cd73)), closes [CodySwannGT/lisa#2003](https://github.com/CodySwannGT/lisa/issues/2003)
* **sonar:** use SONARQUBE_CLI_* env vars for the CLI-wrapped MCP path ([aad472f](https://github.com/CodySwannGT/lisa/commit/aad472f5e273e9c86e2b15b6955edbb18ab11f2b)), closes [#2000](https://github.com/CodySwannGT/lisa/issues/2000) [CodySwannGT/lisa#2003](https://github.com/CodySwannGT/lisa/issues/2003)

## [2.297.0](https://github.com/CodySwannGT/lisa/compare/v2.296.1...v2.297.0) (2026-07-23)


### Features

* **sonar:** replace hand-rolled SonarCloud access with the official SonarQube MCP ([c625b88](https://github.com/CodySwannGT/lisa/commit/c625b88640e9ea8b51447b01a359652909473787))

### [2.296.1](https://github.com/CodySwannGT/lisa/compare/v2.296.0...v2.296.1) (2026-07-23)


### Bug Fixes

* **learnings:** clarify the average-allowance semantics and pin the byte ceiling ([8c29c24](https://github.com/CodySwannGT/lisa/commit/8c29c249c4086f6597ed61dd9a6d45c473549ac4)), closes [#1959](https://github.com/CodySwannGT/lisa/issues/1959) [CodySwannGT/lisa#1959](https://github.com/CodySwannGT/lisa/issues/1959) [CodySwannGT/lisa#1959](https://github.com/CodySwannGT/lisa/issues/1959)
* **learnings:** derive ledger byte budget from entry cap and signal saturation ([#1959](https://github.com/CodySwannGT/lisa/issues/1959)) ([2827d69](https://github.com/CodySwannGT/lisa/commit/2827d69ed184203e7558ad433302e9248cbd3b38))


### Documentation

* **persist-learning:** correct the gardener-linkage wording on the saturation signal ([27cdc0d](https://github.com/CodySwannGT/lisa/commit/27cdc0d9436cef9cd29c0720519b844e435c11bb)), closes [CodySwannGT/lisa#1959](https://github.com/CodySwannGT/lisa/issues/1959) [CodySwannGT/lisa#1959](https://github.com/CodySwannGT/lisa/issues/1959)

## [2.296.0](https://github.com/CodySwannGT/lisa/compare/v2.295.6...v2.296.0) (2026-07-23)


### Features

* pass literal quoted-heredoc payloads through to the content guards ([0874737](https://github.com/CodySwannGT/lisa/commit/0874737cac166f1414d08fbd6d4d2a304fa07670)), closes [#1958](https://github.com/CodySwannGT/lisa/issues/1958) [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958)


### Bug Fixes

* join unquoted-heredoc-body line continuations before the substitution scan ([#1958](https://github.com/CodySwannGT/lisa/issues/1958) R4) ([9aac14e](https://github.com/CodySwannGT/lisa/commit/9aac14ec12f99cac9a26592803d48ed5df3dda7e))
* make the heredoc quote model aware of unquoted-body semantics ([#1958](https://github.com/CodySwannGT/lisa/issues/1958) R3) ([43aae6c](https://github.com/CodySwannGT/lisa/commit/43aae6c01fb9423008b422fb27137eeca4e3893b))
* match heredoc comment/line predicates to bash's blank set ([#1958](https://github.com/CodySwannGT/lisa/issues/1958) R2) ([f8764da](https://github.com/CodySwannGT/lisa/commit/f8764da210de546fe2e74e6c172f4b2f4c0a5b98))
* preserve heredoc RCE scans after rebase ([77d8ea7](https://github.com/CodySwannGT/lisa/commit/77d8ea7c60c2a05b42381be95cdd97ff81189368)), closes [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958) [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958)
* reject fake heredocs nested in open quotes (RCE regression) ([864340b](https://github.com/CodySwannGT/lisa/commit/864340bc712f9c8ef1e90544e3b75aa1b128392a)), closes [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958)
* teach the shared heredoc quote model ANSI-C $'...' quoting ([78ec60b](https://github.com/CodySwannGT/lisa/commit/78ec60b84b82acc8a09fd92d9f3ea531aabd1167)), closes [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958)

### [2.295.6](https://github.com/CodySwannGT/lisa/compare/v2.295.5...v2.295.6) (2026-07-23)


### Bug Fixes

* keep preview substrings from hiding durable operations ([60036ed](https://github.com/CodySwannGT/lisa/commit/60036ed673d4fa932646960f53abad9077164bab)), closes [#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.295.5](https://github.com/CodySwannGT/lisa/compare/v2.295.4...v2.295.5) (2026-07-23)


### Bug Fixes

* catch durable-trigger guardrail bypass ([0f81cfd](https://github.com/CodySwannGT/lisa/commit/0f81cfd9aa3723dfe928ef043ecd365d0013c050)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.295.4](https://github.com/CodySwannGT/lisa/compare/v2.295.3...v2.295.4) (2026-07-23)


### Bug Fixes

* **readiness:** include job-level secrets: mappings in credential text scan ([9f41099](https://github.com/CodySwannGT/lisa/commit/9f410992b0b1d6fee42683ba37f2154073548a33)), closes [#1990](https://github.com/CodySwannGT/lisa/issues/1990) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** scan reusable workflow credential mappings ([b64cc75](https://github.com/CodySwannGT/lisa/commit/b64cc75d5b1aa39a2a2d48291d6c792603028d04)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **readiness:** scan reusable workflow credential mappings ([34bdc57](https://github.com/CodySwannGT/lisa/commit/34bdc5725a0d512ae296baa8376e0aeecc7058f3)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.295.3](https://github.com/CodySwannGT/lisa/compare/v2.295.2...v2.295.3) (2026-07-23)


### Bug Fixes

* **hooks:** relax quoted heredoc classification ([31b3f6c](https://github.com/CodySwannGT/lisa/commit/31b3f6c72acca9e74839e1cfa7dda3a116f2c714)), closes [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958) [CodySwannGT/lisa#1958](https://github.com/CodySwannGT/lisa/issues/1958)

### [2.295.2](https://github.com/CodySwannGT/lisa/compare/v2.295.1...v2.295.2) (2026-07-23)


### Bug Fixes

* **release:** address review on env-scoped tags ([d46bc6a](https://github.com/CodySwannGT/lisa/commit/d46bc6a2d3991fc7645bb4be9addc84374316c08)), closes [CodySwannGT/lisa#1988](https://github.com/CodySwannGT/lisa/issues/1988)

### [2.295.1](https://github.com/CodySwannGT/lisa/compare/v2.295.0...v2.295.1) (2026-07-23)

## [2.295.0](https://github.com/CodySwannGT/lisa/compare/v2.294.0...v2.295.0) (2026-07-23)


### Features

* **workflows:** declare GitHub environments on stack deploy jobs ([38a1fa6](https://github.com/CodySwannGT/lisa/commit/38a1fa667062aab2d44a708aca73ab7980bd1e63)), closes [CodySwannGT/lisa#1969](https://github.com/CodySwannGT/lisa/issues/1969)


### Bug Fixes

* **workflows:** apply DSS-3 review batch — docs parity, cdk snippet, test dedup ([ccd921e](https://github.com/CodySwannGT/lisa/commit/ccd921e3e241160204f20b7c463a15d5f027ce42)), closes [#1969](https://github.com/CodySwannGT/lisa/issues/1969) [#1969](https://github.com/CodySwannGT/lisa/issues/1969) [CodySwannGT/lisa#1969](https://github.com/CodySwannGT/lisa/issues/1969)
* **workflows:** gate the CDK downstream snippet env (CodeRabbit PR [#1983](https://github.com/CodySwannGT/lisa/issues/1983)) ([93a2690](https://github.com/CodySwannGT/lisa/commit/93a2690d43675a150c4341cda5047da81340120b)), closes [CodySwannGT/lisa#1969](https://github.com/CodySwannGT/lisa/issues/1969)
* **workflows:** route gated deploy jobs to <env>-deploy (mitigation A) ([4279551](https://github.com/CodySwannGT/lisa/commit/42795513d6541967dfd8753a288bada3a2814e63)), closes [CodySwannGT/lisa#1969](https://github.com/CodySwannGT/lisa/issues/1969)

## [2.294.0](https://github.com/CodySwannGT/lisa/compare/v2.293.1...v2.294.0) (2026-07-22)


### Features

* **cli:** add deploy-status ref extraction and tracker adapters ([62baa8e](https://github.com/CodySwannGT/lisa/commit/62baa8e0f87c58757f72fec745ff1b8768a6d55e)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **cli:** register lisa deploy-status-sync gate command ([cda7c60](https://github.com/CodySwannGT/lisa/commit/cda7c607fb680b646217cce217e796018e096ace)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **core:** add pure deploy-status transition planner ([b6099ab](https://github.com/CodySwannGT/lisa/commit/b6099ab6ffdec7d66cd84e346b9eda6d43f34d16)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)


### Bug Fixes

* **cli:** address CodeRabbit review on PR [#1980](https://github.com/CodySwannGT/lisa/issues/1980) deploy-status modules ([fd625b4](https://github.com/CodySwannGT/lisa/commit/fd625b485b66c884565aa1da5c683b5dd6a25c35)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **cli:** harden deploy-status transports and git argv handling ([b3b908e](https://github.com/CodySwannGT/lisa/commit/b3b908eafed383b2bf1b55c9d786dc06e5748088)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **cli:** json no-op payloads, three-dot range reject, jira site guard and ADF ([fa8d6df](https://github.com/CodySwannGT/lisa/commit/fa8d6df090b9229ccf8dffc8a638788cf7e7fc3f)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **cli:** slurp gh comment pages and reorder promote comment-first ([6c066fb](https://github.com/CodySwannGT/lisa/commit/6c066fb53136d3a4c10316d8d3b51c0d0708fd36)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **core:** strip materialized default done entries before union assembly ([ab79980](https://github.com/CodySwannGT/lisa/commit/ab79980a13158d8967a41a65b8ea9f4a4581eee1)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **core:** treat materialized default done-map entries as fallbacks ([a73b7b8](https://github.com/CodySwannGT/lisa/commit/a73b7b8ffaa9c1168a1f104c85938de59bd8bdfd)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)


### Code Refactoring

* **cli:** apply T3 simplifier batch to deploy-status modules ([992b6f7](https://github.com/CodySwannGT/lisa/commit/992b6f7e6894d1e3af58c1e462aadcce80eaf04b)), closes [#7](https://github.com/CodySwannGT/lisa/issues/7) [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)
* **cli:** break adapter import cycle with leaf contract module ([cc8103a](https://github.com/CodySwannGT/lisa/commit/cc8103a4a535cc0e08ee6a33b57991380422057c)), closes [CodySwannGT/lisa#1968](https://github.com/CodySwannGT/lisa/issues/1968)

### [2.293.1](https://github.com/CodySwannGT/lisa/compare/v2.293.0...v2.293.1) (2026-07-22)


### Bug Fixes

* **work-item:** accept bare repo-name labels as repository scope ([b105218](https://github.com/CodySwannGT/lisa/commit/b1052186f7dbafa18bad49e125c86fa86a4ced55)), closes [#1957](https://github.com/CodySwannGT/lisa/issues/1957) [CodySwannGT/lisa#1957](https://github.com/CodySwannGT/lisa/issues/1957)


### Documentation

* **work-item:** correct the config-resolution line citation in the scope comment ([5cade7e](https://github.com/CodySwannGT/lisa/commit/5cade7e91415420b283931f7a40d6682ded509dc)), closes [CodySwannGT/lisa#1957](https://github.com/CodySwannGT/lisa/issues/1957) [CodySwannGT/lisa#1957](https://github.com/CodySwannGT/lisa/issues/1957)

## [2.293.0](https://github.com/CodySwannGT/lisa/compare/v2.292.0...v2.293.0) (2026-07-22)


### Features

* **hooks:** conditional git rebase --abort/--quit guard in the safety net ([15d5ee8](https://github.com/CodySwannGT/lisa/commit/15d5ee8fbff65fe67520abd021d0702fa9b0e35a)), closes [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [#1960](https://github.com/CodySwannGT/lisa/issues/1960) [CodySwannGT/lisa#1956](https://github.com/CodySwannGT/lisa/issues/1956)


### Bug Fixes

* **tests:** align docs-guard pins and prose with the new branch-sync contract ([0e0b565](https://github.com/CodySwannGT/lisa/commit/0e0b56561b9519ffb8e7c8677e2bd236aeccd8a8)), closes [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [pre-#1956](https://github.com/CodySwannGT/pre-/issues/1956) [CodySwannGT/lisa#1956](https://github.com/CodySwannGT/lisa/issues/1956) [CodySwannGT/lisa#1956](https://github.com/CodySwannGT/lisa/issues/1956)
* **work-item:** support rebase and merge sync lanes in bound worktrees ([bdedff6](https://github.com/CodySwannGT/lisa/commit/bdedff6e423f1fb6388de76b667f311e8e7711ee)), closes [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [CodySwannGT/lisa#1956](https://github.com/CodySwannGT/lisa/issues/1956)


### Documentation

* **skills:** document both sanctioned branch-sync lanes in lisa-implement ([5192d48](https://github.com/CodySwannGT/lisa/commit/5192d489d1c268244b30e2804cedbcd4bd6d66fd)), closes [#1956](https://github.com/CodySwannGT/lisa/issues/1956) [CodySwannGT/lisa#1956](https://github.com/CodySwannGT/lisa/issues/1956)

## [2.292.0](https://github.com/CodySwannGT/lisa/compare/v2.291.0...v2.292.0) (2026-07-22)


### Features

* **hooks:** absorb upstream safety-net 1.0.6 guards into parity-safety-net.sh ([f02715f](https://github.com/CodySwannGT/lisa/commit/f02715fa7f40be3e5dcaf37e54bdcab22ab31388)), closes [#1960](https://github.com/CodySwannGT/lisa/issues/1960) [CodySwannGT/lisa#1960](https://github.com/CodySwannGT/lisa/issues/1960)


### Bug Fixes

* **hooks:** close git global-option and path-prefixed rm safety-net bypasses ([8ab54c7](https://github.com/CodySwannGT/lisa/commit/8ab54c7e6aff965b7544c84cfa69a036a4b6c883)), closes [#1960](https://github.com/CodySwannGT/lisa/issues/1960) [CodySwannGT/lisa#1960](https://github.com/CodySwannGT/lisa/issues/1960)
* **hooks:** pair any recursive form with any force form in the rm split gate ([29818e2](https://github.com/CodySwannGT/lisa/commit/29818e25f9c39ce83ff09ae68106b4ef9d77758e)), closes [CodySwannGT/lisa#1960](https://github.com/CodySwannGT/lisa/issues/1960) [CodySwannGT/lisa#1960](https://github.com/CodySwannGT/lisa/issues/1960)
* **plugins:** retire upstream safety-net plugin — the Lisa hook is canonical ([eeb8f8f](https://github.com/CodySwannGT/lisa/commit/eeb8f8faf7bd7a12cd5cc0be6b642ba4474f9fc5)), closes [#1960](https://github.com/CodySwannGT/lisa/issues/1960) [#1955](https://github.com/CodySwannGT/lisa/issues/1955) [CodySwannGT/lisa#1960](https://github.com/CodySwannGT/lisa/issues/1960)

## [2.291.0](https://github.com/CodySwannGT/lisa/compare/v2.290.0...v2.291.0) (2026-07-22)


### Features

* **core:** add deploy-status-sync ladder resolver and config schema ([a8bc399](https://github.com/CodySwannGT/lisa/commit/a8bc3991c1b881842b9cf8f5da7f5d150997ec54)), closes [CodySwannGT/lisa#1967](https://github.com/CodySwannGT/lisa/issues/1967)


### Bug Fixes

* **core:** harden deploy ladder resolution per T3 review ([e67dcbe](https://github.com/CodySwannGT/lisa/commit/e67dcbeb23111ef7752a93ad61e83c2d235caf40)), closes [CodySwannGT/lisa#1967](https://github.com/CodySwannGT/lisa/issues/1967)


### Documentation

* **rules:** document deployStatusSync schema and deploy ladder resolution ([03eab13](https://github.com/CodySwannGT/lisa/commit/03eab138feaac95caa878aee23f24eeb65365d6d)), closes [CodySwannGT/lisa#1967](https://github.com/CodySwannGT/lisa/issues/1967)

## [2.290.0](https://github.com/CodySwannGT/lisa/compare/v2.289.2...v2.290.0) (2026-07-22)


### Features

* **parity:** hard-gate parity drift in pre-push ([9c562b7](https://github.com/CodySwannGT/lisa/commit/9c562b70756047a542567b344db18ace3150881f)), closes [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955) [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955)
* **parity:** refresh drifted parity pins to current upstreams ([2e5a7aa](https://github.com/CodySwannGT/lisa/commit/2e5a7aacb2c7a588411d9fb08ee19c6b3438870e)), closes [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955) [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955)


### Bug Fixes

* **parity:** address review — fail-closed gate, 1.2.0 routing inventory, opt-in tracing wording ([fe72ae7](https://github.com/CodySwannGT/lisa/commit/fe72ae771b7c8eb25b653363cf4336d1957fb2d6)), closes [#1961](https://github.com/CodySwannGT/lisa/issues/1961) [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955) [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955)
* **plugins:** retire upstream sentry plugin — the bundled MCP is canonical ([1b92d60](https://github.com/CodySwannGT/lisa/commit/1b92d6073fcc35586a776f990f7b64e8d7b22ff6)), closes [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955) [CodySwannGT/lisa#1955](https://github.com/CodySwannGT/lisa/issues/1955)

### [2.289.2](https://github.com/CodySwannGT/lisa/compare/v2.289.1...v2.289.2) (2026-07-22)


### Performance Improvements

* **postinstall:** inherit primary checkout plugin-sync state in linked worktrees ([5549ab3](https://github.com/CodySwannGT/lisa/commit/5549ab3ef9035ed34d6f4f62181badf923597c19)), closes [#320](https://github.com/CodySwannGT/lisa/issues/320) [#320](https://github.com/CodySwannGT/lisa/issues/320) [#1017](https://github.com/CodySwannGT/lisa/issues/1017) [CodySwannGT/lisa#1962](https://github.com/CodySwannGT/lisa/issues/1962)

### [2.289.1](https://github.com/CodySwannGT/lisa/compare/v2.289.0...v2.289.1) (2026-07-22)


### Documentation

* **rules:** make tracker status vocabulary config-bound for every actor ([78b8a49](https://github.com/CodySwannGT/lisa/commit/78b8a4965191ee2e7902569fadcee276177f23f4)), closes [CodySwannGT/lisa#1953](https://github.com/CodySwannGT/lisa/issues/1953)
* **skills:** resolve jira-sync milestone table statuses from the configured workflow map ([dde5321](https://github.com/CodySwannGT/lisa/commit/dde5321e811047f83bec8d4b66ca75368002f003)), closes [#1954](https://github.com/CodySwannGT/lisa/issues/1954) [CodySwannGT/lisa#1953](https://github.com/CodySwannGT/lisa/issues/1953)

## [2.289.0](https://github.com/CodySwannGT/lisa/compare/v2.288.1...v2.289.0) (2026-07-22)


### Features

* **verification:** require drift-aware assertions for live-environment verification ([7e1be48](https://github.com/CodySwannGT/lisa/commit/7e1be4862ec5b2a268108022ba8561c4033c5381)), closes [CodySwannGT/lisa#1951](https://github.com/CodySwannGT/lisa/issues/1951)


### Bug Fixes

* **verification:** define the canonical drift field in the verdict contract ([182e2b0](https://github.com/CodySwannGT/lisa/commit/182e2b0f2557ca31a7176e14cf0990336a56db0e)), closes [#1952](https://github.com/CodySwannGT/lisa/issues/1952) [CodySwannGT/lisa#1951](https://github.com/CodySwannGT/lisa/issues/1951)

### [2.288.1](https://github.com/CodySwannGT/lisa/compare/v2.288.0...v2.288.1) (2026-07-22)


### Bug Fixes

* **cdk:** grant the release job the token permissions its nested workflows request ([5d2cf4d](https://github.com/CodySwannGT/lisa/commit/5d2cf4de2801cbb7459e166577d89ce6d7f86672))

## [2.288.0](https://github.com/CodySwannGT/lisa/compare/v2.287.1...v2.288.0) (2026-07-22)


### Features

* **skills:** mandate post-merge Linear reconciliation on non-terminal merges ([610e8e1](https://github.com/CodySwannGT/lisa/commit/610e8e1c3260025d50f2e47294a0978bf11bfe62)), closes [#207](https://github.com/CodySwannGT/lisa/issues/207) [CodySwannGT/lisa#1948](https://github.com/CodySwannGT/lisa/issues/1948) [CodySwannGT/lisa#1948](https://github.com/CodySwannGT/lisa/issues/1948)


### Bug Fixes

* **skills:** harden drive-pr-to-merge Linear reconciliation ordering and safe default ([4c66796](https://github.com/CodySwannGT/lisa/commit/4c66796be17fb885afde278d10491db39632d70d)), closes [#1949](https://github.com/CodySwannGT/lisa/issues/1949) [CodySwannGT/lisa#1948](https://github.com/CodySwannGT/lisa/issues/1948) [CodySwannGT/lisa#1948](https://github.com/CodySwannGT/lisa/issues/1948)

### [2.287.1](https://github.com/CodySwannGT/lisa/compare/v2.286.14...v2.287.1) (2026-07-22)


### Bug Fixes

* **release:** realign package.json version with npm latest (2.287.0) ([a74d4f3](https://github.com/CodySwannGT/lisa/commit/a74d4f35544a6aeb978b7e9c83cb9f4086112128)), closes [CodySwannGT/lisa#1945](https://github.com/CodySwannGT/lisa/issues/1945)

### [2.286.14](https://github.com/CodySwannGT/lisa/compare/v2.286.13...v2.286.14) (2026-07-22)

### [2.286.13](https://github.com/CodySwannGT/lisa/compare/v2.287.0...v2.286.13) (2026-07-22)


### Bug Fixes

* **linear:** treat the `duplicate` state.type as terminal in lifecycle rollups ([fcdbe23](https://github.com/CodySwannGT/lisa/commit/fcdbe23e872a12ae26a8b1cc3ddbae26a79d4434)), closes [CodySwannGT/lisa#1942](https://github.com/CodySwannGT/lisa/issues/1942)

## [2.287.0](https://github.com/CodySwannGT/lisa/compare/v2.286.12...v2.287.0) (2026-07-22)


### Features

* **expo:** add opt-in Maestro MCP setup skill + safe SessionStart auto-register ([7dc074e](https://github.com/CodySwannGT/lisa/commit/7dc074e9d093b465d7ce82a5af5cab6480f87855)), closes [CodySwannGT/lisa#1940](https://github.com/CodySwannGT/lisa/issues/1940)


### Bug Fixes

* **expo:** robust Java resolution (SDKMAN + JVM java.home) and guarded Maestro registration ([b3b70c3](https://github.com/CodySwannGT/lisa/commit/b3b70c372edeab98474fd172c08429964584c555)), closes [#1941](https://github.com/CodySwannGT/lisa/issues/1941) [CodySwannGT/lisa#1940](https://github.com/CodySwannGT/lisa/issues/1940)
* **package-lisa:** normalize direct-dep overrides to $name to prevent EOVERRIDE ([6bd6e6f](https://github.com/CodySwannGT/lisa/commit/6bd6e6fbc74428a8c7d78983cb0b3f2c401e45e4)), closes [CodySwannGT/lisa#1940](https://github.com/CodySwannGT/lisa/issues/1940)

### [2.286.12](https://github.com/CodySwannGT/lisa/compare/v2.286.11...v2.286.12) (2026-07-22)


### Documentation

* **verification:** drive stateful surfaces into the state that can break ([0865441](https://github.com/CodySwannGT/lisa/commit/0865441a31ba2be9260cda5298e4afd14b29c205)), closes [CodySwannGT/lisa#1937](https://github.com/CodySwannGT/lisa/issues/1937)

### [2.286.11](https://github.com/CodySwannGT/lisa/compare/v2.286.10...v2.286.11) (2026-07-22)


### Bug Fixes

* **doctor:** clarify B1 runbook-cleared skips ([73d8671](https://github.com/CodySwannGT/lisa/commit/73d8671144b3f588a6d04bf7e1d05131d054c06a)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.10](https://github.com/CodySwannGT/lisa/compare/v2.286.9...v2.286.10) (2026-07-22)


### Bug Fixes

* **doctor:** respect configured default branch for B2 ([f147662](https://github.com/CodySwannGT/lisa/commit/f147662485040bfd38bc653562746781e1d2231d)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903) [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.9](https://github.com/CodySwannGT/lisa/compare/v2.286.8...v2.286.9) (2026-07-22)


### Bug Fixes

* **doctor:** assess every publish step ([db18611](https://github.com/CodySwannGT/lisa/commit/db186119d8f966b4e37003be5e8222babea38c7a)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **doctor:** scope publish promotion checks ([23b16c7](https://github.com/CodySwannGT/lisa/commit/23b16c76f23c9520d26a244d9d0346deafb45036)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.8](https://github.com/CodySwannGT/lisa/compare/v2.286.7...v2.286.8) (2026-07-22)


### Bug Fixes

* **doctor:** address templated build review ([f43aa84](https://github.com/CodySwannGT/lisa/commit/f43aa84a3420e59c4562e8d3ee8fe050d545b113)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **doctor:** detect templated release builds ([e70fe5b](https://github.com/CodySwannGT/lisa/commit/e70fe5b3d5e511ceb9e8b9ddccece6f2d70b09e9)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.7](https://github.com/CodySwannGT/lisa/compare/v2.286.6...v2.286.7) (2026-07-22)


### Bug Fixes

* **doctor:** detect action-based release publishes ([5f7dfaf](https://github.com/CodySwannGT/lisa/commit/5f7dfaf8fc6862c4a2942ad4924bc54f11c362e4)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.6](https://github.com/CodySwannGT/lisa/compare/v2.286.5...v2.286.6) (2026-07-22)


### Bug Fixes

* **doctor:** detect round-2 static credential authority ([146fcdb](https://github.com/CodySwannGT/lisa/commit/146fcdbb8ea3c27fddc5e43446051df6ea38ebac)), closes [CodySwannGT/lisa#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.286.5](https://github.com/CodySwannGT/lisa/compare/v2.286.4...v2.286.5) (2026-07-22)


### Bug Fixes

* **migrations:** retire stale esbuild exclusion securely ([8df8de3](https://github.com/CodySwannGT/lisa/commit/8df8de3b1cae33f02f923060f8c50a544f6cda62)), closes [CodySwannGT/lisa#1929](https://github.com/CodySwannGT/lisa/issues/1929)

### [2.286.4](https://github.com/CodySwannGT/lisa/compare/v2.286.3...v2.286.4) (2026-07-22)

### [2.286.3](https://github.com/CodySwannGT/lisa/compare/v2.286.2...v2.286.3) (2026-07-21)


### Bug Fixes

* **security:** floor fast-xml-parser at 5.10.1 ([b2bac0e](https://github.com/CodySwannGT/lisa/commit/b2bac0e1033695ae9adf26b0b6edd0d0cc5a45ba)), closes [CodySwannGT/lisa#1925](https://github.com/CodySwannGT/lisa/issues/1925)

### [2.286.2](https://github.com/CodySwannGT/lisa/compare/v2.286.1...v2.286.2) (2026-07-21)


### Bug Fixes

* **learnings:** anchor stale-lock reclaim to the lock it judged stale ([#1878](https://github.com/CodySwannGT/lisa/issues/1878)) ([71e5a78](https://github.com/CodySwannGT/lisa/commit/71e5a784c1f759e3c896a4fdbee4ddf4fc1ac36e))

### [2.286.1](https://github.com/CodySwannGT/lisa/compare/v2.286.0...v2.286.1) (2026-07-21)


### Bug Fixes

* **deps:** stop the addition fixture modeling a false detection claim ([#1891](https://github.com/CodySwannGT/lisa/issues/1891)) ([ca285e1](https://github.com/CodySwannGT/lisa/commit/ca285e12fd03784978775219d2a318d86237144c)), closes [#1922](https://github.com/CodySwannGT/lisa/issues/1922) [#1887](https://github.com/CodySwannGT/lisa/issues/1887)


### Documentation

* **deps:** make the shipped record scaffold reach all five surfaces ([#1891](https://github.com/CodySwannGT/lisa/issues/1891)) ([d2a103d](https://github.com/CodySwannGT/lisa/commit/d2a103ded8fbe254682df981da6247877ef55ff6))

## [2.286.0](https://github.com/CodySwannGT/lisa/compare/v2.285.1...v2.286.0) (2026-07-21)


### Features

* **deps:** add confidence-rebuild kit for dependency internalization ([#1890](https://github.com/CodySwannGT/lisa/issues/1890)) ([11d2a80](https://github.com/CodySwannGT/lisa/commit/11d2a80d47c4c85309a6078093bd009561b9b811)), closes [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1887](https://github.com/CodySwannGT/lisa/issues/1887) [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1887](https://github.com/CodySwannGT/lisa/issues/1887) [#1887](https://github.com/CodySwannGT/lisa/issues/1887)

### [2.285.1](https://github.com/CodySwannGT/lisa/compare/v2.285.0...v2.285.1) (2026-07-21)


### Documentation

* **deps:** seed Lisa's dependency decision records ([#1889](https://github.com/CodySwannGT/lisa/issues/1889)) ([c9fb357](https://github.com/CodySwannGT/lisa/commit/c9fb35758d6d86cfa82f2dbd4133e6b45ac8c3f2)), closes [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1887](https://github.com/CodySwannGT/lisa/issues/1887) [#1918](https://github.com/CodySwannGT/lisa/issues/1918) [#1918](https://github.com/CodySwannGT/lisa/issues/1918)

## [2.285.0](https://github.com/CodySwannGT/lisa/compare/v2.284.0...v2.285.0) (2026-07-21)


### Features

* **ci:** add manifest-authoritative duplicate-version check ([#1888](https://github.com/CodySwannGT/lisa/issues/1888)) ([6e140ea](https://github.com/CodySwannGT/lisa/commit/6e140ea386796e39c479ecf4afbc17f2fb3e7330))


### Bug Fixes

* **ci:** stop duplicate-version check misreporting self-references ([#1888](https://github.com/CodySwannGT/lisa/issues/1888)) ([a9fbcd6](https://github.com/CodySwannGT/lisa/commit/a9fbcd6b6542b738b385c275fb650a74399911e1))

## [2.284.0](https://github.com/CodySwannGT/lisa/compare/v2.283.0...v2.284.0) (2026-07-21)


### Features

* **deps:** define dependency trust classes and review requirements ([#1887](https://github.com/CodySwannGT/lisa/issues/1887)) ([8239440](https://github.com/CodySwannGT/lisa/commit/8239440dad929b8d1c4d5322fede5453e3ae8fde)), closes [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1886](https://github.com/CodySwannGT/lisa/issues/1886) [#1888](https://github.com/CodySwannGT/lisa/issues/1888) [#1889](https://github.com/CodySwannGT/lisa/issues/1889)
* **ui:** derive setup checklist readiness ([2abb76d](https://github.com/CodySwannGT/lisa/commit/2abb76dd1ac346bbd442e7f4ba163bd9bbcd4779)), closes [CodySwannGT/lisa#1531](https://github.com/CodySwannGT/lisa/issues/1531)

## [2.283.0](https://github.com/CodySwannGT/lisa/compare/v2.282.0...v2.283.0) (2026-07-21)


### Features

* **deps:** add governed dependency decision-record scaffold ([#1886](https://github.com/CodySwannGT/lisa/issues/1886)) ([d66bbf5](https://github.com/CodySwannGT/lisa/commit/d66bbf53aeb7c60965bba5b562e916e42943f089)), closes [#1887](https://github.com/CodySwannGT/lisa/issues/1887) [#1888](https://github.com/CodySwannGT/lisa/issues/1888) [#1889](https://github.com/CodySwannGT/lisa/issues/1889) [#1889](https://github.com/CodySwannGT/lisa/issues/1889)


### Documentation

* **deps:** make the dependency decision record readable at the gate ([#1886](https://github.com/CodySwannGT/lisa/issues/1886)) ([586e930](https://github.com/CodySwannGT/lisa/commit/586e93062856a14036df5e84473e6f0754a1b0fd)), closes [#1889](https://github.com/CodySwannGT/lisa/issues/1889)

## [2.282.0](https://github.com/CodySwannGT/lisa/compare/v2.281.0...v2.282.0) (2026-07-21)


### Features

* **doctor:** bridge agent readiness group to CLI .lisa/readiness.json ([#1902](https://github.com/CodySwannGT/lisa/issues/1902)) ([efd5dc0](https://github.com/CodySwannGT/lisa/commit/efd5dc09b5b395759e1a3420ae377152a78a482d)), closes [#1739](https://github.com/CodySwannGT/lisa/issues/1739) [#1897](https://github.com/CodySwannGT/lisa/issues/1897) [#1896](https://github.com/CodySwannGT/lisa/issues/1896)
* **standards:** add freshness-bound conformance proof ([be43610](https://github.com/CodySwannGT/lisa/commit/be43610ed24fadf4d05d441f1aa24e4e846e66ef)), closes [CodySwannGT/lisa#1895](https://github.com/CodySwannGT/lisa/issues/1895)


### Bug Fixes

* address standards proof review findings ([3aab61a](https://github.com/CodySwannGT/lisa/commit/3aab61aa7cae6493789d30264046530d19ac6483)), closes [CodySwannGT/lisa#1895](https://github.com/CodySwannGT/lisa/issues/1895)
* **doctor:** escalate readiness dimensions on attribution, not blocker spec ([#1902](https://github.com/CodySwannGT/lisa/issues/1902)) ([0261314](https://github.com/CodySwannGT/lisa/commit/02613149459024151a84ae0c1493bc4cf69eb84a))
* **doctor:** let a standing blocker outrank the recorded readiness status ([#1902](https://github.com/CodySwannGT/lisa/issues/1902)) ([83e2c9c](https://github.com/CodySwannGT/lisa/commit/83e2c9ce04e23d6fb888582f2313185c7a6f7704)), closes [#1858](https://github.com/CodySwannGT/lisa/issues/1858)
* **hooks:** isolate nested Git checks ([bc30e40](https://github.com/CodySwannGT/lisa/commit/bc30e405e1d5b61b97a88b6371c9596c84235d2e)), closes [CodySwannGT/lisa#1895](https://github.com/CodySwannGT/lisa/issues/1895)

## [2.281.0](https://github.com/CodySwannGT/lisa/compare/v2.280.0...v2.281.0) (2026-07-21)


### Features

* **doctor:** wire B1/B4 + capabilities-tools readiness producers, closing [#1896](https://github.com/CodySwannGT/lisa/issues/1896) ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([2c4638f](https://github.com/CodySwannGT/lisa/commit/2c4638f90f69c80d8ce8fe8848ac23759b4106da))


### Bug Fixes

* **doctor:** stop B1/B4 firing on ephemeral CI and preview infrastructure ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([d6c8e9d](https://github.com/CodySwannGT/lisa/commit/d6c8e9d78f236eb54f16384a12527fb7edfae58b))

## [2.280.0](https://github.com/CodySwannGT/lisa/compare/v2.279.2...v2.280.0) (2026-07-21)


### Features

* **doctor:** wire B5/B6 supply-chain + context-routing readiness producers ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([8409aae](https://github.com/CodySwannGT/lisa/commit/8409aaef8bfe7be79b01e8efc418f7b6fde6fd89))


### Bug Fixes

* **doctor:** pin B5 archive URLs, id-less exclusions, and honest exemption wording ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([265ae44](https://github.com/CodySwannGT/lisa/commit/265ae447b429624915383ebd190c4c8ce7d849e3))
* **doctor:** stop B5/B6 false-REDing correctly configured repositories ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([8f488d9](https://github.com/CodySwannGT/lisa/commit/8f488d90e3dcb81c3f8aad0e8ca44561a9dc8822)), closes [#1903](https://github.com/CodySwannGT/lisa/issues/1903)

### [2.279.2](https://github.com/CodySwannGT/lisa/compare/v2.279.1...v2.279.2) (2026-07-21)


### Bug Fixes

* **ci:** avoid package-manager template injection ([051325c](https://github.com/CodySwannGT/lisa/commit/051325cba936501a13e77b00bb41774928d6adae)), closes [CodySwannGT/lisa#1906](https://github.com/CodySwannGT/lisa/issues/1906)

### [2.279.1](https://github.com/CodySwannGT/lisa/compare/v2.279.0...v2.279.1) (2026-07-21)


### Bug Fixes

* **ci:** install dependencies for e2e route coverage ([8f66089](https://github.com/CodySwannGT/lisa/commit/8f66089243080543d64f0fb8c57d0e8fd1c3ecb1)), closes [CodySwannGT/lisa#1906](https://github.com/CodySwannGT/lisa/issues/1906)

## [2.279.0](https://github.com/CodySwannGT/lisa/compare/v2.278.0...v2.279.0) (2026-07-21)


### Features

* **doctor:** wire B2/B3 delivery-authority readiness producers ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([d1cce39](https://github.com/CodySwannGT/lisa/commit/d1cce39ad21b24c05c2d259ad57299872a70e22e)), closes [#1898](https://github.com/CodySwannGT/lisa/issues/1898) [#1902](https://github.com/CodySwannGT/lisa/issues/1902)


### Bug Fixes

* **doctor:** close B2 residual false negatives and false greens ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([9505e30](https://github.com/CodySwannGT/lisa/commit/9505e30fae9524f98431716af01afec8a717b541)), closes [#1898](https://github.com/CodySwannGT/lisa/issues/1898) [#1903](https://github.com/CodySwannGT/lisa/issues/1903)
* **doctor:** name blockers on the persist-failure path, ignore dry-run publishes ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([3e46ee9](https://github.com/CodySwannGT/lisa/commit/3e46ee965ded4a4af87d7934c836d661302c6a5e)), closes [#1905](https://github.com/CodySwannGT/lisa/issues/1905)
* **doctor:** stop B2/B3 readiness producers failing correct repos ([#1896](https://github.com/CodySwannGT/lisa/issues/1896)) ([00d3b6c](https://github.com/CodySwannGT/lisa/commit/00d3b6c4ac56fdc113a536db347c2220bab58523)), closes [#1898](https://github.com/CodySwannGT/lisa/issues/1898)

## [2.278.0](https://github.com/CodySwannGT/lisa/compare/v2.277.4...v2.278.0) (2026-07-21)


### Features

* **ui:** add setup readiness projection ([6a857be](https://github.com/CodySwannGT/lisa/commit/6a857bee13463e1f0e0fc9dff38c08e8d80d6b02)), closes [CodySwannGT/lisa#1892](https://github.com/CodySwannGT/lisa/issues/1892)


### Bug Fixes

* **ui:** address setup readiness review ([422cd2c](https://github.com/CodySwannGT/lisa/commit/422cd2cd04b356ef83d0d6a170b602ffec50a133)), closes [CodySwannGT/lisa#1892](https://github.com/CodySwannGT/lisa/issues/1892)

### [2.277.4](https://github.com/CodySwannGT/lisa/compare/v2.277.3...v2.277.4) (2026-07-21)


### Bug Fixes

* **cli:** complete local setup project flow ([36e2af8](https://github.com/CodySwannGT/lisa/commit/36e2af852faff6e1a5f19825dab819ce8abe3664)), closes [CodySwannGT/lisa#1899](https://github.com/CodySwannGT/lisa/issues/1899)

### [2.277.3](https://github.com/CodySwannGT/lisa/compare/v2.277.2...v2.277.3) (2026-07-21)


### Bug Fixes

* **doctor:** agent-facing readiness scorer must not call unassessed READY ([#1897](https://github.com/CodySwannGT/lisa/issues/1897)) ([d453ed9](https://github.com/CodySwannGT/lisa/commit/d453ed94dbe774a8d72fc332c1cb9caa67aa8819)), closes [#1896](https://github.com/CodySwannGT/lisa/issues/1896)
* **doctor:** unassessed readiness dimensions must not report READY ([#1897](https://github.com/CodySwannGT/lisa/issues/1897)) ([80b2e61](https://github.com/CodySwannGT/lisa/commit/80b2e614947d16004d704df9db5f7d9c090d4b8b))

### [2.277.2](https://github.com/CodySwannGT/lisa/compare/v2.277.1...v2.277.2) (2026-07-21)


### Bug Fixes

* **release:** recover the changelog-push retry from version-line rebase conflicts ([#1884](https://github.com/CodySwannGT/lisa/issues/1884)) ([dae78e6](https://github.com/CodySwannGT/lisa/commit/dae78e60076746485ef716929afbd94a2a5eb08b)), closes [#1848](https://github.com/CodySwannGT/lisa/issues/1848)
* **test:** isolate push-recovery reproduction from the caller's GIT_* env ([8a9ac97](https://github.com/CodySwannGT/lisa/commit/8a9ac97090a934e4ffaa61a43843873cd5730c0d)), closes [CodySwannGT/lisa#1884](https://github.com/CodySwannGT/lisa/issues/1884)

### [2.277.1](https://github.com/CodySwannGT/lisa/compare/v2.277.0...v2.277.1) (2026-07-21)

## [2.277.0](https://github.com/CodySwannGT/lisa/compare/v2.276.0...v2.277.0) (2026-07-21)


### Features

* **automations:** warn on readiness blockers and document the readiness rubric ([#1859](https://github.com/CodySwannGT/lisa/issues/1859)) ([a93a667](https://github.com/CodySwannGT/lisa/commit/a93a6672121428318f8fee960452148592bd62bf)), closes [#1739](https://github.com/CodySwannGT/lisa/issues/1739)

## [2.276.0](https://github.com/CodySwannGT/lisa/compare/v2.275.0...v2.276.0) (2026-07-21)


### Features

* **ui:** wire deterministic health console ([9112b1e](https://github.com/CodySwannGT/lisa/commit/9112b1e6d6b8926f78805cb2f35563631f80d35d)), closes [CodySwannGT/lisa#1529](https://github.com/CodySwannGT/lisa/issues/1529)


### Documentation

* **ui:** attach verification usage record ([a20084e](https://github.com/CodySwannGT/lisa/commit/a20084e4c1bf5caf58dd4b65eff348650c200b62)), closes [CodySwannGT/lisa#1529](https://github.com/CodySwannGT/lisa/issues/1529)
* **ui:** document health single-flight helpers ([ca89e2e](https://github.com/CodySwannGT/lisa/commit/ca89e2e9f321d2e95a3f368674e0c63f0ee259ea)), closes [CodySwannGT/lisa#1529](https://github.com/CodySwannGT/lisa/issues/1529)
* **ui:** link published health evidence ([c81f09e](https://github.com/CodySwannGT/lisa/commit/c81f09ebdc9a2148ae8913b8c04f50984cd2a83c)), closes [CodySwannGT/lisa#1529](https://github.com/CodySwannGT/lisa/issues/1529)

## [2.275.0](https://github.com/CodySwannGT/lisa/compare/v2.274.0...v2.275.0) (2026-07-21)


### Features

* **health:** add shared cross-harness consumer ([f2d01db](https://github.com/CodySwannGT/lisa/commit/f2d01db19b4cf289202b2fd51bf495fb5233c953)), closes [CodySwannGT/lisa#1523](https://github.com/CodySwannGT/lisa/issues/1523)

## [2.274.0](https://github.com/CodySwannGT/lisa/compare/v2.273.0...v2.274.0) (2026-07-21)


### Features

* **doctor:** populate readiness journey evidence via the shared worker-epoch runner ([#1858](https://github.com/CodySwannGT/lisa/issues/1858)) ([ebddba7](https://github.com/CodySwannGT/lisa/commit/ebddba7e49d733d9250c0fda521b5edebcfa0efa)), closes [#1742](https://github.com/CodySwannGT/lisa/issues/1742) [#1742](https://github.com/CodySwannGT/lisa/issues/1742) [#1738](https://github.com/CodySwannGT/lisa/issues/1738) [#1742](https://github.com/CodySwannGT/lisa/issues/1742)

## [2.273.0](https://github.com/CodySwannGT/lisa/compare/v2.272.0...v2.273.0) (2026-07-21)


### Features

* **doctor:** seven-blocker gate and narrowed-claim in readiness assessment ([#1857](https://github.com/CodySwannGT/lisa/issues/1857)) ([f28f81e](https://github.com/CodySwannGT/lisa/commit/f28f81e694f4c32c4cc2015098d333b87a6a1060)), closes [#1855](https://github.com/CodySwannGT/lisa/issues/1855) [#1853](https://github.com/CodySwannGT/lisa/issues/1853) [#1738](https://github.com/CodySwannGT/lisa/issues/1738) [#1738](https://github.com/CodySwannGT/lisa/issues/1738)


### Bug Fixes

* **doctor:** correct verb agreement for singular ship blocker in narrowed claim ([857deb5](https://github.com/CodySwannGT/lisa/commit/857deb5f4133bba5db9c774d298957c9adc6aa6c)), closes [CodySwannGT/lisa#1857](https://github.com/CodySwannGT/lisa/issues/1857)

## [2.272.0](https://github.com/CodySwannGT/lisa/compare/v2.271.0...v2.272.0) (2026-07-21)


### Features

* **health:** add optional agentic composition ([2476321](https://github.com/CodySwannGT/lisa/commit/2476321e67636b73f2e91bfcfdf4481d894ff989)), closes [CodySwannGT/lisa#1522](https://github.com/CodySwannGT/lisa/issues/1522)

## [2.271.0](https://github.com/CodySwannGT/lisa/compare/v2.270.0...v2.271.0) (2026-07-21)


### Features

* **skills:** agent-ready readiness assessment with narrowed ingest-boundary carve-out ([#1856](https://github.com/CodySwannGT/lisa/issues/1856)) ([9abea36](https://github.com/CodySwannGT/lisa/commit/9abea360f4fce04ad0ff3d415f94c94aa383c78f)), closes [#1853](https://github.com/CodySwannGT/lisa/issues/1853) [#1855](https://github.com/CodySwannGT/lisa/issues/1855)

## [2.270.0](https://github.com/CodySwannGT/lisa/compare/v2.269.3...v2.270.0) (2026-07-21)


### Features

* **doctor:** add repository-readiness mode and .lisa/readiness.json ([#1855](https://github.com/CodySwannGT/lisa/issues/1855)) ([2275152](https://github.com/CodySwannGT/lisa/commit/2275152778286647eb301451e3271b10e320686d)), closes [#1740](https://github.com/CodySwannGT/lisa/issues/1740) [#1853](https://github.com/CodySwannGT/lisa/issues/1853)

### [2.269.3](https://github.com/CodySwannGT/lisa/compare/v2.269.2...v2.269.3) (2026-07-21)

### [2.269.2](https://github.com/CodySwannGT/lisa/compare/v2.269.1...v2.269.2) (2026-07-21)

### [2.269.1](https://github.com/CodySwannGT/lisa/compare/v2.269.0...v2.269.1) (2026-07-21)


### Bug Fixes

* **plugins:** harden learner frontmatter ([3f8f236](https://github.com/CodySwannGT/lisa/commit/3f8f2362c5ce8da958ba862dc98370655d9158ad)), closes [CodySwannGT/lisa#1869](https://github.com/CodySwannGT/lisa/issues/1869)
* **plugins:** preserve learner verifier script ([fbc98c5](https://github.com/CodySwannGT/lisa/commit/fbc98c5cf4ff2c72b1b58a9aa3090fc670c42c44)), closes [CodySwannGT/lisa#1869](https://github.com/CodySwannGT/lisa/issues/1869)

## [2.269.0](https://github.com/CodySwannGT/lisa/compare/v2.268.1...v2.269.0) (2026-07-20)


### Features

* **rules:** add invariant-violated and machinery-to-remove to convergent-review ([#1854](https://github.com/CodySwannGT/lisa/issues/1854)) ([9b5cf68](https://github.com/CodySwannGT/lisa/commit/9b5cf68a28f0fd4eb32adb1ee8cd3aa202050543))

### [2.268.1](https://github.com/CodySwannGT/lisa/compare/v2.268.0...v2.268.1) (2026-07-20)


### Bug Fixes

* **security:** patch js-yaml advisory ([b7ec491](https://github.com/CodySwannGT/lisa/commit/b7ec4913de81edeed7043949df179bcd7398e76e)), closes [CodySwannGT/lisa#1866](https://github.com/CodySwannGT/lisa/issues/1866) [CodySwannGT/lisa#1866](https://github.com/CodySwannGT/lisa/issues/1866)

## [2.268.0](https://github.com/CodySwannGT/lisa/compare/v2.267.0...v2.268.0) (2026-07-20)


### Features

* **rules:** add the readiness-rubric rule pair with eight dimensions and seven blockers ([#1853](https://github.com/CodySwannGT/lisa/issues/1853)) ([629e10f](https://github.com/CodySwannGT/lisa/commit/629e10fa102eb2bd030e1a369e5c60e0a96b0d3f)), closes [#1737](https://github.com/CodySwannGT/lisa/issues/1737) [#1835](https://github.com/CodySwannGT/lisa/issues/1835) [#1739](https://github.com/CodySwannGT/lisa/issues/1739) [#1854](https://github.com/CodySwannGT/lisa/issues/1854) [..#1859](https://github.com/CodySwannGT/../issues/1859)


### Bug Fixes

* **security:** force transitive brace-expansion to >=5.0.6 ([#1862](https://github.com/CodySwannGT/lisa/issues/1862)) ([8f03a56](https://github.com/CodySwannGT/lisa/commit/8f03a56bd04d3a002c036334c2c00bb95e2c4e07))

## [2.267.0](https://github.com/CodySwannGT/lisa/compare/v2.266.0...v2.267.0) (2026-07-20)


### Features

* **verification:** executable failure-mode fixtures and the could-not-evaluate guard ([#1840](https://github.com/CodySwannGT/lisa/issues/1840)) ([08a304f](https://github.com/CodySwannGT/lisa/commit/08a304f42fce4f0fb0cf58c845c87099cd2b6bbf))
* **verification:** spec-conformance consumption, parity backstop, and bounded-claims docs ([#1841](https://github.com/CodySwannGT/lisa/issues/1841)) ([a536afa](https://github.com/CodySwannGT/lisa/commit/a536afa4c8f5f423119d41f994d8be6c46f1a3b8))

## [2.266.0](https://github.com/CodySwannGT/lisa/compare/v2.265.0...v2.266.0) (2026-07-20)


### Features

* **health:** add deterministic project probes ([f3b2291](https://github.com/CodySwannGT/lisa/commit/f3b229128283aa26a8e5d632891836fbdbade22d)), closes [CodySwannGT/lisa#1517](https://github.com/CodySwannGT/lisa/issues/1517) [CodySwannGT/lisa#1517](https://github.com/CodySwannGT/lisa/issues/1517)

## [2.265.0](https://github.com/CodySwannGT/lisa/compare/v2.264.0...v2.265.0) (2026-07-20)


### Features

* **security:** two-bucket findings with the impact-or-exploitability bar ([#1839](https://github.com/CodySwannGT/lisa/issues/1839)) ([8d6d6e0](https://github.com/CodySwannGT/lisa/commit/8d6d6e0d13136c57d294c20858faa86c93c28d8f)), closes [#1738](https://github.com/CodySwannGT/lisa/issues/1738)


### Bug Fixes

* **security:** preserve fields, bind ZAP reproducers to boundaries, classify all alerts ([#1839](https://github.com/CodySwannGT/lisa/issues/1839)) ([013daab](https://github.com/CodySwannGT/lisa/commit/013daab29eb368c6865cd6243688f7eaefbdcaac)), closes [#1835](https://github.com/CodySwannGT/lisa/issues/1835)

## [2.264.0](https://github.com/CodySwannGT/lisa/compare/v2.263.0...v2.264.0) (2026-07-20)


### Features

* **evidence:** pin evidence to artifact identity with merge-race reconciliation ([#1838](https://github.com/CodySwannGT/lisa/issues/1838)) ([77b1d4b](https://github.com/CodySwannGT/lisa/commit/77b1d4bd2fa06fc7032941d8134872d73ac1f3ff)), closes [#1836](https://github.com/CodySwannGT/lisa/issues/1836) [#1836](https://github.com/CodySwannGT/lisa/issues/1836)
* **evidence:** require the Not-established section, bind claims to boundaries in S14 ([#1837](https://github.com/CodySwannGT/lisa/issues/1837)) ([6c5ebe6](https://github.com/CodySwannGT/lisa/commit/6c5ebe67dc6d5868138180b268bf1bacfeaae8d8)), closes [#1836](https://github.com/CodySwannGT/lisa/issues/1836)

## [2.263.0](https://github.com/CodySwannGT/lisa/compare/v2.262.0...v2.263.0) (2026-07-20)


### Features

* **health:** add v1 result contract and storage ([163b0a6](https://github.com/CodySwannGT/lisa/commit/163b0a68059a0b78d1c224f4ecc2a99fb7149f27)), closes [CodySwannGT/lisa#1516](https://github.com/CodySwannGT/lisa/issues/1516)


### Bug Fixes

* **health:** address package and lint review ([e59b5ba](https://github.com/CodySwannGT/lisa/commit/e59b5ba51656f6728e7c68d6afabe90748519797)), closes [CodySwannGT/lisa#1516](https://github.com/CodySwannGT/lisa/issues/1516)

## [2.262.0](https://github.com/CodySwannGT/lisa/compare/v2.261.0...v2.262.0) (2026-07-20)


### Features

* **verification:** verdict schema v2 with claim-boundary mapping and compat-windowed gate ([#1836](https://github.com/CodySwannGT/lisa/issues/1836)) ([2c71799](https://github.com/CodySwannGT/lisa/commit/2c717992fb310e4414c80b78db90d5553eda44dc))

## [2.261.0](https://github.com/CodySwannGT/lisa/compare/v2.260.2...v2.261.0) (2026-07-20)


### Features

* **rules:** add the claim-evidence mapping contract ([#1835](https://github.com/CodySwannGT/lisa/issues/1835)) ([eca613b](https://github.com/CodySwannGT/lisa/commit/eca613b025a7446ebea47ed8c6cc82f06b4eb776)), closes [#1837](https://github.com/CodySwannGT/lisa/issues/1837) [#1838](https://github.com/CodySwannGT/lisa/issues/1838) [#1839](https://github.com/CodySwannGT/lisa/issues/1839) [#1738](https://github.com/CodySwannGT/lisa/issues/1738)

### [2.260.2](https://github.com/CodySwannGT/lisa/compare/v2.260.1...v2.260.2) (2026-07-20)


### Bug Fixes

* **tests:** eliminate module-resolution race in expo-eslint-local-config temp project ([#1824](https://github.com/CodySwannGT/lisa/issues/1824)) ([9a4d7e1](https://github.com/CodySwannGT/lisa/commit/9a4d7e15ead4c47ece50170bcc253f15140076d7))

### [2.260.1](https://github.com/CodySwannGT/lisa/compare/v2.260.0...v2.260.1) (2026-07-20)


### Bug Fixes

* **templates:** ignore .lisa/automations/runs/ in host projects ([#1807](https://github.com/CodySwannGT/lisa/issues/1807)) ([daea499](https://github.com/CodySwannGT/lisa/commit/daea499ea14d367f76e060011c149bc73e34387c)), closes [#1797](https://github.com/CodySwannGT/lisa/issues/1797) [#1806](https://github.com/CodySwannGT/lisa/issues/1806)

## [2.260.0](https://github.com/CodySwannGT/lisa/compare/v2.259.4...v2.260.0) (2026-07-20)


### Features

* **learnings:** harden upstream filing projection ([b482052](https://github.com/CodySwannGT/lisa/commit/b482052a508072f90cf702ceedbdab26d7b05783)), closes [CodySwannGT/lisa#1826](https://github.com/CodySwannGT/lisa/issues/1826)

### [2.259.4](https://github.com/CodySwannGT/lisa/compare/v2.259.3...v2.259.4) (2026-07-20)


### Bug Fixes

* **skills:** replace stale eager-load premise with bounded-projection rationale ([#1802](https://github.com/CodySwannGT/lisa/issues/1802)) ([43a6862](https://github.com/CodySwannGT/lisa/commit/43a68620dc490f2eeee871d7d0ad295c118f48b6)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)

### [2.259.3](https://github.com/CodySwannGT/lisa/compare/v2.259.2...v2.259.3) (2026-07-20)


### Bug Fixes

* **skills:** gate Linear magic words to production merges and reconcile native auto-close ([#1778](https://github.com/CodySwannGT/lisa/issues/1778)) ([2c1ef69](https://github.com/CodySwannGT/lisa/commit/2c1ef69d6735f366734d67a70013f854bc287a49))

### [2.259.2](https://github.com/CodySwannGT/lisa/compare/v2.259.1...v2.259.2) (2026-07-20)


### Bug Fixes

* **skills:** verify a deploy run exists for the merge SHA in drive-pr-to-merge ([#1777](https://github.com/CodySwannGT/lisa/issues/1777)) ([80f8f84](https://github.com/CodySwannGT/lisa/commit/80f8f84599d0f77f447645fd4440447a24da0f5f)), closes [#67](https://github.com/CodySwannGT/lisa/issues/67)

### [2.259.1](https://github.com/CodySwannGT/lisa/compare/v2.259.0...v2.259.1) (2026-07-20)


### Bug Fixes

* **ci:** deliberate least-privilege permissions for quality.yml and caller templates ([#1769](https://github.com/CodySwannGT/lisa/issues/1769)) ([7e8b372](https://github.com/CodySwannGT/lisa/commit/7e8b372494ac55d372279a4052da1fdeb01bde2c))
* **ci:** drop unused pull-requests scope from quality caller templates ([00461a1](https://github.com/CodySwannGT/lisa/commit/00461a1d0c3a4ad8fc4b82e48cb1833b190349c8)), closes [#1769](https://github.com/CodySwannGT/lisa/issues/1769) [#1827](https://github.com/CodySwannGT/lisa/issues/1827) [CodySwannGT/lisa#1769](https://github.com/CodySwannGT/lisa/issues/1769)

## [2.259.0](https://github.com/CodySwannGT/lisa/compare/v2.258.4...v2.259.0) (2026-07-20)


### Features

* **learnings:** allowlist upstream attribution bodies ([c533bfe](https://github.com/CodySwannGT/lisa/commit/c533bfe1e63df68c5cad9c7ecbef94777486f910)), closes [CodySwannGT/lisa#1768](https://github.com/CodySwannGT/lisa/issues/1768)

### [2.258.4](https://github.com/CodySwannGT/lisa/compare/v2.258.3...v2.258.4) (2026-07-20)


### Bug Fixes

* **expo:** pin e2e-coverage route sort to code-unit order ([#1713](https://github.com/CodySwannGT/lisa/issues/1713)) ([a9006a7](https://github.com/CodySwannGT/lisa/commit/a9006a70395e9d4146d908c7988cb93fd5491be7)), closes [#6189](https://github.com/CodySwannGT/lisa/issues/6189) [frontend-v2#6190](https://github.com/CodySwannGT/frontend-v2/issues/6190)

### [2.258.3](https://github.com/CodySwannGT/lisa/compare/v2.258.2...v2.258.3) (2026-07-20)


### Bug Fixes

* **husky:** fail closed when mktemp cannot create the gitleaks ignore file ([#1709](https://github.com/CodySwannGT/lisa/issues/1709)) ([c446ab8](https://github.com/CodySwannGT/lisa/commit/c446ab85b900569ee786cd1b9a0ab338ee69e1e1))

### [2.258.2](https://github.com/CodySwannGT/lisa/compare/v2.258.1...v2.258.2) (2026-07-20)


### Bug Fixes

* **expo:** isolate local eslint config typing ([8b87756](https://github.com/CodySwannGT/lisa/commit/8b877568e776573e4dea89dbe1e1901d65fc7132)), closes [CodySwannGT/lisa#1707](https://github.com/CodySwannGT/lisa/issues/1707)

### [2.258.1](https://github.com/CodySwannGT/lisa/compare/v2.258.0...v2.258.1) (2026-07-20)


### Bug Fixes

* **automations:** restore the RBC-3 run-history retirement source ([#1819](https://github.com/CodySwannGT/lisa/issues/1819)) ([f108670](https://github.com/CodySwannGT/lisa/commit/f1086708747a55e5ff43136f406c7f27034dd121)), closes [#1818](https://github.com/CodySwannGT/lisa/issues/1818) [#1801](https://github.com/CodySwannGT/lisa/issues/1801) [#1801](https://github.com/CodySwannGT/lisa/issues/1801) [#1818](https://github.com/CodySwannGT/lisa/issues/1818)

## [2.258.0](https://github.com/CodySwannGT/lisa/compare/v2.257.2...v2.258.0) (2026-07-20)


### Features

* **automations:** per-loop retirement conditions and the policy-obsolete teardown proposal ([#1801](https://github.com/CodySwannGT/lisa/issues/1801)) ([77722a1](https://github.com/CodySwannGT/lisa/commit/77722a17a53fb365e58008e7931383b71656b734))


### Bug Fixes

* **automations:** align retirement proposal review fixes ([16eb215](https://github.com/CodySwannGT/lisa/commit/16eb215ae2e334dcfe92b1d662bfddaf373146da)), closes [CodySwannGT/lisa#1801](https://github.com/CodySwannGT/lisa/issues/1801) [CodySwannGT/lisa#1801](https://github.com/CodySwannGT/lisa/issues/1801)
* **automations:** domain-grounded retirement conditions and review fixes ([#1801](https://github.com/CodySwannGT/lisa/issues/1801)) ([5d942ad](https://github.com/CodySwannGT/lisa/commit/5d942ada05874853fa8a6f3e965187074ce6acf4))

### [2.257.2](https://github.com/CodySwannGT/lisa/compare/v2.257.1...v2.257.2) (2026-07-20)


### Bug Fixes

* **plugins:** guard npm root probe ([cb88589](https://github.com/CodySwannGT/lisa/commit/cb88589482e57029d5affb6e0469e40c1ee76281)), closes [CodySwannGT/lisa#1706](https://github.com/CodySwannGT/lisa/issues/1706) [CodySwannGT/lisa#1706](https://github.com/CodySwannGT/lisa/issues/1706)

### [2.257.1](https://github.com/CodySwannGT/lisa/compare/v2.257.0...v2.257.1) (2026-07-20)


### Documentation

* **learnings:** broaden fresh-worktree bootstrap rule ([f7d9a2b](https://github.com/CodySwannGT/lisa/commit/f7d9a2b6954b6b92cd853c06787851f04bd1e82d)), closes [CodySwannGT/lisa#1706](https://github.com/CodySwannGT/lisa/issues/1706)

## [2.257.0](https://github.com/CodySwannGT/lisa/compare/v2.256.1...v2.257.0) (2026-07-20)


### Features

* **rules:** proposal rejection memory in rejection-detection + conform loops ([#1800](https://github.com/CodySwannGT/lisa/issues/1800)) ([1c45752](https://github.com/CodySwannGT/lisa/commit/1c4575284f5347361346f698c01a26991a9178d6))


### Bug Fixes

* address rejection memory review feedback ([f760920](https://github.com/CodySwannGT/lisa/commit/f7609203b1cf60aa9311beecdd72e30ec268e66b)), closes [CodySwannGT/lisa#1800](https://github.com/CodySwannGT/lisa/issues/1800) [CodySwannGT/lisa#1800](https://github.com/CodySwannGT/lisa/issues/1800)
* **rules:** note stateReason case normalization in rejection memory ([#1800](https://github.com/CodySwannGT/lisa/issues/1800)) ([78271da](https://github.com/CodySwannGT/lisa/commit/78271da6cddcea2d41d0879629055a23739cd080))
* **rules:** teach the close-reason semantic and polish rejection-memory wording ([#1800](https://github.com/CodySwannGT/lisa/issues/1800)) ([c15b3e5](https://github.com/CodySwannGT/lisa/commit/c15b3e5a17de74e3ecc81ee7c3b77270b733a058))

### [2.256.1](https://github.com/CodySwannGT/lisa/compare/v2.256.0...v2.256.1) (2026-07-20)


### Bug Fixes

* **implement:** infer environment-aware base branches ([d2504b4](https://github.com/CodySwannGT/lisa/commit/d2504b4a5b8083c9a2ee330ead22f75a54fed0a1)), closes [CodySwannGT/lisa#1809](https://github.com/CodySwannGT/lisa/issues/1809)

## [2.256.0](https://github.com/CodySwannGT/lisa/compare/v2.255.0...v2.256.0) (2026-07-20)


### Features

* **automations:** show runbook, last outcome, and bounded run history in automation-status ([#1799](https://github.com/CodySwannGT/lisa/issues/1799)) ([201339c](https://github.com/CodySwannGT/lisa/commit/201339ce53cfaf3b85277bcfcd1799bce55b99db))


### Bug Fixes

* **automations:** number escalation citations and pin trailing-streak semantics ([#1799](https://github.com/CodySwannGT/lisa/issues/1799)) ([56719f2](https://github.com/CodySwannGT/lisa/commit/56719f207e99d291a49c1b71c55e74a2ca9239ec))

## [2.255.0](https://github.com/CodySwannGT/lisa/compare/v2.254.0...v2.255.0) (2026-07-20)


### Features

* **automations:** conform registered loops to the run-outcome recording contract ([#1798](https://github.com/CodySwannGT/lisa/issues/1798)) ([3b673f8](https://github.com/CodySwannGT/lisa/commit/3b673f8fc5031850eeffe3afe43cbed6a3c6f3dd))

## [2.254.0](https://github.com/CodySwannGT/lisa/compare/v2.253.0...v2.254.0) (2026-07-20)


### Features

* **automations:** add durable run outcome records ([58f086c](https://github.com/CodySwannGT/lisa/commit/58f086cbd342d7bf4a40b54a0bce5bba9d5d3777)), closes [CodySwannGT/lisa#1797](https://github.com/CodySwannGT/lisa/issues/1797)

## [2.253.0](https://github.com/CodySwannGT/lisa/compare/v2.252.0...v2.253.0) (2026-07-20)


### Features

* **automations:** scaffold per-loop runbooks and unify the fleet roster ([#1796](https://github.com/CodySwannGT/lisa/issues/1796)) ([b2acacc](https://github.com/CodySwannGT/lisa/commit/b2acacc96b589e172a765accacdb91e598a488cf))


### Bug Fixes

* **automations:** accept no-arg Codex registrations in observed-command derivation ([#1796](https://github.com/CodySwannGT/lisa/issues/1796)) ([ae02d4c](https://github.com/CodySwannGT/lisa/commit/ae02d4cc25ae07b514b4a456d52755147d30a78d))
* **automations:** address review findings for runbook scaffolding ([#1796](https://github.com/CodySwannGT/lisa/issues/1796)) ([a9602f7](https://github.com/CodySwannGT/lisa/commit/a9602f7ab92aece97844b83e78be0bf1f1fd7674))

## [2.252.0](https://github.com/CodySwannGT/lisa/compare/v2.251.1...v2.252.0) (2026-07-20)


### Features

* **rules:** add automation-runbook-contract rule pair with six run-outcome vocabulary ([#1795](https://github.com/CodySwannGT/lisa/issues/1795)) ([a0b0cca](https://github.com/CodySwannGT/lisa/commit/a0b0cca0ee90fcb4f472ad5aababf52223dfd633))


### Bug Fixes

* **rules:** address review findings for automation-runbook-contract ([#1795](https://github.com/CodySwannGT/lisa/issues/1795)) ([fa67aa1](https://github.com/CodySwannGT/lisa/commit/fa67aa16a02fb51ae5a8cf6a41746c7ea8bbba28)), closes [#1796](https://github.com/CodySwannGT/lisa/issues/1796) [#1797](https://github.com/CodySwannGT/lisa/issues/1797) [#1738](https://github.com/CodySwannGT/lisa/issues/1738)
* **rules:** mirror the full Blocked-routing disambiguation in the eager head ([#1795](https://github.com/CodySwannGT/lisa/issues/1795)) ([e6f83c9](https://github.com/CodySwannGT/lisa/commit/e6f83c9d7cba5152df7756f5149b98d6117dc87b))

### [2.251.1](https://github.com/CodySwannGT/lisa/compare/v2.251.0...v2.251.1) (2026-07-20)


### Documentation

* **ci:** correct learnings_budget rationale to bounded-projection design ([#1794](https://github.com/CodySwannGT/lisa/issues/1794)) ([70db4be](https://github.com/CodySwannGT/lisa/commit/70db4bede62e247fa056f94dadc263d1fcca6a90))

## [2.251.0](https://github.com/CodySwannGT/lisa/compare/v2.250.1...v2.251.0) (2026-07-20)


### Features

* **hooks:** promote jq-for-JSON rule to blocking executable control ([37f7ba6](https://github.com/CodySwannGT/lisa/commit/37f7ba6d8a7f4f244b08a847b27ad24522fe6cf6)), closes [#1787](https://github.com/CodySwannGT/lisa/issues/1787) [#1787](https://github.com/CodySwannGT/lisa/issues/1787)
* **hooks:** teach git commit -F remediation in heredoc denial diagnostics ([c0f3ee2](https://github.com/CodySwannGT/lisa/commit/c0f3ee29063b2d44bf120ce2b8909643c23eaa65)), closes [#1789](https://github.com/CodySwannGT/lisa/issues/1789) [#1789](https://github.com/CodySwannGT/lisa/issues/1789)


### Bug Fixes

* **eslint:** state the statement-order exemption accurately in the diagnostic ([38c081d](https://github.com/CodySwannGT/lisa/commit/38c081d08c132a5e8e21830b5a356ac9dc3a50f7)), closes [#1791](https://github.com/CodySwannGT/lisa/issues/1791)


### Documentation

* **rules:** demote Console UI knowledge from eager rules to the wiki ([6337c3a](https://github.com/CodySwannGT/lisa/commit/6337c3a865f28d4a5bf88055a3ed71a0ef323e10)), closes [#1788](https://github.com/CodySwannGT/lisa/issues/1788) [#1788](https://github.com/CodySwannGT/lisa/issues/1788)
* **rules:** retire five mechanically-owned PROJECT_RULES sections ([d8707a1](https://github.com/CodySwannGT/lisa/commit/d8707a1061c7596e30903baa5b8c83507284dccd)), closes [#1790](https://github.com/CodySwannGT/lisa/issues/1790) [#1790](https://github.com/CodySwannGT/lisa/issues/1790)

### [2.250.1](https://github.com/CodySwannGT/lisa/compare/v2.250.0...v2.250.1) (2026-07-20)

## [2.250.0](https://github.com/CodySwannGT/lisa/compare/v2.247.3...v2.250.0) (2026-07-20)


### Features

* require tracked work before durable changes ([d557349](https://github.com/CodySwannGT/lisa/commit/d557349e181c53c40a30b1f279ed417f394559e2)), closes [CodySwannGT/lisa#1783](https://github.com/CodySwannGT/lisa/issues/1783)
* **skills:** add convergent review policy ([be06184](https://github.com/CodySwannGT/lisa/commit/be0618423f4d3858a657f1d44f1a363845f10389))
* **skills:** add lisa-improve-harness bounded improvement loop ([#1744](https://github.com/CodySwannGT/lisa/issues/1744)) ([45a5087](https://github.com/CodySwannGT/lisa/commit/45a508712389351fa979743d62c834c0cf51f3df))
* **verify:** add guarded Kane CLI browser provider ([00dee10](https://github.com/CodySwannGT/lisa/commit/00dee10b27eae8fc4987152898878cfed75308d1))


### Bug Fixes

* **skills:** address review findings for lisa-improve-harness ([#1744](https://github.com/CodySwannGT/lisa/issues/1744)) ([b349159](https://github.com/CodySwannGT/lisa/commit/b34915968349d6523b14d7591cecfc28a24badba))

## [2.249.0](https://github.com/CodySwannGT/lisa/compare/v2.247.3...v2.249.0) (2026-07-20)


### Features

* require tracked work before durable changes ([d557349](https://github.com/CodySwannGT/lisa/commit/d557349e181c53c40a30b1f279ed417f394559e2)), closes [CodySwannGT/lisa#1783](https://github.com/CodySwannGT/lisa/issues/1783)
* **skills:** add convergent review policy ([be06184](https://github.com/CodySwannGT/lisa/commit/be0618423f4d3858a657f1d44f1a363845f10389))
* **verify:** add guarded Kane CLI browser provider ([00dee10](https://github.com/CodySwannGT/lisa/commit/00dee10b27eae8fc4987152898878cfed75308d1))

## [2.248.0](https://github.com/CodySwannGT/lisa/compare/v2.247.3...v2.248.0) (2026-07-20)


### Features

* **verify:** add guarded Kane CLI browser provider ([00dee10](https://github.com/CodySwannGT/lisa/commit/00dee10b27eae8fc4987152898878cfed75308d1))

### [2.247.3](https://github.com/CodySwannGT/lisa/compare/v2.247.2...v2.247.3) (2026-07-19)


### Bug Fixes

* broaden worker-epoch host detection and workaround matching ([4975ed6](https://github.com/CodySwannGT/lisa/commit/4975ed6e874d43d93cbf20251008e0f33ab9e88f)), closes [#1782](https://github.com/CodySwannGT/lisa/issues/1782)
* surface worker epoch drift in doctor ([b7e9dea](https://github.com/CodySwannGT/lisa/commit/b7e9dea92c24cec855b0a051971f28170466aa77))

### [2.247.2](https://github.com/CodySwannGT/lisa/compare/v2.247.1...v2.247.2) (2026-07-19)


### Bug Fixes

* **ci:** collapse learnings budget bridge ([ce5d199](https://github.com/CodySwannGT/lisa/commit/ce5d199cd8a5dd16fb6f780338727d38d50628ad))

### [2.247.1](https://github.com/CodySwannGT/lisa/compare/v2.247.0...v2.247.1) (2026-07-19)

## [2.247.0](https://github.com/CodySwannGT/lisa/compare/v2.246.0...v2.247.0) (2026-07-19)


### Features

* **agents:** extend skill-evaluator into the six-rung ladder router (LLG-5) ([41700c6](https://github.com/CodySwannGT/lisa/commit/41700c6261ce40c9c23748f3bed428d0ed8a76db)), closes [#1729](https://github.com/CodySwannGT/lisa/issues/1729) [#1735](https://github.com/CodySwannGT/lisa/issues/1735) [#1731](https://github.com/CodySwannGT/lisa/issues/1731) [#1731](https://github.com/CodySwannGT/lisa/issues/1731) [#1734](https://github.com/CodySwannGT/lisa/issues/1734)
* **rules:** add promotion-contract pair and template-candidate lane (LLG-7) ([a95a8b6](https://github.com/CodySwannGT/lisa/commit/a95a8b6a7e88fa0447f9435ef387241c92293971)), closes [#1736](https://github.com/CodySwannGT/lisa/issues/1736)
* **skills:** add lisa-learnings-audit — the gardener (LLG-6) ([52862d9](https://github.com/CodySwannGT/lisa/commit/52862d97ab54a6571e6cbd8535a65501d451a404)), closes [#1735](https://github.com/CodySwannGT/lisa/issues/1735)


### Bug Fixes

* **skills:** correct the gardener dedupe search command (LLG-6) ([c0d9ecd](https://github.com/CodySwannGT/lisa/commit/c0d9ecd77f6bf465dcee7fd01e70361f30fd0806))
* **skills:** honest gardener concurrency + stateless retirement condition ([4cd8ed1](https://github.com/CodySwannGT/lisa/commit/4cd8ed123e8ff9fe5726e4868d47a3db359f0129)), closes [#1779](https://github.com/CodySwannGT/lisa/issues/1779) [#1735](https://github.com/CodySwannGT/lisa/issues/1735) [#1736](https://github.com/CodySwannGT/lisa/issues/1736)
* **skills:** review fixes — deterministic gardener fingerprints, batch contract, doc freshness ([0abf59c](https://github.com/CodySwannGT/lisa/commit/0abf59c9c095f9bc2881b270babf48b67c2ae7bf)), closes [#1735](https://github.com/CodySwannGT/lisa/issues/1735) [#1736](https://github.com/CodySwannGT/lisa/issues/1736) [#1735](https://github.com/CodySwannGT/lisa/issues/1735) [#1736](https://github.com/CodySwannGT/lisa/issues/1736)

## [2.246.0](https://github.com/CodySwannGT/lisa/compare/v2.245.1...v2.246.0) (2026-07-19)


### Features

* **debrief-apply:** reroute knowledge categories to the ledger (LLG-4, [#1733](https://github.com/CodySwannGT/lisa/issues/1733)) ([25c60f6](https://github.com/CodySwannGT/lisa/commit/25c60f68b5f5dc91e5f4c94faf501dce9fca0f2a))

### [2.245.1](https://github.com/CodySwannGT/lisa/compare/v2.245.0...v2.245.1) (2026-07-19)


### Documentation

* **rules:** split contract-mediated vs legacy ledger writers (LLG-2) ([5b7c458](https://github.com/CodySwannGT/lisa/commit/5b7c45843ebe99e1c90cdb2518e29b33e2c41192)), closes [#1771](https://github.com/CodySwannGT/lisa/issues/1771) [pre-#1733](https://github.com/CodySwannGT/pre-/issues/1733) [#1733](https://github.com/CodySwannGT/lisa/issues/1733)

## [2.245.0](https://github.com/CodySwannGT/lisa/compare/v2.244.0...v2.245.0) (2026-07-19)


### Features

* **learner:** rewrite as capture-only ledger writer (LLG-2) ([854c806](https://github.com/CodySwannGT/lisa/commit/854c80626f9a008533c3d59f98ef81ebae369917)), closes [#1735](https://github.com/CodySwannGT/lisa/issues/1735) [#1731](https://github.com/CodySwannGT/lisa/issues/1731)


### Bug Fixes

* **learner:** apply review fixes for MLD fields, writer claim, confidence (LLG-2) ([4f9cee3](https://github.com/CodySwannGT/lisa/commit/4f9cee3d282cee0fb6f4d9a541c74886c506361c)), closes [#1732](https://github.com/CodySwannGT/lisa/issues/1732) [#1732](https://github.com/CodySwannGT/lisa/issues/1732) [#1733](https://github.com/CodySwannGT/lisa/issues/1733) [#1733](https://github.com/CodySwannGT/lisa/issues/1733) [#1731](https://github.com/CodySwannGT/lisa/issues/1731)

## [2.244.0](https://github.com/CodySwannGT/lisa/compare/v2.243.0...v2.244.0) (2026-07-19)


### Features

* **implement:** capture MLD task-end telemetry (LLG-3) ([ce09100](https://github.com/CodySwannGT/lisa/commit/ce091008397d15a40ae5c9c533aba873513bacc9)), closes [#1731](https://github.com/CodySwannGT/lisa/issues/1731) [#1732](https://github.com/CodySwannGT/lisa/issues/1732)
* **rules:** thread task-end MLD into intent-routing Implement sequence (LLG-3) ([f1e1864](https://github.com/CodySwannGT/lisa/commit/f1e1864bb053c6afca4fc5d80b0d24583b1937b9)), closes [#1732](https://github.com/CodySwannGT/lisa/issues/1732)


### Bug Fixes

* **implement:** literal JSON MLD example + built-artifact fan-out tests (LLG-3) ([9b62d67](https://github.com/CodySwannGT/lisa/commit/9b62d676c5c6a0a5c05f4b39450efc098752a571)), closes [#1770](https://github.com/CodySwannGT/lisa/issues/1770) [#1732](https://github.com/CodySwannGT/lisa/issues/1732)

## [2.243.0](https://github.com/CodySwannGT/lisa/compare/v2.242.0...v2.243.0) (2026-07-19)


### Features

* **learnings:** add bounded projection serving slice (LLG-1) ([89fbf8a](https://github.com/CodySwannGT/lisa/commit/89fbf8a450d983f7ebb6880c924694de0f8287ff)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)
* **learnings:** default ledger to .lisa/ + learnings.file override (LLG-1) ([ec3c6a6](https://github.com/CodySwannGT/lisa/commit/ec3c6a64a31df19deab2c7522c4bd1523c500226)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)
* **learnings:** relocate legacy ledger during apply/doctor (LLG-1) ([c1b77bc](https://github.com/CodySwannGT/lisa/commit/c1b77bce973b63da8d021911c1aeebaaabd116ac)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)


### Bug Fixes

* **learnings:** exact wrapper accounting + deterministic projection tiebreak (LLG-1) ([e1d0f75](https://github.com/CodySwannGT/lisa/commit/e1d0f7579d205d16ef4e69d5f86247c5824c5df5)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)
* **learnings:** harden ledger relocation + override rejection (LLG-1) ([b1b0f3c](https://github.com/CodySwannGT/lisa/commit/b1b0f3c15e0ee2ea67a9830a605d5900b72f2669)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)
* **learnings:** never strand a populated legacy ledger on the fleet-upgrade path (LLG-1) ([b545ebf](https://github.com/CodySwannGT/lisa/commit/b545ebfadb8ec242fbbf5e27d497db46a01e1d83)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)


### Code Refactoring

* **learnings:** relocate canonical ledger template to .lisa/ (LLG-1) ([7a81646](https://github.com/CodySwannGT/lisa/commit/7a8164600162f87c89d2cfe4f7aaf61831a8e427)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)


### Documentation

* **learnings:** prose parity for relocated, projection-only ledger (LLG-1) ([54ec601](https://github.com/CodySwannGT/lisa/commit/54ec601607409a86dd8e344702f1cf716187dca3)), closes [#1730](https://github.com/CodySwannGT/lisa/issues/1730)

## [2.242.0](https://github.com/CodySwannGT/lisa/compare/v2.241.0...v2.242.0) (2026-07-19)


### Features

* **quality:** add threshold ratchet — gates may tighten, never weaken ([7b6e3e9](https://github.com/CodySwannGT/lisa/commit/7b6e3e9b45dc50fe0c5e646794cedc36065c47f5))


### Bug Fixes

* **quality:** address CodeRabbit review on the threshold ratchet ([929b357](https://github.com/CodySwannGT/lisa/commit/929b3571cc40847fe98d502e722b0ba2cbedb845))

## [2.241.0](https://github.com/CodySwannGT/lisa/compare/v2.240.0...v2.241.0) (2026-07-19)


### Features

* **rules:** add claim-time archaeology rule and gate it into the three build intakes ([121b497](https://github.com/CodySwannGT/lisa/commit/121b4970f8a16702494c656b96f17a8799c7ac77)), closes [#1570](https://github.com/CodySwannGT/lisa/issues/1570) [#1574](https://github.com/CodySwannGT/lisa/issues/1574) [#1580](https://github.com/CodySwannGT/lisa/issues/1580) [#1584](https://github.com/CodySwannGT/lisa/issues/1584) [#1564](https://github.com/CodySwannGT/lisa/issues/1564) [#1566](https://github.com/CodySwannGT/lisa/issues/1566) [#1554](https://github.com/CodySwannGT/lisa/issues/1554) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **sync:** seed the archaeology.maxSteps budget default via the sync registry ([eb7d604](https://github.com/CodySwannGT/lisa/commit/eb7d6040dd9479dfaab4fc25e2d37244cd56e29b)), closes [#1584](https://github.com/CodySwannGT/lisa/issues/1584) [#1566](https://github.com/CodySwannGT/lisa/issues/1566) [#1554](https://github.com/CodySwannGT/lisa/issues/1554) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)


### Bug Fixes

* **rules:** centralize archaeology semantics in the rule pair; POSIX-safe grep ([cec67b1](https://github.com/CodySwannGT/lisa/commit/cec67b1effcd50571257bf8251969aaf08ca17c7)), closes [#1764](https://github.com/CodySwannGT/lisa/issues/1764) [#1570](https://github.com/CodySwannGT/lisa/issues/1570) [#1574](https://github.com/CodySwannGT/lisa/issues/1574) [#1580](https://github.com/CodySwannGT/lisa/issues/1580) [#1584](https://github.com/CodySwannGT/lisa/issues/1584) [#1566](https://github.com/CodySwannGT/lisa/issues/1566) [#1554](https://github.com/CodySwannGT/lisa/issues/1554) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **rules:** harden claim-archaeology merge-PR recipe, dedupe scope, marker key ([4e0c479](https://github.com/CodySwannGT/lisa/commit/4e0c479a5c0e5fdc9fa88df7420ec7b8db140729)), closes [#1570](https://github.com/CodySwannGT/lisa/issues/1570) [#1574](https://github.com/CodySwannGT/lisa/issues/1574) [#1580](https://github.com/CodySwannGT/lisa/issues/1580) [#1584](https://github.com/CodySwannGT/lisa/issues/1584) [#1566](https://github.com/CodySwannGT/lisa/issues/1566) [#1554](https://github.com/CodySwannGT/lisa/issues/1554) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)

## [2.240.0](https://github.com/CodySwannGT/lisa/compare/v2.239.1...v2.240.0) (2026-07-19)


### Features

* **learnings:** add surgical confirmLearningEntry last_confirmed bump ([8bd3a94](https://github.com/CodySwannGT/lisa/commit/8bd3a94828154eb9de039efd5e2e27c547d3d42c)), closes [#1579](https://github.com/CodySwannGT/lisa/issues/1579) [#1579](https://github.com/CodySwannGT/lisa/issues/1579)
* **skills:** auto-file the upstream Lisa ticket from handoff-upstream ([aeb9d0f](https://github.com/CodySwannGT/lisa/commit/aeb9d0f05d58c9f751ad135280334243959bde6b)), closes [#1583](https://github.com/CodySwannGT/lisa/issues/1583) [#1583](https://github.com/CodySwannGT/lisa/issues/1583)
* **skills:** confirm applied learnings at claim time via 3c.2 bump ([3209621](https://github.com/CodySwannGT/lisa/commit/32096215a9ddec701886e66e8d2d0d06bfb47d2e)), closes [#1579](https://github.com/CodySwannGT/lisa/issues/1579) [#1579](https://github.com/CodySwannGT/lisa/issues/1579)
* **skills:** extract event-triggered lisa-attribute-failure from doctor ([ae220dc](https://github.com/CodySwannGT/lisa/commit/ae220dcdc8aaaa033b3e8965de122f99846adea2)), closes [#1494](https://github.com/CodySwannGT/lisa/issues/1494) [#1582](https://github.com/CodySwannGT/lisa/issues/1582) [#1622](https://github.com/CodySwannGT/lisa/issues/1622) [#1582](https://github.com/CodySwannGT/lisa/issues/1582)


### Bug Fixes

* **skills:** bind upstream evidence redaction and resolve handoff claims ([378b4ba](https://github.com/CodySwannGT/lisa/commit/378b4ba0833d0fb5a1b32ef0f50de3cdfdac3116)), closes [#1583](https://github.com/CodySwannGT/lisa/issues/1583)
* **skills:** harden upstream filing and claim-time bump per review ([7f85eae](https://github.com/CodySwannGT/lisa/commit/7f85eae5f27266af8d59ee717267141f4fa34f7b)), closes [#1763](https://github.com/CodySwannGT/lisa/issues/1763) [#1582](https://github.com/CodySwannGT/lisa/issues/1582) [#1583](https://github.com/CodySwannGT/lisa/issues/1583) [#1579](https://github.com/CodySwannGT/lisa/issues/1579)


### Code Refactoring

* **learnings:** return file path from in-lock not-found confirm result ([afced27](https://github.com/CodySwannGT/lisa/commit/afced2789a25bd6b7342d15c0d71d826abaca4bd)), closes [#1579](https://github.com/CodySwannGT/lisa/issues/1579)

### [2.239.1](https://github.com/CodySwannGT/lisa/compare/v2.239.0...v2.239.1) (2026-07-19)


### Bug Fixes

* **ci:** repoint learnings budget gate at a CLI that actually runs headless ([3fe092b](https://github.com/CodySwannGT/lisa/commit/3fe092b9365725e7474c10cc66eb5b7a6cbb9227)), closes [#1753](https://github.com/CodySwannGT/lisa/issues/1753) [CodySwannGT/lisa#1581](https://github.com/CodySwannGT/lisa/issues/1581)

## [2.239.0](https://github.com/CodySwannGT/lisa/compare/v2.238.0...v2.239.0) (2026-07-19)


### Features

* **atlassian:** add changelog transition-history op to lisa-atlassian-access ([521bb3f](https://github.com/CodySwannGT/lisa/commit/521bb3fa9f40cd38ba8d023d4e5bff07ec161554)), closes [#1571](https://github.com/CodySwannGT/lisa/issues/1571) [#1559](https://github.com/CodySwannGT/lisa/issues/1559) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **implement:** consume rejection evidence so re-claim does not repeat it ([a1a03f9](https://github.com/CodySwannGT/lisa/commit/a1a03f9f6267a2c7ccf704453fff3aa79fdb6871)), closes [#1587](https://github.com/CodySwannGT/lisa/issues/1587) [#1565](https://github.com/CodySwannGT/lisa/issues/1565) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **linear:** add history transition-history op to lisa-linear-access ([b3c79d7](https://github.com/CodySwannGT/lisa/commit/b3c79d7b223fd36336403e6440c6b4370c407aa1)), closes [#1573](https://github.com/CodySwannGT/lisa/issues/1573) [#1559](https://github.com/CodySwannGT/lisa/issues/1559) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **rules:** add vendor-neutral rejection-detection rule at claim time ([a5951fa](https://github.com/CodySwannGT/lisa/commit/a5951fac8578d2b5f8ee86f93883c93c8b16d245)), closes [#1575](https://github.com/CodySwannGT/lisa/issues/1575) [#1565](https://github.com/CodySwannGT/lisa/issues/1565) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)
* **rules:** reflect on rejection-reclaim and route a candidate learning ([d00a9c3](https://github.com/CodySwannGT/lisa/commit/d00a9c3cb5f1a9b213e60e2e98917d053842b4b3)), closes [#1586](https://github.com/CodySwannGT/lisa/issues/1586) [#1565](https://github.com/CodySwannGT/lisa/issues/1565) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)


### Bug Fixes

* **rules:** make fallback rejection-candidate comment visible + linear op naming ([838a6b8](https://github.com/CodySwannGT/lisa/commit/838a6b8512f3a703529e93363571a202a3cf6fb2)), closes [#1586](https://github.com/CodySwannGT/lisa/issues/1586) [#1586](https://github.com/CodySwannGT/lisa/issues/1586) [#1565](https://github.com/CodySwannGT/lisa/issues/1565) [#1553](https://github.com/CodySwannGT/lisa/issues/1553) [#1548](https://github.com/CodySwannGT/lisa/issues/1548)

## [2.238.0](https://github.com/CodySwannGT/lisa/compare/v2.237.0...v2.238.0) (2026-07-19)


### Features

* **agents:** add learning-judge hostile-default judgment gate ([fd8ecd6](https://github.com/CodySwannGT/lisa/commit/fd8ecd61475cf63a9aea43b40de8894116d3a944)), closes [CodySwannGT/lisa#1589](https://github.com/CodySwannGT/lisa/issues/1589)
* **core:** add supersede-capable consolidated learnings write ([c32ea39](https://github.com/CodySwannGT/lisa/commit/c32ea39ac6b4e1aeda36f4e42b192d09a6a7b692)), closes [CodySwannGT/lisa#1592](https://github.com/CodySwannGT/lisa/issues/1592)
* **skills:** add auto_merge input to drive-pr-to-merge and git-submit-pr ([b179d2d](https://github.com/CodySwannGT/lisa/commit/b179d2d758913ea730ed335cad30b786b9e91856)), closes [CodySwannGT/lisa#1588](https://github.com/CodySwannGT/lisa/issues/1588)
* **skills:** add lisa-persist-learning routing skill and command ([97c6b37](https://github.com/CodySwannGT/lisa/commit/97c6b37770a71a77acad45ec3035079aa949b9a3)), closes [CodySwannGT/lisa#1590](https://github.com/CodySwannGT/lisa/issues/1590) [CodySwannGT/lisa#1591](https://github.com/CodySwannGT/lisa/issues/1591) [CodySwannGT/lisa#1592](https://github.com/CodySwannGT/lisa/issues/1592)


### Bug Fixes

* **core:** export readProjectConfig from the learnings barrel ([0636726](https://github.com/CodySwannGT/lisa/commit/06367263c34a694eaf11967bddd4b40c65169c9a)), closes [CodySwannGT/lisa#1591](https://github.com/CodySwannGT/lisa/issues/1591) [CodySwannGT/lisa#1592](https://github.com/CodySwannGT/lisa/issues/1592)
* **skills:** harden auto_merge=false disarm and report-mode scope ([c30872b](https://github.com/CodySwannGT/lisa/commit/c30872b578752f6fe5850e8bb0b497a0a57a520b)), closes [#1748](https://github.com/CodySwannGT/lisa/issues/1748) [CodySwannGT/lisa#1588](https://github.com/CodySwannGT/lisa/issues/1588)


### Documentation

* **skills:** apply review feedback to persist-learning and drive-pr prose ([4e63aeb](https://github.com/CodySwannGT/lisa/commit/4e63aebf76be4cf9db4a15e8cdd26b163b6bee6a)), closes [CodySwannGT/lisa#1588](https://github.com/CodySwannGT/lisa/issues/1588) [CodySwannGT/lisa#1590](https://github.com/CodySwannGT/lisa/issues/1590) [CodySwannGT/lisa#1591](https://github.com/CodySwannGT/lisa/issues/1591)

## [2.237.0](https://github.com/CodySwannGT/lisa/compare/v2.236.0...v2.237.0) (2026-07-19)


### Features

* **cli:** add lisa check-learnings-budget subcommand ([4c88fa4](https://github.com/CodySwannGT/lisa/commit/4c88fa46fe2309cef1c65452dc3c9b0b0074dc25)), closes [#1581](https://github.com/CodySwannGT/lisa/issues/1581) [#1561](https://github.com/CodySwannGT/lisa/issues/1561)


### Bug Fixes

* **learnings:** teach remediation and fix double-escaped entry id ([9a9a566](https://github.com/CodySwannGT/lisa/commit/9a9a566999ff3819af990b5ad067ef1dac3a81e5)), closes [#1581](https://github.com/CodySwannGT/lisa/issues/1581) [#1561](https://github.com/CodySwannGT/lisa/issues/1561)


### Code Refactoring

* **learnings:** extract reusable budget check into core ([eb0f06f](https://github.com/CodySwannGT/lisa/commit/eb0f06f4ca5ec622439f0ee41a7cd418616a7377)), closes [#1581](https://github.com/CodySwannGT/lisa/issues/1581) [#1581](https://github.com/CodySwannGT/lisa/issues/1581) [#1561](https://github.com/CodySwannGT/lisa/issues/1561)

## [2.236.0](https://github.com/CodySwannGT/lisa/compare/v2.235.0...v2.236.0) (2026-07-18)


### Features

* **ui:** add detected-stacks status probe ([c588acc](https://github.com/CodySwannGT/lisa/commit/c588acc36ed64198700e65767e00cade68a639f3)), closes [CodySwannGT/lisa#1539](https://github.com/CodySwannGT/lisa/issues/1539)
* **ui:** compute deploy pipeline stages from deploy.yml and GitHub environments ([eaf4c4b](https://github.com/CodySwannGT/lisa/commit/eaf4c4b2b56d9123d2537d014b50038d77fc6f5c))
* **ui:** detect connected observability providers via live-status probes ([f6dfb4e](https://github.com/CodySwannGT/lisa/commit/f6dfb4e4612d9cfc8cb0e2251c7e8fedd09ba234))
* **ui:** populate Automations from harness scheduler probe ([50074f1](https://github.com/CodySwannGT/lisa/commit/50074f1af232c4f1e0a2972d6591c917a5a579bc)), closes [#1719](https://github.com/CodySwannGT/lisa/issues/1719) [#1720](https://github.com/CodySwannGT/lisa/issues/1720)
* **ui:** populate GitHub repository panel from live gh api probes ([d21f98f](https://github.com/CodySwannGT/lisa/commit/d21f98f2cb5fdc3a339e1cae6ed5fa09f6e9c6d7))
* **ui:** wire Plugins & MCP section to enabledPlugins via live-status ([9f43573](https://github.com/CodySwannGT/lisa/commit/9f43573372276ab33ee81781b1600604e1041fe6)), closes [#1540](https://github.com/CodySwannGT/lisa/issues/1540)
* **ui:** wire Stacks console section to the detected-stacks probe ([4246c03](https://github.com/CodySwannGT/lisa/commit/4246c0313694cb8a6e07467683741e44b5059126)), closes [CodySwannGT/lisa#1539](https://github.com/CodySwannGT/lisa/issues/1539)


### Bug Fixes

* **ui:** harden detected-stacks against non-string arrays and lock escaping ([336c48b](https://github.com/CodySwannGT/lisa/commit/336c48b0a37be098cc09078081866e4cb1357904)), closes [CodySwannGT/lisa#1539](https://github.com/CodySwannGT/lisa/issues/1539)
* **ui:** restore applyCiQualityJobs close after deploy-pipeline merge ([55718ec](https://github.com/CodySwannGT/lisa/commit/55718ec8714bd4e6878916aa67b22ab4300537e5))
* **ui:** restore applyDeployPipelineStages closing brace lost in merge ([651e69e](https://github.com/CodySwannGT/lisa/commit/651e69ead00b7df56b478f7bd4bdbe2dc84cf1b3)), closes [#1714](https://github.com/CodySwannGT/lisa/issues/1714)
* **ui:** restore console script syntax ([e496006](https://github.com/CodySwannGT/lisa/commit/e49600637bbc468e426f501b3963315f95c8436d))
* **ui:** use own-key-safe Map for stack catalog lookups ([9c5155f](https://github.com/CodySwannGT/lisa/commit/9c5155f077442a7a2e9f3d81f97c764016686ce0)), closes [#1714](https://github.com/CodySwannGT/lisa/issues/1714)


### Documentation

* **rules:** capture Lisa Console UI build + e2e testing constraints ([ee14ff2](https://github.com/CodySwannGT/lisa/commit/ee14ff21b6b8b86622a4daf5ad2b7676a83fe274))

## [2.235.0](https://github.com/CodySwannGT/lisa/compare/v2.234.0...v2.235.0) (2026-07-18)


### Features

* **ui:** compute CI quality-jobs Active column from live probes ([25308fc](https://github.com/CodySwannGT/lisa/commit/25308fca9002015e53d93f81dd79e29698429165)), closes [#1541](https://github.com/CodySwannGT/lisa/issues/1541)

## [2.234.0](https://github.com/CodySwannGT/lisa/compare/v2.233.1...v2.234.0) (2026-07-18)


### Features

* **ui:** add lisa-version probe reusing doctor checkVersion ([1d315aa](https://github.com/CodySwannGT/lisa/commit/1d315aa6da3ceb6da325c518c62f53cdfab7a2d7))
* **ui:** wire top-bar #healthChip to lisa-version status ([a0fb64c](https://github.com/CodySwannGT/lisa/commit/a0fb64ca4408e3d952f79086d4cc787aacbab6ae))

### [2.233.1](https://github.com/CodySwannGT/lisa/compare/v2.233.0...v2.233.1) (2026-07-18)


### Bug Fixes

* make postinstall bootstrap idempotent ([efdb108](https://github.com/CodySwannGT/lisa/commit/efdb1085921770417c08e93e2e670086cd94a5d6))

## [2.233.0](https://github.com/CodySwannGT/lisa/compare/v2.232.0...v2.233.0) (2026-07-18)


### Features

* **qa:** human-QA acceptance skill family ([2e7d41f](https://github.com/CodySwannGT/lisa/commit/2e7d41f53362fa3c5f86ab1c594d878d60edc1eb))


### Bug Fixes

* **qa:** address CodeRabbit review on QA skill family ([61b7a0b](https://github.com/CodySwannGT/lisa/commit/61b7a0b64963812ba542e2b10af821f38c40d44f))

## [2.232.0](https://github.com/CodySwannGT/lisa/compare/v2.231.0...v2.232.0) (2026-07-18)


### Features

* **hardening:** self-hardening rework-triage loop ([b33f664](https://github.com/CodySwannGT/lisa/commit/b33f6646353adb9719036e3225713a6a9fef921e))


### Bug Fixes

* **hardening:** address CodeRabbit review on rework-triage ([b832f5b](https://github.com/CodySwannGT/lisa/commit/b832f5bce706ded148522466e9ff35050151eafe))

## [2.231.0](https://github.com/CodySwannGT/lisa/compare/v2.230.1...v2.231.0) (2026-07-18)


### Features

* add secure lisa ui config write endpoint ([2f3aae4](https://github.com/CodySwannGT/lisa/commit/2f3aae4def41651cd3f3b1a8f099c9b7d7cf8960))


### Bug Fixes

* harden lisa ui config writes ([eb45cc8](https://github.com/CodySwannGT/lisa/commit/eb45cc88df6fccb6cd37e08709ae4affe92311ee))

### [2.230.1](https://github.com/CodySwannGT/lisa/compare/v2.230.0...v2.230.1) (2026-07-18)


### Bug Fixes

* **ui:** render readonly console affordances ([7be4f4d](https://github.com/CodySwannGT/lisa/commit/7be4f4dd8aac48e92b5c9b643f97afeb23f15bc9))

## [2.230.0](https://github.com/CodySwannGT/lisa/compare/v2.229.2...v2.230.0) (2026-07-18)


### Features

* **ui:** make remote requirements project-aware ([e41390a](https://github.com/CodySwannGT/lisa/commit/e41390a945bab6fc33e6244c29d4b01f58f0c201))

### [2.229.2](https://github.com/CodySwannGT/lisa/compare/v2.229.1...v2.229.2) (2026-07-18)


### Bug Fixes

* **release:** retry changelog push after rebase ([97ee442](https://github.com/CodySwannGT/lisa/commit/97ee4429b5bbbacbab0a45ee8b7416b371e283da))

### [2.229.1](https://github.com/CodySwannGT/lisa/compare/v2.229.0...v2.229.1) (2026-07-18)


### Bug Fixes

* **deps:** promote js-yaml to a runtime dependency ([c8864ab](https://github.com/CodySwannGT/lisa/commit/c8864ab52764de8953e40c76a824560a9190f453)), closes [#1696](https://github.com/CodySwannGT/lisa/issues/1696)

## [2.229.0](https://github.com/CodySwannGT/lisa/compare/v2.228.0...v2.229.0) (2026-07-18)


### Features

* **ui:** add live status probe contract ([dcb3ee8](https://github.com/CodySwannGT/lisa/commit/dcb3ee84fa81520ac9023d290e04d0ab3b698840))


### Bug Fixes

* **ui:** address live status review findings ([59e8b07](https://github.com/CodySwannGT/lisa/commit/59e8b076ee9ffcd5f9df2c50b335774e3338868a))
* **ui:** harden live status edge cases ([17addca](https://github.com/CodySwannGT/lisa/commit/17addcab40889221d71e6579b31a0a6cc837ef1b))


### Documentation

* **plan:** reconcile live browser verification ([c222588](https://github.com/CodySwannGT/lisa/commit/c222588fb941bf26aeaa2fd0f9f0816ac973d11e))

## [2.228.0](https://github.com/CodySwannGT/lisa/compare/v2.227.0...v2.228.0) (2026-07-18)


### Features

* **ui:** show remote environment readiness ([549e263](https://github.com/CodySwannGT/lisa/commit/549e263a17fc2c9657912b35ad9d9f9c140357d5))


### Performance Improvements

* **postinstall:** dedupe applies and version-gate plugin sync ([7159632](https://github.com/CodySwannGT/lisa/commit/71596323c99837f529b9bb6aa27ef8452b82d158)), closes [#1017](https://github.com/CodySwannGT/lisa/issues/1017) [#383](https://github.com/CodySwannGT/lisa/issues/383) [#320](https://github.com/CodySwannGT/lisa/issues/320)

## [2.227.0](https://github.com/CodySwannGT/lisa/compare/v2.226.2...v2.227.0) (2026-07-18)


### Features

* **rules:** add history-audit rule for behavior-removal changes ([7795371](https://github.com/CodySwannGT/lisa/commit/779537183ae4c8212fb12a711c7a4bda08d9dbde)), closes [#1017](https://github.com/CodySwannGT/lisa/issues/1017) [#383](https://github.com/CodySwannGT/lisa/issues/383)

### [2.226.2](https://github.com/CodySwannGT/lisa/compare/v2.226.1...v2.226.2) (2026-07-18)


### Bug Fixes

* **remote-aws:** clear stale session token ([fe96a4e](https://github.com/CodySwannGT/lisa/commit/fe96a4e8e37826edf46fc5ff4032aeb60497b697))
* **remote-aws:** reserve bootstrap profile ([3980233](https://github.com/CodySwannGT/lisa/commit/39802333b3a5f7fa642bc1c59af9a34beb983111))

### [2.226.1](https://github.com/CodySwannGT/lisa/compare/v2.226.0...v2.226.1) (2026-07-18)


### Bug Fixes

* **remote-aws:** verify AWS CLI installer ([5126160](https://github.com/CodySwannGT/lisa/commit/5126160d4523759398e4d5d324b1e4011f62816e))
* **remote-aws:** wire Copilot bootstrap secret ([445b0e8](https://github.com/CodySwannGT/lisa/commit/445b0e853acb273426e9e0695fa307df992a9ed0))

## [2.226.0](https://github.com/CodySwannGT/lisa/compare/v2.225.5...v2.226.0) (2026-07-18)


### Features

* add remote-agent AWS bootstrap ([2094e48](https://github.com/CodySwannGT/lisa/commit/2094e48791f22fd1d6949956e38e21a2c41e1cf8))

### [2.225.5](https://github.com/CodySwannGT/lisa/compare/v2.225.4...v2.225.5) (2026-07-18)


### Bug Fixes

* sync npm lifecycle lockfiles before exit ([b04b68c](https://github.com/CodySwannGT/lisa/commit/b04b68c0c0509c61bb3d015d4bc6b1f1d02a801b))

### [2.225.4](https://github.com/CodySwannGT/lisa/compare/v2.225.3...v2.225.4) (2026-07-18)


### Bug Fixes

* **rules:** scope force-push approval to SHA ([4348e6e](https://github.com/CodySwannGT/lisa/commit/4348e6e160efd05b674971e53e125d3b271adffb)), closes [#1626](https://github.com/CodySwannGT/lisa/issues/1626)

### [2.225.3](https://github.com/CodySwannGT/lisa/compare/v2.225.2...v2.225.3) (2026-07-18)


### Bug Fixes

* **expo:** pin Maestro platform scripts ([f769e03](https://github.com/CodySwannGT/lisa/commit/f769e03f4db812af6cec04a98a108cf3fcf33af5)), closes [#1625](https://github.com/CodySwannGT/lisa/issues/1625)

### [2.225.2](https://github.com/CodySwannGT/lisa/compare/v2.225.1...v2.225.2) (2026-07-18)


### Bug Fixes

* **expo:** align route character indices ([d338bd2](https://github.com/CodySwannGT/lisa/commit/d338bd226c3092cfedf897ea9b8d260db88f7313)), closes [#1624](https://github.com/CodySwannGT/lisa/issues/1624)
* **expo:** ignore companion route files ([b664504](https://github.com/CodySwannGT/lisa/commit/b664504a546a3d889a4bb44b83f885a8e1e56ed5)), closes [#1624](https://github.com/CodySwannGT/lisa/issues/1624)

### [2.225.1](https://github.com/CodySwannGT/lisa/compare/v2.225.0...v2.225.1) (2026-07-18)


### Bug Fixes

* **skills:** harden distributed validation guidance ([d4a1bd1](https://github.com/CodySwannGT/lisa/commit/d4a1bd1eb95c7ec581fd17c61720674fa227eef5)), closes [#1622](https://github.com/CodySwannGT/lisa/issues/1622)

## [2.225.0](https://github.com/CodySwannGT/lisa/compare/v2.224.0...v2.225.0) (2026-07-18)


### Features

* **agent-ready:** harden source ingestion readiness ([63ac17a](https://github.com/CodySwannGT/lisa/commit/63ac17a0295c129c39c7aff31d047476a3bb095e)), closes [#1620](https://github.com/CodySwannGT/lisa/issues/1620)

## [2.224.0](https://github.com/CodySwannGT/lisa/compare/v2.223.3...v2.224.0) (2026-07-18)


### Features

* **config:** support GitHub umbrella build queues ([70d02bc](https://github.com/CodySwannGT/lisa/commit/70d02bc26b239f3ddb4dc9ff929e83270bf998c1))


### Bug Fixes

* **config:** clarify umbrella queue automation contracts ([51ca59c](https://github.com/CodySwannGT/lisa/commit/51ca59c85e6e74f5484f16449c82c345b7c26194))

### [2.223.3](https://github.com/CodySwannGT/lisa/compare/v2.223.2...v2.223.3) (2026-07-18)


### Bug Fixes

* **gitignore:** exclude verification verdict ([7c81142](https://github.com/CodySwannGT/lisa/commit/7c811420baf7210ad14c59e5661a0ea26cd85719))

### [2.223.2](https://github.com/CodySwannGT/lisa/compare/v2.223.1...v2.223.2) (2026-07-17)


### Bug Fixes

* **verification:** clarify typed evidence marker ([a2f97b8](https://github.com/CodySwannGT/lisa/commit/a2f97b827b87e91db42aa2fc6352751c8b52a000))
* **verification:** preserve legacy evidence refs ([436d05d](https://github.com/CodySwannGT/lisa/commit/436d05d0156af99a54727a8e362dea832b83fd4a))

### [2.223.1](https://github.com/CodySwannGT/lisa/compare/v2.223.0...v2.223.1) (2026-07-17)


### Bug Fixes

* **verification:** add non-claiming evidence references ([195ed99](https://github.com/CodySwannGT/lisa/commit/195ed9918423c0645f8811aa53d09eb506fdffad))

## [2.223.0](https://github.com/CodySwannGT/lisa/compare/v2.222.3...v2.223.0) (2026-07-17)


### Features

* **validate:** add evidence reference markers ([3de2332](https://github.com/CodySwannGT/lisa/commit/3de2332ef83c8f79781931a557b34924644fa871))

### [2.222.3](https://github.com/CodySwannGT/lisa/compare/v2.222.2...v2.222.3) (2026-07-17)


### Bug Fixes

* apply CodeRabbit auto-fixes ([267757a](https://github.com/CodySwannGT/lisa/commit/267757aeee10d827458754864349ad14fab62361))
* **hooks:** fail closed on heredoc classification ([#1594](https://github.com/CodySwannGT/lisa/issues/1594)) ([5450387](https://github.com/CodySwannGT/lisa/commit/5450387ee562c5d9959c228c00b2690b487f5d10))

### [2.222.2](https://github.com/CodySwannGT/lisa/compare/v2.222.1...v2.222.2) (2026-07-17)


### Bug Fixes

* **hooks:** ignore heredoc prose in safety net ([5396118](https://github.com/CodySwannGT/lisa/commit/5396118ace931cfadec187536b42a5400d345f61))
* **hooks:** make heredoc stripping quote-aware and chain-safe ([4615d6a](https://github.com/CodySwannGT/lisa/commit/4615d6aa041de30cefb205f0c31eb9e8dd2b5941))

### [2.222.1](https://github.com/CodySwannGT/lisa/compare/v2.222.0...v2.222.1) (2026-07-17)


### Bug Fixes

* **usage-accounting:** preserve explicit rollup state ([ae94225](https://github.com/CodySwannGT/lisa/commit/ae942253fe95c0a4e479cb77065c9e023af39d9f))
* **usage-accounting:** preserve legacy ledgers ([#1550](https://github.com/CodySwannGT/lisa/issues/1550)) ([9a3fa24](https://github.com/CodySwannGT/lisa/commit/9a3fa24a1e82e212854c03004350fd478c5aa07d))

## [2.222.0](https://github.com/CodySwannGT/lisa/compare/v2.221.6...v2.222.0) (2026-07-17)


### Features

* **usage-accounting:** record measured subsets ([6b7d642](https://github.com/CodySwannGT/lisa/commit/6b7d64209cb3fbadaeaced3fea44c2141421b7f6))

### [2.221.6](https://github.com/CodySwannGT/lisa/compare/v2.221.5...v2.221.6) (2026-07-17)


### Bug Fixes

* **validate:** align F2/F4 with lifecycle hierarchy ([#1549](https://github.com/CodySwannGT/lisa/issues/1549)) ([7279e21](https://github.com/CodySwannGT/lisa/commit/7279e21cb10c2491338a4ff0d3794a40032a3bef))


### Documentation

* **plan:** require successful regression execution ([9f87d7b](https://github.com/CodySwannGT/lisa/commit/9f87d7bab2a4c9e1ad524502014c3de37d6f034c))

### [2.221.5](https://github.com/CodySwannGT/lisa/compare/v2.221.4...v2.221.5) (2026-07-17)


### Bug Fixes

* **workflows:** hash source root in build caches ([a61a95b](https://github.com/CodySwannGT/lisa/commit/a61a95ba4c3727137df71417bb7de1ea09f96f9a))

### [2.221.4](https://github.com/CodySwannGT/lisa/compare/v2.221.3...v2.221.4) (2026-07-17)


### Bug Fixes

* **lighthouse:** support numeric metric budgets ([5a2bf5e](https://github.com/CodySwannGT/lisa/commit/5a2bf5e9008f1e5fea9e3a6a0dbfacc7ea9d8758))

### [2.221.3](https://github.com/CodySwannGT/lisa/compare/v2.221.2...v2.221.3) (2026-07-17)


### Bug Fixes

* prune Expo Jest agent worktrees ([87cad5a](https://github.com/CodySwannGT/lisa/commit/87cad5a40584749a88fc9d3b8bf2420dbc2f652e)), closes [#1472](https://github.com/CodySwannGT/lisa/issues/1472)

### [2.221.2](https://github.com/CodySwannGT/lisa/compare/v2.221.1...v2.221.2) (2026-07-17)


### Bug Fixes

* clarify browser verification evidence ([1ca2d9b](https://github.com/CodySwannGT/lisa/commit/1ca2d9b198ad0d9a5faeacb6e244cf0aee99fdb0))

### [2.221.1](https://github.com/CodySwannGT/lisa/compare/v2.221.0...v2.221.1) (2026-07-17)


### Bug Fixes

* expose github label event history ([474c29a](https://github.com/CodySwannGT/lisa/commit/474c29a27d7847cf4cc1f747a95fbb26f702890d))

## [2.221.0](https://github.com/CodySwannGT/lisa/compare/v2.220.1...v2.221.0) (2026-07-17)


### Features

* **learnings:** fan out project learnings rules ([5e87eda](https://github.com/CodySwannGT/lisa/commit/5e87eda1cb4b7c26a70c06cd11129070249c8ce9))


### Bug Fixes

* reject duplicate agy project-learnings markers before editing AGENTS.md ([1b1258b](https://github.com/CodySwannGT/lisa/commit/1b1258b2dd1cbe7bdfa883a2e8260667fba8fbaa)), closes [#1666](https://github.com/CodySwannGT/lisa/issues/1666)

### [2.220.1](https://github.com/CodySwannGT/lisa/compare/v2.220.0...v2.220.1) (2026-07-17)

## [2.220.0](https://github.com/CodySwannGT/lisa/compare/v2.219.1...v2.220.0) (2026-07-17)


### Features

* **learnings:** enforce project memory budgets ([bb1c0a0](https://github.com/CodySwannGT/lisa/commit/bb1c0a044efa6f1605c73121a94b13bfd8b0fb68))

### [2.219.1](https://github.com/CodySwannGT/lisa/compare/v2.219.0...v2.219.1) (2026-07-17)


### Bug Fixes

* **ci:** skip back-sync on single-environment repos even with a hardcoded chain ([8db6223](https://github.com/CodySwannGT/lisa/commit/8db6223a980d59303c1f40d3234bfc5d23e1da06))
* **eslint:** annotate config default exports and merge optional local ignores ([f464ed6](https://github.com/CodySwannGT/lisa/commit/f464ed6765ce38d1cda9f385c024669c35b7e135)), closes [acmeorgc/wiki#206](https://github.com/acmeorgc/wiki/issues/206)
* **expo:** ship brownfield-safe e2e thresholds and a stable route sort ([1582257](https://github.com/CodySwannGT/lisa/commit/15822577607c54bb21da522591c48c077cbe4fd9))
* **gitignore:** make tasks/tasks.json re-include effective and ignore .build-boot ([1289a6d](https://github.com/CodySwannGT/lisa/commit/1289a6dd9723aeded239fc161e38fa77407551f7))
* **husky:** use a portable mktemp template in the gitleaks pre-commit hook ([225fd34](https://github.com/CodySwannGT/lisa/commit/225fd34a62e6edd8db7ae5e3056c16dc2de0d925))
* **phaser:** bubble pre-push failures, re-run CI on label toggles, keep example art ([423ab4e](https://github.com/CodySwannGT/lisa/commit/423ab4ec73c669c20f5525464b72a254c26f79ec))
* **rails:** grant CI caller the write permissions quality-rails.yml needs ([de58f9e](https://github.com/CodySwannGT/lisa/commit/de58f9e999404375672a0494b1359d82276a3246)), closes [railsstarter#59](https://github.com/CodySwannGT/railsstarter/issues/59)
* **security:** add force-governed CVE floors for systeminformation and websocket-driver ([ff4ac6f](https://github.com/CodySwannGT/lisa/commit/ff4ac6f66df7e0af7d620c3ecdb29b1713a730bc)), closes [harperstarter#11](https://github.com/CodySwannGT/harperstarter/issues/11)
* **security:** drop withdrawn esbuild advisory GHSA-gv7w-rqvm-qjhr from audit ignore ([42f8157](https://github.com/CodySwannGT/lisa/commit/42f8157d46b2a09deef19ca17797c37ffcad3744))

## [2.219.0](https://github.com/CodySwannGT/lisa/compare/v2.218.0...v2.219.0) (2026-07-16)


### Features

* **learnings:** preserve create-only project memory ([5d9c7af](https://github.com/CodySwannGT/lisa/commit/5d9c7aff9136c57c960afb96b7ed868644d803bc))

## [2.218.0](https://github.com/CodySwannGT/lisa/compare/v2.217.8...v2.218.0) (2026-07-16)


### Features

* **learnings:** define bounded project learning contract ([d692467](https://github.com/CodySwannGT/lisa/commit/d6924673c6a43415c0656716863485a12fcc5bd2))


### Bug Fixes

* **learnings:** harden contract review findings ([eff9326](https://github.com/CodySwannGT/lisa/commit/eff9326bd704f4e0fd700533d8f352c5a4ac5008))

### [2.217.8](https://github.com/CodySwannGT/lisa/compare/v2.217.7...v2.217.8) (2026-07-16)


### Bug Fixes

* **apply:** materialize forced devDependencies, migrate legacy harness, guard source-repo self-apply ([242a28d](https://github.com/CodySwannGT/lisa/commit/242a28deda611c4773d45fb00b2ab8cb4eeef00f)), closes [#177](https://github.com/CodySwannGT/lisa/issues/177) [#335](https://github.com/CodySwannGT/lisa/issues/335) [#13](https://github.com/CodySwannGT/lisa/issues/13) [#38](https://github.com/CodySwannGT/lisa/issues/38) [#1659](https://github.com/CodySwannGT/lisa/issues/1659)

### [2.217.7](https://github.com/CodySwannGT/lisa/compare/v2.217.6...v2.217.7) (2026-07-16)

### [2.217.6](https://github.com/CodySwannGT/lisa/compare/v2.217.5...v2.217.6) (2026-07-16)


### Bug Fixes

* **sync:** migrate legacy monitor thresholds ([80180ab](https://github.com/CodySwannGT/lisa/commit/80180abea91a2e3e26b42004103c37d7fe557977))

### [2.217.5](https://github.com/CodySwannGT/lisa/compare/v2.217.4...v2.217.5) (2026-07-16)


### Bug Fixes

* **sync:** preserve human legacy monitor values ([cb2f4f2](https://github.com/CodySwannGT/lisa/commit/cb2f4f25955ba0f64832a2ac8824534bfe3d2729))

### [2.217.4](https://github.com/CodySwannGT/lisa/compare/v2.217.3...v2.217.4) (2026-07-16)


### Bug Fixes

* **monitor:** preserve legacy threshold behavior ([85b0f5f](https://github.com/CodySwannGT/lisa/commit/85b0f5fba862620c4f58a66c6a4f8f927ae86249))

### [2.217.3](https://github.com/CodySwannGT/lisa/compare/v2.217.2...v2.217.3) (2026-07-16)


### Bug Fixes

* **monitor:** preserve legacy threshold keys ([c1d8ad5](https://github.com/CodySwannGT/lisa/commit/c1d8ad5fe1acf30c488e3b901504b4ae9004e3ee))

### [2.217.2](https://github.com/CodySwannGT/lisa/compare/v2.217.1...v2.217.2) (2026-07-16)


### Documentation

* **rules:** use provider-neutral monitor thresholds ([dd97ba7](https://github.com/CodySwannGT/lisa/commit/dd97ba77f305a8e0fc6ce45451b0d8d0ea248b47))

### [2.217.1](https://github.com/CodySwannGT/lisa/compare/v2.217.0...v2.217.1) (2026-07-16)


### Bug Fixes

* **ci:** cover missing secrets block in migration; assert full diagnostic phrase ([45df1db](https://github.com/CodySwannGT/lisa/commit/45df1db359f89acb81ff7e25e2087b331b342768))
* **ci:** least-privilege secrets mapping for auto-fix callers ([ea589fd](https://github.com/CodySwannGT/lisa/commit/ea589fd6afbf3d1e937d830f66f6dca9ad49f0c3)), closes [AcmeOrgA/backend#900](https://github.com/AcmeOrgA/backend/issues/900)

## [2.217.0](https://github.com/CodySwannGT/lisa/compare/v2.216.0...v2.217.0) (2026-07-16)


### Features

* **skills:** add PRD requirement traceability to ticket decomposition ([95f94ef](https://github.com/CodySwannGT/lisa/commit/95f94efcbb3cad090dc338a88aeb1046def95adb))

## [2.216.0](https://github.com/CodySwannGT/lisa/compare/v2.215.0...v2.216.0) (2026-07-16)


### Features

* **ci:** harden review-response and deploy-auto-fix workflows ([87f86ab](https://github.com/CodySwannGT/lisa/commit/87f86ab504c6b956e626f049d495a47f12d47a07))

## [2.215.0](https://github.com/CodySwannGT/lisa/compare/v2.214.0...v2.215.0) (2026-07-16)


### Features

* **ci:** config-driven failure-issue dispatcher with Linear leg and dedupe ([876ef11](https://github.com/CodySwannGT/lisa/commit/876ef11b02e36bceec0329e95527a245d9caf687))
* **ci:** ownership-aware Claude CI auto-fix with side-branch fix PRs ([61f5a46](https://github.com/CodySwannGT/lisa/commit/61f5a46b5aeb22d9c61018cf7142078cc4e15310)), closes [#5](https://github.com/CodySwannGT/lisa/issues/5)
* **templates:** inherit secrets in auto-fix callers and add babysitter lease to drive-pr-to-merge ([ef6fd36](https://github.com/CodySwannGT/lisa/commit/ef6fd368fd880672a109afc495e7e86a47dd776a))


### Bug Fixes

* **ci:** address CodeRabbit review findings on failure routing and auto-fix ([248dd8d](https://github.com/CodySwannGT/lisa/commit/248dd8d26010210d0e6001c704e6d6e97d49278f))
* **skills:** verify the babysitter lease attached before driving the PR ([9c0d38e](https://github.com/CodySwannGT/lisa/commit/9c0d38ecb97f553b8becfcd5d53c052602e5e518))

## [2.214.0](https://github.com/CodySwannGT/lisa/compare/v2.213.0...v2.214.0) (2026-07-15)


### Features

* **verification:** evidence markers must declare a typed empirical artifact ([e33c151](https://github.com/CodySwannGT/lisa/commit/e33c151268827a78a66f0452715b884ec23c9b3e))
* **verification:** frontend codification is dual-runner — Playwright + Maestro when supported ([e6ec318](https://github.com/CodySwannGT/lisa/commit/e6ec318d902aa68711318c3ff1cb6ff7ee95a199))

## [2.213.0](https://github.com/CodySwannGT/lisa/compare/v2.212.0...v2.213.0) (2026-07-15)


### Features

* **research:** restructure PRD synthesis to a per-user-story layout ([e89fadc](https://github.com/CodySwannGT/lisa/commit/e89fadc10ff2f592df675a7b737498ecbd43f229))

## [2.212.0](https://github.com/CodySwannGT/lisa/compare/v2.211.3...v2.212.0) (2026-07-15)


### Features

* **implement:** add tool-access gate — block on missing tool access, never work around ([f63b6b3](https://github.com/CodySwannGT/lisa/commit/f63b6b3fa3aaf2841d883ac85455a96b5f2c2ad5))


### Bug Fixes

* **implement:** address CodeRabbit review on tool-access gate ([9995543](https://github.com/CodySwannGT/lisa/commit/999554335539e2873eb5ed039b9887107915e97c))

### [2.211.3](https://github.com/CodySwannGT/lisa/compare/v2.211.2...v2.211.3) (2026-07-15)


### Bug Fixes

* require PRD open question recommendations ([c97c0cd](https://github.com/CodySwannGT/lisa/commit/c97c0cd917bc0279e1c16e94e7451b68d4f818c5))

### [2.211.2](https://github.com/CodySwannGT/lisa/compare/v2.211.1...v2.211.2) (2026-07-14)

### [2.211.1](https://github.com/CodySwannGT/lisa/compare/v2.211.0...v2.211.1) (2026-07-14)


### Code Refactoring

* **ui:** split pipelines from quality gates, make hosting host-neutral ([5ac2230](https://github.com/CodySwannGT/lisa/commit/5ac22301ee3c49e2e7a6fe61be96c7ecfe8aaa4f))

## [2.211.0](https://github.com/CodySwannGT/lisa/compare/v2.210.3...v2.211.0) (2026-07-14)


### Features

* **ui:** surface e2e coverage gates and reorganize core commands in the console ([2b6b973](https://github.com/CodySwannGT/lisa/commit/2b6b9731cbabf742f3e5a97d8219327c1785bb8d))


### Documentation

* **ui:** note that 0 disables the Playwright route-coverage gate ([c193d3e](https://github.com/CodySwannGT/lisa/commit/c193d3eb5a2a3920e6719ffbfe89f90770c94d72))

### [2.210.3](https://github.com/CodySwannGT/lisa/compare/v2.210.2...v2.210.3) (2026-07-14)


### Bug Fixes

* **expo:** ship copy-overwrite tsconfig so the typescript template stops clobbering expo projects ([5bc08f3](https://github.com/CodySwannGT/lisa/commit/5bc08f35d4df03b32201ac60c113162da8911ba5)), closes [#1638](https://github.com/CodySwannGT/lisa/issues/1638)

### [2.210.2](https://github.com/CodySwannGT/lisa/compare/v2.210.1...v2.210.2) (2026-07-14)


### Bug Fixes

* **nestjs:** keep typescript7/bin/tsc in knip ignoreBinaries ([d11f726](https://github.com/CodySwannGT/lisa/commit/d11f726d34218db1ca35456a979d6728bf65bc8a))

### [2.210.1](https://github.com/CodySwannGT/lisa/compare/v2.210.0...v2.210.1) (2026-07-14)


### Bug Fixes

* **tsconfig:** drop baseUrl from project tsconfig templates ([871f9f5](https://github.com/CodySwannGT/lisa/commit/871f9f5314a76e8d8d9365e620789bcede23e540))

## [2.210.0](https://github.com/CodySwannGT/lisa/compare/v2.209.6...v2.210.0) (2026-07-14)


### Features

* **doctor:** flag committed legacy pre-2.198 Codex overlay ([9157c9a](https://github.com/CodySwannGT/lisa/commit/9157c9a162f0e6fbd2b0cfeda5c154fbe602bfc9)), closes [#1632](https://github.com/CodySwannGT/lisa/issues/1632)

### [2.209.6](https://github.com/CodySwannGT/lisa/compare/v2.209.5...v2.209.6) (2026-07-14)


### Bug Fixes

* **cdk:** move aws-cdk-lib pin from force to defaults ([2e4c4d6](https://github.com/CodySwannGT/lisa/commit/2e4c4d6188fdc6d6d9e0c2798ac1e92744c69b9f))

### [2.209.5](https://github.com/CodySwannGT/lisa/compare/v2.209.4...v2.209.5) (2026-07-14)


### Bug Fixes

* **nestjs,expo:** demote split-major pins from force to defaults ([2373368](https://github.com/CodySwannGT/lisa/commit/2373368a72cee14d4ad748a25ca7e07f68d987c2))

### [2.209.4](https://github.com/CodySwannGT/lisa/compare/v2.209.3...v2.209.4) (2026-07-14)


### Bug Fixes

* **expo:** give the Maestro Android job the same 90-minute budget as iOS ([b5c1b57](https://github.com/CodySwannGT/lisa/commit/b5c1b57f9ee92111a4437bb8ab24310a016f0001))

### [2.209.3](https://github.com/CodySwannGT/lisa/compare/v2.209.2...v2.209.3) (2026-07-14)


### Bug Fixes

* **expo:** move tailwindcss pin from force to defaults ([ddb4043](https://github.com/CodySwannGT/lisa/commit/ddb4043b2ceb3664290766d066a1dc72c5a5be7e))

### [2.209.2](https://github.com/CodySwannGT/lisa/compare/v2.209.1...v2.209.2) (2026-07-14)


### Bug Fixes

* **hooks:** derive primary checkout via git-common-dir in install-pkgs ([254458d](https://github.com/CodySwannGT/lisa/commit/254458db136c6d543c7605f05a18726f626b5cef))

### [2.209.1](https://github.com/CodySwannGT/lisa/compare/v2.209.0...v2.209.1) (2026-07-14)


### Bug Fixes

* resolve packaged wiki scripts ([8e5cbe3](https://github.com/CodySwannGT/lisa/commit/8e5cbe399f9843963cd4cc724a054806ae4f0d08))

## [2.209.0](https://github.com/CodySwannGT/lisa/compare/v2.208.0...v2.209.0) (2026-07-14)


### Features

* **expo:** add include-tags inputs to the Maestro native e2e workflow ([2d32f8b](https://github.com/CodySwannGT/lisa/commit/2d32f8babd8eb5475c543e51d004bd45e624a2f9))

## [2.208.0](https://github.com/CodySwannGT/lisa/compare/v2.207.0...v2.208.0) (2026-07-14)


### Features

* **expo:** forward secret and non-MAESTRO flow variables to maestro ([0d52b76](https://github.com/CodySwannGT/lisa/commit/0d52b76ca21c898671f45adf802462ed606ebde0))
* **expo:** reusable Maestro native e2e workflow on GitHub runners ([173b691](https://github.com/CodySwannGT/lisa/commit/173b6914a085debe3c87fb86103f2d13d493a5e7))

## [2.207.0](https://github.com/CodySwannGT/lisa/compare/v2.206.0...v2.207.0) (2026-07-14)


### Features

* add workflow change verification skill ([a3525c5](https://github.com/CodySwannGT/lisa/commit/a3525c55a683dcc6a5b7e7b49e59ca3220760554))

## [2.206.0](https://github.com/CodySwannGT/lisa/compare/v2.205.1...v2.206.0) (2026-07-14)


### Features

* **expo:** add e2e route/screen coverage gate for Playwright and Maestro ([49adfe6](https://github.com/CodySwannGT/lisa/commit/49adfe6b37e016fb185ce69d7fb36683d2b4b62a))


### Bug Fixes

* **expo:** guard malformed e2e.thresholds.json with a readable error ([fbb9aa9](https://github.com/CodySwannGT/lisa/commit/fbb9aa90ffb9907eef2c2e6e0d477efab1a81304))

### [2.205.1](https://github.com/CodySwannGT/lisa/compare/v2.205.0...v2.205.1) (2026-07-14)


### Bug Fixes

* **rules:** treat create-only templates as upstream Lisa ([00326f8](https://github.com/CodySwannGT/lisa/commit/00326f85c7b7bbd20cca7dad26c2ea45c3ae34a4))

## [2.205.0](https://github.com/CodySwannGT/lisa/compare/v2.204.8...v2.205.0) (2026-07-13)


### Features

* **cdk:** add setup-aws-accounts skill driving the aws-soc2-setup CLI ([ce29f95](https://github.com/CodySwannGT/lisa/commit/ce29f9509f4e4ff8335e8386207353a0adc2b2ad))


### Bug Fixes

* **cdk:** address CodeRabbit review on setup-aws-accounts skill ([61ddb20](https://github.com/CodySwannGT/lisa/commit/61ddb20358d8390136402e074d2cce45ea73017b))

### [2.204.8](https://github.com/CodySwannGT/lisa/compare/v2.204.7...v2.204.8) (2026-07-13)


### Bug Fixes

* pass package manager through claude templates ([5863d5b](https://github.com/CodySwannGT/lisa/commit/5863d5b5ff5a013db3404a646f44ee5e1cb0f253))

### [2.204.7](https://github.com/CodySwannGT/lisa/compare/v2.204.6...v2.204.7) (2026-07-13)


### Bug Fixes

* **apply:** preserve expo tsconfig ownership ([a977927](https://github.com/CodySwannGT/lisa/commit/a977927fcd1711a63b43658a334acda9e28986af))

### [2.204.6](https://github.com/CodySwannGT/lisa/compare/v2.204.5...v2.204.6) (2026-07-13)


### Bug Fixes

* skip agent emits during postinstall apply ([87e0fe1](https://github.com/CodySwannGT/lisa/commit/87e0fe13c9cd6b13ff08a64ddf59edde8e8e61e0))

### [2.204.5](https://github.com/CodySwannGT/lisa/compare/v2.204.4...v2.204.5) (2026-07-13)


### Bug Fixes

* **workflows:** populate the GitHub release changelog for standard-version releases ([50ac462](https://github.com/CodySwannGT/lisa/commit/50ac4628bd576646e10e374762b69b6915970bc3))

### [2.204.4](https://github.com/CodySwannGT/lisa/compare/v2.204.3...v2.204.4) (2026-07-13)


### Bug Fixes

* **eslint:** enforce the jsdoc rules deferred to oxlint ([881147d](https://github.com/CodySwannGT/lisa/commit/881147d53f85171beb8fbf9fdb297464a6c69930))

### [2.204.3](https://github.com/CodySwannGT/lisa/compare/v2.204.2...v2.204.3) (2026-07-13)


### Bug Fixes

* **workflows:** skip Claude automation jobs cleanly when CLAUDE_CODE_OAUTH_TOKEN is absent ([7e43483](https://github.com/CodySwannGT/lisa/commit/7e43483b481c0891b750aae3dd29cb656cd9a176)), closes [AcmeOrgD/frontend#13-16](https://github.com/AcmeOrgD/frontend/issues/13-16) [#21](https://github.com/CodySwannGT/lisa/issues/21) [#1601](https://github.com/CodySwannGT/lisa/issues/1601)

### [2.204.2](https://github.com/CodySwannGT/lisa/compare/v2.204.1...v2.204.2) (2026-07-13)


### Bug Fixes

* **nestjs-deploy:** gate deploy on check_migration_required succeeding ([af26b8d](https://github.com/CodySwannGT/lisa/commit/af26b8d5a4589d2703977d7cbdf5bcb1c6da9c38)), closes [#1604](https://github.com/CodySwannGT/lisa/issues/1604)
* **workflows:** harden deploy template contracts ([e791987](https://github.com/CodySwannGT/lisa/commit/e791987350d1235a44b32c4519a5f9b7e9cb9f78))

### [2.204.1](https://github.com/CodySwannGT/lisa/compare/v2.204.0...v2.204.1) (2026-07-12)


### Bug Fixes

* **plugins:** flatten plugin command namespace so Claude gets /lisa:* not /lisa:lisa:* ([e87794b](https://github.com/CodySwannGT/lisa/commit/e87794ba105e894074e0d3cecb98d131c6de80a5))

## [2.204.0](https://github.com/CodySwannGT/lisa/compare/v2.203.0...v2.204.0) (2026-07-12)


### Features

* **nestjs:** add optional deploy env and health smoke ([a468e4e](https://github.com/CodySwannGT/lisa/commit/a468e4e75fa702b360e8f5bc567cfed88657ae04))

## [2.203.0](https://github.com/CodySwannGT/lisa/compare/v2.202.0...v2.203.0) (2026-07-12)


### Features

* **onboarding:** /lisa:agent-ready — brownfield knowledge convergence before autonomy ([b133919](https://github.com/CodySwannGT/lisa/commit/b1339191520a92b60700fecd130867e81a71fb54))

## [2.202.0](https://github.com/CodySwannGT/lisa/compare/v2.201.0...v2.202.0) (2026-07-12)


### Features

* **plugins:** factory-model rule, scheduled monitor loop, autonomous defaults, F5 access gate ([842cea6](https://github.com/CodySwannGT/lisa/commit/842cea62f82ab31722b919fe7407813c69d0c933))
* **ui:** factory model on the overview, automations status board, table-control fix ([39412a3](https://github.com/CodySwannGT/lisa/commit/39412a32efa5ae05cb9bb9d446dbd2fa2a60cf78))


### Documentation

* make the factory model Lisa's stated purpose ([c22d1db](https://github.com/CodySwannGT/lisa/commit/c22d1dbd7e41bf848c1e6aaef65a2915b93f9213))
* **purpose:** the factory goal — non-technical people creating scalable software ([5724052](https://github.com/CodySwannGT/lisa/commit/57240524ea82db4b842a6d3cd1299f4e69717ed3)), closes [#5](https://github.com/CodySwannGT/lisa/issues/5)

## [2.201.0](https://github.com/CodySwannGT/lisa/compare/v2.200.0...v2.201.0) (2026-07-12)


### Features

* **doctor:** diagnose findings against upstream Lisa git history ([9115ba2](https://github.com/CodySwannGT/lisa/commit/9115ba26c7e6c76a3fe081a6bcf817724207c24f))


### Bug Fixes

* **tests:** sanitize git hook env in repo-settings script test ([ef18e92](https://github.com/CodySwannGT/lisa/commit/ef18e9292d926959a4f2ad121a2a4894369e6e42))


### Documentation

* **doctor:** aggregate paginated gh api output with --slurp ([3a662e5](https://github.com/CodySwannGT/lisa/commit/3a662e555bc75741ededddbdf00272033b4141f8))
* **doctor:** harden upstream history diagnosis against truncated/unbounded results ([618afcc](https://github.com/CodySwannGT/lisa/commit/618afcc743f97d74a304df3e20d1b92cb27fa4e6))

## [2.200.0](https://github.com/CodySwannGT/lisa/compare/v2.199.0...v2.200.0) (2026-07-12)


### Features

* **cli:** add lisa ui command and wire sync/ui subcommands ([c6ec787](https://github.com/CodySwannGT/lisa/commit/c6ec787dcd475b9f2d30fbd4a9d2f0490215524b))
* **sync:** make .lisa.config.json the source of truth via lisa sync ([1192343](https://github.com/CodySwannGT/lisa/commit/11923435b253b03c56b92749f99299e3ac7fb10b))
* **ui:** add Health section with version status and in-band scan contract ([d3a34af](https://github.com/CodySwannGT/lisa/commit/d3a34af4f128ee7a586ce5d5be8095c068db63bb))
* **ui:** add Lisa settings console prototype ([c786746](https://github.com/CodySwannGT/lisa/commit/c78674674b4913f6dc249a8498a4bdc64195398c))
* **ui:** add Setup checklist and Core workflow sections ([9d22cc8](https://github.com/CodySwannGT/lisa/commit/9d22cc8352982f1c681eee234b341bacde80a51e))
* **ui:** apply console feedback across CI, deploy, automations, monitoring ([e367c48](https://github.com/CodySwannGT/lisa/commit/e367c487899e8b2d51bc280c3fe5e7cb7cb8be54))


### Bug Fixes

* **tests:** sanitize git hook env vars when spawning git in temp dirs ([5a16990](https://github.com/CodySwannGT/lisa/commit/5a1699013a92f78f7b3ee12b4ac9caa9a60fe45b))


### Code Refactoring

* **sync:** provider-neutral monitor threshold keys; self-populate config ([4e9a065](https://github.com/CodySwannGT/lisa/commit/4e9a0659ed552485625c60c221a2b93a2853853d))

## [2.199.0](https://github.com/CodySwannGT/lisa/compare/v2.198.2...v2.199.0) (2026-07-12)


### Features

* **github:** provision deployment environments with human-approval gates ([52ae835](https://github.com/CodySwannGT/lisa/commit/52ae83514898cc4fbcde95cce189780910956c2a))
* **workflows:** wire config-driven approval gates into stack deploy templates ([8c60b0a](https://github.com/CodySwannGT/lisa/commit/8c60b0ac0d393763796ae4e14a001ddf24359478))


### Bug Fixes

* **github:** harden skill's approval-wiring detection and env verification ([8ce9594](https://github.com/CodySwannGT/lisa/commit/8ce95942155281cdd58c10131cb7b4a4b598fa0d)), closes [#1491](https://github.com/CodySwannGT/lisa/issues/1491)


### Documentation

* **github:** document github.environments approval gates ([452677f](https://github.com/CodySwannGT/lisa/commit/452677fbb98ee08a7ed6504ba43a37308966a60a))

### [2.198.2](https://github.com/CodySwannGT/lisa/compare/v2.198.1...v2.198.2) (2026-07-11)


### Bug Fixes

* **release:** prevent cross-branch tag collisions and make release creation rerun-safe ([a83dcb0](https://github.com/CodySwannGT/lisa/commit/a83dcb03d70e5d681bd0305b49b08cf923cf9136))

### [2.198.1](https://github.com/CodySwannGT/lisa/compare/v2.198.0...v2.198.1) (2026-07-11)


### Bug Fixes

* **orchestration:** run intake's per-item lifecycle in the lead session so implement fans out ([5d9d290](https://github.com/CodySwannGT/lisa/commit/5d9d290070ecb7a76c35784d5e10cab5d40d8c83))

## [2.198.0](https://github.com/CodySwannGT/lisa/compare/v2.197.0...v2.198.0) (2026-07-11)


### Features

* **github:** default branch resolves to lowest-tier environment branch ([49b8101](https://github.com/CodySwannGT/lisa/commit/49b81017910e738cb6fdb6a0baf2895c6dc70a41))

## [2.197.0](https://github.com/CodySwannGT/lisa/compare/v2.196.1...v2.197.0) (2026-07-11)


### Features

* **github:** per-repo required-check opt-out via .lisa.config.json ([4db7e3c](https://github.com/CodySwannGT/lisa/commit/4db7e3c61c75ccdd2fb388835d8cb8b121c10959))

### [2.196.1](https://github.com/CodySwannGT/lisa/compare/v2.196.0...v2.196.1) (2026-07-11)


### Bug Fixes

* **github:** drop cdk-validation ruleset template ([5cab5e7](https://github.com/CodySwannGT/lisa/commit/5cab5e7220f367cdcbdfb1bef4e5aae85cc8eb68))
* **github:** harden governance scripts against real fleet conditions ([acfdc18](https://github.com/CodySwannGT/lisa/commit/acfdc186bcd815701ecd0393ce85577bcf40f4bd))

## [2.196.0](https://github.com/CodySwannGT/lisa/compare/v2.195.8...v2.196.0) (2026-07-11)


### Features

* **github:** fleet-baseline ruleset templates and refreshed apply script ([71157ca](https://github.com/CodySwannGT/lisa/commit/71157ca676acb770e61fdd62c6e54a3a6ce0f9e6))
* **github:** repo settings baseline, governance orchestrator, deploy-key --yes ([a0d83ab](https://github.com/CodySwannGT/lisa/commit/a0d83aba260efaf0ce6cadb864489f179102c237))
* **plugins:** lisa-setup-github-repo skill and /lisa:setup:github-repo command ([8b1cbdc](https://github.com/CodySwannGT/lisa/commit/8b1cbdcd3c0d32e9ef25a11ef906a814ae05cb0c))
* **scripts:** merged-only branch cleanup and repo-level worktree cleanup ([3695207](https://github.com/CodySwannGT/lisa/commit/3695207cf4f41511c87af606ee96f1495a2de80a))


### Bug Fixes

* address CodeRabbit review feedback ([2fa52aa](https://github.com/CodySwannGT/lisa/commit/2fa52aa29f4abf6054da1c71483712aac30dd411))

### [2.195.8](https://github.com/CodySwannGT/lisa/compare/v2.195.7...v2.195.8) (2026-07-11)


### Bug Fixes

* **expo:** add force_build dispatch input to recover skipped EAS builds ([7c9e4f9](https://github.com/CodySwannGT/lisa/commit/7c9e4f94d3c47bde933106a3d872cc5e13735fa8)), closes [AcmeOrgA/frontend#822](https://github.com/AcmeOrgA/frontend/issues/822)

### [2.195.7](https://github.com/CodySwannGT/lisa/compare/v2.195.6...v2.195.7) (2026-07-10)


### Bug Fixes

* **expo:** trigger EAS build when app.json or eas.json changes ([ec407a2](https://github.com/CodySwannGT/lisa/commit/ec407a2357cf761dc4a87ba5183a2737f956adcf))

### [2.195.6](https://github.com/CodySwannGT/lisa/compare/v2.195.5...v2.195.6) (2026-07-10)


### Bug Fixes

* **release:** pin npm compatible with Node 22.21 ([074d9d6](https://github.com/CodySwannGT/lisa/commit/074d9d62692cbc1d76ea9755fe336535a6e778bf))

### [2.195.5](https://github.com/CodySwannGT/lisa/compare/v2.195.4...v2.195.5) (2026-07-10)


### Bug Fixes

* **codex:** scope Lisa plugin delivery to projects ([1b47a8c](https://github.com/CodySwannGT/lisa/commit/1b47a8cdaac6be5a28a72eab2e615e0496120d72))

### [2.195.4](https://github.com/CodySwannGT/lisa/compare/v2.195.3...v2.195.4) (2026-07-08)


### Bug Fixes

* **expo:** remove always-on Maestro MCP server from the expo plugin ([b1f3efd](https://github.com/CodySwannGT/lisa/commit/b1f3efd21f55793597bc52a2bbb8ff4984ca4a28))

### [2.195.3](https://github.com/CodySwannGT/lisa/compare/v2.195.2...v2.195.3) (2026-07-08)


### Bug Fixes

* scrub client project names from distributed skills ([1d40304](https://github.com/CodySwannGT/lisa/commit/1d403045fc680d030421b1b848308a69ebdb2edd))
* scrub remaining client names from skill references ([e6ede33](https://github.com/CodySwannGT/lisa/commit/e6ede3390682d66f20add967440b4917ee7743b6))

### [2.195.2](https://github.com/CodySwannGT/lisa/compare/v2.195.1...v2.195.2) (2026-07-08)


### Bug Fixes

* **expo:** tsconfig.json becomes host-owned (create-only) with expo's stable include ([c7261a2](https://github.com/CodySwannGT/lisa/commit/c7261a29eca3b16d74e8c791860948f67c18099f))
* **typescript:** tolerate fully-ignored staged files in lint-staged ([fb80327](https://github.com/CodySwannGT/lisa/commit/fb80327f63d5908592531e84ad947c5902844ead)), closes [acmeorgc/acmeorgd-frontend#20](https://github.com/acmeorgc/acmeorgd-frontend/issues/20)

### [2.195.1](https://github.com/CodySwannGT/lisa/compare/v2.195.0...v2.195.1) (2026-07-08)


### Bug Fixes

* **expo:** ship expo's generated include list in the tsconfig template ([9fefe76](https://github.com/CodySwannGT/lisa/commit/9fefe76d8793f0b4b83891a739f72f8837623dc6))
* **expo:** stop forcing EXPO_ATLAS=true in start scripts ([2bed3f1](https://github.com/CodySwannGT/lisa/commit/2bed3f198a594460f5190d31fb8ada3be9ffbaa6))

## [2.195.0](https://github.com/CodySwannGT/lisa/compare/v2.194.2...v2.195.0) (2026-07-08)


### Features

* **hooks:** add session-end sweep of stale agent worktrees ([7d74598](https://github.com/CodySwannGT/lisa/commit/7d745981e62ffb29d523d06489338d9afb6162dd))


### Bug Fixes

* **hooks:** treat failed git status as dirty in worktree cleanup sweep ([9ef972d](https://github.com/CodySwannGT/lisa/commit/9ef972d3ab97607f831ae6353529e1c85e59314a)), closes [#1473](https://github.com/CodySwannGT/lisa/issues/1473)

### [2.194.2](https://github.com/CodySwannGT/lisa/compare/v2.194.1...v2.194.2) (2026-07-07)


### Bug Fixes

* **ci:** scope node_modules cache by patch-package state and recognize bun.lock ([14ea30e](https://github.com/CodySwannGT/lisa/commit/14ea30e4f683d4c397d86c702c9b8405012c8ef6)), closes [acmeorgc/acmeorgd-frontend#3](https://github.com/acmeorgc/acmeorgd-frontend/issues/3)

### [2.194.1](https://github.com/CodySwannGT/lisa/compare/v2.194.0...v2.194.1) (2026-07-07)


### Bug Fixes

* **release:** expand release notes date and normalize v-prefix across strategies ([63c0c31](https://github.com/CodySwannGT/lisa/commit/63c0c31cf783fda5f40ebacd775a8b2d4fe04797))

## [2.194.0](https://github.com/CodySwannGT/lisa/compare/v2.193.0...v2.194.0) (2026-07-07)


### Features

* **expo:** support Expo SDK 57 / React Native 0.86 ([af14e58](https://github.com/CodySwannGT/lisa/commit/af14e581b2ebf1f558e4d8bcee15d2c4a651fa8a))

## [2.193.0](https://github.com/CodySwannGT/lisa/compare/v2.192.1...v2.193.0) (2026-07-06)


### Features

* **harper-fabric:** default type-declaration-immutability to ReadonlyDeep, not Immutable ([86fd1b0](https://github.com/CodySwannGT/lisa/commit/86fd1b0797d645a70898f7b3da80e94f28faec15))

### [2.192.1](https://github.com/CodySwannGT/lisa/compare/v2.192.0...v2.192.1) (2026-07-06)


### Bug Fixes

* **harper-fabric:** protect all root-level compiled harper-app modules ([4894fd2](https://github.com/CodySwannGT/lisa/commit/4894fd21cdd0be3ca399b53952f03de7ff214682))

## [2.192.0](https://github.com/CodySwannGT/lisa/compare/v2.191.14...v2.192.0) (2026-07-06)


### Features

* **harper-fabric:** enforce empirically-verified Harper best practices ([913a4ce](https://github.com/CodySwannGT/lisa/commit/913a4ce7ee77f0c87a1029bb45d7e88c2d2ac267))

### [2.191.14](https://github.com/CodySwannGT/lisa/compare/v2.191.13...v2.191.14) (2026-07-06)

### [2.191.13](https://github.com/CodySwannGT/lisa/compare/v2.191.12...v2.191.13) (2026-07-06)


### Bug Fixes

* **harper-fabric:** make the ZAP report dir writable by the container user ([7061136](https://github.com/CodySwannGT/lisa/commit/706113608ddd80dced5158ec0cb89c2dd1b13e88)), closes [#9](https://github.com/CodySwannGT/lisa/issues/9)

### [2.191.12](https://github.com/CodySwannGT/lisa/compare/v2.191.11...v2.191.12) (2026-07-06)


### Bug Fixes

* **harper-fabric:** honor WARN policy and fix duplicate ZAP mount ([779d5ad](https://github.com/CodySwannGT/lisa/commit/779d5ad2882ecfc4a372dc297f2726c7678e8978))

### [2.191.11](https://github.com/CodySwannGT/lisa/compare/v2.191.10...v2.191.11) (2026-07-06)


### Bug Fixes

* **eslint:** add checkRequiredComponentFiles opt-out to enforce-component-structure ([f4f175e](https://github.com/CodySwannGT/lisa/commit/f4f175ea8886a06ae987dab3a9e42c88d8597255))

### [2.191.10](https://github.com/CodySwannGT/lisa/compare/v2.191.9...v2.191.10) (2026-07-06)


### Bug Fixes

* **harper-fabric:** start Harper via install+component+start in zap-baseline.sh ([9f25e27](https://github.com/CodySwannGT/lisa/commit/9f25e27813b85e9a1931cc918c4835145eb29b77)), closes [#1462](https://github.com/CodySwannGT/lisa/issues/1462) [#9](https://github.com/CodySwannGT/lisa/issues/9)

### [2.191.9](https://github.com/CodySwannGT/lisa/compare/v2.191.8...v2.191.9) (2026-07-06)


### Bug Fixes

* **harper-fabric:** answer the HarperDB destination prompt in zap-baseline.sh ([ac741a7](https://github.com/CodySwannGT/lisa/commit/ac741a76adcd0f830e45e6ad6d5b0d61831ac6c4)), closes [#1460](https://github.com/CodySwannGT/lisa/issues/1460) [#9](https://github.com/CodySwannGT/lisa/issues/9)

### [2.191.8](https://github.com/CodySwannGT/lisa/compare/v2.191.7...v2.191.8) (2026-07-06)


### Bug Fixes

* **typescript:** group regex alternatives in check-verification-coverage ([2bc89f7](https://github.com/CodySwannGT/lisa/commit/2bc89f751776aca4e3e0f7900eb560c2f7ba8d99)), closes [#259](https://github.com/CodySwannGT/lisa/issues/259)

### [2.191.7](https://github.com/CodySwannGT/lisa/compare/v2.191.6...v2.191.7) (2026-07-06)


### Bug Fixes

* **cdk:** use $esbuild self-reference for the esbuild override ([3579957](https://github.com/CodySwannGT/lisa/commit/3579957db33b2b899718ade8c05b51068ae586ee))
* **harper-fabric:** auto-accept HarperDB T&C in zap-baseline.sh ([089e526](https://github.com/CodySwannGT/lisa/commit/089e5262d07cd94128b3e43ab5314b581b83c25e))

### [2.191.6](https://github.com/CodySwannGT/lisa/compare/v2.191.5...v2.191.6) (2026-07-06)


### Bug Fixes

* **eslint:** treat super() as constructor prologue in enforce-statement-order ([d2a498a](https://github.com/CodySwannGT/lisa/commit/d2a498ac9b80b4b3566e10f0ac783535f12a8acd))

### [2.191.5](https://github.com/CodySwannGT/lisa/compare/v2.191.4...v2.191.5) (2026-07-06)


### Bug Fixes

* **eslint:** disable enforce-statement-order in shared test-file override ([20e28e5](https://github.com/CodySwannGT/lisa/commit/20e28e52e1d3792b8ffdd41e58bc4a2e7ef80959))

### [2.191.4](https://github.com/CodySwannGT/lisa/compare/v2.191.3...v2.191.4) (2026-07-06)


### Bug Fixes

* **cdk:** keep eslint.cdk.ts template within its own max-lines-per-function limit ([6f15815](https://github.com/CodySwannGT/lisa/commit/6f158154582181f7c6dfbdc920fb39a200a6d17e))

### [2.191.3](https://github.com/CodySwannGT/lisa/compare/v2.191.2...v2.191.3) (2026-07-06)


### Bug Fixes

* **security:** allowlist historical $SONAR_TOKEN gitleaks false positives ([85e7d9a](https://github.com/CodySwannGT/lisa/commit/85e7d9addf1c512c66cc9b3b3af0138e8ae2cdb8)), closes [#1418](https://github.com/CodySwannGT/lisa/issues/1418) [#1418](https://github.com/CodySwannGT/lisa/issues/1418)
* **tests:** keep plugin-sync fixture repo hermetic under git hooks ([1ebb51c](https://github.com/CodySwannGT/lisa/commit/1ebb51c72ee02571e768a85906a16faaefbf2052))

### [2.191.2](https://github.com/CodySwannGT/lisa/compare/v2.191.1...v2.191.2) (2026-07-06)


### Bug Fixes

* guard auto-merge against stale PR heads ([ec118d6](https://github.com/CodySwannGT/lisa/commit/ec118d6e3e82bf6754939e83fb7c1bf8baf485c5))

### [2.191.1](https://github.com/CodySwannGT/lisa/compare/v2.191.0...v2.191.1) (2026-07-06)

## [2.191.0](https://github.com/CodySwannGT/lisa/compare/v2.190.5...v2.191.0) (2026-07-05)


### Features

* **expo:** add official Maestro MCP server to the expo plugin ([b12d5d3](https://github.com/CodySwannGT/lisa/commit/b12d5d3ec90a8852c5794e7632c47821ed6fc133))


### Bug Fixes

* **postinstall:** skip hyphenated npm_package_* names in env sanitize ([b1740d5](https://github.com/CodySwannGT/lisa/commit/b1740d528786a7c3819db998a3d876bfc7efe502))

### [2.190.5](https://github.com/CodySwannGT/lisa/compare/v2.190.4...v2.190.5) (2026-07-05)


### Bug Fixes

* widen plugins sync trigger paths ([a9e89a1](https://github.com/CodySwannGT/lisa/commit/a9e89a18a68ff2e3fae7a27272080b916b0f140c))

### [2.190.4](https://github.com/CodySwannGT/lisa/compare/v2.190.3...v2.190.4) (2026-07-05)


### Bug Fixes

* catch plugin artifact additions and deletions ([bf47fba](https://github.com/CodySwannGT/lisa/commit/bf47fbaeea83476161c88786870590c0ce361008))

### [2.190.3](https://github.com/CodySwannGT/lisa/compare/v2.190.2...v2.190.3) (2026-07-05)


### Bug Fixes

* emit Claude hook context envelope for rules ([d2fa559](https://github.com/CodySwannGT/lisa/commit/d2fa559c077d84d6de02c09f3047608e98863a80))

### [2.190.2](https://github.com/CodySwannGT/lisa/compare/v2.190.1...v2.190.2) (2026-07-05)


### Bug Fixes

* return blocking hook findings to claude ([fa70fc1](https://github.com/CodySwannGT/lisa/commit/fa70fc175c9a0817509ed4337f52bfc242d6ce54))

### [2.190.1](https://github.com/CodySwannGT/lisa/compare/v2.190.0...v2.190.1) (2026-07-05)


### Bug Fixes

* ship ast-grep rules in stack templates ([ba1c2c0](https://github.com/CodySwannGT/lisa/commit/ba1c2c03e2d94d9a1ec16516c70fb705e3dc696f))

## [2.190.0](https://github.com/CodySwannGT/lisa/compare/v2.189.23...v2.190.0) (2026-07-05)


### Features

* **phaser:** asset-sourcing skill + art-debt guardrails ([32fb925](https://github.com/CodySwannGT/lisa/commit/32fb925db474132ad5c9d7afe8a52172f56e058e)), closes [#7](https://github.com/CodySwannGT/lisa/issues/7)


### Bug Fixes

* **phaser:** address CodeRabbit review on asset guardrails ([c31bae8](https://github.com/CodySwannGT/lisa/commit/c31bae85ee09bafda40adebc0a23448f00296250))


### Documentation

* **phaser:** narrow contract-test guarantee to atlas-derived frame names ([25e48d8](https://github.com/CodySwannGT/lisa/commit/25e48d8b1e69732edef8895784c114a8929907cc)), closes [#1445](https://github.com/CodySwannGT/lisa/issues/1445)

### [2.189.23](https://github.com/CodySwannGT/lisa/compare/v2.189.22...v2.189.23) (2026-07-05)


### Bug Fixes

* install husky after successful prepare build ([b5f459e](https://github.com/CodySwannGT/lisa/commit/b5f459ef160be6c781fa976df1b6bddc76323f1c))

### [2.189.22](https://github.com/CodySwannGT/lisa/compare/v2.189.21...v2.189.22) (2026-07-05)


### Bug Fixes

* remove rails tired boss prompt hook ([da5fbff](https://github.com/CodySwannGT/lisa/commit/da5fbffa39a135ad325de8dc54795eef24dcd668))

### [2.189.21](https://github.com/CodySwannGT/lisa/compare/v2.189.20...v2.189.21) (2026-07-05)


### Bug Fixes

* preserve arrays in merge strategy ([66c6d96](https://github.com/CodySwannGT/lisa/commit/66c6d9621760392f1e73c0abbff8d49a10b7612a))
* use structural equality when deduping merged JSON arrays ([ad7a395](https://github.com/CodySwannGT/lisa/commit/ad7a395fb40d63831c62404428dad1c749e441b9)), closes [#1444](https://github.com/CodySwannGT/lisa/issues/1444)

### [2.189.20](https://github.com/CodySwannGT/lisa/compare/v2.189.19...v2.189.20) (2026-07-05)


### Bug Fixes

* handle pnpm postinstall script paths ([bdb8d68](https://github.com/CodySwannGT/lisa/commit/bdb8d68f46d632452053c0b4226c8fcba1873405))
* make postinstall root detection project-local ([2728986](https://github.com/CodySwannGT/lisa/commit/27289865e8e65d39a2ee39f990f3656d7e53cf52))

### [2.189.19](https://github.com/CodySwannGT/lisa/compare/v2.189.18...v2.189.19) (2026-07-05)


### Bug Fixes

* harden failure workflow inputs ([e57a95d](https://github.com/CodySwannGT/lisa/commit/e57a95d63c4cd3290c12132b6630f74c9510eb48))

### [2.189.18](https://github.com/CodySwannGT/lisa/compare/vv2.189.17...v2.189.18) (2026-07-05)


### Bug Fixes

* normalize release tag version output ([ec5caa6](https://github.com/CodySwannGT/lisa/commit/ec5caa613b048b38dc8eebb27dba0434f50cdcb7))

### [2.189.17](https://github.com/CodySwannGT/lisa/compare/vv2.189.16...v2.189.17) (2026-07-05)


### Bug Fixes

* ship npm package template ([268c857](https://github.com/CodySwannGT/lisa/commit/268c85736b94f53512bfc67b0584eb1a3bd6b1b8))

### [2.189.16](https://github.com/CodySwannGT/lisa/compare/vv2.189.15...v2.189.16) (2026-07-05)


### Bug Fixes

* avoid ruleset counter errexit footgun ([5c3f51b](https://github.com/CodySwannGT/lisa/commit/5c3f51b84ab8373713ee225e3830e96c807a8e68))

### [2.189.15](https://github.com/CodySwannGT/lisa/compare/vv2.189.14...v2.189.15) (2026-07-05)


### Bug Fixes

* scope Phaser shutdown cleanup rule to scenes ([f3b5d38](https://github.com/CodySwannGT/lisa/commit/f3b5d3868e34f5f13a8127f2aa1584de0ec5521c))

### [2.189.14](https://github.com/CodySwannGT/lisa/compare/vv2.189.13...v2.189.14) (2026-07-05)


### Bug Fixes

* address governance review feedback ([f993232](https://github.com/CodySwannGT/lisa/commit/f993232eedb9b85a9b9eca7d7d18b68e10de2f76))
* **governance:** align tracker and team instructions ([66a0997](https://github.com/CodySwannGT/lisa/commit/66a0997daf5b293b911185902f32517f99bae578))

### [2.189.13](https://github.com/CodySwannGT/lisa/compare/vv2.189.12...v2.189.13) (2026-07-05)


### Bug Fixes

* correct Codex and OpenCode plugin fanout ([2ac28b4](https://github.com/CodySwannGT/lisa/commit/2ac28b493adbc921af101f6c30f5ef8ab0d04da6))

### [2.189.12](https://github.com/CodySwannGT/lisa/compare/vv2.189.11...v2.189.12) (2026-07-05)


### Bug Fixes

* make every skill/command frontmatter load under strict agent loaders ([3076176](https://github.com/CodySwannGT/lisa/commit/307617648584dac8c0db62cc7102791ffe41f149))

### [2.189.11](https://github.com/CodySwannGT/lisa/compare/vv2.189.10...v2.189.11) (2026-07-05)


### Bug Fixes

* keep shared gitleaks ignore managed ([141203a](https://github.com/CodySwannGT/lisa/commit/141203a50e42db21c4a89cc073c456c6527972ec))
* preserve stack template host hygiene ([61e9b98](https://github.com/CodySwannGT/lisa/commit/61e9b987b19d711f454aa4c7cbefff2b787ea481))

### [2.189.10](https://github.com/CodySwannGT/lisa/compare/vv2.189.9...v2.189.10) (2026-07-05)


### Bug Fixes

* harden release workflow failure handling ([7cd9448](https://github.com/CodySwannGT/lisa/commit/7cd9448e46c2dc3c423a7a8e6e8082012b65563f))

### [2.189.9](https://github.com/CodySwannGT/lisa/compare/vv2.189.8...v2.189.9) (2026-07-05)


### Bug Fixes

* check statement order in all function bodies ([b250e59](https://github.com/CodySwannGT/lisa/commit/b250e598690257d8bdc025df1e02e5b56a872528))

### [2.189.8](https://github.com/CodySwannGT/lisa/compare/vv2.189.7...v2.189.8) (2026-07-04)


### Bug Fixes

* **plugins:** namespace Lisa commands and skills to prevent slash collisions ([e0856ed](https://github.com/CodySwannGT/lisa/commit/e0856edddc5fbac7d1f09aa44feaea2325a5c057))

### [2.189.7](https://github.com/CodySwannGT/lisa/compare/vv2.189.6...v2.189.7) (2026-07-04)


### Bug Fixes

* tighten eslint rule coverage ([667d83b](https://github.com/CodySwannGT/lisa/commit/667d83bdbff67637dd4684919bea4ba3d23082fe))

### [2.189.6](https://github.com/CodySwannGT/lisa/compare/vv2.189.5...v2.189.6) (2026-07-04)


### Bug Fixes

* **hooks:** keep install package output off stdout ([090b27b](https://github.com/CodySwannGT/lisa/commit/090b27bf3d683ae6e5c0e8767b128a4f9f2ccbd9))
* **hooks:** keep install package output off stdout ([a2b2378](https://github.com/CodySwannGT/lisa/commit/a2b2378b84ac858ae0c5914fbf58cc6f882ea10f))

### [2.189.5](https://github.com/CodySwannGT/lisa/compare/vv2.189.4...v2.189.5) (2026-07-04)


### Bug Fixes

* **hooks:** support OpenCode commit attribution ([eb7c256](https://github.com/CodySwannGT/lisa/commit/eb7c25686c93aa4938d824fd2c3ad4aad4771e06))

### [2.189.4](https://github.com/CodySwannGT/lisa/compare/vv2.189.3...v2.189.4) (2026-07-04)


### Bug Fixes

* **commands:** namespace Lisa command surfaces ([ab5caae](https://github.com/CodySwannGT/lisa/commit/ab5caae45ad96a30df287c6402ae2a145cb62a3d))

### [2.189.3](https://github.com/CodySwannGT/lisa/compare/vv2.189.2...v2.189.3) (2026-07-04)


### Bug Fixes

* address review feedback for cleanup ([b7deba2](https://github.com/CodySwannGT/lisa/commit/b7deba2c5e29dfc740332c8826dd9b9a2c6687a1))
* clean low-severity repo hygiene issues ([969482f](https://github.com/CodySwannGT/lisa/commit/969482f0707d039b7b9a9fbb3c6b3f98047ea8cf))

### [2.189.2](https://github.com/CodySwannGT/lisa/compare/vv2.189.1...v2.189.2) (2026-07-04)


### Bug Fixes

* **postinstall:** bootstrap Lisa self plugins safely ([d08abc5](https://github.com/CodySwannGT/lisa/commit/d08abc5eeccdde595a3388d32815ed95b86bd807))

### [2.189.1](https://github.com/CodySwannGT/lisa/compare/vv2.189.0...v2.189.1) (2026-07-04)


### Bug Fixes

* **ci:** accept vintage claude workflow package manager input ([9d0efe6](https://github.com/CodySwannGT/lisa/commit/9d0efe648a289b55adb6085f340dc9d59ee00b24))

## [2.189.0](https://github.com/CodySwannGT/lisa/compare/vv2.188.4...v2.189.0) (2026-07-04)


### Features

* **expo:** add Play Store access skill ([a04f6df](https://github.com/CodySwannGT/lisa/commit/a04f6df44dab895dda09c379293f2359de9bc0c2))


### Bug Fixes

* **expo:** recognize app.config.json in play-store-access Expo detection ([ff7d43f](https://github.com/CodySwannGT/lisa/commit/ff7d43fd5bd2b1b21d1793cd33834525074babba)), closes [#1422](https://github.com/CodySwannGT/lisa/issues/1422)

### [2.188.4](https://github.com/CodySwannGT/lisa/compare/vv2.188.3...v2.188.4) (2026-07-04)


### Bug Fixes

* **audit:** align ignore policy with current lockfile ([d6a97c7](https://github.com/CodySwannGT/lisa/commit/d6a97c74d7db37f8999d263b13cd3a67811616e8))

### [2.188.3](https://github.com/CodySwannGT/lisa/compare/vv2.188.2...v2.188.3) (2026-07-04)


### Documentation

* **readme:** align lifecycle prompt stage names with the pipeline list ([5ae7028](https://github.com/CodySwannGT/lisa/commit/5ae702862bfce365acd34d3bc842838fceef62ff)), closes [#1392](https://github.com/CodySwannGT/lisa/issues/1392)

### [2.188.2](https://github.com/CodySwannGT/lisa/compare/vv2.188.1...v2.188.2) (2026-07-04)


### Bug Fixes

* **cdk:** replace hardcoded AWS account IDs with per-environment secrets ([9ea1593](https://github.com/CodySwannGT/lisa/commit/9ea1593cbbf6ef168a7e17d2be88c690798c9748))


### Documentation

* **readme:** rewrite for dual human/agent audience with live-repo prompts ([8604667](https://github.com/CodySwannGT/lisa/commit/86046673b238b0fb94f839a311686e39990e55b9))

### [2.188.1](https://github.com/CodySwannGT/lisa/compare/vv2.188.0...v2.188.1) (2026-07-02)


### Bug Fixes

* **workflows:** fail EAS Build workflow when a queued remote build errors ([d6575af](https://github.com/CodySwannGT/lisa/commit/d6575afc281c48ac9b288fe96ca056a72128a473))

## [2.188.0](https://github.com/CodySwannGT/lisa/compare/vv2.187.4...v2.188.0) (2026-07-02)


### Features

* **skills:** global, product-type-aware exploratory-qa & product-walkthrough ([8092717](https://github.com/CodySwannGT/lisa/commit/8092717c2262dc2d5fa888347cbfb37611614608))

### [2.187.4](https://github.com/CodySwannGT/lisa/compare/vv2.187.3...v2.187.4) (2026-07-02)


### Bug Fixes

* clarify env base branch mapping fallback ([63ae590](https://github.com/CodySwannGT/lisa/commit/63ae590247933b49f11e2f422425e6bd115da6d8))
* restore env-base-branch fallback and clarify missing-mapping report ([b6be240](https://github.com/CodySwannGT/lisa/commit/b6be2403e540ba3a75b48efd8576b4bbe4193dfd)), closes [#1388](https://github.com/CodySwannGT/lisa/issues/1388)

### [2.187.3](https://github.com/CodySwannGT/lisa/compare/vv2.187.2...v2.187.3) (2026-07-02)


### Bug Fixes

* honor reported bug environments ([56d6dea](https://github.com/CodySwannGT/lisa/commit/56d6deaaf5f9b1bdbe791eeb243dba80d68f4d7f))

### [2.187.2](https://github.com/CodySwannGT/lisa/compare/vv2.187.1...v2.187.2) (2026-07-01)


### Bug Fixes

* avoid duplicate intake_mode=build in repair queue fallback ([879cf3d](https://github.com/CodySwannGT/lisa/commit/879cf3dc32a1b280752eac61548084f0d76286e6))
* repair-intake stale build coverage ([8bd0518](https://github.com/CodySwannGT/lisa/commit/8bd05181014a511eaf3621c18649bd0dafb4dda0))

### [2.187.1](https://github.com/CodySwannGT/lisa/compare/vv2.187.0...v2.187.1) (2026-07-01)


### Bug Fixes

* **ci:** scope the bun security audit to production deps ([5c2e3f0](https://github.com/CodySwannGT/lisa/commit/5c2e3f0bc2595e83e13a15a5d1e7e1c22182ba6d))

## [2.187.0](https://github.com/CodySwannGT/lisa/compare/vv2.186.12...v2.187.0) (2026-07-01)


### Features

* **phaser:** add game-development persona subagents ([a614a6d](https://github.com/CodySwannGT/lisa/commit/a614a6ded9e8d667bef57af88c4110c77e5ea169))

### [2.186.12](https://github.com/CodySwannGT/lisa/compare/vv2.186.11...v2.186.12) (2026-06-30)


### Bug Fixes

* **ci:** make Playwright quality job framework-aware; pin underscore in phaser starter ([04b1aff](https://github.com/CodySwannGT/lisa/commit/04b1affee1ad4d544505229e5ebe0c62d2cdc2d4))
* **phaser:** also pin minimist@^1.2.8 in starter template ([ff942f0](https://github.com/CodySwannGT/lisa/commit/ff942f0cae5ab7390054fa1dc983b46836e7a1de))

### [2.186.11](https://github.com/CodySwannGT/lisa/compare/vv2.186.10...v2.186.11) (2026-06-29)


### Bug Fixes

* **plugins:** harden worktree bootstrap + bound verification fetch ([836f366](https://github.com/CodySwannGT/lisa/commit/836f366c53978699d991d8dee39cb358a5a381e3)), closes [CodySwannGT/grist#166](https://github.com/CodySwannGT/grist/issues/166)

### [2.186.10](https://github.com/CodySwannGT/lisa/compare/vv2.186.9...v2.186.10) (2026-06-29)


### Bug Fixes

* **ci:** restore cross-repo verification gate wiring ([62d4272](https://github.com/CodySwannGT/lisa/commit/62d4272ad0a1a088f05a99d1c39e783150cb6c3b))

### [2.186.9](https://github.com/CodySwannGT/lisa/compare/vv2.186.8...v2.186.9) (2026-06-29)


### Bug Fixes

* **ci:** avoid implicit token in verification gate ([0b3f1fc](https://github.com/CodySwannGT/lisa/commit/0b3f1fc61fac04759ebec178fb482f1c16b49b64))

### [2.186.8](https://github.com/CodySwannGT/lisa/compare/vv2.186.7...v2.186.8) (2026-06-29)


### Bug Fixes

* **ci:** drop dynamic approval environment ([2976d64](https://github.com/CodySwannGT/lisa/commit/2976d6459664b58d5b921d831644213412ccf578))

### [2.186.7](https://github.com/CodySwannGT/lisa/compare/vv2.186.6...v2.186.7) (2026-06-29)


### Bug Fixes

* **ci:** remove reserved github env from sonar scan ([3baa870](https://github.com/CodySwannGT/lisa/commit/3baa8706cf176a09af0ef504032d2f1abacdd802))

### [2.186.6](https://github.com/CodySwannGT/lisa/compare/vv2.186.5...v2.186.6) (2026-06-29)


### Bug Fixes

* **ci:** use workflow token for sonar scan ([34d5ed3](https://github.com/CodySwannGT/lisa/commit/34d5ed3d3cf8b6e51a02e97d0899b3df7f5ad82f))

### [2.186.5](https://github.com/CodySwannGT/lisa/compare/vv2.186.4...v2.186.5) (2026-06-29)


### Bug Fixes

* **plugins:** address review — value-filter, retry-on-failure, name safety ([8bd004d](https://github.com/CodySwannGT/lisa/commit/8bd004dbdac5c9f73f2f71598cf501598b8fa614))
* **plugins:** load Lisa plugins/hooks in git worktree sessions ([49783f2](https://github.com/CodySwannGT/lisa/commit/49783f2f11eedecd3ba4795a7d8f8c494594e532)), closes [anthropics/claude-code#46808](https://github.com/anthropics/claude-code/issues/46808) [#36360](https://github.com/CodySwannGT/lisa/issues/36360)

### [2.186.4](https://github.com/CodySwannGT/lisa/compare/vv2.186.3...v2.186.4) (2026-06-29)


### Bug Fixes

* avoid reserved github env names in verification gate ([baa349e](https://github.com/CodySwannGT/lisa/commit/baa349eb91b28f7202e75d4a11bff349b1c1f4e6))

### [2.186.3](https://github.com/CodySwannGT/lisa/compare/vv2.186.2...v2.186.3) (2026-06-29)


### Bug Fixes

* rerun CI on PR label changes ([6301716](https://github.com/CodySwannGT/lisa/commit/6301716235c4f6ad75090b2def07d594e8cba9ae)), closes [#1370](https://github.com/CodySwannGT/lisa/issues/1370)

### [2.186.2](https://github.com/CodySwannGT/lisa/compare/vv2.186.1...v2.186.2) (2026-06-29)


### Bug Fixes

* read live labels for verification coverage ([c9f5341](https://github.com/CodySwannGT/lisa/commit/c9f534176663af33e54c6cd2eebbc6abce64689e)), closes [#1371](https://github.com/CodySwannGT/lisa/issues/1371)

### [2.186.1](https://github.com/CodySwannGT/lisa/compare/vv2.186.0...v2.186.1) (2026-06-28)


### Bug Fixes

* **codex:** stop committing the node_modules-pointing Codex marketplace ([dcc6c6a](https://github.com/CodySwannGT/lisa/commit/dcc6c6a9f7cbeefd7b8a3774940e06a0a59b39d3)), closes [#1366](https://github.com/CodySwannGT/lisa/issues/1366)
* **migration:** throw instead of noop when git rm --cached fails unexpectedly ([4285270](https://github.com/CodySwannGT/lisa/commit/4285270ad19648ff8146480152e3fac656ee0dcf))

## [2.186.0](https://github.com/CodySwannGT/lisa/compare/vv2.185.1...v2.186.0) (2026-06-28)


### Features

* **phaser:** mirror the verification (UAT) gate on pre-push ([8e60f6f](https://github.com/CodySwannGT/lisa/commit/8e60f6fbe97834475cb275d3b5a46a7e5b96f987)), closes [#1367](https://github.com/CodySwannGT/lisa/issues/1367)

### [2.185.1](https://github.com/CodySwannGT/lisa/compare/vv2.185.0...v2.185.1) (2026-06-27)


### Bug Fixes

* **typescript:** use endsWith in mutation script to satisfy oxlint ([cf14fd7](https://github.com/CodySwannGT/lisa/commit/cf14fd759764908a2ab2cf35797d2f04e28f5ad8))

## [2.185.0](https://github.com/CodySwannGT/lisa/compare/vv2.184.0...v2.185.0) (2026-06-27)


### Features

* **phaser:** enable lisa-wiki as the docs source for the phaser type ([b49234f](https://github.com/CodySwannGT/lisa/commit/b49234f3a2caad1662c02ef9785ac90dbd068c27))

## [2.184.0](https://github.com/CodySwannGT/lisa/compare/vv2.183.0...v2.184.0) (2026-06-27)


### Features

* **cli:** register phaser setup-type; lint app config files ([53defe6](https://github.com/CodySwannGT/lisa/commit/53defe6dd232db3432f61cce5b1bc31d75e2ebc9))

## [2.183.0](https://github.com/CodySwannGT/lisa/compare/vv2.182.0...v2.183.0) (2026-06-27)


### Features

* **phaser:** enforce verification (UAT) coverage in CI ([7c104df](https://github.com/CodySwannGT/lisa/commit/7c104dfaf511d80f5b2d6c53b4a450f22974f5e3))

## [2.182.0](https://github.com/CodySwannGT/lisa/compare/vv2.181.0...v2.182.0) (2026-06-27)


### Features

* **phaser:** bundler module resolution + Vite 8 idioms ([fff629e](https://github.com/CodySwannGT/lisa/commit/fff629e209c0250abbb8c0cb9ee6a00d0c8594e6))

## [2.181.0](https://github.com/CodySwannGT/lisa/compare/vv2.180.1...v2.181.0) (2026-06-27)


### Features

* **verification:** make verification (UAT) concrete and per-change enforced ([cd9ebdc](https://github.com/CodySwannGT/lisa/commit/cd9ebdcd62f3814090ce4984fcaf3b72daac903d))


### Bug Fixes

* **verification:** tighten coverage matcher + diff/log ranges; harden checkout ([b7ec49b](https://github.com/CodySwannGT/lisa/commit/b7ec49b2dc728b41fbbe9fb06fbfcbe0df5faa03)), closes [#1360](https://github.com/CodySwannGT/lisa/issues/1360)

### [2.180.1](https://github.com/CodySwannGT/lisa/compare/vv2.180.0...v2.180.1) (2026-06-27)


### Bug Fixes

* **strategies:** ship .gitignore via npm; align phaser vite override ([ef1aff2](https://github.com/CodySwannGT/lisa/commit/ef1aff29e79a6fb1a064aa794350c45f843f8887))

## [2.180.0](https://github.com/CodySwannGT/lisa/compare/vv2.179.0...v2.180.0) (2026-06-27)


### Features

* **phaser:** defer to Phaser's official skills + wire Editor MCP ([bea1ab4](https://github.com/CodySwannGT/lisa/commit/bea1ab47a18b7ea05b41dd2389148a9123de14c2))


### Bug Fixes

* **phaser:** align project-structure skill to Phaser v4.2 pin ([c27b083](https://github.com/CodySwannGT/lisa/commit/c27b08342eb5ff03e79bf7b5a6e500c114bf5b05)), closes [#1358](https://github.com/CodySwannGT/lisa/issues/1358)

## [2.179.0](https://github.com/CodySwannGT/lisa/compare/vv2.178.6...v2.179.0) (2026-06-27)


### Features

* **phaser:** enforce Phaser 4 best practices across lint, types, and skills ([7af6d13](https://github.com/CodySwannGT/lisa/commit/7af6d13c8ee1a43dd608d12b906cd1f17387b2c3))


### Bug Fixes

* **phaser:** scope per-frame/listener rules to Scenes; address review ([b50a3ca](https://github.com/CodySwannGT/lisa/commit/b50a3ca8b09632d9b4c933d7837e51b9e524cc37)), closes [#1357](https://github.com/CodySwannGT/lisa/issues/1357)

### [2.178.6](https://github.com/CodySwannGT/lisa/compare/vv2.178.5...v2.178.6) (2026-06-24)


### Bug Fixes

* document AWS headless remote substrate ([7ee7935](https://github.com/CodySwannGT/lisa/commit/7ee793578dbc9b24df55711524cde022f2d29123))

### [2.178.5](https://github.com/CodySwannGT/lisa/compare/vv2.178.4...v2.178.5) (2026-06-24)


### Bug Fixes

* **husky:** run pre-push in Claude remote ([bb806cd](https://github.com/CodySwannGT/lisa/commit/bb806cd94b36ccadbcc01598e5612996bb97f230)), closes [#1349](https://github.com/CodySwannGT/lisa/issues/1349)

### [2.178.4](https://github.com/CodySwannGT/lisa/compare/vv2.178.3...v2.178.4) (2026-06-24)


### Bug Fixes

* **hooks:** link node_modules in agent worktrees ([add08b4](https://github.com/CodySwannGT/lisa/commit/add08b409be75543851ca39ddabd1950ac0430c7))

### [2.178.3](https://github.com/CodySwannGT/lisa/compare/vv2.178.2...v2.178.3) (2026-06-24)


### Bug Fixes

* add sealed design system guards to Expo skills ([bba9a81](https://github.com/CodySwannGT/lisa/commit/bba9a81c668e228af9b421ee9d7ccb919e9ed708))
* **expo:** harden sealed design-system detection in validator scripts ([fb79493](https://github.com/CodySwannGT/lisa/commit/fb794939867b46d083a88cb80376db5ce2b5ce46)), closes [#1352](https://github.com/CodySwannGT/lisa/issues/1352)
* **expo:** relax sealed-design-system predicate and harden test path assertions ([e2cdfe2](https://github.com/CodySwannGT/lisa/commit/e2cdfe2044147d46591188a9fa18cd7cbce49164))

### [2.178.2](https://github.com/CodySwannGT/lisa/compare/vv2.178.1...v2.178.2) (2026-06-24)


### Bug Fixes

* **analyze-claude-remote:** update SonarCloud URL and strengthen Jam antipattern test ([a60eb42](https://github.com/CodySwannGT/lisa/commit/a60eb4259442760429e37a8b1aab5ea758164e25))
* **claude-remote:** detect mcp token substrates ([7a16149](https://github.com/CodySwannGT/lisa/commit/7a16149f5e6b83911246e0c7648d85c07138ceed))

### [2.178.1](https://github.com/CodySwannGT/lisa/compare/vv2.178.0...v2.178.1) (2026-06-24)


### Documentation

* **claude-remote:** encode routine platform network model ([934d66e](https://github.com/CodySwannGT/lisa/commit/934d66e36334b73df58adcf0199055e18fddc6c0))

## [2.178.0](https://github.com/CodySwannGT/lisa/compare/vv2.177.0...v2.178.0) (2026-06-24)


### Features

* **linear:** route consumers through access layer ([6c5c861](https://github.com/CodySwannGT/lisa/commit/6c5c8618e21ab6712b2112e6e3da85f091667c77))


### Bug Fixes

* standardize linear-access operation names to kebab-case ([46a8231](https://github.com/CodySwannGT/lisa/commit/46a8231a17bdc7931bdc365eb61b4b5f82487c51))

## [2.177.0](https://github.com/CodySwannGT/lisa/compare/vv2.176.12...v2.177.0) (2026-06-23)


### Features

* **integrations:** add headless access layers ([cf6557f](https://github.com/CodySwannGT/lisa/commit/cf6557f9dfe7479bcaaca54e2390d963bfce85be))


### Bug Fixes

* **codex:** preserve PostHog and SonarCloud brand-name capitalization in display_name ([70bee13](https://github.com/CodySwannGT/lisa/commit/70bee1316fd5289118f57614fd0866e507167e86)), closes [#1345](https://github.com/CodySwannGT/lisa/issues/1345)

### [2.176.12](https://github.com/CodySwannGT/lisa/compare/vv2.176.11...v2.176.12) (2026-06-23)


### Bug Fixes

* add Jira CLI config fallback ([a177e28](https://github.com/CodySwannGT/lisa/commit/a177e28a9e88c314c7922c567c2dc3aa42a35730))
* use strict https?:// regex in session bootstrap URL check ([ca4e6cd](https://github.com/CodySwannGT/lisa/commit/ca4e6cd66a10ae67d309858671b4bcb42b5cde55))

### [2.176.11](https://github.com/CodySwannGT/lisa/compare/vv2.176.10...v2.176.11) (2026-06-23)


### Bug Fixes

* **implement:** keep the Roster Decision gate after implicit-team migration ([3cb90e3](https://github.com/CodySwannGT/lisa/commit/3cb90e3545ccf2411430a88ad448e9cda625be7b))

### [2.176.10](https://github.com/CodySwannGT/lisa/compare/vv2.176.9...v2.176.10) (2026-06-22)


### Bug Fixes

* **agents:** draft missing spec content before blocking at the pre-flight gate ([adb7e64](https://github.com/CodySwannGT/lisa/commit/adb7e64f4f52d18c269c0685574e81327d8f6075))
* **agents:** respect .lisa.config.local.json override when resolving build labels in github-agent ([d08bbc5](https://github.com/CodySwannGT/lisa/commit/d08bbc5900698bf6872aa7219ede6d812b96ab01))

### [2.176.9](https://github.com/CodySwannGT/lisa/compare/vv2.176.8...v2.176.9) (2026-06-22)


### Bug Fixes

* **skills:** return delegation requests for build agents ([483bb07](https://github.com/CodySwannGT/lisa/commit/483bb07c3f70a55cd3fd9fcba4acf1cbbfba3a55))

### [2.176.8](https://github.com/CodySwannGT/lisa/compare/vv2.176.7...v2.176.8) (2026-06-21)


### Bug Fixes

* **skills:** repo-scope jira-build-intake query to skip sibling-repo tickets ([9780173](https://github.com/CodySwannGT/lisa/commit/9780173293c208c62e062dbfbb41e4f88a04ef23))

### [2.176.7](https://github.com/CodySwannGT/lisa/compare/vv2.176.6...v2.176.7) (2026-06-20)


### Bug Fixes

* **ci:** drop contradictory setup-node cache input that breaks npm ci ([8826521](https://github.com/CodySwannGT/lisa/commit/8826521e25467fdcdb03b975adb13635e613b8a9)), closes [#163](https://github.com/CodySwannGT/lisa/issues/163) [#165](https://github.com/CodySwannGT/lisa/issues/165)

### [2.176.6](https://github.com/CodySwannGT/lisa/compare/vv2.176.5...v2.176.6) (2026-06-20)


### Bug Fixes

* **package-lisa:** $name self-ref for direct-dep overrides (aws-cdk-lib, vite) ([0a446d0](https://github.com/CodySwannGT/lisa/commit/0a446d03f3223feb954dbb6dc2c7c3a89da670f0)), closes [#1330](https://github.com/CodySwannGT/lisa/issues/1330) [#1330](https://github.com/CodySwannGT/lisa/issues/1330)

### [2.176.5](https://github.com/CodySwannGT/lisa/compare/vv2.176.4...v2.176.5) (2026-06-20)


### Bug Fixes

* **ci:** bust poisoned node_modules cache and align forced vite floor ([295858c](https://github.com/CodySwannGT/lisa/commit/295858c242e0293b6c976618536d191a59aedfd2))

### [2.176.4](https://github.com/CodySwannGT/lisa/compare/vv2.176.3...v2.176.4) (2026-06-20)

### [2.176.3](https://github.com/CodySwannGT/lisa/compare/vv2.176.2...v2.176.3) (2026-06-20)


### Bug Fixes

* **skills:** gate branch updates on strict checks ([b8da59e](https://github.com/CodySwannGT/lisa/commit/b8da59e1e406eee84ed28a043c16c12371b162d9)), closes [#1327](https://github.com/CodySwannGT/lisa/issues/1327)

### [2.176.2](https://github.com/CodySwannGT/lisa/compare/vv2.176.1...v2.176.2) (2026-06-20)


### Bug Fixes

* **security:** force-bump undici and multer in TS package governance ([1c2422f](https://github.com/CodySwannGT/lisa/commit/1c2422f9df9651c528072266bee63d4c78d26571))

### [2.176.1](https://github.com/CodySwannGT/lisa/compare/vv2.176.0...v2.176.1) (2026-06-20)


### Bug Fixes

* **apply:** stop copy-contents from duplicating markerless managed files ([0d622d7](https://github.com/CodySwannGT/lisa/commit/0d622d7517e2d48ec04989e79d4b934c4d2c2460))

## [2.176.0](https://github.com/CodySwannGT/lisa/compare/vv2.175.3...v2.176.0) (2026-06-20)


### Features

* **rules:** add upstream-to-lisa rule for host-project agents ([50ae92c](https://github.com/CodySwannGT/lisa/commit/50ae92c3609979ccf72dc25ef0effdd99b16fe67))

### [2.175.3](https://github.com/CodySwannGT/lisa/compare/vv2.175.2...v2.175.3) (2026-06-20)


### Bug Fixes

* **rules:** make security-audit remediation autonomous via decision ladder ([5420223](https://github.com/CodySwannGT/lisa/commit/54202239232e854bb80a2dacbcc759a13b77dfbd))


### Documentation

* **migrations:** clarify reason field is policy-enforced, not code-validated ([96941a8](https://github.com/CodySwannGT/lisa/commit/96941a8422ad634346aa08c4063f2a08190b02b2))

### [2.175.2](https://github.com/CodySwannGT/lisa/compare/vv2.175.1...v2.175.2) (2026-06-20)


### Bug Fixes

* honor bun audit allowlist ([7bd3fcf](https://github.com/CodySwannGT/lisa/commit/7bd3fcf3c178145eb25448aee510ca036334b71a)), closes [#1322](https://github.com/CodySwannGT/lisa/issues/1322)

### [2.175.1](https://github.com/CodySwannGT/lisa/compare/vv2.175.0...v2.175.1) (2026-06-20)


### Bug Fixes

* **ci:** pass Bun audit ignore flags with equals ([39f81a8](https://github.com/CodySwannGT/lisa/commit/39f81a8fbacb83b9f2b95b9402afdc382e1af8fc))

## [2.175.0](https://github.com/CodySwannGT/lisa/compare/vv2.174.1...v2.175.0) (2026-06-19)


### Features

* **monitor:** add observability audit + build-ready ticket filing ([04ebbcd](https://github.com/CodySwannGT/lisa/commit/04ebbcd1e87e09a897b8c12183f4fc71d90f6491))

### [2.174.1](https://github.com/CodySwannGT/lisa/compare/vv2.174.0...v2.174.1) (2026-06-19)


### Bug Fixes

* **intake:** close duplicate already fixed tickets ([ccc1fde](https://github.com/CodySwannGT/lisa/commit/ccc1fdedcfed54dba86405b4421255ec97655e41))

## [2.174.0](https://github.com/CodySwannGT/lisa/compare/vv2.173.3...v2.174.0) (2026-06-19)


### Features

* **quality:** add opt-in concurrency_group input to mutex cross-run E2E ([72160cc](https://github.com/CodySwannGT/lisa/commit/72160ccfc0b47e694e616f3cbba75b1620ef456f))

### [2.173.3](https://github.com/CodySwannGT/lisa/compare/vv2.173.2...v2.173.3) (2026-06-18)


### Bug Fixes

* **qa:** require browser interaction for exploratory QA ([52b6431](https://github.com/CodySwannGT/lisa/commit/52b6431ed6edb850e2e340c14b4e7496e297a151)), closes [#1314](https://github.com/CodySwannGT/lisa/issues/1314)

### [2.173.2](https://github.com/CodySwannGT/lisa/compare/vv2.173.1...v2.173.2) (2026-06-18)


### Bug Fixes

* **jira:** bind ticket status transitions to config.jira.workflow; skip review hop when unconfigured ([2f14903](https://github.com/CodySwannGT/lisa/commit/2f149034e798c77284e05f40bd6f3f0fad56916b))

### [2.173.1](https://github.com/CodySwannGT/lisa/compare/vv2.173.0...v2.173.1) (2026-06-17)


### Bug Fixes

* **enforce-team-first:** accept implicit-team Agent spawn (Claude Code >= 2.1.178) ([93db633](https://github.com/CodySwannGT/lisa/commit/93db6331c23c050f0e7eefa8fea90d98ce99322e))

## [2.173.0](https://github.com/CodySwannGT/lisa/compare/vv2.172.0...v2.173.0) (2026-06-17)


### Features

* **repair-intake:** try to resolve a true merge conflict before filing a fix ticket ([d1da19c](https://github.com/CodySwannGT/lisa/commit/d1da19c185dcd6e87d9dcbddf65f92c25c56cf88)), closes [#1308](https://github.com/CodySwannGT/lisa/issues/1308)

## [2.172.0](https://github.com/CodySwannGT/lisa/compare/vv2.171.6...v2.172.0) (2026-06-17)


### Features

* **build-intake:** assign an unassigned claimed item to the authenticated user ([6bfd964](https://github.com/CodySwannGT/lisa/commit/6bfd964f171768cd51b02f216060783fad18514b))

### [2.171.6](https://github.com/CodySwannGT/lisa/compare/vv2.171.5...v2.171.6) (2026-06-17)


### Bug Fixes

* **implement:** fill fillable gaps, then file+link a dependency ticket before a blocked exit ([329de88](https://github.com/CodySwannGT/lisa/commit/329de886cc78435f7a43dbca2e49f63b7500a52d))

### [2.171.5](https://github.com/CodySwannGT/lisa/compare/vv2.171.4...v2.171.5) (2026-06-16)


### Bug Fixes

* **cdk:** deliver aws-cdk-lib >=2.246.0 via overrides + bump aws-cdk CLI to ^2.1127.0 (schema 53) ([0c720f2](https://github.com/CodySwannGT/lisa/commit/0c720f2a60d6bdf302e97ab2fe75b538caa044aa))
* **typescript:** force-pin form-data >=4.0.6 (GHSA-hmw2-7cc7-3qxx) ([500a6c5](https://github.com/CodySwannGT/lisa/commit/500a6c57269413b6445d2e0e1da4056e5a281b4a))

### [2.171.4](https://github.com/CodySwannGT/lisa/compare/vv2.171.3...v2.171.4) (2026-06-16)


### Bug Fixes

* **package-lisa:** apply security pins under skip-git-check; bump ws/aws-cdk-lib ([6fae359](https://github.com/CodySwannGT/lisa/commit/6fae3596111393c7be5ac6e938317968b373433e))

### [2.171.3](https://github.com/CodySwannGT/lisa/compare/vv2.171.2...v2.171.3) (2026-06-16)


### Bug Fixes

* **release:** align vite npm override ([bb379e8](https://github.com/CodySwannGT/lisa/commit/bb379e824fbd6054404a9cf1da22e5277b777754)), closes [#1304](https://github.com/CodySwannGT/lisa/issues/1304)

### [2.171.2](https://github.com/CodySwannGT/lisa/compare/vv2.171.1...v2.171.2) (2026-06-16)


### Bug Fixes

* **governance:** mirror lodash floor into TypeScript package.lisa.json force blocks ([661cc25](https://github.com/CodySwannGT/lisa/commit/661cc25ab4b1e19a700be6f27db46fb559bc47d7))

### [2.171.1](https://github.com/CodySwannGT/lisa/compare/vv2.171.0...v2.171.1) (2026-06-16)


### Bug Fixes

* **pm:** add bun.lockb detection and jq guard to generated script skeleton ([3ce1ab7](https://github.com/CodySwannGT/lisa/commit/3ce1ab731faadad09943e1e206765e77f9512f2b))
* **pm:** detect & respect project package manager; scope bun audit to prod (SE-5221) ([7f3993e](https://github.com/CodySwannGT/lisa/commit/7f3993e094e1291f9786b67561ebdf7921ac0485))

## [2.171.0](https://github.com/CodySwannGT/lisa/compare/vv2.170.0...v2.171.0) (2026-06-16)


### Features

* **harper-fabric:** add caching skill ([3f22fd6](https://github.com/CodySwannGT/lisa/commit/3f22fd61354ce3880ff3c265d26f82418039784e))


### Bug Fixes

* **harper-fabric:** add missing id parameter to allowStaleWhileRevalidate example ([b604e3c](https://github.com/CodySwannGT/lisa/commit/b604e3cd917d0ce8d12e009529b366910520aa1a))

## [2.170.0](https://github.com/CodySwannGT/lisa/compare/vv2.169.0...v2.170.0) (2026-06-16)


### Features

* **harper-fabric:** add harper auth skill ([8acac03](https://github.com/CodySwannGT/lisa/commit/8acac03dc5ebd842ce1e42c8e961ccd61145fbea))


### Bug Fixes

* **harper-auth:** correct refresh_operation_token API usage and static method signatures ([d5bb0f7](https://github.com/CodySwannGT/lisa/commit/d5bb0f788578894a6e7f59c83b0ff99e67709a96))

## [2.169.0](https://github.com/CodySwannGT/lisa/compare/vv2.168.0...v2.169.0) (2026-06-16)


### Features

* **harper-fabric:** add operations skill ([b52f8c9](https://github.com/CodySwannGT/lisa/commit/b52f8c9e4e0fc813b61860656fddb936a6172b60))


### Bug Fixes

* **harper-operations:** correct API documentation errors in SKILL.md ([837c3aa](https://github.com/CodySwannGT/lisa/commit/837c3aa0f57035bbb1511c9aad4ebda915a208b7))

## [2.168.0](https://github.com/CodySwannGT/lisa/compare/vv2.167.0...v2.168.0) (2026-06-15)


### Features

* **harper-fabric:** add REST query skill ([710df8c](https://github.com/CodySwannGT/lisa/commit/710df8c7be88e00d8763d5a20e534ce4a96687c8))


### Bug Fixes

* **harper-rest-queries:** normalize URL path casing and fix malformed range example ([53061a6](https://github.com/CodySwannGT/lisa/commit/53061a6699f2a1b551c7b69536c3a38d8718f52f))

## [2.167.0](https://github.com/CodySwannGT/lisa/compare/vv2.166.5...v2.167.0) (2026-06-15)


### Features

* **harper-fabric:** add testing skill ([e63e84d](https://github.com/CodySwannGT/lisa/commit/e63e84d5c637d87906d73a914af260598f8a87c7))

### [2.166.5](https://github.com/CodySwannGT/lisa/compare/vv2.166.4...v2.166.5) (2026-06-15)


### Documentation

* pin Harper schema guidance ([8940a1a](https://github.com/CodySwannGT/lisa/commit/8940a1a27f796ca3a62b4508d9a7f4af793c59ad))

### [2.166.4](https://github.com/CodySwannGT/lisa/compare/vv2.166.3...v2.166.4) (2026-06-15)


### Documentation

* deepen Harper config extension guidance ([77b945b](https://github.com/CodySwannGT/lisa/commit/77b945bd27e7c3eeb1dbdf4943b47503a5e27c08))

### [2.166.3](https://github.com/CodySwannGT/lisa/compare/vv2.166.2...v2.166.3) (2026-06-15)


### Documentation

* document Harper Fabric build deploy semantics ([fdaef46](https://github.com/CodySwannGT/lisa/commit/fdaef46caa0261f5ddef9d206c0aafc4e44357a6))

### [2.166.2](https://github.com/CodySwannGT/lisa/compare/vv2.166.1...v2.166.2) (2026-06-14)


### Bug Fixes

* **vitest:** make .claude/worktrees exclusion cwd-aware ([12d85fc](https://github.com/CodySwannGT/lisa/commit/12d85fca7ffd745ac86f19a5f3eeea3b23e55141))

### [2.166.1](https://github.com/CodySwannGT/lisa/compare/vv2.166.0...v2.166.1) (2026-06-14)


### Bug Fixes

* enforce fix-before-ignore hook policy ([e29095b](https://github.com/CodySwannGT/lisa/commit/e29095b0b3987210ff6880cbea886d462788dcc0))

## [2.166.0](https://github.com/CodySwannGT/lisa/compare/vv2.165.8...v2.166.0) (2026-06-14)


### Features

* **mutation-testing:** add configurable opt-in mutation gate for TS and Rails ([1345bd4](https://github.com/CodySwannGT/lisa/commit/1345bd4c6e04aec88b19a7268f027f7d82e2e3ef))

### [2.165.8](https://github.com/CodySwannGT/lisa/compare/vv2.165.7...v2.165.8) (2026-06-14)

### [2.165.7](https://github.com/CodySwannGT/lisa/compare/vv2.165.6...v2.165.7) (2026-06-14)


### Documentation

* **wiki:** ingest Lisa wiki state ([5fae1f3](https://github.com/CodySwannGT/lisa/commit/5fae1f38d4a0e6065f8ca97b3ee0035af2147f9e))

### [2.165.6](https://github.com/CodySwannGT/lisa/compare/vv2.165.5...v2.165.6) (2026-06-13)

### [2.165.5](https://github.com/CodySwannGT/lisa/compare/vv2.165.4...v2.165.5) (2026-06-13)


### Bug Fixes

* **security:** exclude esbuild GHSA-gv7w-rqvm-qjhr from audit ([61488cf](https://github.com/CodySwannGT/lisa/commit/61488cf1b3a9192c3b1a079a4a6e8aa578be521b))


### Documentation

* **wiki:** ingest Lisa wiki state ([8f1b9dc](https://github.com/CodySwannGT/lisa/commit/8f1b9dc94a6a9713f32a1b8f16a115db359595cb))

### [2.165.4](https://github.com/CodySwannGT/lisa/compare/vv2.165.3...v2.165.4) (2026-06-12)


### Bug Fixes

* **hooks:** allow lint-ignored edit files ([8fdb329](https://github.com/CodySwannGT/lisa/commit/8fdb329671f15bccf8a1443c4cd8f3b0be5bd122))

### [2.165.3](https://github.com/CodySwannGT/lisa/compare/vv2.165.2...v2.165.3) (2026-06-12)


### Bug Fixes

* **plugins:** ship hook scripts with the executable bit set ([47972fb](https://github.com/CodySwannGT/lisa/commit/47972fb0ba7e628179a425c488d334ac8f28e637))

### [2.165.2](https://github.com/CodySwannGT/lisa/compare/vv2.165.0...v2.165.2) (2026-06-12)


### Bug Fixes

* improve commit-msg hook diagnostics ([3030258](https://github.com/CodySwannGT/lisa/commit/303025817f07a31b207452b26b830f372e2b1f9f))


### Documentation

* **wiki:** ingest Lisa wiki state ([60a3d65](https://github.com/CodySwannGT/lisa/commit/60a3d650703c6f9f412e66cb6fc6e96ec4e5c1e9))
* **wiki:** remove machine-specific worktree path from wiki snapshot ([dadad5a](https://github.com/CodySwannGT/lisa/commit/dadad5af898a4f01ebf8fdda864f6df89feb7cac))

### [2.165.1](https://github.com/CodySwannGT/lisa/compare/vv2.165.0...v2.165.1) (2026-06-12)


### Documentation

* **wiki:** ingest Lisa wiki state ([60a3d65](https://github.com/CodySwannGT/lisa/commit/60a3d650703c6f9f412e66cb6fc6e96ec4e5c1e9))
* **wiki:** remove machine-specific worktree path from wiki snapshot ([dadad5a](https://github.com/CodySwannGT/lisa/commit/dadad5af898a4f01ebf8fdda864f6df89feb7cac))

## [2.165.0](https://github.com/CodySwannGT/lisa/compare/vv2.164.1...v2.165.0) (2026-06-12)


### Features

* **harper-fabric:** add realtime skill ([0b8e607](https://github.com/CodySwannGT/lisa/commit/0b8e607b9801934c65330be407c06c8814a301f2))

### [2.164.1](https://github.com/CodySwannGT/lisa/compare/vv2.164.0...v2.164.1) (2026-06-12)


### Bug Fixes

* **hooks:** use oxlint for edit-time lint ([589a1d2](https://github.com/CodySwannGT/lisa/commit/589a1d280945a0600920a5aaf3402179d98bb516))

## [2.164.0](https://github.com/CodySwannGT/lisa/compare/vv2.163.7...v2.164.0) (2026-06-12)


### Features

* **codex:** nudge on shell writes ([831b2e1](https://github.com/CodySwannGT/lisa/commit/831b2e14b95307768ce8e8d411ec615a85063a87))


### Bug Fixes

* **hooks:** catch plain tee writes and suppress read-only inline-runtime false positives ([6b8814d](https://github.com/CodySwannGT/lisa/commit/6b8814da7282666c053edf46ebf42bd06df5b6b3))

### [2.163.7](https://github.com/CodySwannGT/lisa/compare/vv2.163.6...v2.163.7) (2026-06-12)


### Bug Fixes

* **expo:** add shell-quote to knip ignoreDependencies template ([43acf3a](https://github.com/CodySwannGT/lisa/commit/43acf3a70e395154c11b6154bb3738dc22ded0cb)), closes [acmeorgb/frontend-v2#5256](https://github.com/acmeorgb/frontend-v2/issues/5256)

### [2.163.6](https://github.com/CodySwannGT/lisa/compare/vv2.163.5...v2.163.6) (2026-06-12)


### Documentation

* clarify sync-down conflict patterns ([603a392](https://github.com/CodySwannGT/lisa/commit/603a392b90aeba7f26c95cc10df873e2f02ca4f1))

### [2.163.5](https://github.com/CodySwannGT/lisa/compare/vv2.163.4...v2.163.5) (2026-06-11)


### Bug Fixes

* **hooks:** tokenize no-verify guard input ([37a7904](https://github.com/CodySwannGT/lisa/commit/37a790452c068e249c2963c107b4c2f5ef2e3031))

### [2.163.4](https://github.com/CodySwannGT/lisa/compare/vv2.163.3...v2.163.4) (2026-06-11)


### Bug Fixes

* guard bootstrapper in build contexts ([65be62b](https://github.com/CodySwannGT/lisa/commit/65be62b77941bae1c6d7acba5e57155e50b7e06c))

### [2.163.3](https://github.com/CodySwannGT/lisa/compare/vv2.163.2...v2.163.3) (2026-06-11)


### Bug Fixes

* **package-lisa:** rename knip script to knip:check and add remove section ([d72e351](https://github.com/CodySwannGT/lisa/commit/d72e351b6b591607c72b666fc449cdd7dbcec9af))

### [2.163.2](https://github.com/CodySwannGT/lisa/compare/vv2.163.1...v2.163.2) (2026-06-11)

### [2.163.1](https://github.com/CodySwannGT/lisa/compare/vv2.163.0...v2.163.1) (2026-06-11)


### Bug Fixes

* **husky:** make pre-push bun audit gate filter exclusions reliably ([a888871](https://github.com/CodySwannGT/lisa/commit/a8888713159715d498a3d641fe1a9db2e2cabb0d))

## [2.163.0](https://github.com/CodySwannGT/lisa/compare/vv2.162.0...v2.163.0) (2026-06-11)


### Features

* guard harper config extension drops ([5969713](https://github.com/CodySwannGT/lisa/commit/5969713b7fbdd2d3ff6c2c7a26e321e1e5ff141b))


### Bug Fixes

* handle malformed YAML in enforce-config-extensions hook ([e19be49](https://github.com/CodySwannGT/lisa/commit/e19be49496e5a85570094578e51e084e35e6b34a))

## [2.162.0](https://github.com/CodySwannGT/lisa/compare/vv2.161.0...v2.162.0) (2026-06-11)


### Features

* **phaser:** add Phaser 4 stack pack (plugin, templates, detection, lint enforcement) ([d9f8f68](https://github.com/CodySwannGT/lisa/commit/d9f8f683ef6a1bf660c3e768139217b7345a2bf0))


### Bug Fixes

* **phaser:** re-stamp plugin artifacts at v2.160.0 after main merge + clarify skill provenance ([28c5e59](https://github.com/CodySwannGT/lisa/commit/28c5e5915e97b3bad66ee862a064f6ae65969998))
* **phaser:** remove conflicting --check flag from format script ([149d402](https://github.com/CodySwannGT/lisa/commit/149d40275c561605a9953609755da99f26105266))

## [2.161.0](https://github.com/CodySwannGT/lisa/compare/vv2.160.0...v2.161.0) (2026-06-11)


### Features

* block harper generated artifact edits ([a0f0a18](https://github.com/CodySwannGT/lisa/commit/a0f0a18a81ff9be0c329a7efa0fe008df396331b))

## [2.160.0](https://github.com/CodySwannGT/lisa/compare/vv2.159.9...v2.160.0) (2026-06-11)


### Features

* add harper fabric deploy workflows ([e653373](https://github.com/CodySwannGT/lisa/commit/e6533735decb150d35167ea00789f0310cd79f76))

### [2.159.9](https://github.com/CodySwannGT/lisa/compare/vv2.159.8...v2.159.9) (2026-06-11)


### Bug Fixes

* **codex:** clarify repair intake default invocation ([ef5f0cc](https://github.com/CodySwannGT/lisa/commit/ef5f0cc5f8aed96588e6b3e690fcf7a07d544b69))
* **codex:** expose lisa repair intake skill ([84f8c63](https://github.com/CodySwannGT/lisa/commit/84f8c633afbeac200e9fe33c4cc138d4ba6ae75c))

### [2.159.8](https://github.com/CodySwannGT/lisa/compare/vv2.159.7...v2.159.8) (2026-06-11)


### Documentation

* **wiki:** ingest Lisa wiki state ([e518def](https://github.com/CodySwannGT/lisa/commit/e518def1436be93c793790b111b81387ed73db6f))

### [2.159.7](https://github.com/CodySwannGT/lisa/compare/vv2.159.6...v2.159.7) (2026-06-11)


### Bug Fixes

* preserve host config during postinstall apply ([2429738](https://github.com/CodySwannGT/lisa/commit/2429738b9e72ab89aaf81b71c6470cf13c0c2862))

### [2.159.6](https://github.com/CodySwannGT/lisa/compare/vv2.159.5...v2.159.6) (2026-06-10)


### Bug Fixes

* **skills:** require e2e regression execution proof ([0be769a](https://github.com/CodySwannGT/lisa/commit/0be769abc84673262a27a32ce1c197e1b5d0f256))

### [2.159.5](https://github.com/CodySwannGT/lisa/compare/vv2.159.4...v2.159.5) (2026-06-10)


### Bug Fixes

* require auditable implement rosters ([8acc0c9](https://github.com/CodySwannGT/lisa/commit/8acc0c9a2f1ab6ef6517d47d279451bad8c0897e))

### [2.159.4](https://github.com/CodySwannGT/lisa/compare/vv2.159.3...v2.159.4) (2026-06-10)


### Documentation

* **wiki:** ingest Lisa wiki state ([227aa7f](https://github.com/CodySwannGT/lisa/commit/227aa7f083904b43f90593d7ab254a6bc47cba32))

### [2.159.3](https://github.com/CodySwannGT/lisa/compare/vv2.159.2...v2.159.3) (2026-06-10)


### Bug Fixes

* block artifact-only verification without credentials ([29231d3](https://github.com/CodySwannGT/lisa/commit/29231d33a8cd81bba94860919a2298b63aff16c3))

### [2.159.2](https://github.com/CodySwannGT/lisa/compare/vv2.159.1...v2.159.2) (2026-06-10)


### Bug Fixes

* **atlassian-access:** bind jira writes to cloud id ([92817d3](https://github.com/CodySwannGT/lisa/commit/92817d3d036fbd3128675e506c7a51fdec96dd58))

### [2.159.1](https://github.com/CodySwannGT/lisa/compare/vv2.159.0...v2.159.1) (2026-06-10)


### Bug Fixes

* **atlassian-access:** reverify switched acli profile ([ac6c7dc](https://github.com/CodySwannGT/lisa/commit/ac6c7dcd4150d5ed9f5ffc64df21a9d5e7fd4473))

## [2.159.0](https://github.com/CodySwannGT/lisa/compare/vv2.158.3...v2.159.0) (2026-06-09)


### Features

* **apply:** declare wiki.source.path when a project has a local wiki ([05efab3](https://github.com/CodySwannGT/lisa/commit/05efab3b39dfa12be91cd1b1656248ae32e487a6))

### [2.158.3](https://github.com/CodySwannGT/lisa/compare/vv2.158.2...v2.158.3) (2026-06-09)


### Bug Fixes

* **safety-net:** portable line-continuation normalization in the push guard ([7d26a28](https://github.com/CodySwannGT/lisa/commit/7d26a28a294b15dfbbfa17aa776655771d725a7b))

### [2.158.2](https://github.com/CodySwannGT/lisa/compare/vv2.158.1...v2.158.2) (2026-06-09)


### Bug Fixes

* **safety-net:** correlate force-push guard to a single push statement ([c1fb296](https://github.com/CodySwannGT/lisa/commit/c1fb296a984ba550bb013708f1a55be28eff08b3))
* **safety-net:** normalize line-continuations before push guard segmentation ([62f8b81](https://github.com/CodySwannGT/lisa/commit/62f8b817c247502dc53bdf4485bb841c7dd061eb))

### [2.158.1](https://github.com/CodySwannGT/lisa/compare/vv2.158.0...v2.158.1) (2026-06-09)


### Bug Fixes

* **ci:** ignore no-config playwright aggregate abandonment ([ab733ac](https://github.com/CodySwannGT/lisa/commit/ab733ac6b0b9f302f8f60c864862787a7badcb16))

## [2.158.0](https://github.com/CodySwannGT/lisa/compare/vv2.157.1...v2.158.0) (2026-06-09)


### Features

* **apply:** exclude generated harness dirs from sonar.exclusions ([4f9a403](https://github.com/CodySwannGT/lisa/commit/4f9a4033c4cce86e46a50e27c8613e90ba2a41c4))

### [2.157.1](https://github.com/CodySwannGT/lisa/compare/vv2.157.0...v2.157.1) (2026-06-09)


### Bug Fixes

* **apply:** use node:fs/promises for fs reads/writes (Expo apply crash) ([3087e33](https://github.com/CodySwannGT/lisa/commit/3087e336e3884ea6f911d310bbbf596af0a53c8d))

## [2.157.0](https://github.com/CodySwannGT/lisa/compare/vv2.156.0...v2.157.0) (2026-06-09)


### Features

* **wiki:** add local wiki.source.path; unify local resolution ([d713aad](https://github.com/CodySwannGT/lisa/commit/d713aade546c6f40f379e2c4e01b520fb3e688bd))

## [2.156.0](https://github.com/CodySwannGT/lisa/compare/vv2.155.7...v2.156.0) (2026-06-09)


### Features

* **wiki:** resolve + mirror a remote wiki via ensure-wiki (read side) ([50ce32e](https://github.com/CodySwannGT/lisa/commit/50ce32e364a5c37a501e5de7f6b7f4943939579d))

### [2.155.7](https://github.com/CodySwannGT/lisa/compare/vv2.155.6...v2.155.7) (2026-06-09)


### Documentation

* **wiki:** ingest Lisa wiki state ([97f31c8](https://github.com/CodySwannGT/lisa/commit/97f31c824e023c33805d3d95efb45863802b1461))

### [2.155.6](https://github.com/CodySwannGT/lisa/compare/vv2.155.5...v2.155.6) (2026-06-09)


### Bug Fixes

* expand exploratory qa human experience checks ([13b67fe](https://github.com/CodySwannGT/lisa/commit/13b67feb6126563ea8371edfcf1b18a132e96730))

### [2.155.5](https://github.com/CodySwannGT/lisa/compare/vv2.155.4...v2.155.5) (2026-06-08)


### Bug Fixes

* **repair-intake:** align stale default in intake explain ([3e2e1a9](https://github.com/CodySwannGT/lisa/commit/3e2e1a9a6e32fe5aa41f1c6707ceaf9fa9a0fdfe))

### [2.155.4](https://github.com/CodySwannGT/lisa/compare/vv2.155.3...v2.155.4) (2026-06-08)


### Bug Fixes

* **typescript:** ignore .opencode overlay in eslint/prettier gates ([8c8bc51](https://github.com/CodySwannGT/lisa/commit/8c8bc5163969a2c595ae86d238ebb5f0f6edb2bb))

### [2.155.3](https://github.com/CodySwannGT/lisa/compare/vv2.155.2...v2.155.3) (2026-06-08)


### Bug Fixes

* **sync-down:** no-op chain when all deploy.branches collapse to one branch ([38ff0ac](https://github.com/CodySwannGT/lisa/commit/38ff0ace32b1937e82d5a498f8c405038d2869fd))

### [2.155.2](https://github.com/CodySwannGT/lisa/compare/vv2.155.1...v2.155.2) (2026-06-08)


### Bug Fixes

* **expo:** pin apollo-link-sentry to exactly 4.4.0 (Apollo v3 + Sentry v8) ([4f40ca8](https://github.com/CodySwannGT/lisa/commit/4f40ca8c9d1e2674a240a74b19f5803ebfabbdf6))

### [2.155.1](https://github.com/CodySwannGT/lisa/compare/vv2.155.0...v2.155.1) (2026-06-08)


### Bug Fixes

* relax automation dirty tree preflight ([d0c2246](https://github.com/CodySwannGT/lisa/commit/d0c224618a6739147bd362d9d66505e7dfcd5601))

## [2.155.0](https://github.com/CodySwannGT/lisa/compare/vv2.154.1...v2.155.0) (2026-06-08)


### Features

* **skills:** add /lisa:validate-tracker-mapping drift detector + repairer ([db8317e](https://github.com/CodySwannGT/lisa/commit/db8317e1cfcc6c13827ff9bb6732ce475362caf0))

### [2.154.1](https://github.com/CodySwannGT/lisa/compare/vv2.154.0...v2.154.1) (2026-06-08)


### Documentation

* **wiki:** ingest Lisa wiki state ([4dcdea5](https://github.com/CodySwannGT/lisa/commit/4dcdea572ca55e8a4303bdf6e2ffd3d23dedd3c1))

## [2.154.0](https://github.com/CodySwannGT/lisa/compare/vv2.153.0...v2.154.0) (2026-06-07)


### Features

* **cross-pollinate:** make local agent definitions available across the fleet ([6984a1f](https://github.com/CodySwannGT/lisa/commit/6984a1f8f703ce009bb51f9fb13fbac06527f95a))

## [2.153.0](https://github.com/CodySwannGT/lisa/compare/vv2.152.2...v2.153.0) (2026-06-07)


### Features

* **harness:** add "all" alias for fleet and remove legacy "both" ([c0978c9](https://github.com/CodySwannGT/lisa/commit/c0978c9fd73731ff2a0a36a282680a78d78a9965))

### [2.152.2](https://github.com/CodySwannGT/lisa/compare/vv2.152.1...v2.152.2) (2026-06-07)


### Bug Fixes

* **apply:** prune stale Lisa stack plugins from settings.json ([896e5d4](https://github.com/CodySwannGT/lisa/commit/896e5d44d9c995eb29bcab85354549a5a99c7f08))

### [2.152.1](https://github.com/CodySwannGT/lisa/compare/vv2.152.0...v2.152.1) (2026-06-07)


### Bug Fixes

* **codex:** exclude per-harness variant plugins from agent discovery ([326a785](https://github.com/CodySwannGT/lisa/commit/326a78572413a80d757164f31f101e2d4b831d15)), closes [#1203](https://github.com/CodySwannGT/lisa/issues/1203)
* **repair-intake:** recover merged-PR leaves staleness-exempt and before rollup ([96c9ace](https://github.com/CodySwannGT/lisa/commit/96c9ace05ea702a678dbbb155d1f1e032ae4b78f)), closes [#1171-1174](https://github.com/CodySwannGT/lisa/issues/1171-1174) [#707](https://github.com/CodySwannGT/lisa/issues/707)

## [2.152.0](https://github.com/CodySwannGT/lisa/compare/vv2.151.0...v2.152.0) (2026-06-07)


### Features

* **opencode:** port Lisa lifecycle hooks to OpenCode ([81d3716](https://github.com/CodySwannGT/lisa/commit/81d3716eaeaaa13a5ca86c32b6ffa2b783c777b4)), closes [#1197](https://github.com/CodySwannGT/lisa/issues/1197)

## [2.151.0](https://github.com/CodySwannGT/lisa/compare/vv2.150.1...v2.151.0) (2026-06-07)


### Features

* **opencode:** emit native agents and commands ([06532e2](https://github.com/CodySwannGT/lisa/commit/06532e24219748343a2fa776b89fd65a88752e3b)), closes [#1197](https://github.com/CodySwannGT/lisa/issues/1197)

### [2.150.1](https://github.com/CodySwannGT/lisa/compare/vv2.150.0...v2.150.1) (2026-06-07)


### Bug Fixes

* **repair-intake:** re-check deployed-verification blocks with same-context reproduction ([d5b8c8f](https://github.com/CodySwannGT/lisa/commit/d5b8c8f90b1fa36c6eecbc7581ad4e8ee2cba9eb))

## [2.150.0](https://github.com/CodySwannGT/lisa/compare/vv2.149.1...v2.150.0) (2026-06-07)


### Features

* **opencode:** add config-level settings + MCP wrap delivery ([1960a15](https://github.com/CodySwannGT/lisa/commit/1960a15fe6a242d2a47275c13ecd4f2b1becb1cc)), closes [#1197](https://github.com/CodySwannGT/lisa/issues/1197)

### [2.149.1](https://github.com/CodySwannGT/lisa/compare/vv2.149.0...v2.149.1) (2026-06-07)


### Bug Fixes

* **lifecycle:** roll parents up forward when a leaf reaches done ([f1078ff](https://github.com/CodySwannGT/lisa/commit/f1078ffc9b80a31216975791dd0695c14666e1c5)), closes [#963](https://github.com/CodySwannGT/lisa/issues/963) [#968](https://github.com/CodySwannGT/lisa/issues/968)

## [2.149.0](https://github.com/CodySwannGT/lisa/compare/vv2.148.0...v2.149.0) (2026-06-07)


### Features

* **opencode:** add OpenCode as a fleet coding-agent harness ([479c2a3](https://github.com/CodySwannGT/lisa/commit/479c2a37541af26568f73f217969955565b2fbd3))


### Bug Fixes

* **opencode:** harden manifest paths and clean-replace stale skill files ([385ccb2](https://github.com/CodySwannGT/lisa/commit/385ccb2435d3be38ad74be9a97c4336e2547baf9)), closes [#1197](https://github.com/CodySwannGT/lisa/issues/1197)

## [2.148.0](https://github.com/CodySwannGT/lisa/compare/vv2.147.7...v2.148.0) (2026-06-07)


### Features

* **migrations:** backfill AccessibilityManager RN mock ([ab056bb](https://github.com/CodySwannGT/lisa/commit/ab056bbb876a9ac11f859be962e35198d42f0539))


### Bug Fixes

* **expo:** align SDK 56 dependency templates ([363c0e5](https://github.com/CodySwannGT/lisa/commit/363c0e50de27dc50a1db4a27d054d3da90b9da37))

### [2.147.7](https://github.com/CodySwannGT/lisa/compare/vv2.147.6...v2.147.7) (2026-06-07)


### Bug Fixes

* **wiki:** support older Python UTC constants ([682a74a](https://github.com/CodySwannGT/lisa/commit/682a74aeee1b62dd9bcd410143180d2ff833e1c6))


### Documentation

* **openclaw:** note account-scoped topic route runtime requirement ([224b86d](https://github.com/CodySwannGT/lisa/commit/224b86d570da5dfd1b7ff0c0519529268adde18e))

### [2.147.6](https://github.com/CodySwannGT/lisa/compare/vv2.147.5...v2.147.6) (2026-06-07)


### Bug Fixes

* **repair-intake:** heal missing native sub-issue links on build Epics/Stories ([672b5f1](https://github.com/CodySwannGT/lisa/commit/672b5f15ddc8684e6380adff175edeaf688fae90))

### [2.147.5](https://github.com/CodySwannGT/lisa/compare/vv2.147.4...v2.147.5) (2026-06-07)


### Documentation

* **openclaw:** document account-scoped Telegram routes ([dbce9d3](https://github.com/CodySwannGT/lisa/commit/dbce9d313669577f3916cf67079e0d6159cb843e))

### [2.147.4](https://github.com/CodySwannGT/lisa/compare/vv2.147.3...v2.147.4) (2026-06-07)


### Bug Fixes

* **validate:** don't strand parentless build-ready leaf work units (S7) ([5164960](https://github.com/CodySwannGT/lisa/commit/5164960fd55a0eba9be2a4bff4dc4ebd40049fd2))

### [2.147.3](https://github.com/CodySwannGT/lisa/compare/vv2.147.2...v2.147.3) (2026-06-07)


### Documentation

* **wiki:** ingest Lisa wiki state ([6533c6e](https://github.com/CodySwannGT/lisa/commit/6533c6e5507460b89f3a1e4efcec266bf6bc1a1b))

### [2.147.2](https://github.com/CodySwannGT/lisa/compare/vv2.147.1...v2.147.2) (2026-06-07)


### Documentation

* **wiki:** add 2026-06-07 source notes to lisa-monorepo provenance ([c31c416](https://github.com/CodySwannGT/lisa/commit/c31c4160f977940ac29b229d745774fdc0c55fd4)), closes [#1188](https://github.com/CodySwannGT/lisa/issues/1188)
* **wiki:** ingest Lisa wiki state ([9eaefba](https://github.com/CodySwannGT/lisa/commit/9eaefbae9b258dca6936bc4f784241f2cb517f91))

### [2.147.1](https://github.com/CodySwannGT/lisa/compare/vv2.147.0...v2.147.1) (2026-06-07)


### Documentation

* **wiki:** ingest Lisa wiki state ([2b3d2ff](https://github.com/CodySwannGT/lisa/commit/2b3d2ffeed60a723728dc1d184610872699c9d95))

## [2.147.0](https://github.com/CodySwannGT/lisa/compare/vv2.146.1...v2.147.0) (2026-06-07)


### Features

* validate wiki redaction policy ([057f51b](https://github.com/CodySwannGT/lisa/commit/057f51b404af8e6f67706a9c97038ecd0dc6c3c9))


### Bug Fixes

* harden wiki redaction policy validation ([9af7adf](https://github.com/CodySwannGT/lisa/commit/9af7adfe95fc956fcf983a32ac5e27323ea989f0))

### [2.146.1](https://github.com/CodySwannGT/lisa/compare/vv2.146.0...v2.146.1) (2026-06-07)


### Bug Fixes

* **install:** use jq instead of grep to fingerprint legacy .safety-net.json ([135f658](https://github.com/CodySwannGT/lisa/commit/135f6584b2416ead8b89b9598739ffcc56a347eb))
* stop shipping legacy .safety-net.json incompatible with cc-safety-net 1.0.1 ([d6c67fd](https://github.com/CodySwannGT/lisa/commit/d6c67fdbed07c8edfd100fa2521bf619a30d9829))

## [2.146.0](https://github.com/CodySwannGT/lisa/compare/vv2.145.2...v2.146.0) (2026-06-07)


### Features

* **wiki:** sanitize connector source notes ([a45b203](https://github.com/CodySwannGT/lisa/commit/a45b203dab5cd73690d3600be7843cc95c36f672))

### [2.145.2](https://github.com/CodySwannGT/lisa/compare/vv2.145.1...v2.145.2) (2026-06-06)


### Bug Fixes

* **eslint:** ignore .lisa.config.json (config data, not source) ([1510913](https://github.com/CodySwannGT/lisa/commit/1510913664b727f8b35e6a88cd5b784cc510aaf7))

### [2.145.1](https://github.com/CodySwannGT/lisa/compare/vv2.145.0...v2.145.1) (2026-06-06)


### Bug Fixes

* **wiki:** require review for redacted ingests ([4f83645](https://github.com/CodySwannGT/lisa/commit/4f83645f473b8a4497f56e9f606729ab159bfce7))


### Documentation

* **wiki:** ingest Lisa wiki state ([a9974f9](https://github.com/CodySwannGT/lisa/commit/a9974f9eb87005992d9d4bce5f5b1ab740d96970))

## [2.145.0](https://github.com/CodySwannGT/lisa/compare/vv2.144.0...v2.145.0) (2026-06-06)


### Features

* **apply:** ensure every project has a .lisa.config.json ([248d46c](https://github.com/CodySwannGT/lisa/commit/248d46c8989ac9030562208c67498f623a4d59f0))

## [2.144.0](https://github.com/CodySwannGT/lisa/compare/vv2.143.2...v2.144.0) (2026-06-06)


### Features

* **wiki:** add generated output safety gate ([3e474da](https://github.com/CodySwannGT/lisa/commit/3e474dacb2f2994d5204cf88ff93ac0ab78a2140))

### [2.143.2](https://github.com/CodySwannGT/lisa/compare/vv2.143.1...v2.143.2) (2026-06-06)

### [2.143.1](https://github.com/CodySwannGT/lisa/compare/vv2.143.0...v2.143.1) (2026-06-06)


### Bug Fixes

* **repair-intake:** relink generated prd children ([f4530ae](https://github.com/CodySwannGT/lisa/commit/f4530ae10e050e2d0bab26e90ec8a7adaa39bdcf))

## [2.143.0](https://github.com/CodySwannGT/lisa/compare/vv2.142.3...v2.143.0) (2026-06-06)


### Features

* **wiki:** add deterministic safety sanitizer ([fc4f4eb](https://github.com/CodySwannGT/lisa/commit/fc4f4eb7dee82ff93bf64c84169e2e0ca7a4e98a))

### [2.142.3](https://github.com/CodySwannGT/lisa/compare/vv2.142.2...v2.142.3) (2026-06-06)


### Bug Fixes

* **repair-intake:** normalize unlabeled github issues ([907f926](https://github.com/CodySwannGT/lisa/commit/907f9263d8f263f19bf2d067daf4818c7675e5c6))

### [2.142.2](https://github.com/CodySwannGT/lisa/compare/vv2.142.1...v2.142.2) (2026-06-06)

### [2.142.1](https://github.com/CodySwannGT/lisa/compare/vv2.142.0...v2.142.1) (2026-06-06)


### Bug Fixes

* **vitest:** pass with no tests so source-less repos don't fail the gate ([88df474](https://github.com/CodySwannGT/lisa/commit/88df474eba593688a0f81a1b8fd4cc110df37b32))

## [2.142.0](https://github.com/CodySwannGT/lisa/compare/vv2.141.3...v2.142.0) (2026-06-06)


### Features

* **ci:** escalate unfixed deploy failures as build-ready tickets ([73da716](https://github.com/CodySwannGT/lisa/commit/73da716eeba57b0836aa6172b8fb8b5a88439f39)), closes [#922](https://github.com/CodySwannGT/lisa/issues/922)

### [2.141.3](https://github.com/CodySwannGT/lisa/compare/vv2.141.2...v2.141.3) (2026-06-06)


### Bug Fixes

* **tsconfig:** graceful typecheck posture for source-less repos ([87e5dad](https://github.com/CodySwannGT/lisa/commit/87e5dadad387be4da7ce195dc5df2fb7985cfe4f))

### [2.141.2](https://github.com/CodySwannGT/lisa/compare/vv2.141.1...v2.141.2) (2026-06-06)


### Bug Fixes

* **claude-remote:** don't tell users to re-enter committed settings.json env flags ([3b6edb8](https://github.com/CodySwannGT/lisa/commit/3b6edb85f049d9475ec8a0b091057a9ae7465cb0))


### Documentation

* **claude-remote:** capitalize GitHub in analyze-claude-remote prose example ([05e9a1c](https://github.com/CodySwannGT/lisa/commit/05e9a1c098c95fb6df753b85c532804a6437617e)), closes [#1158](https://github.com/CodySwannGT/lisa/issues/1158)

### [2.141.1](https://github.com/CodySwannGT/lisa/compare/vv2.141.0...v2.141.1) (2026-06-06)


### Bug Fixes

* **package-lisa:** govern @codyswann/lisa version via defaults, not force ([37b3483](https://github.com/CodySwannGT/lisa/commit/37b34831278c6f884d384f7892303e3e288aafdf))

## [2.141.0](https://github.com/CodySwannGT/lisa/compare/vv2.140.1...v2.141.0) (2026-06-06)


### Features

* **claude-remote:** resolve tracker/source credentials for headless routines ([9bbc950](https://github.com/CodySwannGT/lisa/commit/9bbc95074d935b2aab4142b56c1c8dc0c92af4af))

### [2.140.1](https://github.com/CodySwannGT/lisa/compare/vv2.140.0...v2.140.1) (2026-06-06)


### Documentation

* **wiki:** ingest Lisa wiki state ([46c20ee](https://github.com/CodySwannGT/lisa/commit/46c20ee4d20e72e04662e82404982d8e6fa2dde4))

## [2.140.0](https://github.com/CodySwannGT/lisa/compare/vv2.139.0...v2.140.0) (2026-06-06)


### Features

* **plugins:** derive sync-down chain from deploy.order + add /lisa:sync-down ([442e8c6](https://github.com/CodySwannGT/lisa/commit/442e8c63301d171e2febfdfdcb81cf46a4ce388b))


### Code Refactoring

* **plugins:** consolidate PR drive-to-merge and review-thread handling ([07f266b](https://github.com/CodySwannGT/lisa/commit/07f266b7f3a71c35b64788984a1117d1bd7303dc))

## [2.139.0](https://github.com/CodySwannGT/lisa/compare/vv2.138.2...v2.139.0) (2026-06-06)


### Features

* **instructions:** run the canonical-files migration during lisa apply ([4475d98](https://github.com/CodySwannGT/lisa/commit/4475d983045f06d1825e0c32974663cb9a70129f))

### [2.138.2](https://github.com/CodySwannGT/lisa/compare/vv2.138.1...v2.138.2) (2026-06-06)


### Documentation

* **wiki:** correct remaining agy-baking references for rule-free AGENTS.md ([39d7e93](https://github.com/CodySwannGT/lisa/commit/39d7e93fa3de90dda27068e43920ddec2f9c834b)), closes [#1150](https://github.com/CodySwannGT/lisa/issues/1150) [#1150](https://github.com/CodySwannGT/lisa/issues/1150)

### [2.138.1](https://github.com/CodySwannGT/lisa/compare/vv2.138.0...v2.138.1) (2026-06-06)


### Documentation

* **wiki:** correct agy rules story for canonical, rule-free AGENTS.md ([84c5286](https://github.com/CodySwannGT/lisa/commit/84c52869d5f3e80072c44fabdb15b4a2e0f790ba)), closes [#1150](https://github.com/CodySwannGT/lisa/issues/1150)

## [2.138.0](https://github.com/CodySwannGT/lisa/compare/vv2.137.3...v2.138.0) (2026-06-06)


### Features

* **instructions:** make AGENTS.md canonical, CLAUDE.md a pointer, add doctor migration ([afe8035](https://github.com/CodySwannGT/lisa/commit/afe803501ba73c0b69ad1b66c6e063297ffc1d2b))

### [2.137.3](https://github.com/CodySwannGT/lisa/compare/vv2.137.2...v2.137.3) (2026-06-06)


### Documentation

* **wiki:** ingest Lisa wiki state ([5ac9fc6](https://github.com/CodySwannGT/lisa/commit/5ac9fc6dab1ff271f10476b4446cd20f89f1043b))
* **wiki:** ingest Lisa wiki state ([cbb4436](https://github.com/CodySwannGT/lisa/commit/cbb443692628a851f8b48456b8a8a5de052c6120))

### [2.137.2](https://github.com/CodySwannGT/lisa/compare/vv2.137.1...v2.137.2) (2026-06-06)


### Documentation

* **wiki:** ingest Lisa wiki state ([55ea35d](https://github.com/CodySwannGT/lisa/commit/55ea35d301231c6187b4fc0139b292929263ff30))

### [2.137.1](https://github.com/CodySwannGT/lisa/compare/vv2.137.0...v2.137.1) (2026-06-05)


### Documentation

* **wiki:** ingest Lisa wiki state ([ef65c5f](https://github.com/CodySwannGT/lisa/commit/ef65c5fc808cab2d444d819dcdd3e7aebdb119e9))

## [2.137.0](https://github.com/CodySwannGT/lisa/compare/vv2.136.0...v2.137.0) (2026-06-05)


### Features

* **exploratory-qa:** add action-preconditions / incomplete-end-state category ([c8b93b8](https://github.com/CodySwannGT/lisa/commit/c8b93b835f8964c24902660f160af77e891d9b7f))


### Bug Fixes

* **test:** stop integration cli-smoke from racing the unit suite ([fc23edf](https://github.com/CodySwannGT/lisa/commit/fc23edf2f19446e9bbba3672103ee4906d28f9a7))

## [2.136.0](https://github.com/CodySwannGT/lisa/compare/vv2.135.0...v2.136.0) (2026-06-05)


### Features

* **openclaw:** default repo-topic requireMention to false ([d563f92](https://github.com/CodySwannGT/lisa/commit/d563f921d574e6b5bf0df7250ae43117ac76b808))

## [2.135.0](https://github.com/CodySwannGT/lisa/compare/vv2.134.10...v2.135.0) (2026-06-05)


### Features

* **exploratory-qa:** add flow-completeness / missing-counterpart category ([d56ea39](https://github.com/CodySwannGT/lisa/commit/d56ea39290ef47ae389591f7a59c01134c14651d))


### Bug Fixes

* **expo,rails:** apply same exploratory-qa layout-integrity fix ([e111b20](https://github.com/CodySwannGT/lisa/commit/e111b20aa9b2dfd84cdc028b365f313b90e78e07))

### [2.134.10](https://github.com/CodySwannGT/lisa/compare/vv2.134.9...v2.134.10) (2026-06-05)


### Bug Fixes

* **harper-fabric:** make exploratory-qa catch clipped/offscreen controls ([fb955a0](https://github.com/CodySwannGT/lisa/commit/fb955a05001af0aff4d2e2defb2cffd9a68258c5))

### [2.134.9](https://github.com/CodySwannGT/lisa/compare/vv2.134.8...v2.134.9) (2026-06-05)


### Documentation

* **wiki:** ingest Lisa wiki state ([74c1ddc](https://github.com/CodySwannGT/lisa/commit/74c1ddc8cd70490a03f505f5aa4da09d7fdab6a2))

### [2.134.8](https://github.com/CodySwannGT/lisa/compare/vv2.134.7...v2.134.8) (2026-06-04)


### Documentation

* **wiki:** ingest Lisa wiki state ([c232ee5](https://github.com/CodySwannGT/lisa/commit/c232ee5bc1f642a598e520a7b7e631b34dc97070))

### [2.134.7](https://github.com/CodySwannGT/lisa/compare/vv2.134.6...v2.134.7) (2026-06-04)


### Documentation

* **wiki:** ingest Lisa wiki state ([04a694e](https://github.com/CodySwannGT/lisa/commit/04a694e51895dbf7ad2bac75ee2a2967c33946e7))

### [2.134.6](https://github.com/CodySwannGT/lisa/compare/vv2.134.5...v2.134.6) (2026-06-04)


### Documentation

* **wiki:** ingest Lisa wiki state ([d7752fa](https://github.com/CodySwannGT/lisa/commit/d7752fa8e22e34a1e888aa0e221c8e1a195c4fd3))

### [2.134.5](https://github.com/CodySwannGT/lisa/compare/vv2.134.4...v2.134.5) (2026-06-03)


### Documentation

* **wiki:** ingest Lisa wiki state ([3de37da](https://github.com/CodySwannGT/lisa/commit/3de37da814eb745b9faf200318f7274c446ec8a6))

### [2.134.4](https://github.com/CodySwannGT/lisa/compare/vv2.134.3...v2.134.4) (2026-06-03)


### Documentation

* **wiki:** ingest Lisa wiki state ([ccb9689](https://github.com/CodySwannGT/lisa/commit/ccb9689051fc40ecbb9c5232f66956783f7fa0e0))

### [2.134.3](https://github.com/CodySwannGT/lisa/compare/vv2.134.2...v2.134.3) (2026-06-02)


### Documentation

* **wiki:** ingest carried-forward Lisa wiki state ([e6cfd45](https://github.com/CodySwannGT/lisa/commit/e6cfd45148ba1a4b4f718d28a8ad1ef4da6ef6b7))
* **wiki:** ingest Lisa history through 2.134.2 ([72fc529](https://github.com/CodySwannGT/lisa/commit/72fc529f33c12e0b2ebcb56027a35b02565a797c))
* **wiki:** sync lisa-monorepo snapshot to carried-forward ingest state ([40fdf6a](https://github.com/CodySwannGT/lisa/commit/40fdf6a21ff34199a49fe8f98074ff93f27e66d5))

### [2.134.2](https://github.com/CodySwannGT/lisa/compare/vv2.134.1...v2.134.2) (2026-06-02)


### Documentation

* **wiki:** ingest Lisa history through 2.134.1 ([ac7f0ae](https://github.com/CodySwannGT/lisa/commit/ac7f0aee46a7fe9e5b14ceb8f4295a4817f3ca36))

### [2.134.1](https://github.com/CodySwannGT/lisa/compare/vv2.134.0...v2.134.1) (2026-06-01)

## [2.134.0](https://github.com/CodySwannGT/lisa/compare/vv2.133.4...v2.134.0) (2026-06-01)


### Features

* **cli:** add maintenance commands ([c757253](https://github.com/CodySwannGT/lisa/commit/c757253d7a515d42d715415f10b667efc00d9693))

### [2.133.4](https://github.com/CodySwannGT/lisa/compare/vv2.133.3...v2.133.4) (2026-06-01)


### Documentation

* **wiki:** ingest Lisa history through 2.133.3 ([4a8feda](https://github.com/CodySwannGT/lisa/commit/4a8fedac1277af9c5b0f734e2bf739ca1d4e78b8))

### [2.133.3](https://github.com/CodySwannGT/lisa/compare/vv2.133.2...v2.133.3) (2026-06-01)


### Bug Fixes

* **harper-fabric:** remove advisory-rankings app content from shared template ([224a9a3](https://github.com/CodySwannGT/lisa/commit/224a9a3d4772ad3d189ef516e4d082ad3722e488))

### [2.133.2](https://github.com/CodySwannGT/lisa/compare/vv2.133.1...v2.133.2) (2026-06-01)


### Bug Fixes

* **expo,eslint:** ignore wiki/** and pin apollo-link-sentry compatible with apollo-client v3 ([f512527](https://github.com/CodySwannGT/lisa/commit/f512527617898082e6bb2f7bdbf892a7bcf3c4e1))

### [2.133.1](https://github.com/CodySwannGT/lisa/compare/vv2.133.0...v2.133.1) (2026-06-01)


### Bug Fixes

* **postinstall:** prevent cross-project package.json corruption in lisa apply ([a24afd9](https://github.com/CodySwannGT/lisa/commit/a24afd9e80ea9f18f1c1c1f8b6bd9b0fa4133a48))

## [2.133.0](https://github.com/CodySwannGT/lisa/compare/vv2.132.7...v2.133.0) (2026-06-01)


### Features

* **cli:** add setup-project command ([6727f90](https://github.com/CodySwannGT/lisa/commit/6727f901c7afe23c76e58aedba5af520c97657b4))

### [2.132.7](https://github.com/CodySwannGT/lisa/compare/vv2.132.6...v2.132.7) (2026-06-01)


### Bug Fixes

* **expo:** make jest resolver + react-test-renderer SDK-54/56 aware ([bc1c296](https://github.com/CodySwannGT/lisa/commit/bc1c296b7e1ec9f3ad0d412b8417dd714432df90))

### [2.132.6](https://github.com/CodySwannGT/lisa/compare/vv2.132.5...v2.132.6) (2026-06-01)


### Bug Fixes

* **eslint:** ignore .codex/** in eslint ignore template ([9abb665](https://github.com/CodySwannGT/lisa/commit/9abb665a9a6b8d4750366dc8461415d4474308d6))
* **expo:** stop tsconfig.expo.json from clobbering src/-layout projects ([f63d2a7](https://github.com/CodySwannGT/lisa/commit/f63d2a7d638cebea3c05e3c3011c708c4f149c01))
* **expo:** support both Expo SDK 54 and 56 (stop forcing the SDK major) ([0c9d92a](https://github.com/CodySwannGT/lisa/commit/0c9d92a91bf8541fa6f1a1b2e761f904c0a2721f))

### [2.132.5](https://github.com/CodySwannGT/lisa/compare/vv2.132.4...v2.132.5) (2026-06-01)


### Bug Fixes

* require two-way PR ticket links ([914f8bd](https://github.com/CodySwannGT/lisa/commit/914f8bd0c599e83189f1e2d16d6c414c941ffd19))

### [2.132.4](https://github.com/CodySwannGT/lisa/compare/vv2.132.3...v2.132.4) (2026-06-01)


### Documentation

* **wiki:** ingest Lisa history through 2.132.3 ([6662639](https://github.com/CodySwannGT/lisa/commit/6662639013591359febdae9621e8c596ec812535))

### [2.132.3](https://github.com/CodySwannGT/lisa/compare/vv2.132.2...v2.132.3) (2026-06-01)

### [2.132.2](https://github.com/CodySwannGT/lisa/compare/vv2.132.1...v2.132.2) (2026-06-01)

### [2.132.1](https://github.com/CodySwannGT/lisa/compare/vv2.132.0...v2.132.1) (2026-06-01)


### Documentation

* **wiki:** ingest Lisa history through 2.132.0 ([8e9ed41](https://github.com/CodySwannGT/lisa/commit/8e9ed413c0495c9dbbfb178034c354d1f5c522df))

## [2.132.0](https://github.com/CodySwannGT/lisa/compare/vv2.130.7...v2.132.0) (2026-06-01)


### Features

* **hooks:** block HUSKY=0 and core.hooksPath hook-bypass vectors ([f12b8bb](https://github.com/CodySwannGT/lisa/commit/f12b8bb1f63e73b1b3122503413582b840b66883))
* **implement:** add /goal-style non-bypassable verification gate ([4bfa067](https://github.com/CodySwannGT/lisa/commit/4bfa067333be7decf5a82deb64d2090e7294ba38))

## [2.131.0](https://github.com/CodySwannGT/lisa/compare/vv2.130.7...v2.131.0) (2026-06-01)


### Features

* **implement:** add /goal-style non-bypassable verification gate ([4bfa067](https://github.com/CodySwannGT/lisa/commit/4bfa067333be7decf5a82deb64d2090e7294ba38))

### [2.130.7](https://github.com/CodySwannGT/lisa/compare/vv2.130.6...v2.130.7) (2026-06-01)


### Documentation

* **lisa-update-projects:** use .lisa.workspaces.json and clarify worktree/PR flow ([32efd24](https://github.com/CodySwannGT/lisa/commit/32efd248186b1f9b8a62de1c0db6956e32f22f57))

### [2.130.6](https://github.com/CodySwannGT/lisa/compare/vv2.130.5...v2.130.6) (2026-06-01)


### Code Refactoring

* **cli:** split runLisa into apply subcommand + positional default ([ef10caa](https://github.com/CodySwannGT/lisa/commit/ef10caad272d0f277caf798092fdec4e3837647a)), closes [CodySwannGT/lisa#974](https://github.com/CodySwannGT/lisa/issues/974)

### [2.130.5](https://github.com/CodySwannGT/lisa/compare/vv2.130.4...v2.130.5) (2026-06-01)


### Documentation

* **wiki:** ingest Lisa history through 2.130.4 ([e3e8fcf](https://github.com/CodySwannGT/lisa/commit/e3e8fcf97f3d0f6dc71d62a91fe0c924490b2c83))

### [2.130.4](https://github.com/CodySwannGT/lisa/compare/vv2.130.3...v2.130.4) (2026-05-31)


### Documentation

* **wiki:** ingest Lisa history through 2.130.3 ([92a1fe0](https://github.com/CodySwannGT/lisa/commit/92a1fe03149292276ac1f703a1e392132eadbe36))

### [2.130.3](https://github.com/CodySwannGT/lisa/compare/vv2.130.1...v2.130.3) (2026-05-31)


### Bug Fixes

* **repair-intake:** clear is-blocked-by deps at any env-staged done, not just prod ([feed0b3](https://github.com/CodySwannGT/lisa/commit/feed0b3f71aad8f6edd3d12d8aacff09282584d4))


### Documentation

* **atlassian-access:** document acli link-create direction + flags ([adb4f00](https://github.com/CodySwannGT/lisa/commit/adb4f0091a345dc7882a5bffefcc7b8cf3b0b01d))
* **wiki:** ingest Lisa history through 2.130.1 ([f91afba](https://github.com/CodySwannGT/lisa/commit/f91afba90783c6a6b7481ad0c95149ed85973b47))

### [2.130.2](https://github.com/CodySwannGT/lisa/compare/vv2.130.1...v2.130.2) (2026-05-31)


### Bug Fixes

* **repair-intake:** clear is-blocked-by deps at any env-staged done, not just prod ([feed0b3](https://github.com/CodySwannGT/lisa/commit/feed0b3f71aad8f6edd3d12d8aacff09282584d4))


### Documentation

* **wiki:** ingest Lisa history through 2.130.1 ([f91afba](https://github.com/CodySwannGT/lisa/commit/f91afba90783c6a6b7481ad0c95149ed85973b47))

### [2.130.1](https://github.com/CodySwannGT/lisa/compare/vv2.130.0...v2.130.1) (2026-05-31)


### Bug Fixes

* **exploratory-qa:** flag late meaningful content ([d76ea64](https://github.com/CodySwannGT/lisa/commit/d76ea646f572f3d65d6bbdce2ee09b0cc16a3a0d))

## [2.130.0](https://github.com/CodySwannGT/lisa/compare/vv2.129.8...v2.130.0) (2026-05-31)


### Features

* **lifecycle:** add Human Needed marker label on agent-blocked work ([b87fe90](https://github.com/CodySwannGT/lisa/commit/b87fe907f38c7a227081af05601821a59c4c99fb))


### Bug Fixes

* **plugin-sync:** strip GIT_INDEX_FILE from nested git env (hermetic fixtures) ([6b27b89](https://github.com/CodySwannGT/lisa/commit/6b27b89c095848bd8deee8ea4a856a381858c305))

### [2.129.8](https://github.com/CodySwannGT/lisa/compare/vv2.129.7...v2.129.8) (2026-05-31)


### Bug Fixes

* preserve Harper schema knip suppression ([b8508e8](https://github.com/CodySwannGT/lisa/commit/b8508e8abf0746d8079cbe77bb92bbd53c0a5dd0))

### [2.129.7](https://github.com/CodySwannGT/lisa/compare/vv2.129.6...v2.129.7) (2026-05-31)


### Bug Fixes

* **build-intake,repair-intake:** gate env transition on PR merge + auto-rebase stranded PRs ([be3a108](https://github.com/CodySwannGT/lisa/commit/be3a108b19d9c8fe8ecd6df0be062e3e12003b3e)), closes [AcmeOrgA/frontend#701](https://github.com/AcmeOrgA/frontend/issues/701)

### [2.129.6](https://github.com/CodySwannGT/lisa/compare/vv2.129.5...v2.129.6) (2026-05-31)


### Bug Fixes

* convert jira descriptions to adf ([bd737b5](https://github.com/CodySwannGT/lisa/commit/bd737b56c2f3104326b9f52f765d9c5b26a4d17b))
* enforce S10 repair before PRD ticket writes ([eb58c63](https://github.com/CodySwannGT/lisa/commit/eb58c639a4c0ba9f66a7c78f63639506c8c88799))
* request full JIRA fields in Atlassian reads ([bafb156](https://github.com/CodySwannGT/lisa/commit/bafb1562a30dfc344dbff4da9a26847ffac06c44))

### [2.129.5](https://github.com/CodySwannGT/lisa/compare/vv2.129.4...v2.129.5) (2026-05-31)


### Documentation

* **wiki:** ingest Lisa history through 2.129.4 ([e36affb](https://github.com/CodySwannGT/lisa/commit/e36affbc1eecb3eb92baddc84a075e92f226a26d))

### [2.129.4](https://github.com/CodySwannGT/lisa/compare/vv2.129.3...v2.129.4) (2026-05-31)


### Documentation

* **wiki:** ingest Lisa history through 2.129.3 ([a3b198f](https://github.com/CodySwannGT/lisa/commit/a3b198f792ed2d4094cb85876008315e82ad0892))

### [2.129.3](https://github.com/CodySwannGT/lisa/compare/vv2.129.2...v2.129.3) (2026-05-31)


### Bug Fixes

* **exploratory-qa:** flag contextless extracted data ([c017cda](https://github.com/CodySwannGT/lisa/commit/c017cda7fb8e351175eeb3d42d53b7b4880930ad))

### [2.129.2](https://github.com/CodySwannGT/lisa/compare/vv2.129.1...v2.129.2) (2026-05-31)


### Bug Fixes

* add doctor plugin drift guidance ([577bd07](https://github.com/CodySwannGT/lisa/commit/577bd0745d6cb8b8ed24e9846f0df6d3c888366c))

### [2.129.1](https://github.com/CodySwannGT/lisa/compare/vv2.129.0...v2.129.1) (2026-05-31)


### Bug Fixes

* **exploratory-qa:** flag human-facing jargon ([53e6284](https://github.com/CodySwannGT/lisa/commit/53e6284b4cee14fe07076c554a20821986495a1f))

## [2.129.0](https://github.com/CodySwannGT/lisa/compare/vv2.128.1...v2.129.0) (2026-05-31)


### Features

* expose plugin sync readiness result ([1ee307b](https://github.com/CodySwannGT/lisa/commit/1ee307bdfe67fd563a9e6f4826f4067645fa1a8d))
* render plugin sync readiness in doctor ([fa3b4d9](https://github.com/CodySwannGT/lisa/commit/fa3b4d97b07e05ccb978851bdb7a0022a44d8f27))

### [2.128.1](https://github.com/CodySwannGT/lisa/compare/vv2.128.0...v2.128.1) (2026-05-30)


### Documentation

* **wiki:** ingest Lisa history through 2.128.0 ([92eddca](https://github.com/CodySwannGT/lisa/commit/92eddcaae52676e5c4b7496510dbe55071e844d8))

## [2.128.0](https://github.com/CodySwannGT/lisa/compare/vv2.127.1...v2.128.0) (2026-05-30)


### Features

* **parity:** real cross-agent implementations of the curated plugins (replace scaffolds) ([ea6ad4f](https://github.com/CodySwannGT/lisa/commit/ea6ad4faf0f04e9fe37d6eec80ba36b92ffc1b96)), closes [#1059](https://github.com/CodySwannGT/lisa/issues/1059)

### [2.127.1](https://github.com/CodySwannGT/lisa/compare/vv2.127.0...v2.127.1) (2026-05-30)


### Bug Fixes

* **leaf-only:** treat childless Story/Spike as buildable leaves ([f107334](https://github.com/CodySwannGT/lisa/commit/f107334d4e9c3d9c82e8915861f831f680f666ea))


### Documentation

* **wiki:** ingest Lisa history through 2.127.0 ([80be8c9](https://github.com/CodySwannGT/lisa/commit/80be8c986e85b97e0d38bd7dc8c597d3cc5a9971))

## [2.127.0](https://github.com/CodySwannGT/lisa/compare/vv2.126.2...v2.127.0) (2026-05-30)


### Features

* **parity:** re-point sentry MCP to codex/agy/copilot/cursor via base .mcp.json ([c6c931e](https://github.com/CodySwannGT/lisa/commit/c6c931e7f9e0e2ed4dbf4b1d93296f2475b990d6))
* **parity:** scaffold 7 reimplement placeholder skills (synced-from pins) ([cecf931](https://github.com/CodySwannGT/lisa/commit/cecf931cdd6a8f01e3921bbc1b9f9ab64dfd990c)), closes [#1050](https://github.com/CodySwannGT/lisa/issues/1050) [#1059](https://github.com/CodySwannGT/lisa/issues/1059)


### Documentation

* **parity:** record deferred parity work (LSP subsystem, vendor-equivalents) ([7f05ade](https://github.com/CodySwannGT/lisa/commit/7f05adeedd9797d742221eb0ddc72217a503cf3c))

### [2.126.2](https://github.com/CodySwannGT/lisa/compare/vv2.126.1...v2.126.2) (2026-05-30)


### Bug Fixes

* **lifecycle:** roll parents up to intermediate env states + reconcile stranded containers ([19d88ac](https://github.com/CodySwannGT/lisa/commit/19d88ac11209fc11627074322efc18fdeadc6d2a))

### [2.126.1](https://github.com/CodySwannGT/lisa/compare/vv2.126.0...v2.126.1) (2026-05-30)


### Bug Fixes

* **parity:** enforce per-agent component coverage in routing validator (CodeRabbit [#1079](https://github.com/CodySwannGT/lisa/issues/1079)) ([afb3b03](https://github.com/CodySwannGT/lisa/commit/afb3b03e995d8722c6bcc78bae91abc9bf959f3a))

## [2.126.0](https://github.com/CodySwannGT/lisa/compare/vv2.125.1...v2.126.0) (2026-05-30)


### Features

* **parity:** harden analyze-plugin from dogfooding + add committed routing validator ([12cf0d8](https://github.com/CodySwannGT/lisa/commit/12cf0d8aa7a77063ebfaca70295dbc2c060b4228))


### Bug Fixes

* **tests:** return well-formed RoutingReport when stdout is empty ([39aa29c](https://github.com/CodySwannGT/lisa/commit/39aa29cf507752a712b9beb58ead09761603f30e))


### Documentation

* **parity:** add proposed routing plans for the 7 curated plugins (analyze output) ([281d76d](https://github.com/CodySwannGT/lisa/commit/281d76d19aef2a2892c608dff0420ae7e5d3b849))

### [2.125.1](https://github.com/CodySwannGT/lisa/compare/vv2.125.0...v2.125.1) (2026-05-30)


### Documentation

* **wiki:** ingest Lisa history through 2.125.0 ([27f6aa9](https://github.com/CodySwannGT/lisa/commit/27f6aa91f56deae24a47af0a40b643597d404b9b))

## [2.125.0](https://github.com/CodySwannGT/lisa/compare/vv2.124.12...v2.125.0) (2026-05-30)


### Features

* **parity:** add 3rd-party plugin parity subsystem (analyze/implement/drift) ([#1059](https://github.com/CodySwannGT/lisa/issues/1059)) ([ebfd8b8](https://github.com/CodySwannGT/lisa/commit/ebfd8b8d988847837a763821aa986cb4fb7b0f0c)), closes [#1054](https://github.com/CodySwannGT/lisa/issues/1054) [-#1058](https://github.com/CodySwannGT/-/issues/1058)


### Bug Fixes

* **parity:** stabilize drift result ordering + clarify synced-from frontmatter (CodeRabbit [#1077](https://github.com/CodySwannGT/lisa/issues/1077)) ([8af0aa3](https://github.com/CodySwannGT/lisa/commit/8af0aa3d64d66ac93f31474752e49ff0099dd054))

### [2.124.12](https://github.com/CodySwannGT/lisa/compare/vv2.124.11...v2.124.12) (2026-05-30)


### Documentation

* **wiki:** ingest Lisa history through 2.124.11 ([0c2b9a6](https://github.com/CodySwannGT/lisa/commit/0c2b9a6786acf8c6d5f7912d52e827388ef1472d))

### [2.124.11](https://github.com/CodySwannGT/lisa/compare/vv2.124.10...v2.124.11) (2026-05-30)


### Documentation

* **wiki:** ingest Lisa history through 2.124.10 ([8482e87](https://github.com/CodySwannGT/lisa/commit/8482e87b070173e0a129621fff83800963220058))

### [2.124.10](https://github.com/CodySwannGT/lisa/compare/vv2.124.9...v2.124.10) (2026-05-30)


### Bug Fixes

* **copilot:** drop invalid subagentStart event + inline MCP pointer ([#1056](https://github.com/CodySwannGT/lisa/issues/1056)) ([62b1572](https://github.com/CodySwannGT/lisa/commit/62b15720c229e42d20af1974d39bdb031edf233c))
* **copilot:** validate mcpServers is a non-empty plain object ([#1056](https://github.com/CodySwannGT/lisa/issues/1056)) ([0c3abe1](https://github.com/CodySwannGT/lisa/commit/0c3abe1de1d8006d6428eb172d22af63bead4e5f)), closes [#1073](https://github.com/CodySwannGT/lisa/issues/1073)

### [2.124.9](https://github.com/CodySwannGT/lisa/compare/vv2.124.8...v2.124.9) (2026-05-30)


### Documentation

* **wiki:** ingest Lisa history through 2.124.8 ([03fcfeb](https://github.com/CodySwannGT/lisa/commit/03fcfeb2dba378a49eb25d366b538de200df381c))

### [2.124.8](https://github.com/CodySwannGT/lisa/compare/vv2.124.7...v2.124.8) (2026-05-29)


### Documentation

* **wiki:** ingest Lisa history through 2.124.7 ([6e9efcc](https://github.com/CodySwannGT/lisa/commit/6e9efcc6e95b15e80d9086a9e3bcabbaa0073a4e))

### [2.124.7](https://github.com/CodySwannGT/lisa/compare/vv2.124.6...v2.124.7) (2026-05-29)


### Documentation

* **rules:** add auto-merge ancestry-check rule ([#1055](https://github.com/CodySwannGT/lisa/issues/1055)) ([aa06224](https://github.com/CodySwannGT/lisa/commit/aa06224170ca6840601b53730a509e109590dde4)), closes [#1069](https://github.com/CodySwannGT/lisa/issues/1069)

### [2.124.6](https://github.com/CodySwannGT/lisa/compare/vv2.124.5...v2.124.6) (2026-05-29)


### Bug Fixes

* **cursor:** use ${CURSOR_PLUGIN_ROOT} for hook command paths ([#1055](https://github.com/CodySwannGT/lisa/issues/1055)) ([a2942a6](https://github.com/CodySwannGT/lisa/commit/a2942a68c3dc1b81f28465c034b747fa9ed143cf))

### [2.124.5](https://github.com/CodySwannGT/lisa/compare/vv2.124.4...v2.124.5) (2026-05-29)


### Bug Fixes

* **cursor:** reshape plugin variant to match Cursor plugin spec ([#1055](https://github.com/CodySwannGT/lisa/issues/1055)) ([4615771](https://github.com/CodySwannGT/lisa/commit/4615771c198f1e0f4045bfc8e24f11c18a18ac1d))


### Documentation

* **wiki:** correct Cursor plugin-shape guidance + add probe evidence ([#1055](https://github.com/CodySwannGT/lisa/issues/1055)) ([c99ead9](https://github.com/CodySwannGT/lisa/commit/c99ead929b437924227ad8f442c753621b4c7412))

### [2.124.4](https://github.com/CodySwannGT/lisa/compare/vv2.124.3...v2.124.4) (2026-05-29)


### Documentation

* **wiki:** ingest Lisa history through 2.124.2 ([78b592f](https://github.com/CodySwannGT/lisa/commit/78b592fbe3b567ad67884916fedfde7e2bb362a4))

### [2.124.3](https://github.com/CodySwannGT/lisa/compare/vv2.124.2...v2.124.3) (2026-05-29)


### Bug Fixes

* **codex:** emit plugin hooks to .codex-plugin/ to stop breaking Claude startup ([0a5ae3b](https://github.com/CodySwannGT/lisa/commit/0a5ae3b36e19965a91819520456ef7043cff1c82)), closes [#1058](https://github.com/CodySwannGT/lisa/issues/1058) [#1](https://github.com/CodySwannGT/lisa/issues/1) [#1058](https://github.com/CodySwannGT/lisa/issues/1058) [#2](https://github.com/CodySwannGT/lisa/issues/2) [#1058](https://github.com/CodySwannGT/lisa/issues/1058)

### [2.124.2](https://github.com/CodySwannGT/lisa/compare/vv2.124.1...v2.124.2) (2026-05-29)


### Bug Fixes

* **agy:** deliver native MCP + hooks via runtime-correct mechanisms ([3f02d93](https://github.com/CodySwannGT/lisa/commit/3f02d93291237fefbc1663a701b2f7e203a67bbf)), closes [#1054](https://github.com/CodySwannGT/lisa/issues/1054)
* **agy:** harden plugin generation and MCP cleanup for missing scripts and stale entries ([a2ceb70](https://github.com/CodySwannGT/lisa/commit/a2ceb70e7774a292415b7c4ca11f9e3ad64bbb46))
* **agy:** resolve agy hook command path to the install-dir name (CodeRabbit [#1](https://github.com/CodySwannGT/lisa/issues/1)) ([60cdab1](https://github.com/CodySwannGT/lisa/commit/60cdab13de380b2c0a4f02190450ea02b6609655))

### [2.124.1](https://github.com/CodySwannGT/lisa/compare/vv2.124.0...v2.124.1) (2026-05-29)


### Documentation

* **wiki:** ingest Lisa history through 2.124.0 ([3d70be0](https://github.com/CodySwannGT/lisa/commit/3d70be0067e070c874411dae585e837ed79bec81))

## [2.124.0](https://github.com/CodySwannGT/lisa/compare/vv2.123.3...v2.124.0) (2026-05-29)


### Features

* **base:** add claude-remote readiness skills ([997ee13](https://github.com/CodySwannGT/lisa/commit/997ee1304068284c788824531bb81155a8d209f5))

### [2.123.3](https://github.com/CodySwannGT/lisa/compare/vv2.123.2...v2.123.3) (2026-05-29)


### Documentation

* **wiki:** ingest incremental Lisa history ([ecb6a09](https://github.com/CodySwannGT/lisa/commit/ecb6a093d767203add54de4d0d703783c80abda0))
* **wiki:** ingest Lisa history through 2.123.2 ([be868bf](https://github.com/CodySwannGT/lisa/commit/be868bfb4798661993ea465deee270504a8600bd))

### [2.123.2](https://github.com/CodySwannGT/lisa/compare/vv2.123.1...v2.123.2) (2026-05-29)


### Documentation

* **wiki:** document stack fan-out + correct rule-delivery model ([af9595b](https://github.com/CodySwannGT/lisa/commit/af9595bb9547b186fdb865ab0df25adc60ccd05c)), closes [#1050](https://github.com/CodySwannGT/lisa/issues/1050) [#1052](https://github.com/CodySwannGT/lisa/issues/1052)

### [2.123.1](https://github.com/CodySwannGT/lisa/compare/vv2.123.0...v2.123.1) (2026-05-29)


### Bug Fixes

* **parity:** agy bake resolves rules like inject-rules.sh (eager OR flat) ([8a7bd43](https://github.com/CodySwannGT/lisa/commit/8a7bd43682a8c7242bb7a967409350832487a9f1))

## [2.123.0](https://github.com/CodySwannGT/lisa/compare/vv2.122.0...v2.123.0) (2026-05-29)


### Features

* **expo:** support Expo SDK 56 + /src directory convention ([b262f39](https://github.com/CodySwannGT/lisa/commit/b262f3985b85c17adc22c8eff507e618d469ef1e))


### Bug Fixes

* **expo:** apply directory-structure /src edits to plugin source ([c91536b](https://github.com/CodySwannGT/lisa/commit/c91536b5b1a6741dc82d14b730934507a985a341))
* **expo:** make knip/prettier/eslint-ignore templates /src-aware ([2684755](https://github.com/CodySwannGT/lisa/commit/26847556bbe8dc092a39c4f63b5c6206adbdd91a))
* **expo:** wire sourceRoot into jest/eslint entry templates (auto-detect /src) ([546fc79](https://github.com/CodySwannGT/lisa/commit/546fc795a724eefe5db60c13ede74fdb0fa4b8a9))


### Documentation

* **expo:** address CodeRabbit — SDK 56 doc consistency + validator path reporting ([9f7f836](https://github.com/CodySwannGT/lisa/commit/9f7f836d6f4cb4a13fb96da3a7cac29a0c2202d0))
* **expo:** fix eas:publish script examples in upgrade guide ([3f0214d](https://github.com/CodySwannGT/lisa/commit/3f0214deffb40254f940961fab1e602e9588cc31))

## [2.122.0](https://github.com/CodySwannGT/lisa/compare/vv2.121.1...v2.122.0) (2026-05-29)


### Features

* **parity:** fan out every Lisa plugin to cursor/agy/copilot variants ([e3ed805](https://github.com/CodySwannGT/lisa/commit/e3ed805c00d8738f62e623248775486fd340666c))
* **parity:** install matching stack variant per detected type on agy/copilot ([d1eb064](https://github.com/CodySwannGT/lisa/commit/d1eb0648b99bae6898041cc7d259a94984fce98d))

### [2.121.1](https://github.com/CodySwannGT/lisa/compare/vv2.121.0...v2.121.1) (2026-05-29)


### Bug Fixes

* **parity:** emit Codex hooks where Codex actually discovers them ([eaae96e](https://github.com/CodySwannGT/lisa/commit/eaae96effc5149de26bceabfbe5d9e53f876a8ae))
* **parity:** execFile for plugin installs + agy MCP scope resolver ([9903d4c](https://github.com/CodySwannGT/lisa/commit/9903d4c4dfc0b3b531cfc2c7ea5023d4838d3e9d))
* **parity:** include Codex in fleet emit + bake agy rules from base plugin ([c767b02](https://github.com/CodySwannGT/lisa/commit/c767b02414a9134150e135f6c12fefb68f02f99f))
* **parity:** pin Codex plugin key to lisa@lisa + populate Copilot probe cache ([a45dce2](https://github.com/CodySwannGT/lisa/commit/a45dce25c78cb57446ab3bac0d2ac75668a9ab7e))


### Documentation

* **wiki:** record Codex/Copilot parity findings verified by run ([517b475](https://github.com/CodySwannGT/lisa/commit/517b475fd86a1322383bfc6687d7453389f3bd86))

## [2.121.0](https://github.com/CodySwannGT/lisa/compare/vv2.119.1...v2.121.0) (2026-05-29)


### Features

* **parity:** wave 3 part 1 — Pattern B per-agent plugin variant build pipeline ([d02c887](https://github.com/CodySwannGT/lisa/commit/d02c8877afc215a90eaa84a2060a536556539fb7)), closes [#17](https://github.com/CodySwannGT/lisa/issues/17) [#17](https://github.com/CodySwannGT/lisa/issues/17)
* **parity:** wave 3 part 2 — agy per-project installers ([3524c1b](https://github.com/CodySwannGT/lisa/commit/3524c1b8164bc7b9a7fe46b8fd72765480b9b3aa))
* **parity:** wave 3 part 3 — Copilot per-project installers ([8dac2a2](https://github.com/CodySwannGT/lisa/commit/8dac2a22df3a734000cdae18e4cfb98a3180c5be))
* **parity:** wave 3 part 4 — Claude memory installer ([21ccd89](https://github.com/CodySwannGT/lisa/commit/21ccd891af5f1c9fae20cc100f2ee8e35965231a))
* **parity:** wave 3 part 5 — Codex plugin-install detection ([93773d1](https://github.com/CodySwannGT/lisa/commit/93773d1d7a6c9ccac65e8a9476239946ca1ef092))
* **parity:** wave 3 part 7 — wire installers into lisa apply + unit tests ([5a9a8b8](https://github.com/CodySwannGT/lisa/commit/5a9a8b8ebf42702336e686182a6f5391f37c955b))
* **parity:** wave 3b — emit plugin-bundled Codex hooks (Action 3) ([e57ba24](https://github.com/CodySwannGT/lisa/commit/e57ba245229e71624f0b00cd592180cb55111280)), closes [#1045](https://github.com/CodySwannGT/lisa/issues/1045)


### Bug Fixes

* **parity:** correct Codex hooks.json root shape + harden hook parsing ([2fc7b32](https://github.com/CodySwannGT/lisa/commit/2fc7b327b580500c71fc139c82416c19ae9a6787))
* **parity:** wave 3 part 5b — TOML detection tolerance + dual-key ([c80c03a](https://github.com/CodySwannGT/lisa/commit/c80c03a7c2f3b40767c6f681ca1cb58d3b2f129c))


### Documentation

* **parity:** wave 1 — per-agent hook ship-list audit ([374d625](https://github.com/CodySwannGT/lisa/commit/374d6259ca29e68e0584f62c45089a05deba56cf))
* **parity:** wave 2 — architecture decisions + Pattern B fan-out spec ([640d4ce](https://github.com/CodySwannGT/lisa/commit/640d4cef33430989176f7b875629a2cb1008c4f8))

## [2.120.0](https://github.com/CodySwannGT/lisa/compare/vv2.119.1...v2.120.0) (2026-05-28)


### Features

* **parity:** wave 3 part 1 — Pattern B per-agent plugin variant build pipeline ([d02c887](https://github.com/CodySwannGT/lisa/commit/d02c8877afc215a90eaa84a2060a536556539fb7)), closes [#17](https://github.com/CodySwannGT/lisa/issues/17) [#17](https://github.com/CodySwannGT/lisa/issues/17)
* **parity:** wave 3 part 2 — agy per-project installers ([3524c1b](https://github.com/CodySwannGT/lisa/commit/3524c1b8164bc7b9a7fe46b8fd72765480b9b3aa))
* **parity:** wave 3 part 3 — Copilot per-project installers ([8dac2a2](https://github.com/CodySwannGT/lisa/commit/8dac2a22df3a734000cdae18e4cfb98a3180c5be))
* **parity:** wave 3 part 4 — Claude memory installer ([21ccd89](https://github.com/CodySwannGT/lisa/commit/21ccd891af5f1c9fae20cc100f2ee8e35965231a))
* **parity:** wave 3 part 5 — Codex plugin-install detection ([93773d1](https://github.com/CodySwannGT/lisa/commit/93773d1d7a6c9ccac65e8a9476239946ca1ef092))
* **parity:** wave 3 part 7 — wire installers into lisa apply + unit tests ([5a9a8b8](https://github.com/CodySwannGT/lisa/commit/5a9a8b8ebf42702336e686182a6f5391f37c955b))


### Bug Fixes

* **parity:** wave 3 part 5b — TOML detection tolerance + dual-key ([c80c03a](https://github.com/CodySwannGT/lisa/commit/c80c03a7c2f3b40767c6f681ca1cb58d3b2f129c))

### [2.119.1](https://github.com/CodySwannGT/lisa/compare/vv2.119.0...v2.119.1) (2026-05-28)


### Documentation

* **wiki:** fix Codex installer module count from nine to ten ([b37f07c](https://github.com/CodySwannGT/lisa/commit/b37f07c90e2ce4dafa8ec45d4cde6a58d9f30b9d))
* **wiki:** ingest coding-agent parity research artifact ([066f4b5](https://github.com/CodySwannGT/lisa/commit/066f4b563fad078e6a347260053ebefe1536c11e))

## [2.119.0](https://github.com/CodySwannGT/lisa/compare/vv2.118.0...v2.119.0) (2026-05-28)


### Features

* **cli:** add package version update check ([f1d424e](https://github.com/CodySwannGT/lisa/commit/f1d424eb5742164cd7e33d6feefb73bd044ea2c3))


### Bug Fixes

* **cli:** validate semver in readCachedLatest and swallow writeCache errors ([0da89db](https://github.com/CodySwannGT/lisa/commit/0da89db83a2ba6ff74d402a936b8e2e5119f3c86)), closes [#1040](https://github.com/CodySwannGT/lisa/issues/1040)

## [2.118.0](https://github.com/CodySwannGT/lisa/compare/vv2.117.0...v2.118.0) (2026-05-28)


### Features

* **wiki:** merge a managed .gitignore block during /setup ([5a0d76d](https://github.com/CodySwannGT/lisa/commit/5a0d76dcb67da8c0eadf25840cd4e8e709433bb1))

## [2.117.0](https://github.com/CodySwannGT/lisa/compare/vv2.116.2...v2.117.0) (2026-05-28)


### Features

* **codex,ci:** mirror eager/reference subdirs and add pairing check ([80ca00b](https://github.com/CodySwannGT/lisa/commit/80ca00b992434801d3ba01bde419202ca8e0b6dc))
* **rules:** split rules into eager heads and reference bodies ([040acf5](https://github.com/CodySwannGT/lisa/commit/040acf54ae64c1e3ae996fd1395bf79c0a3c925d))

### [2.116.2](https://github.com/CodySwannGT/lisa/compare/vv2.116.1...v2.116.2) (2026-05-28)

### [2.116.1](https://github.com/CodySwannGT/lisa/compare/vv2.116.0...v2.116.1) (2026-05-28)


### Documentation

* **wiki:** ingest incremental Lisa history ([666971e](https://github.com/CodySwannGT/lisa/commit/666971e61c240eeefb08d3a63bb5f31610a1d17a))

## [2.116.0](https://github.com/CodySwannGT/lisa/compare/vv2.115.4...v2.116.0) (2026-05-28)


### Features

* **rules:** add wiki-as-knowledge-source rule to base plugin ([dbf21ed](https://github.com/CodySwannGT/lisa/commit/dbf21edb69195102682daa008f4ca9d950f9b336))

### [2.115.4](https://github.com/CodySwannGT/lisa/compare/vv2.115.3...v2.115.4) (2026-05-27)


### Documentation

* **wiki:** ingest incremental Lisa history ([b4a1bd3](https://github.com/CodySwannGT/lisa/commit/b4a1bd30c02cc6a2b55583e047739e4e26255632))

### [2.115.3](https://github.com/CodySwannGT/lisa/compare/vv2.115.2...v2.115.3) (2026-05-27)


### Documentation

* **ideation:** document PRD pressure gate ([ac5ce8e](https://github.com/CodySwannGT/lisa/commit/ac5ce8e8459d0040f656b3412cee2a0a8760a6c2))

### [2.115.2](https://github.com/CodySwannGT/lisa/compare/vv2.115.1...v2.115.2) (2026-05-27)

### [2.115.1](https://github.com/CodySwannGT/lisa/compare/vv2.115.0...v2.115.1) (2026-05-27)


### Bug Fixes

* **project-ideation:** block auto-ready prds under queue pressure ([964ae08](https://github.com/CodySwannGT/lisa/commit/964ae0812d959fccaf6782452666b9fe65793404))

## [2.115.0](https://github.com/CodySwannGT/lisa/compare/vv2.114.0...v2.115.0) (2026-05-27)


### Features

* **queue-status:** add PRD pressure helper ([b8b8987](https://github.com/CodySwannGT/lisa/commit/b8b89878d13ccab8e754655d85453145313ede84))

## [2.114.0](https://github.com/CodySwannGT/lisa/compare/vv2.113.1...v2.114.0) (2026-05-27)


### Features

* **wiki:** make the standard digital-staff roster the setup default ([fcb7a10](https://github.com/CodySwannGT/lisa/commit/fcb7a10e5263fee80730b6b536c14016772f25a0))

### [2.113.1](https://github.com/CodySwannGT/lisa/compare/vv2.113.0...v2.113.1) (2026-05-27)


### Documentation

* **wiki:** ingest incremental Lisa history ([46a4461](https://github.com/CodySwannGT/lisa/commit/46a44616ec4877476aa3f536627a402d11457389))

## [2.113.0](https://github.com/CodySwannGT/lisa/compare/vv2.112.0...v2.113.0) (2026-05-27)


### Features

* **postinstall:** re-enable crash-safe template apply on local install ([4b8f113](https://github.com/CodySwannGT/lisa/commit/4b8f1136bb27413b7534e645ae8a639a6d958175)), closes [#318](https://github.com/CodySwannGT/lisa/issues/318) [#318](https://github.com/CodySwannGT/lisa/issues/318)

## [2.112.0](https://github.com/CodySwannGT/lisa/compare/vv2.111.0...v2.112.0) (2026-05-27)


### Features

* **expo:** adopt official Expo skills + Expo MCP server ([2691cad](https://github.com/CodySwannGT/lisa/commit/2691cad709e0c7fd1347ca7123d9c788dce54883))

## [2.111.0](https://github.com/CodySwannGT/lisa/compare/vv2.110.1...v2.111.0) (2026-05-27)


### Features

* **qa:** split exploratory-qa into human-experience pass + e2e-coverage-gaps ([ffd43fa](https://github.com/CodySwannGT/lisa/commit/ffd43fa52412c30fe9ba927fb463e376ce4605eb))
* **repair-intake:** 2h stuck threshold + PR/deploy blocker diagnosis ([7ef908d](https://github.com/CodySwannGT/lisa/commit/7ef908df0f68acd8b3d73184a2d0e50a4eafd167))
* **wiki:** make /query the primary way agents answer project questions ([7826528](https://github.com/CodySwannGT/lisa/commit/78265287b0ac76bdda4acc75076d5300288fc4ad))

### [2.110.1](https://github.com/CodySwannGT/lisa/compare/vv2.110.0...v2.110.1) (2026-05-27)


### Bug Fixes

* thread ideation ledger payload ([13f66f3](https://github.com/CodySwannGT/lisa/commit/13f66f37094a5d5196770db629a44e068c917d6d))

## [2.110.0](https://github.com/CodySwannGT/lisa/compare/vv2.109.0...v2.110.0) (2026-05-27)


### Features

* record github prd ideation ledger ([5b8040e](https://github.com/CodySwannGT/lisa/commit/5b8040ef88d8a585ecc19d3a41d9146eb7a063d8))


### Bug Fixes

* **wiki:** flush lint-wiki --json output before exit ([789c399](https://github.com/CodySwannGT/lisa/commit/789c399bc33a6925daebdb48bbff093cfc5c82b6))

## [2.109.0](https://github.com/CodySwannGT/lisa/compare/vv2.108.0...v2.109.0) (2026-05-27)


### Features

* **project-ideation:** record automation memory contract ([e8c7626](https://github.com/CodySwannGT/lisa/commit/e8c7626eb77ee52b85140c64803be254cb9cd510))

## [2.108.0](https://github.com/CodySwannGT/lisa/compare/vv2.107.2...v2.108.0) (2026-05-27)


### Features

* add project ideation idempotency harness ([81c6061](https://github.com/CodySwannGT/lisa/commit/81c6061bb739b86fad44ffe3d08dab01145821e3))

### [2.107.2](https://github.com/CodySwannGT/lisa/compare/vv2.107.1...v2.107.2) (2026-05-27)

### [2.107.1](https://github.com/CodySwannGT/lisa/compare/vv2.107.0...v2.107.1) (2026-05-27)


### Bug Fixes

* **orchestration:** make nested team flows add specialists instead of collapsing to single-agent ([18740ec](https://github.com/CodySwannGT/lisa/commit/18740ec3c8c35256f5d81b63e5633d54c69e9bb0))

## [2.107.0](https://github.com/CodySwannGT/lisa/compare/vv2.106.9...v2.107.0) (2026-05-27)


### Features

* **typescript:** block error-suppression directives on edit ([10b6afd](https://github.com/CodySwannGT/lisa/commit/10b6afd4c4e51818fca76c0937a91f81877065dc))


### Bug Fixes

* **automation-status:** isolate codex cwd git check from inherited GIT_DIR ([5354f98](https://github.com/CodySwannGT/lisa/commit/5354f9823ca99029609fc658101ad8f801fcc9fa))

### [2.106.9](https://github.com/CodySwannGT/lisa/compare/vv2.106.8...v2.106.9) (2026-05-27)


### Documentation

* **wiki:** ingest durable automation checkout guidance ([b4c74bd](https://github.com/CodySwannGT/lisa/commit/b4c74bd59d7a7408389c040b96621c6ab27bb469))

### [2.106.8](https://github.com/CodySwannGT/lisa/compare/vv2.106.7...v2.106.8) (2026-05-27)


### Bug Fixes

* **automations:** use durable synced Lisa checkouts ([ea4881c](https://github.com/CodySwannGT/lisa/commit/ea4881c839f290092843fd06199d73da8491d18c))

### [2.106.7](https://github.com/CodySwannGT/lisa/compare/vv2.106.6...v2.106.7) (2026-05-27)


### Documentation

* **wiki:** ingest incremental Lisa knowledge ([296785e](https://github.com/CodySwannGT/lisa/commit/296785ee670dfd448f0aaef96606fde35a97c44d))

### [2.106.6](https://github.com/CodySwannGT/lisa/compare/vv2.106.5...v2.106.6) (2026-05-27)


### Documentation

* **wiki:** ingest incremental git history ([0d7f4e4](https://github.com/CodySwannGT/lisa/commit/0d7f4e481e33463b5206a2e541099feeea115e48))

### [2.106.5](https://github.com/CodySwannGT/lisa/compare/vv2.106.4...v2.106.5) (2026-05-26)


### Documentation

* **wiki:** ingest incremental git history ([774bd8b](https://github.com/CodySwannGT/lisa/commit/774bd8bf3ab145ddf06aa8266453f2b184eab37f))

### [2.106.4](https://github.com/CodySwannGT/lisa/compare/vv2.106.3...v2.106.4) (2026-05-26)


### Bug Fixes

* **plugin-sync:** compare generated drift in scratch ([251fe7b](https://github.com/CodySwannGT/lisa/commit/251fe7b2e9cc630ebeaf7edf87cec4441d742291))

### [2.106.3](https://github.com/CodySwannGT/lisa/compare/vv2.106.2...v2.106.3) (2026-05-26)


### Bug Fixes

* **plugin-sync:** name marketplace source drift ([718ff18](https://github.com/CodySwannGT/lisa/commit/718ff18cd54f28c0975a311797b81a891edaba41))

### [2.106.2](https://github.com/CodySwannGT/lisa/compare/vv2.106.1...v2.106.2) (2026-05-26)

### [2.106.1](https://github.com/CodySwannGT/lisa/compare/vv2.106.0...v2.106.1) (2026-05-26)


### Documentation

* **wiki:** ingest incremental git history ([b986680](https://github.com/CodySwannGT/lisa/commit/b986680cddd624e1f812d329caa7fa58b41d65d6))

## [2.106.0](https://github.com/CodySwannGT/lisa/compare/vv2.105.1...v2.106.0) (2026-05-26)


### Features

* **wiki:** expose source freshness parser ([8f11cd1](https://github.com/CodySwannGT/lisa/commit/8f11cd134aa9cedebdbb043622399917771f2229))


### Bug Fixes

* handle council executor exceptions ([0f13fb1](https://github.com/CodySwannGT/lisa/commit/0f13fb1fb985d5ab89776b71cf9c889293feff9c))
* prevent mixed currency usage rollups ([bb2fb06](https://github.com/CodySwannGT/lisa/commit/bb2fb06c7e6a42a7a9c4433ff0e9177ccdd5ff4a))
* prevent runtime-only council guarded writes ([ae35494](https://github.com/CodySwannGT/lisa/commit/ae3549464e16f1e108b3b47aa5909d4cc4eb7add))

### [2.105.1](https://github.com/CodySwannGT/lisa/compare/vv2.105.0...v2.105.1) (2026-05-26)


### Bug Fixes

* detect missing build lifecycle namespace ([f43b3ea](https://github.com/CodySwannGT/lisa/commit/f43b3ea1b7a06725bcdba9e67a03cd7145dd852b))

## [2.105.0](https://github.com/CodySwannGT/lisa/compare/vv2.104.7...v2.105.0) (2026-05-26)


### Features

* **usage-accounting:** dedupe child work rollups ([ba8db51](https://github.com/CodySwannGT/lisa/commit/ba8db513074e5fbcce08bbe9f4e964327af11393)), closes [#734](https://github.com/CodySwannGT/lisa/issues/734)


### Bug Fixes

* gate claude workflow by author association ([fffcfa0](https://github.com/CodySwannGT/lisa/commit/fffcfa0bc7440c2c2c28ed4addf444ffa712874b))
* **usage-accounting:** treat explicit childArtifacts: [] as recompute not fallback ([2f3f900](https://github.com/CodySwannGT/lisa/commit/2f3f9008d25c5aa6a318457755b38bf7302967e3))

### [2.104.7](https://github.com/CodySwannGT/lisa/compare/vv2.104.6...v2.104.7) (2026-05-26)


### Bug Fixes

* close PRDs only after verification ([131500e](https://github.com/CodySwannGT/lisa/commit/131500e85da9d853540097141169079509cb2965))

### [2.104.6](https://github.com/CodySwannGT/lisa/compare/vv2.104.5...v2.104.6) (2026-05-26)


### Bug Fixes

* **queue-status:** ignore invalid prd role overrides ([9d91ae5](https://github.com/CodySwannGT/lisa/commit/9d91ae5e1fd6306897531dc712fefd3443e3cf54))

### [2.104.5](https://github.com/CodySwannGT/lisa/compare/vv2.104.4...v2.104.5) (2026-05-26)


### Bug Fixes

* **ci:** don't file a 'Claude auto-fix failed' issue when loop-guard intentionally skipped ([98332e8](https://github.com/CodySwannGT/lisa/commit/98332e85eb3c554b0c9476c3c28054f6e43b3e46)), closes [#960](https://github.com/CodySwannGT/lisa/issues/960)

### [2.104.4](https://github.com/CodySwannGT/lisa/compare/vv2.104.3...v2.104.4) (2026-05-26)


### Bug Fixes

* add observedCadence assertion for hourly case and JSDoc for extractClaudeScheduleCadence ([11e7742](https://github.com/CodySwannGT/lisa/commit/11e77426269c84b9ee9accb864be1821f9f382b5)), closes [#896](https://github.com/CodySwannGT/lisa/issues/896)
* **council:** mark unexecuted first-round captures ([0d1ee1d](https://github.com/CodySwannGT/lisa/commit/0d1ee1dfe4bbde9a504e45ecd065fc96b0d06cb8))
* normalize claude schedule cadence ([a7ada49](https://github.com/CodySwannGT/lisa/commit/a7ada498d7c535dde7e70d44e044b1f5219fa661))
* parse latest Codex automation memory run ([e1c8265](https://github.com/CodySwannGT/lisa/commit/e1c826588297e5707da41e864b83ddcb45072606))
* **queue-status:** apply default github reader labels ([8c92544](https://github.com/CodySwannGT/lisa/commit/8c92544a5aac8dd275904d46467364876ee8e67d))
* repair automation-status fleet matching ([88d8854](https://github.com/CodySwannGT/lisa/commit/88d8854b7a7277d5f69c71fa548096836c174af4))

### [2.104.3](https://github.com/CodySwannGT/lisa/compare/vv2.104.2...v2.104.3) (2026-05-26)


### Documentation

* **github-build-intake:** preserve multi-repo containers ([c9bfdab](https://github.com/CodySwannGT/lisa/commit/c9bfdab1460f266dd18db82b5ba622cc7f803c68))

### [2.104.2](https://github.com/CodySwannGT/lisa/compare/vv2.104.1...v2.104.2) (2026-05-26)

### [2.104.1](https://github.com/CodySwannGT/lisa/compare/vv2.104.0...v2.104.1) (2026-05-26)

## [2.104.0](https://github.com/CodySwannGT/lisa/compare/vv2.103.1...v2.104.0) (2026-05-26)


### Features

* **wiki:** add status command surface ([9194c8e](https://github.com/CodySwannGT/lisa/commit/9194c8e419a3a66419c96b16ad315461283c1022))

### [2.103.1](https://github.com/CodySwannGT/lisa/compare/vv2.103.0...v2.103.1) (2026-05-26)


### Bug Fixes

* canonicalize codex lisa automation aliases ([4f1236b](https://github.com/CodySwannGT/lisa/commit/4f1236bc55413dc3a9e0ef2e36981d0a4b93f5b3))

## [2.103.0](https://github.com/CodySwannGT/lisa/compare/vv2.102.0...v2.103.0) (2026-05-26)


### Features

* **wiki:** render source freshness status ([210020b](https://github.com/CodySwannGT/lisa/commit/210020be7010f2173cc7c1b7d59686afb02ea034))

## [2.102.0](https://github.com/CodySwannGT/lisa/compare/vv2.101.1...v2.102.0) (2026-05-26)


### Features

* **base:** add /lisa:wiki:install bootstrap for the lisa-wiki plugin ([915d7b2](https://github.com/CodySwannGT/lisa/commit/915d7b20639d8e83714a1aa3301d639438935c79))


### Bug Fixes

* **config-resolution:** dedupe conflicting `usage` JSON example and stray docs ([90ea817](https://github.com/CodySwannGT/lisa/commit/90ea817e3c86a14920d91ddddf9be603364e922b)), closes [#2](https://github.com/CodySwannGT/lisa/issues/2) [#4](https://github.com/CodySwannGT/lisa/issues/4)
* **council:** pass cwd through buildCouncilDryRunPlan so worktree tests stay deterministic ([e0b8c3a](https://github.com/CodySwannGT/lisa/commit/e0b8c3a75c30df35a0e275cd165f7402ba37a2f7))
* **trampoline:** opt out of postinstall reconciliation under vitest/jest ([0ba447e](https://github.com/CodySwannGT/lisa/commit/0ba447ebf6781a02eb53d33c57b188baf4b485d2))

### [2.101.1](https://github.com/CodySwannGT/lisa/compare/vv2.101.0...v2.101.1) (2026-05-26)


### Bug Fixes

* fail unsupported queue-status vendor readers ([9d73597](https://github.com/CodySwannGT/lisa/commit/9d73597872a94a08f069d48c01b5538be4557418))

## [2.101.0](https://github.com/CodySwannGT/lisa/compare/vv2.100.2...v2.101.0) (2026-05-26)


### Features

* **intake-explain:** document prd repair gates ([ef6f9a3](https://github.com/CodySwannGT/lisa/commit/ef6f9a36729ad3fd7952a44b5270dd0f389bd8cf))


### Bug Fixes

* count empty doctor groups as skips ([1554af5](https://github.com/CodySwannGT/lisa/commit/1554af5bd5da7aba1b039475098e669beeb839b6))
* **doctor:** normalize direct aggregator statuses ([f3f2ed7](https://github.com/CodySwannGT/lisa/commit/f3f2ed70e10542df8c140867b86d84199b51722b))


### Documentation

* **wiki:** ingest incremental git history ([4c7312d](https://github.com/CodySwannGT/lisa/commit/4c7312d33904bfe63b31dfb96c4beed703f02e2c))

### [2.100.2](https://github.com/CodySwannGT/lisa/compare/vv2.100.1...v2.100.2) (2026-05-26)


### Bug Fixes

* align council execution policy inputs ([d6a99fd](https://github.com/CodySwannGT/lisa/commit/d6a99fd235c74a2ef40f09bf413542fd1905ed88))
* **council:** classify executor errors as failed ([c1bc307](https://github.com/CodySwannGT/lisa/commit/c1bc3073b1ead016f2cf31efacdce256859b1235))
* handle negated automation-status failures ([f91e07c](https://github.com/CodySwannGT/lisa/commit/f91e07ccb2e449be0c2aa5b8f3e8d4f068fcf4e8))
* make usage tokens reversible ([54019ea](https://github.com/CodySwannGT/lisa/commit/54019eaf389caf576c8bed97febb121b81d93d84))
* preserve decimal usage cost totals ([a4d6b84](https://github.com/CodySwannGT/lisa/commit/a4d6b84257e069874db905db3d4378e838dda771))
* recompute merged usage rollups ([2bdf9e3](https://github.com/CodySwannGT/lisa/commit/2bdf9e316c5e12e710a6ff71c6a8b555d02d4102))
* reject invalid usage numeric tokens ([93f5be0](https://github.com/CodySwannGT/lisa/commit/93f5be0fe81d7d513714d36508bec994e4983c12))
* reject missing council flag values ([9eb34a2](https://github.com/CodySwannGT/lisa/commit/9eb34a27edba8259ad4241a9916316abaaf534ca))


### Documentation

* explain intake build gates ([2ab8975](https://github.com/CodySwannGT/lisa/commit/2ab8975b7ca7ac44857a140b3f4b3228527eab8e))
* **intake-explain:** publish operator guidance ([1a1ea50](https://github.com/CodySwannGT/lisa/commit/1a1ea509300cddf1ed5724ad914a84688e09d12b))

### [2.100.1](https://github.com/CodySwannGT/lisa/compare/vv2.100.0...v2.100.1) (2026-05-26)


### Documentation

* explain intake ownership readiness ([7cc7df8](https://github.com/CodySwannGT/lisa/commit/7cc7df83031ad16f8e48201e7c8c0d5613d6c030))

## [2.100.0](https://github.com/CodySwannGT/lisa/compare/vv2.99.1...v2.100.0) (2026-05-26)


### Features

* **intake-explain:** resolve one-item contract routing ([e8c8825](https://github.com/CodySwannGT/lisa/commit/e8c8825c3407ed39c73ba7ca24c575aab94d12d4))

### [2.99.1](https://github.com/CodySwannGT/lisa/compare/vv2.99.0...v2.99.1) (2026-05-26)


### Documentation

* harden intake-explain operator contract ([0909b4c](https://github.com/CodySwannGT/lisa/commit/0909b4cac091046f36902935fb050f6faa229c51))

## [2.99.0](https://github.com/CodySwannGT/lisa/compare/vv2.98.1...v2.99.0) (2026-05-26)


### Features

* add intake-explain scaffold ([54098a3](https://github.com/CodySwannGT/lisa/commit/54098a3ed91cb95d6ed48735610153feff7232ca))

### [2.98.1](https://github.com/CodySwannGT/lisa/compare/vv2.98.0...v2.98.1) (2026-05-26)


### Documentation

* **wiki:** ingest incremental git history ([810cc55](https://github.com/CodySwannGT/lisa/commit/810cc5590c22bb214234d8748db02d9d6251d2ef))

## [2.98.0](https://github.com/CodySwannGT/lisa/compare/vv2.97.1...v2.98.0) (2026-05-26)


### Features

* **repair-intake:** batch close out stuck work ([62439d5](https://github.com/CodySwannGT/lisa/commit/62439d5128ab2062cd6e7e59bad57492e81baa60))

### [2.97.1](https://github.com/CodySwannGT/lisa/compare/vv2.97.0...v2.97.1) (2026-05-26)


### Documentation

* **queue-status:** add operator guidance ([8e143c9](https://github.com/CodySwannGT/lisa/commit/8e143c94dc3810c413c4d4b602d0dec0200daf76))

## [2.97.0](https://github.com/CodySwannGT/lisa/compare/vv2.96.0...v2.97.0) (2026-05-26)


### Features

* **queue-status:** add PRD queue readers ([ec926ac](https://github.com/CodySwannGT/lisa/commit/ec926acf982dd830d02cc8b250a9fa306d2b5068))


### Bug Fixes

* **queue-status:** pass raw roles to inferNamespaceAdopted to avoid false-positive ([2af8527](https://github.com/CodySwannGT/lisa/commit/2af8527624f2b4102207d6eb3ceaf3cb1ec4879b))

## [2.96.0](https://github.com/CodySwannGT/lisa/compare/vv2.95.0...v2.96.0) (2026-05-26)


### Features

* **queue-status:** add build queue readers ([ab9ce33](https://github.com/CodySwannGT/lisa/commit/ab9ce336ac7edf53df8d10b2971a66fafa3d50b9))

## [2.95.0](https://github.com/CodySwannGT/lisa/compare/vv2.94.0...v2.95.0) (2026-05-26)


### Features

* **queue-status:** classify queue health ([be8d807](https://github.com/CodySwannGT/lisa/commit/be8d807e0a8a848e3edf36a6e664f8fad27ebbf7))

## [2.94.0](https://github.com/CodySwannGT/lisa/compare/vv2.93.0...v2.94.0) (2026-05-26)


### Features

* share queue contract resolution ([#822](https://github.com/CodySwannGT/lisa/issues/822)) ([af1a338](https://github.com/CodySwannGT/lisa/commit/af1a3382777fd93d2231b1f37ec0826376d086a2))

## [2.93.0](https://github.com/CodySwannGT/lisa/compare/vv2.92.0...v2.93.0) (2026-05-26)


### Features

* **queue-status:** define grouped output contract ([7e7c016](https://github.com/CodySwannGT/lisa/commit/7e7c016d37f5ce78adcb12e28cc24b047c0ec6e6))

## [2.92.0](https://github.com/CodySwannGT/lisa/compare/vv2.91.4...v2.92.0) (2026-05-26)


### Features

* **queue-status:** scaffold command and skill surfaces ([6f3e467](https://github.com/CodySwannGT/lisa/commit/6f3e4679c601c6d4c8d0858b046f7a21cc441fff))

### [2.91.4](https://github.com/CodySwannGT/lisa/compare/vv2.91.3...v2.91.4) (2026-05-26)


### Documentation

* **github:** add project coordination rollout coverage ([c0076ab](https://github.com/CodySwannGT/lisa/commit/c0076ab07cebf6ebc722979a88572b478c2db99a))

### [2.91.3](https://github.com/CodySwannGT/lisa/compare/vv2.91.2...v2.91.3) (2026-05-26)


### Documentation

* **wiki:** ingest incremental git history ([ea01a84](https://github.com/CodySwannGT/lisa/commit/ea01a847d7e729c758ccfb62d8a92b6c6583a956))

### [2.91.2](https://github.com/CodySwannGT/lisa/compare/vv2.91.1...v2.91.2) (2026-05-26)


### Documentation

* add automation-status operator guidance ([8ddb5f0](https://github.com/CodySwannGT/lisa/commit/8ddb5f013e68072905d092778150b4ea70a9862a))

### [2.91.1](https://github.com/CodySwannGT/lisa/compare/vv2.91.0...v2.91.1) (2026-05-26)

## [2.91.0](https://github.com/CodySwannGT/lisa/compare/vv2.90.0...v2.91.0) (2026-05-26)


### Features

* **automation-status:** add Claude schedule adapter ([#802](https://github.com/CodySwannGT/lisa/issues/802)) ([dd12767](https://github.com/CodySwannGT/lisa/commit/dd12767835a33366d31e2e41f47cd23e3188ac16))

## [2.90.0](https://github.com/CodySwannGT/lisa/compare/vv2.89.0...v2.90.0) (2026-05-26)


### Features

* **automation-status:** inspect codex automation metadata ([d514c0e](https://github.com/CodySwannGT/lisa/commit/d514c0ef6f89496fa15dbebeb9a1994247b578e5))

## [2.89.0](https://github.com/CodySwannGT/lisa/compare/vv2.88.0...v2.89.0) (2026-05-26)


### Features

* **automation-status:** detect contract drift ([922de56](https://github.com/CodySwannGT/lisa/commit/922de5667e9891c870e94e0410b91f3f50e323d7))

## [2.88.0](https://github.com/CodySwannGT/lisa/compare/vv2.87.0...v2.88.0) (2026-05-26)


### Features

* **automation-status:** resolve expected fleet contract ([3199732](https://github.com/CodySwannGT/lisa/commit/31997323f76cea35cf33e06cecf409c88696cc48))

## [2.87.0](https://github.com/CodySwannGT/lisa/compare/vv2.86.0...v2.87.0) (2026-05-26)


### Features

* **automation-status:** add grouped fleet report renderer ([e3bc4d7](https://github.com/CodySwannGT/lisa/commit/e3bc4d74658f3bdc11b809398fd79769c65093d3))

## [2.86.0](https://github.com/CodySwannGT/lisa/compare/vv2.85.2...v2.86.0) (2026-05-26)


### Features

* **lisa:** scaffold automation-status surfaces ([1d004dc](https://github.com/CodySwannGT/lisa/commit/1d004dcd6e67b90966d396681795fc32908bd96a))

### [2.85.2](https://github.com/CodySwannGT/lisa/compare/vv2.85.1...v2.85.2) (2026-05-26)


### Documentation

* **wiki:** ingest incremental git history ([da1af52](https://github.com/CodySwannGT/lisa/commit/da1af5295aa0e19668660ec188709db11f9fac57))

### [2.85.1](https://github.com/CodySwannGT/lisa/compare/vv2.85.0...v2.85.1) (2026-05-26)


### Bug Fixes

* **codex:** block internal skill distribution ([ccb0e3b](https://github.com/CodySwannGT/lisa/commit/ccb0e3bb520bc2c060253558d7a4b0cb022f8ba3))

## [2.85.0](https://github.com/CodySwannGT/lisa/compare/vv2.84.1...v2.85.0) (2026-05-26)


### Features

* **skills:** guard council write mode ([931c4c4](https://github.com/CodySwannGT/lisa/commit/931c4c4f1d3c9a9b4ac2b7f6085e2cfdef5ea997))


### Bug Fixes

* **council:** propagate runtime to workspace guard detection ([96f0142](https://github.com/CodySwannGT/lisa/commit/96f0142e469216f3394169dce348aa0cdaa08982))

### [2.84.1](https://github.com/CodySwannGT/lisa/compare/vv2.84.0...v2.84.1) (2026-05-26)


### Bug Fixes

* **council:** sanitize runtime captures ([4f83acd](https://github.com/CodySwannGT/lisa/commit/4f83acd5a831908fe93c5f1919c68e710f43e765))

## [2.84.0](https://github.com/CodySwannGT/lisa/compare/vv2.83.0...v2.84.0) (2026-05-26)


### Features

* **council:** add runtime-filtered dry-run critique planning ([3d142f9](https://github.com/CodySwannGT/lisa/commit/3d142f9ac22f91345167a907967597da7f346252))


### Bug Fixes

* address CodeRabbit review on PR [#784](https://github.com/CodySwannGT/lisa/issues/784) ([e2c055e](https://github.com/CodySwannGT/lisa/commit/e2c055e0007800d1e2ac9adb0cdf552bb230e380))

## [2.83.0](https://github.com/CodySwannGT/lisa/compare/vv2.82.0...v2.83.0) (2026-05-25)


### Features

* **skills:** add first-round council consultation flow ([ca3693e](https://github.com/CodySwannGT/lisa/commit/ca3693ef0391ee011148e10cf2456111370860fe))

## [2.82.0](https://github.com/CodySwannGT/lisa/compare/vv2.81.0...v2.82.0) (2026-05-25)


### Features

* **skills:** add council runtime adapter planning ([478cff7](https://github.com/CodySwannGT/lisa/commit/478cff7b79a53d4f9e255a828bab808db7fb6e18))

## [2.81.0](https://github.com/CodySwannGT/lisa/compare/vv2.80.1...v2.81.0) (2026-05-25)


### Features

* **skills:** add harness parity council scaffold ([dfa595a](https://github.com/CodySwannGT/lisa/commit/dfa595ae5fbfb5e7740c56d1d2082304bb507920))

### [2.80.1](https://github.com/CodySwannGT/lisa/compare/vv2.80.0...v2.80.1) (2026-05-25)

## [2.80.0](https://github.com/CodySwannGT/lisa/compare/vv2.79.0...v2.80.0) (2026-05-25)


### Features

* **doctor:** define wiki delegation contract ([f38b197](https://github.com/CodySwannGT/lisa/commit/f38b197698b691dba232846d0994995b18c85da6))

## [2.79.0](https://github.com/CodySwannGT/lisa/compare/vv2.78.0...v2.79.0) (2026-05-25)


### Features

* document doctor automation readiness ([46a11ce](https://github.com/CodySwannGT/lisa/commit/46a11ce4c47201ee8e01b51d2f4581fffedf72cc))

## [2.78.0](https://github.com/CodySwannGT/lisa/compare/vv2.77.2...v2.78.0) (2026-05-25)


### Features

* **doctor:** validate github project readiness ([6ba4362](https://github.com/CodySwannGT/lisa/commit/6ba43628a863ba8e1b63b6a24f6a0ae62ce88f5d))

### [2.77.2](https://github.com/CodySwannGT/lisa/compare/vv2.77.1...v2.77.2) (2026-05-25)


### Documentation

* **doctor:** define vendor preflight readiness contract ([03b9375](https://github.com/CodySwannGT/lisa/commit/03b93756c2ea133689ad0dc85f74086137be25db))

### [2.77.1](https://github.com/CodySwannGT/lisa/compare/vv2.77.0...v2.77.1) (2026-05-25)


### Documentation

* lock doctor config readiness contract ([cc3fd99](https://github.com/CodySwannGT/lisa/commit/cc3fd9923fb301b2ec93ac7a1d42ac4c01dbc691))

## [2.77.0](https://github.com/CodySwannGT/lisa/compare/vv2.76.0...v2.77.0) (2026-05-25)


### Features

* **doctor:** add grouped report renderer ([1572c1e](https://github.com/CodySwannGT/lisa/commit/1572c1e6e9a3680513ae6f7197d0f0ef8ec3463e))

## [2.76.0](https://github.com/CodySwannGT/lisa/compare/vv2.75.1...v2.76.0) (2026-05-25)


### Features

* **doctor:** add doctor command scaffold ([27b2cea](https://github.com/CodySwannGT/lisa/commit/27b2ceafd2e93be9e7737599dc3e7681e98ed099))

### [2.75.1](https://github.com/CodySwannGT/lisa/compare/vv2.75.0...v2.75.1) (2026-05-25)

## [2.75.0](https://github.com/CodySwannGT/lisa/compare/vv2.74.1...v2.75.0) (2026-05-25)


### Features

* **config-resolution:** add usage pricing contract ([5983ed4](https://github.com/CodySwannGT/lisa/commit/5983ed4f49802393ea7a71528da1a1018b107271))

### [2.74.1](https://github.com/CodySwannGT/lisa/compare/vv2.74.0...v2.74.1) (2026-05-25)


### Documentation

* **wiki:** ingest incremental git history ([651f1fa](https://github.com/CodySwannGT/lisa/commit/651f1fae0135aaed67a51777d9affd43b9f001eb))
* wire usage accounting into delivery flows ([8958987](https://github.com/CodySwannGT/lisa/commit/8958987c831d4c077590c405e755f237e076d77b))

## [2.74.0](https://github.com/CodySwannGT/lisa/compare/vv2.73.0...v2.74.0) (2026-05-25)


### Features

* record lifecycle usage on research plan and debrief artifacts ([4625f23](https://github.com/CodySwannGT/lisa/commit/4625f23190c9205ed6afc440c6e7cfa9fc0a5fb8))

## [2.73.0](https://github.com/CodySwannGT/lisa/compare/vv2.72.0...v2.73.0) (2026-05-25)


### Features

* preserve usage ledgers in writers ([22cee0c](https://github.com/CodySwannGT/lisa/commit/22cee0c42297b9c31e34b7c1b25baa930d8c91f3))


### Bug Fixes

* align writer preservation tests ([6465537](https://github.com/CodySwannGT/lisa/commit/64655375fcce0cee3b09520856633ec390e70614))

## [2.72.0](https://github.com/CodySwannGT/lisa/compare/vv2.71.0...v2.72.0) (2026-05-25)


### Features

* add usage-accounting skill contract ([eaa6906](https://github.com/CodySwannGT/lisa/commit/eaa6906814fcb52f7f661817edfffee90b5f9fe6))

## [2.71.0](https://github.com/CodySwannGT/lisa/compare/vv2.70.0...v2.71.0) (2026-05-25)


### Features

* **utils:** add idempotent Lisa usage section utility ([070bc05](https://github.com/CodySwannGT/lisa/commit/070bc05bb296faefe9f7585cdff07b42e23a3558))

## [2.70.0](https://github.com/CodySwannGT/lisa/compare/vv2.69.2...v2.70.0) (2026-05-25)


### Features

* add usage accounting contract ([5e07aa7](https://github.com/CodySwannGT/lisa/commit/5e07aa700ce88c1b7fc4f64a476ca5707e7218e8))

### [2.69.2](https://github.com/CodySwannGT/lisa/compare/vv2.69.1...v2.69.2) (2026-05-25)


### Documentation

* **setup-github:** validate project coordination setup ([caa3130](https://github.com/CodySwannGT/lisa/commit/caa3130856fec382d8570efc42b6169bc11cf604))

### [2.69.1](https://github.com/CodySwannGT/lisa/compare/vv2.69.0...v2.69.1) (2026-05-25)


### Documentation

* **github:** preserve multi-repo containers ([d7150e5](https://github.com/CodySwannGT/lisa/commit/d7150e5a2a0822db24ff86948ad51abb78fa1cd9))

## [2.69.0](https://github.com/CodySwannGT/lisa/compare/vv2.68.0...v2.69.0) (2026-05-25)


### Features

* **github:** coordinate linked PR project membership ([aa4d556](https://github.com/CodySwannGT/lisa/commit/aa4d556384c38dcb034721f97a89064fdeaa9c64))

## [2.68.0](https://github.com/CodySwannGT/lisa/compare/vv2.67.0...v2.68.0) (2026-05-25)


### Features

* **github:** coordinate writer project membership ([ce4a5d2](https://github.com/CodySwannGT/lisa/commit/ce4a5d2f7f46b42ee2b0ee6b51f30a924dd476e3))

## [2.67.0](https://github.com/CodySwannGT/lisa/compare/vv2.66.0...v2.67.0) (2026-05-25)


### Features

* **github:** add project v2 utility contract ([d5525f7](https://github.com/CodySwannGT/lisa/commit/d5525f72d164e426cc69e85469108bc954b2f9e3))

## [2.66.0](https://github.com/CodySwannGT/lisa/compare/vv2.65.0...v2.66.0) (2026-05-25)


### Features

* **github:** document project validation modes ([4a5cedd](https://github.com/CodySwannGT/lisa/commit/4a5cedd9c0ebc49595033645089ec7e6853ea723))

## [2.65.0](https://github.com/CodySwannGT/lisa/compare/vv2.64.0...v2.65.0) (2026-05-25)


### Features

* **config:** add GitHub ProjectV2 coordination docs ([5606de0](https://github.com/CodySwannGT/lisa/commit/5606de0c7670c0a9b7b1d279c6b21b3bb2a3a0e5))

## [2.64.0](https://github.com/CodySwannGT/lisa/compare/vv2.63.2...v2.64.0) (2026-05-25)


### Features

* **intake:** add local assignee queue filter ([c32e3f3](https://github.com/CodySwannGT/lisa/commit/c32e3f3136b4ab8ea4d995649fab4701f4606459))

### [2.63.2](https://github.com/CodySwannGT/lisa/compare/vv2.63.1...v2.63.2) (2026-05-25)


### Documentation

* **wiki:** ingest git and roles connectors ([40a1a1d](https://github.com/CodySwannGT/lisa/commit/40a1a1d9ec58cdf477779b0181a1cf903542696c))

### [2.63.1](https://github.com/CodySwannGT/lisa/compare/vv2.63.0...v2.63.1) (2026-05-25)

## [2.63.0](https://github.com/CodySwannGT/lisa/compare/vv2.62.2...v2.63.0) (2026-05-25)


### Features

* **wiki:** add setup-automations / tear-down-automations to the wiki plugin ([d49cc4c](https://github.com/CodySwannGT/lisa/commit/d49cc4c47615107579b08b89070285d5f8dd8b07))

### [2.62.2](https://github.com/CodySwannGT/lisa/compare/vv2.62.1...v2.62.2) (2026-05-25)


### Bug Fixes

* **harper-fabric:** ignore per-resource generated files; exclude .codex from prettier ([d54d691](https://github.com/CodySwannGT/lisa/commit/d54d6913480bb86df27834d6ab2a12852e3ac17c))

### [2.62.1](https://github.com/CodySwannGT/lisa/compare/vv2.62.0...v2.62.1) (2026-05-25)

## [2.62.0](https://github.com/CodySwannGT/lisa/compare/vv2.61.1...v2.62.0) (2026-05-25)


### Features

* **automations:** add /setup-automations and /tear-down-automations skills ([3818d5a](https://github.com/CodySwannGT/lisa/commit/3818d5ac482afb1c2f21d43dd7f2e7f36a7a5851))
* **build-intake:** claim-time repo scoping for multi-repo trackers ([46fec29](https://github.com/CodySwannGT/lisa/commit/46fec2969742b27a5ef007a08452255190b1c3eb))
* **exploratory-qa:** file findings as lifecycle tickets + add build_ready write-control ([bb96411](https://github.com/CodySwannGT/lisa/commit/bb96411cb79bc76f1a4d58f3e217e43431abdc84))
* **implement:** rebase onto the ticket's target-environment branch before work; PR to that branch ([9255222](https://github.com/CodySwannGT/lisa/commit/92552221e0fe7c379dc69e5c3def466d3ecf8c4e))
* **intake:** close the PRD loop — dispatch verify-prd for shipped PRDs ([ea5574c](https://github.com/CodySwannGT/lisa/commit/ea5574c433c599b5b4b4d353197742a7d78c8132))
* **lisa-wiki-ingest:** bookend every ingest with branch sync + auto-merge PR ([586458a](https://github.com/CodySwannGT/lisa/commit/586458a88fa7c1585cb317c1d10a09ff81c1421c))
* **project-ideation:** persona-driven ideation that creates PRDs in the source ([415e4fb](https://github.com/CodySwannGT/lisa/commit/415e4fb6e7a084bdab98365796f18f85bb830a61))
* **repair-intake:** add /lisa:repair-intake recovery scanner ([795d5c0](https://github.com/CodySwannGT/lisa/commit/795d5c0f594cbc8ee54d3465f3368be9300ccadb))
* **verify-prd:** self-healing FAIL — re-open to ticketed + build-ready fix tickets (never blocked) ([e902fd3](https://github.com/CodySwannGT/lisa/commit/e902fd3cc559c655107ffe62d769037b71f3a7b8))


### Bug Fixes

* **skills:** address CodeRabbit review findings — doc clarity and correctness ([6604685](https://github.com/CodySwannGT/lisa/commit/66046854fffb778cbe6fe835be079dfec956c054))


### Documentation

* **verify-prd:** correct stale command description ([2ff3c5f](https://github.com/CodySwannGT/lisa/commit/2ff3c5ff0eb11447fb4fc1ab3257e9a8b594793d))

### [2.61.1](https://github.com/CodySwannGT/lisa/compare/vv2.61.0...v2.61.1) (2026-05-25)


### Bug Fixes

* **intake:** process one ready item per cycle ([b7e0fbc](https://github.com/CodySwannGT/lisa/commit/b7e0fbc80f3abba97d6d2af00c2fc41816cd678b))
* recognize all github build done labels ([b5712d9](https://github.com/CodySwannGT/lisa/commit/b5712d9eb1bb4bfd51e048225e111d54172c8f3e))
* remove github code-review build hop ([354966d](https://github.com/CodySwannGT/lisa/commit/354966d308f2b6eae25d7fcd4cca554c724809a1)), closes [#632](https://github.com/CodySwannGT/lisa/issues/632)

## [2.61.0](https://github.com/CodySwannGT/lisa/compare/vv2.60.1...v2.61.0) (2026-05-25)


### Features

* link build PRs to source issues ([dd5a4e0](https://github.com/CodySwannGT/lisa/commit/dd5a4e080865e1ffd4f593bf42f6466d73e25b93))

### [2.60.1](https://github.com/CodySwannGT/lisa/compare/vv2.60.0...v2.60.1) (2026-05-25)


### Bug Fixes

* **github-build-intake:** repair ready containers ([8a96ba8](https://github.com/CodySwannGT/lisa/commit/8a96ba8957492dc38b34a15876c40157a480452e))

## [2.60.0](https://github.com/CodySwannGT/lisa/compare/vv2.59.1...v2.60.0) (2026-05-25)


### Features

* add verified PRD lifecycle role ([5bccb29](https://github.com/CodySwannGT/lisa/commit/5bccb29dc91dbbee1bbc524ee41c0e3b2550f9ec))
* **github-build-intake:** hold ready issues with active blockers ([26609b4](https://github.com/CodySwannGT/lisa/commit/26609b4b12b57782142cf0e0a812edd0cb7e0312)), closes [#644](https://github.com/CodySwannGT/lisa/issues/644)


### Documentation

* add PRD rollup vendor matrix ([68a563a](https://github.com/CodySwannGT/lisa/commit/68a563ae499aa85bb4ecdebf8ec46a0a5e05cfb1))

### [2.59.1](https://github.com/CodySwannGT/lisa/compare/vv2.59.0...v2.59.1) (2026-05-25)

## [2.59.0](https://github.com/CodySwannGT/lisa/compare/vv2.58.0...v2.59.0) (2026-05-25)


### Features

* **skills:** ship project ideation distribution check ([e5f3f56](https://github.com/CodySwannGT/lisa/commit/e5f3f56bd1f0a31775d927fd250b0d0c9a5b2421))

## [2.58.0](https://github.com/CodySwannGT/lisa/compare/vv2.57.0...v2.58.0) (2026-05-24)


### Features

* **verify-prd:** idempotent reruns (no duplicate evidence, fix issues, or lifecycle labels) ([e335d5b](https://github.com/CodySwannGT/lisa/commit/e335d5bdd837cd9cebffa52e0999c2b4554b877a)), closes [#600](https://github.com/CodySwannGT/lisa/issues/600) [#600](https://github.com/CodySwannGT/lisa/issues/600) [#599](https://github.com/CodySwannGT/lisa/issues/599)

## [2.57.0](https://github.com/CodySwannGT/lisa/compare/vv2.56.0...v2.57.0) (2026-05-24)


### Features

* **verify-prd:** add FAIL path (shipped->blocked + failure report + linked fix issues) ([c967803](https://github.com/CodySwannGT/lisa/commit/c967803d655c1527771f4c47b9b4edd31234eed6)), closes [#597](https://github.com/CodySwannGT/lisa/issues/597) [#598](https://github.com/CodySwannGT/lisa/issues/598) [#600](https://github.com/CodySwannGT/lisa/issues/600) [#598](https://github.com/CodySwannGT/lisa/issues/598) [#599](https://github.com/CodySwannGT/lisa/issues/599) [#599](https://github.com/CodySwannGT/lisa/issues/599)

## [2.56.0](https://github.com/CodySwannGT/lisa/compare/vv2.55.0...v2.56.0) (2026-05-24)


### Features

* **skills:** require research-backed project ideation ([de8dc2b](https://github.com/CodySwannGT/lisa/commit/de8dc2bc4801004b4c1ed6d63d8833051c30dab8)), closes [#668](https://github.com/CodySwannGT/lisa/issues/668)
* **verify-prd:** add spec-conformance + empirical verification + PASS path (shipped->verified) ([2beb2b0](https://github.com/CodySwannGT/lisa/commit/2beb2b0a09876fdb9bfe4c89a87db99c120f9c3d)), closes [#597](https://github.com/CodySwannGT/lisa/issues/597) [#599](https://github.com/CodySwannGT/lisa/issues/599) [#600](https://github.com/CodySwannGT/lisa/issues/600) [#598](https://github.com/CodySwannGT/lisa/issues/598)

## [2.55.0](https://github.com/CodySwannGT/lisa/compare/vv2.55.0...v2.55.0) (2026-05-24)


### Features

* **skills:** require research-backed project ideation ([de8dc2b](https://github.com/CodySwannGT/lisa/commit/de8dc2bc4801004b4c1ed6d63d8833051c30dab8)), closes [#668](https://github.com/CodySwannGT/lisa/issues/668)

## [2.54.0](https://github.com/CodySwannGT/lisa/compare/vv2.53.0...v2.54.0) (2026-05-24)


### Features

* **skills:** add project ideation examples ([b2f674e](https://github.com/CodySwannGT/lisa/commit/b2f674ebad7de1e4c28b081bbafa0d344540535b))

## [2.53.0](https://github.com/CodySwannGT/lisa/compare/vv2.52.0...v2.53.0) (2026-05-24)


### Features

* **skills:** add base project-ideation skill ([#666](https://github.com/CodySwannGT/lisa/issues/666)) ([c244a69](https://github.com/CodySwannGT/lisa/commit/c244a69c97e3d5809da53408a8d97d1507d9f1b6))

## [2.52.0](https://github.com/CodySwannGT/lisa/compare/vv2.51.0...v2.52.0) (2026-05-24)


### Features

* **verify-prd:** scaffold command+skill with child-set read and terminal-child guard ([c80e4c6](https://github.com/CodySwannGT/lisa/commit/c80e4c653ae128a94676791970cd1735a8df7430)), closes [#553](https://github.com/CodySwannGT/lisa/issues/553) [#590](https://github.com/CodySwannGT/lisa/issues/590) [#587](https://github.com/CodySwannGT/lisa/issues/587) [#598](https://github.com/CodySwannGT/lisa/issues/598) [#599](https://github.com/CodySwannGT/lisa/issues/599) [#600](https://github.com/CodySwannGT/lisa/issues/600) [#597](https://github.com/CodySwannGT/lisa/issues/597)

## [2.51.0](https://github.com/CodySwannGT/lisa/compare/vv2.50.0...v2.51.0) (2026-05-24)


### Features

* **setup-confluence:** scaffold Verified parent page + dashboard tile + config persist ([81696fa](https://github.com/CodySwannGT/lisa/commit/81696faf041ad266b86e790d41a6d60bf8bc3e96)), closes [#593](https://github.com/CodySwannGT/lisa/issues/593) [#594](https://github.com/CodySwannGT/lisa/issues/594) [#595](https://github.com/CodySwannGT/lisa/issues/595) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#596](https://github.com/CodySwannGT/lisa/issues/596) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#593](https://github.com/CodySwannGT/lisa/issues/593) [#594](https://github.com/CodySwannGT/lisa/issues/594) [#595](https://github.com/CodySwannGT/lisa/issues/595)

## [2.50.0](https://github.com/CodySwannGT/lisa/compare/vv2.49.0...v2.50.0) (2026-05-24)


### Features

* **setup-notion:** map/create the Verified PRD status value idempotently ([be5b8ec](https://github.com/CodySwannGT/lisa/commit/be5b8ecfa40b2d02b5501a67e3c80f7db092245d)), closes [#593](https://github.com/CodySwannGT/lisa/issues/593) [#594](https://github.com/CodySwannGT/lisa/issues/594) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#595](https://github.com/CodySwannGT/lisa/issues/595) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#593](https://github.com/CodySwannGT/lisa/issues/593) [#594](https://github.com/CodySwannGT/lisa/issues/594)

## [2.49.0](https://github.com/CodySwannGT/lisa/compare/vv2.48.0...v2.49.0) (2026-05-24)


### Features

* **hooks:** accept Codex commit attribution in commit-msg guardrail ([38a8b43](https://github.com/CodySwannGT/lisa/commit/38a8b43c27901fc76c1528ab812c98c1f1e83d82))
* **setup-linear:** scaffold prd-verified PRD project label idempotently ([7152bd1](https://github.com/CodySwannGT/lisa/commit/7152bd1c2b2887c340505ca541fd3017d8e600e6)), closes [#593](https://github.com/CodySwannGT/lisa/issues/593) [#594](https://github.com/CodySwannGT/lisa/issues/594) [#591](https://github.com/CodySwannGT/lisa/issues/591) [#593](https://github.com/CodySwannGT/lisa/issues/593)

## [2.48.0](https://github.com/CodySwannGT/lisa/compare/vv2.47.1...v2.48.0) (2026-05-24)


### Features

* **setup-github:** scaffold prd-verified PRD label idempotently ([d17f393](https://github.com/CodySwannGT/lisa/commit/d17f393dae0629eead32a1340f18f75adb9debdc)), closes [#591](https://github.com/CodySwannGT/lisa/issues/591) [#593](https://github.com/CodySwannGT/lisa/issues/593) [#591](https://github.com/CodySwannGT/lisa/issues/591)

### [2.47.1](https://github.com/CodySwannGT/lisa/compare/vv2.47.0...v2.47.1) (2026-05-24)


### Documentation

* **prd-lifecycle:** add verified terminal state + verify vs verify-prd distinction ([c7c8374](https://github.com/CodySwannGT/lisa/commit/c7c83740dae5adda2f39d7855636e09e5b8b8e50)), closes [#553](https://github.com/CodySwannGT/lisa/issues/553) [#592](https://github.com/CodySwannGT/lisa/issues/592) [#553](https://github.com/CodySwannGT/lisa/issues/553)

## [2.47.0](https://github.com/CodySwannGT/lisa/compare/vv2.46.0...v2.47.0) (2026-05-24)


### Features

* **prd-lifecycle:** harden idempotency with match-by-ref-not-title ([#585](https://github.com/CodySwannGT/lisa/issues/585)) ([815ad09](https://github.com/CodySwannGT/lisa/commit/815ad093476cbcf8527128abb5652cceadaf04e3)), closes [#580](https://github.com/CodySwannGT/lisa/issues/580) [-#584](https://github.com/CodySwannGT/-/issues/584) [#579](https://github.com/CodySwannGT/lisa/issues/579)

## [2.46.0](https://github.com/CodySwannGT/lisa/compare/vv2.45.0...v2.46.0) (2026-05-24)


### Features

* **skills:** propagate PRD closure rollup to linear/confluence/notion intake ([22d8a3d](https://github.com/CodySwannGT/lisa/commit/22d8a3d2b369d95f193dc89c149fed857aaf7ceb)), closes [#583](https://github.com/CodySwannGT/lisa/issues/583) [#579](https://github.com/CodySwannGT/lisa/issues/579) [#584](https://github.com/CodySwannGT/lisa/issues/584)

## [2.45.0](https://github.com/CodySwannGT/lisa/compare/vv2.44.0...v2.45.0) (2026-05-24)


### Features

* **github-prd-intake:** add config-gated PRD closure rollup phase ([2d6f193](https://github.com/CodySwannGT/lisa/commit/2d6f1935055439d0cef3ca51f84fb9974c76f12c)), closes [#583](https://github.com/CodySwannGT/lisa/issues/583) [#525](https://github.com/CodySwannGT/lisa/issues/525) [#582](https://github.com/CodySwannGT/lisa/issues/582) [#584](https://github.com/CodySwannGT/lisa/issues/584)

## [2.44.0](https://github.com/CodySwannGT/lisa/compare/vv2.43.0...v2.44.0) (2026-05-24)


### Features

* **prd-backlink:** always-written, machine-readable generated-work section ([78ca342](https://github.com/CodySwannGT/lisa/commit/78ca34270e71a121bc8fc1f149bc3aaf7fb115e2)), closes [#582](https://github.com/CodySwannGT/lisa/issues/582) [#525](https://github.com/CodySwannGT/lisa/issues/525) [#580](https://github.com/CodySwannGT/lisa/issues/580) [#581](https://github.com/CodySwannGT/lisa/issues/581) [#579](https://github.com/CodySwannGT/lisa/issues/579)

## [2.43.0](https://github.com/CodySwannGT/lisa/compare/vv2.42.0...v2.43.0) (2026-05-24)


### Features

* **prd-backlink:** attach generated top-level work via Linear/JIRA native parent ([9448170](https://github.com/CodySwannGT/lisa/commit/9448170852ea054859ad31f5eea53e4cf35c9dba)), closes [#580](https://github.com/CodySwannGT/lisa/issues/580) [#525](https://github.com/CodySwannGT/lisa/issues/525) [#582](https://github.com/CodySwannGT/lisa/issues/582) [#579](https://github.com/CodySwannGT/lisa/issues/579) [#581](https://github.com/CodySwannGT/lisa/issues/581)

## [2.42.0](https://github.com/CodySwannGT/lisa/compare/vv2.41.1...v2.42.0) (2026-05-24)


### Features

* **prd-backlink:** link generated Epic as native GitHub sub-issue of the PRD ([69bf36b](https://github.com/CodySwannGT/lisa/commit/69bf36b2a69ef3c621b1f02a93010449f7433a9e)), closes [#525](https://github.com/CodySwannGT/lisa/issues/525) [#579](https://github.com/CodySwannGT/lisa/issues/579) [#581](https://github.com/CodySwannGT/lisa/issues/581) [#582](https://github.com/CodySwannGT/lisa/issues/582) [#580](https://github.com/CodySwannGT/lisa/issues/580)

### [2.41.1](https://github.com/CodySwannGT/lisa/compare/vv2.41.0...v2.41.1) (2026-05-24)


### Bug Fixes

* harden git submit pr merge loop ([b352505](https://github.com/CodySwannGT/lisa/commit/b35250577aed22cedf2e49a2ff0a23238b725ba4)), closes [#612](https://github.com/CodySwannGT/lisa/issues/612)

## [2.41.0](https://github.com/CodySwannGT/lisa/compare/vv2.40.0...v2.41.0) (2026-05-24)


### Features

* **rules:** add vendor-neutral prd-lifecycle-rollup rule and wire config schema ([2940335](https://github.com/CodySwannGT/lisa/commit/294033576b38e20da3264eb055d0eebd5b8d63c8)), closes [#525](https://github.com/CodySwannGT/lisa/issues/525) [#580](https://github.com/CodySwannGT/lisa/issues/580) [#586](https://github.com/CodySwannGT/lisa/issues/586) [#579](https://github.com/CodySwannGT/lisa/issues/579)

## [2.40.0](https://github.com/CodySwannGT/lisa/compare/vv2.39.4...v2.40.0) (2026-05-24)


### Features

* close terminal work items natively ([19385eb](https://github.com/CodySwannGT/lisa/commit/19385ebbd6d1608fc475c1be9f548bd763909915)), closes [#613](https://github.com/CodySwannGT/lisa/issues/613)

### [2.39.4](https://github.com/CodySwannGT/lisa/compare/vv2.39.3...v2.39.4) (2026-05-24)

### [2.39.3](https://github.com/CodySwannGT/lisa/compare/vv2.39.2...v2.39.3) (2026-05-24)

### [2.39.2](https://github.com/CodySwannGT/lisa/compare/vv2.39.1...v2.39.2) (2026-05-24)

### [2.39.1](https://github.com/CodySwannGT/lisa/compare/vv2.39.0...v2.39.1) (2026-05-24)

## [2.39.0](https://github.com/CodySwannGT/lisa/compare/vv2.38.0...v2.39.0) (2026-05-24)


### Features

* **codex:** derive humanized display_name/short_description/default_prompt from frontmatter ([#548](https://github.com/CodySwannGT/lisa/issues/548)) ([925d625](https://github.com/CodySwannGT/lisa/commit/925d625df25c02802b5e353b890cc2954ab56f88)), closes [#547](https://github.com/CodySwannGT/lisa/issues/547)

## [2.38.0](https://github.com/CodySwannGT/lisa/compare/vv2.37.0...v2.38.0) (2026-05-24)


### Features

* **codex:** walk skills and emit per-skill agents/openai.yaml ([#547](https://github.com/CodySwannGT/lisa/issues/547)) ([c095a24](https://github.com/CodySwannGT/lisa/commit/c095a24798d6796c6ffe8ad1a77e23f6547ed31d)), closes [#545](https://github.com/CodySwannGT/lisa/issues/545) [#546](https://github.com/CodySwannGT/lisa/issues/546) [#521](https://github.com/CodySwannGT/lisa/issues/521) [#548](https://github.com/CodySwannGT/lisa/issues/548)

## [2.37.0](https://github.com/CodySwannGT/lisa/compare/vv2.36.0...v2.37.0) (2026-05-24)


### Features

* **codex:** add deterministic openai.yaml serializer to artifact generator ([0f050b4](https://github.com/CodySwannGT/lisa/commit/0f050b4ab1d2ff5dcf068a047ade8ac08e2d1f41)), closes [#547](https://github.com/CodySwannGT/lisa/issues/547) [#548](https://github.com/CodySwannGT/lisa/issues/548) [#546](https://github.com/CodySwannGT/lisa/issues/546)

## [2.36.0](https://github.com/CodySwannGT/lisa/compare/vv2.35.0...v2.36.0) (2026-05-24)


### Features

* **codex:** add SKILL.md frontmatter parser to artifact generator ([cd91672](https://github.com/CodySwannGT/lisa/commit/cd916725921a61f609e3825b74f895ed5f9c1276)), closes [#521](https://github.com/CodySwannGT/lisa/issues/521) [#533](https://github.com/CodySwannGT/lisa/issues/533) [#546](https://github.com/CodySwannGT/lisa/issues/546) [#547](https://github.com/CodySwannGT/lisa/issues/547) [#548](https://github.com/CodySwannGT/lisa/issues/548) [#545](https://github.com/CodySwannGT/lisa/issues/545)

## [2.35.0](https://github.com/CodySwannGT/lisa/compare/vv2.34.0...v2.35.0) (2026-05-24)


### Features

* **skills:** mirror leaf-only claim gate into jira/linear build-intake + tracker shim ([2abe983](https://github.com/CodySwannGT/lisa/commit/2abe9835c69b6181ce9a4409b6be9634aad3d4f6)), closes [#543](https://github.com/CodySwannGT/lisa/issues/543) [#542](https://github.com/CodySwannGT/lisa/issues/542) [#543](https://github.com/CodySwannGT/lisa/issues/543)

## [2.34.0](https://github.com/CodySwannGT/lisa/compare/vv2.33.2...v2.34.0) (2026-05-24)


### Features

* **codex:** register lisa-wiki plugin in the marketplace installer ([f177d9c](https://github.com/CodySwannGT/lisa/commit/f177d9cb58efb95d8106856f3291310ab00e5f73))
* **validators:** mirror leaf-only build-ready gate into jira/linear validators ([fb1ef4c](https://github.com/CodySwannGT/lisa/commit/fb1ef4cc7e5219d8955def64f9500a2506b608f5)), closes [#540](https://github.com/CodySwannGT/lisa/issues/540) [#541](https://github.com/CodySwannGT/lisa/issues/541) [#541](https://github.com/CodySwannGT/lisa/issues/541)

### [2.33.2](https://github.com/CodySwannGT/lisa/compare/vv2.33.1...v2.33.2) (2026-05-24)

### [2.33.1](https://github.com/CodySwannGT/lisa/compare/vv2.33.0...v2.33.1) (2026-05-24)


### Bug Fixes

* wire setup:deploy-key script into host project package.json ([df1208a](https://github.com/CodySwannGT/lisa/commit/df1208a10bc352e7b1fb3b282a4281f353fce9b4))

## [2.33.0](https://github.com/CodySwannGT/lisa/compare/vv2.32.0...v2.33.0) (2026-05-24)


### Features

* **to-tracker:** mirror leaf-only build-ready labeling into notion/confluence/linear ([93922f2](https://github.com/CodySwannGT/lisa/commit/93922f288f00500a1c5755bb31289e9a3b219dad)), closes [#538](https://github.com/CodySwannGT/lisa/issues/538) [#538](https://github.com/CodySwannGT/lisa/issues/538) [#539](https://github.com/CodySwannGT/lisa/issues/539) [#539](https://github.com/CodySwannGT/lisa/issues/539)

## [2.32.0](https://github.com/CodySwannGT/lisa/compare/vv2.31.0...v2.32.0) (2026-05-24)


### Features

* **sync:** implement parent status rollup across GitHub/JIRA/Linear ([#544](https://github.com/CodySwannGT/lisa/issues/544)) ([a277037](https://github.com/CodySwannGT/lisa/commit/a277037ba5daad78ea5f6cf20d021e99611dbb1a)), closes [#538](https://github.com/CodySwannGT/lisa/issues/538) [#540](https://github.com/CodySwannGT/lisa/issues/540) [#542](https://github.com/CodySwannGT/lisa/issues/542)

## [2.31.0](https://github.com/CodySwannGT/lisa/compare/vv2.30.0...v2.31.0) (2026-05-24)


### Features

* **plugins:** add lisa-openclaw — connect staff to Telegram/Slack via OpenClaw ([2a7d85c](https://github.com/CodySwannGT/lisa/commit/2a7d85ca8788ce7aa990bdbeb584be75b684abfe))

## [2.30.0](https://github.com/CodySwannGT/lisa/compare/vv2.29.0...v2.30.0) (2026-05-24)


### Features

* **github-build-intake:** skip/safe-block parents with open child work (leaf-only claim gate) ([65c9186](https://github.com/CodySwannGT/lisa/commit/65c91862921dde8a1627a5b93ec025e0583c6aa0)), closes [#538](https://github.com/CodySwannGT/lisa/issues/538) [#540](https://github.com/CodySwannGT/lisa/issues/540) [#542](https://github.com/CodySwannGT/lisa/issues/542) [#542](https://github.com/CodySwannGT/lisa/issues/542)

## [2.29.0](https://github.com/CodySwannGT/lisa/compare/vv2.28.0...v2.29.0) (2026-05-24)


### Features

* **github-validate-issue:** add leaf-only build-ready gate (S15) ([bbdfac2](https://github.com/CodySwannGT/lisa/commit/bbdfac2f117715c5f68722527f4622697c06d190)), closes [#538](https://github.com/CodySwannGT/lisa/issues/538) [#540](https://github.com/CodySwannGT/lisa/issues/540)

## [2.28.0](https://github.com/CodySwannGT/lisa/compare/vv2.27.0...v2.28.0) (2026-05-24)


### Features

* **github-to-tracker:** apply build-ready label only to leaf sub-tasks ([d702c9b](https://github.com/CodySwannGT/lisa/commit/d702c9b8b9352691335b33a3439479f0e6f32d89)), closes [#538](https://github.com/CodySwannGT/lisa/issues/538)

## [2.27.0](https://github.com/CodySwannGT/lisa/compare/vv2.26.3...v2.27.0) (2026-05-24)


### Features

* **rules:** add leaf-only-invariant + parent rollup vendor-neutral rule ([a75b560](https://github.com/CodySwannGT/lisa/commit/a75b56067ab770521d6cf5c2e93f4be170c24303)), closes [#522](https://github.com/CodySwannGT/lisa/issues/522) [#537](https://github.com/CodySwannGT/lisa/issues/537)


### Documentation

* **rules:** drop PRD-only 'ticketed' from build-lifecycle rollup terminals ([346ab10](https://github.com/CodySwannGT/lisa/commit/346ab101892d7f0317fc2dd8a2020bdedca27196)), closes [#610](https://github.com/CodySwannGT/lisa/issues/610)

### [2.26.3](https://github.com/CodySwannGT/lisa/compare/vv2.26.2...v2.26.3) (2026-05-23)


### Documentation

* add documentation source path rules ([440c8bd](https://github.com/CodySwannGT/lisa/commit/440c8bdb58ba21c42cf5dde3bd996e61ac5e4283))

### [2.26.2](https://github.com/CodySwannGT/lisa/compare/vv2.26.1...v2.26.2) (2026-05-23)


### Bug Fixes

* **ci:** soft-fail GitGuardian quota exhaustion ([#606](https://github.com/CodySwannGT/lisa/issues/606)) ([393511b](https://github.com/CodySwannGT/lisa/commit/393511b6276d8a3553a1787fafe965ce0502a4cc))
* **ci:** use supported ggshield scan flags ([#609](https://github.com/CodySwannGT/lisa/issues/609)) ([dbce535](https://github.com/CodySwannGT/lisa/commit/dbce535f5f3ac71febca68e4a7f18c70b1cb327d))
* **codex:** route lifecycle teams without TeamCreate ([#601](https://github.com/CodySwannGT/lisa/issues/601)) ([d4acfd5](https://github.com/CodySwannGT/lisa/commit/d4acfd5b32eca3b83c267649fadb3516bbbb4ac1))

### [2.26.1](https://github.com/CodySwannGT/lisa/compare/vv2.26.0...v2.26.1) (2026-05-23)


### Bug Fixes

* **codex:** make edit hooks fire on apply_patch and block migration edits ([b2116ef](https://github.com/CodySwannGT/lisa/commit/b2116ef81015c79aad29ee840d344441de86f300))


### Documentation

* **skill:** add allowed-tools to lisa-codex-parity frontmatter ([48e1d05](https://github.com/CodySwannGT/lisa/commit/48e1d056fa3aef729e1bacb3a2e13cca857de24b)), closes [#523](https://github.com/CodySwannGT/lisa/issues/523)
* **skill:** add lisa-codex-parity skill for Claude<->Codex feature parity ([b328a80](https://github.com/CodySwannGT/lisa/commit/b328a805eb720a95be18a4855f3427a70eaac882))

## [2.26.0](https://github.com/CodySwannGT/lisa/compare/vv2.25.5...v2.26.0) (2026-05-23)


### Features

* **plugins:** add exploratory-qa skill and command to expo, rails, harper-fabric ([ede7add](https://github.com/CodySwannGT/lisa/commit/ede7addcb5f37a297c6b8eaefb6cb3a528ef0b29))

### [2.25.5](https://github.com/CodySwannGT/lisa/compare/vv2.25.4...v2.25.5) (2026-05-23)


### Bug Fixes

* **harper-fabric:** ignore generated web in prettier ([8e87cae](https://github.com/CodySwannGT/lisa/commit/8e87cae19cb2cf59920807f1a59efdb3e11a198c))

### [2.25.4](https://github.com/CodySwannGT/lisa/compare/vv2.25.3...v2.25.4) (2026-05-23)


### Bug Fixes

* **harper-fabric:** stop creating Jest local config ([303f3e7](https://github.com/CodySwannGT/lisa/commit/303f3e7aa72a99586b91a9a6da2f9321b6a753be))

### [2.25.3](https://github.com/CodySwannGT/lisa/compare/vv2.25.2...v2.25.3) (2026-05-23)

### [2.25.2](https://github.com/CodySwannGT/lisa/compare/vv2.25.1...v2.25.2) (2026-05-23)


### Bug Fixes

* **harper-fabric:** align package script defaults with rootDir:src emit ([#515](https://github.com/CodySwannGT/lisa/issues/515)) ([ddffad3](https://github.com/CodySwannGT/lisa/commit/ddffad3f637c23cecf728652334a8f5abead30ae))

### [2.25.1](https://github.com/CodySwannGT/lisa/compare/vv2.25.0...v2.25.1) (2026-05-23)


### Bug Fixes

* **marketplace:** register lisa-harper-fabric and guard marketplace coverage ([#512](https://github.com/CodySwannGT/lisa/issues/512)) ([3f2f72b](https://github.com/CodySwannGT/lisa/commit/3f2f72be8bbf2043ea8711ce15ad127aa7428303))
* **setup:** make Windows credential read functional via Win32 CredRead ([#513](https://github.com/CodySwannGT/lisa/issues/513)) ([efde416](https://github.com/CodySwannGT/lisa/commit/efde416799c347098fdcb5e910f44b4a6feff61b)), closes [#509](https://github.com/CodySwannGT/lisa/issues/509)

## [2.25.0](https://github.com/CodySwannGT/lisa/compare/vv2.24.0...v2.25.0) (2026-05-23)


### Features

* lisa-wiki — distributable LLM Wiki plugin (Claude + Codex) ([#510](https://github.com/CodySwannGT/lisa/issues/510)) ([36f9fc1](https://github.com/CodySwannGT/lisa/commit/36f9fc1cc346c05ca562b940bbe99d9cdebf9106))

## [2.24.0](https://github.com/CodySwannGT/lisa/compare/vv2.23.2...v2.24.0) (2026-05-23)


### Features

* **setup:** add setup-github and setup-linear skills ([#509](https://github.com/CodySwannGT/lisa/issues/509)) ([8e10921](https://github.com/CodySwannGT/lisa/commit/8e10921e73cbe06e9d2db47a059768bcbfc36762))

### [2.23.2](https://github.com/CodySwannGT/lisa/compare/vv2.23.1...v2.23.2) (2026-05-22)

### [2.23.1](https://github.com/CodySwannGT/lisa/compare/vv2.23.0...v2.23.1) (2026-05-22)


### Bug Fixes

* make team bootstrap runtime-aware ([431f6ad](https://github.com/CodySwannGT/lisa/commit/431f6add82ffe859ec79ad798bb8519e1fed3bd6))


### Documentation

* **implement:** resolve team-always vs no-team-fallback contradiction ([b922291](https://github.com/CodySwannGT/lisa/commit/b922291c3b72c06256f6dafe917195f494410fd1))

## [2.23.0](https://github.com/CodySwannGT/lisa/compare/vv2.21.1...v2.23.0) (2026-05-22)


### Features

* **config:** re-land wiped PRs [#471](https://github.com/CodySwannGT/lisa/issues/471) + [#478](https://github.com/CodySwannGT/lisa/issues/478), guard against artifact-only plugin edits ([#505](https://github.com/CodySwannGT/lisa/issues/505)) ([8be8f9d](https://github.com/CodySwannGT/lisa/commit/8be8f9d6cec0cee29415dfe1750ca66aa4cc3568))

## [2.22.0](https://github.com/CodySwannGT/lisa/compare/vv2.21.1...v2.22.0) (2026-05-22)


### Features

* **config:** re-land wiped PRs [#471](https://github.com/CodySwannGT/lisa/issues/471) + [#478](https://github.com/CodySwannGT/lisa/issues/478), guard against artifact-only plugin edits ([#505](https://github.com/CodySwannGT/lisa/issues/505)) ([8be8f9d](https://github.com/CodySwannGT/lisa/commit/8be8f9d6cec0cee29415dfe1750ca66aa4cc3568))

### [2.21.1](https://github.com/CodySwannGT/lisa/compare/vv2.21.0...v2.21.1) (2026-05-21)

## [2.21.0](https://github.com/CodySwannGT/lisa/compare/vv2.20.0...v2.21.0) (2026-05-21)


### Features

* add Harper/Fabric runtime knowledge skills ([#490](https://github.com/CodySwannGT/lisa/issues/490)) ([43d9665](https://github.com/CodySwannGT/lisa/commit/43d9665340690c31e9137d5d1d9d151adcefee59))

## [2.20.0](https://github.com/CodySwannGT/lisa/compare/vv2.19.1...v2.20.0) (2026-05-21)


### Features

* add harper fabric project type ([dfe5e96](https://github.com/CodySwannGT/lisa/commit/dfe5e966ac3aa2a2752ba14bf2fda41dcd7e8867))

### [2.19.1](https://github.com/CodySwannGT/lisa/compare/vv2.19.0...v2.19.1) (2026-05-21)

## [2.19.0](https://github.com/CodySwannGT/lisa/compare/vv2.18.0...v2.19.0) (2026-05-21)


### Features

* **lisa-update-projects:** worktree per project, auto-merge, blocker fix, self-upgrade ([#479](https://github.com/CodySwannGT/lisa/issues/479)) ([b0c6a41](https://github.com/CodySwannGT/lisa/commit/b0c6a411e23248b28fff8ebbf32d80b64d4576bd))

## [2.18.0](https://github.com/CodySwannGT/lisa/compare/vv2.17.0...v2.18.0) (2026-05-20)


### Features

* **verification:** per-work-unit evidence manifest + work-time cross-repo split ([#478](https://github.com/CodySwannGT/lisa/issues/478)) ([7295678](https://github.com/CodySwannGT/lisa/commit/729567808d4963ca8b397623d7cdb10de8cbc15c)), closes [#7](https://github.com/CodySwannGT/lisa/issues/7)

## [2.17.0](https://github.com/CodySwannGT/lisa/compare/vv2.16.9...v2.17.0) (2026-05-19)


### Features

* **plugins:** declare plugin dependency graph ([#477](https://github.com/CodySwannGT/lisa/issues/477)) ([93e2b5c](https://github.com/CodySwannGT/lisa/commit/93e2b5cd1aebb4a518054089a1070465c998feca))

### [2.16.9](https://github.com/CodySwannGT/lisa/compare/vv2.16.8...v2.16.9) (2026-05-15)


### Documentation

* **agents:** require ingestion PR auto-merge ([#475](https://github.com/CodySwannGT/lisa/issues/475)) ([123dce2](https://github.com/CodySwannGT/lisa/commit/123dce2778b8971ba7474b3083c1af6596206bd6))
* **agents:** require ingestion PR auto-merge ([#476](https://github.com/CodySwannGT/lisa/issues/476)) ([2044b46](https://github.com/CodySwannGT/lisa/commit/2044b46df64341c90ea3ab1132ebcedb8824c6b2))

### [2.16.8](https://github.com/CodySwannGT/lisa/compare/vv2.16.7...v2.16.8) (2026-05-14)


### Bug Fixes

* **sync-down-branches:** open sync PR via Claude so CI triggers ([#474](https://github.com/CodySwannGT/lisa/issues/474)) ([e13a2b7](https://github.com/CodySwannGT/lisa/commit/e13a2b7d60cbb4861a6abc0654f1b305fa4ec4e6))

### [2.16.7](https://github.com/CodySwannGT/lisa/compare/vv2.16.6...v2.16.7) (2026-05-14)

### [2.16.6](https://github.com/CodySwannGT/lisa/compare/vv2.16.5...v2.16.6) (2026-05-14)


### Documentation

* make wiki canonical documentation home ([#472](https://github.com/CodySwannGT/lisa/issues/472)) ([4ec1ebf](https://github.com/CodySwannGT/lisa/commit/4ec1ebf109d0b0e589f4a8e9d96010dfeb77431a)), closes [#635](https://github.com/CodySwannGT/lisa/issues/635)

### [2.16.5](https://github.com/CodySwannGT/lisa/compare/vv2.16.4...v2.16.5) (2026-05-13)

### [2.16.4](https://github.com/CodySwannGT/lisa/compare/vv2.16.3...v2.16.4) (2026-05-12)


### Bug Fixes

* **quality:** harden audit-exclusions loader against set -e ([#470](https://github.com/CodySwannGT/lisa/issues/470)) ([0d81b56](https://github.com/CodySwannGT/lisa/commit/0d81b56ece1946bb84ed924aba99e0bc7a79e000)), closes [#635](https://github.com/CodySwannGT/lisa/issues/635)

### [2.16.3](https://github.com/CodySwannGT/lisa/compare/vv2.16.2...v2.16.3) (2026-05-12)


### Bug Fixes

* **templates:** clarify fast-uri reachability via aws-cdk-lib ([#469](https://github.com/CodySwannGT/lisa/issues/469)) ([b11d385](https://github.com/CodySwannGT/lisa/commit/b11d385cf7d1a3069a01b4f9b9f20154dfafdf2a))

### [2.16.2](https://github.com/CodySwannGT/lisa/compare/vv2.16.1...v2.16.2) (2026-05-12)


### Bug Fixes

* **expo:** restore useFocusEffect/useIsFocused mocks in jest.setup.ts ([#468](https://github.com/CodySwannGT/lisa/issues/468)) ([1ce1610](https://github.com/CodySwannGT/lisa/commit/1ce1610664ebc532c61542ef34624daa8cc45df5))

### [2.16.1](https://github.com/CodySwannGT/lisa/compare/vv2.16.0...v2.16.1) (2026-05-12)


### Bug Fixes

* **templates:** bump axios floor to >=1.15.2 and exclude fast-uri advisories ([#467](https://github.com/CodySwannGT/lisa/issues/467)) ([1939ea5](https://github.com/CodySwannGT/lisa/commit/1939ea59a6da21381df622778de5a6f6aa3a19a4))

## [2.16.0](https://github.com/CodySwannGT/lisa/compare/vv2.15.1...v2.16.0) (2026-05-11)


### Features

* **skills:** single-repo scope on work units, auto-split during decomposition ([#466](https://github.com/CodySwannGT/lisa/issues/466)) ([df69670](https://github.com/CodySwannGT/lisa/commit/df696701ce6c432ee39e67ff141a84eea28ee3ba))

### [2.15.1](https://github.com/CodySwannGT/lisa/compare/vv2.15.0...v2.15.1) (2026-05-07)


### Bug Fixes

* **templates:** restore amplify/rubocop-todo ignores and harden sync-down ([#465](https://github.com/CodySwannGT/lisa/issues/465)) ([c329b5b](https://github.com/CodySwannGT/lisa/commit/c329b5be0aac2bb172489d480ecab96bd776c3b7))

## [2.15.0](https://github.com/CodySwannGT/lisa/compare/vv2.14.0...v2.15.0) (2026-05-07)


### Features

* **actions:** add Claude-assisted back-sync workflow for env chains ([#464](https://github.com/CodySwannGT/lisa/issues/464)) ([967f0dc](https://github.com/CodySwannGT/lisa/commit/967f0dcc4030df78b7c82f7f10dcde1b0ac6e87d))

## [2.14.0](https://github.com/CodySwannGT/lisa/compare/vv2.13.0...v2.14.0) (2026-05-06)


### Features

* **rules:** forbid squash-merging promotion PRs ([9ef2bea](https://github.com/CodySwannGT/lisa/commit/9ef2bea7ccf88524a6d95ad3ee7dc1577c4cefe8))


### Bug Fixes

* **git-submit-pr:** scope --merge to promotion PRs, --squash for feature PRs ([3989bb2](https://github.com/CodySwannGT/lisa/commit/3989bb2e5048dc6e50a8d2498979b10968ff7418))

## [2.13.0](https://github.com/CodySwannGT/lisa/compare/vv2.12.0...v2.13.0) (2026-05-06)


### Features

* **tracker-evidence:** add tracker-agnostic UI evidence checklist ([#462](https://github.com/CodySwannGT/lisa/issues/462)) ([08cc233](https://github.com/CodySwannGT/lisa/commit/08cc233932c371687da69b255a97f83838329147))

## [2.12.0](https://github.com/CodySwannGT/lisa/compare/vv2.11.1...v2.12.0) (2026-05-05)


### Features

* **jira-read-ticket:** add download-attachment helper ([#461](https://github.com/CodySwannGT/lisa/issues/461)) ([2eef6b3](https://github.com/CodySwannGT/lisa/commit/2eef6b3aaa7db70a0738156de29b06da85c97580))

### [2.11.1](https://github.com/CodySwannGT/lisa/compare/vv2.11.0...v2.11.1) (2026-05-02)


### Documentation

* **readme:** rewrite Working With Lisa around top-level workflows ([#460](https://github.com/CodySwannGT/lisa/issues/460)) ([0c96720](https://github.com/CodySwannGT/lisa/commit/0c96720e9c12284ed8408f8fefe1db3adaa42150))

## [2.11.0](https://github.com/CodySwannGT/lisa/compare/vv2.10.1...v2.11.0) (2026-05-01)


### Features

* **tracker:** expand .lisa.config.json schema and add Linear as destination tracker ([#459](https://github.com/CodySwannGT/lisa/issues/459)) ([e730286](https://github.com/CodySwannGT/lisa/commit/e730286cccf9a7bb57ec19d015a53afd7d73f657))

### [2.10.1](https://github.com/CodySwannGT/lisa/compare/vv2.10.0...v2.10.1) (2026-05-01)

## [2.10.0](https://github.com/CodySwannGT/lisa/compare/vv2.9.1...v2.10.0) (2026-04-30)


### Features

* **skills:** add Edge Case Brainstorm sub-flow, Debrief flow, and PRD back-link ([#457](https://github.com/CodySwannGT/lisa/issues/457)) ([2edb0d2](https://github.com/CodySwannGT/lisa/commit/2edb0d2c515755ce41534c300a4386029726087c))

### [2.9.1](https://github.com/CodySwannGT/lisa/compare/vv2.9.0...v2.9.1) (2026-04-29)


### Bug Fixes

* **strategies:** child stack create-only overrides parent for same path ([#448](https://github.com/CodySwannGT/lisa/issues/448)) ([f87f399](https://github.com/CodySwannGT/lisa/commit/f87f39994837f32d348fd5c90de74325f6cdb424))

## [2.9.0](https://github.com/CodySwannGT/lisa/compare/vv2.8.10...v2.9.0) (2026-04-29)


### Features

* **hooks:** mechanically enforce TeamCreate-first for lifecycle skills ([#456](https://github.com/CodySwannGT/lisa/issues/456)) ([80df08a](https://github.com/CodySwannGT/lisa/commit/80df08a2a9d2364cdbf3ad222dfe5ff33bf72d94)), closes [#455](https://github.com/CodySwannGT/lisa/issues/455)

### [2.8.10](https://github.com/CodySwannGT/lisa/compare/vv2.8.9...v2.8.10) (2026-04-29)


### Bug Fixes

* **skills:** close TeamCreate bypass paths in lifecycle orchestration ([#455](https://github.com/CodySwannGT/lisa/issues/455)) ([0294bd0](https://github.com/CodySwannGT/lisa/commit/0294bd009759d581c38da5fde5048cd6a554f8ef))

### [2.8.9](https://github.com/CodySwannGT/lisa/compare/vv2.8.8...v2.8.9) (2026-04-29)

### [2.8.8](https://github.com/CodySwannGT/lisa/compare/vv2.8.7...v2.8.8) (2026-04-29)

### [2.8.7](https://github.com/CodySwannGT/lisa/compare/vv2.8.6...v2.8.7) (2026-04-29)


### Bug Fixes

* **marketplace:** remove pluginRoot from metadata ([#452](https://github.com/CodySwannGT/lisa/issues/452)) ([b5a8fb0](https://github.com/CodySwannGT/lisa/commit/b5a8fb09d09da8653be2abb525f970e46382dfa9)), closes [#451](https://github.com/CodySwannGT/lisa/issues/451)

### [2.8.6](https://github.com/CodySwannGT/lisa/compare/vv2.8.5...v2.8.6) (2026-04-29)


### Bug Fixes

* **marketplace:** add ref:main to git-subdir plugin sources ([#451](https://github.com/CodySwannGT/lisa/issues/451)) ([e65ed70](https://github.com/CodySwannGT/lisa/commit/e65ed7031f7d1bc758cd65d7488bc1bc6a1db14c))

### [2.8.5](https://github.com/CodySwannGT/lisa/compare/vv2.8.4...v2.8.5) (2026-04-29)


### Bug Fixes

* **release:** stage rebuilt plugin manifests in postbump ([#450](https://github.com/CodySwannGT/lisa/issues/450)) ([d5d9ce3](https://github.com/CodySwannGT/lisa/commit/d5d9ce3571436d61e333abfd5cdb58a495345874)), closes [#449](https://github.com/CodySwannGT/lisa/issues/449)

### [2.8.4](https://github.com/CodySwannGT/lisa/compare/vv2.8.3...v2.8.4) (2026-04-29)


### Bug Fixes

* **release:** include rebuilt plugin manifests in release commit ([#449](https://github.com/CodySwannGT/lisa/issues/449)) ([7ee2be7](https://github.com/CodySwannGT/lisa/commit/7ee2be7c5efc9d2ac0a54cbbf3a5b7b033849b8e))

### [2.8.3](https://github.com/CodySwannGT/lisa/compare/vv2.8.2...v2.8.3) (2026-04-29)


### Bug Fixes

* **marketplace:** switch plugin sources to git-subdir + heal local classification ([#447](https://github.com/CodySwannGT/lisa/issues/447)) ([c91d1cc](https://github.com/CodySwannGT/lisa/commit/c91d1cc4bd6a5c55ad5f24f7d5a534ac4b4e9768))

### [2.8.2](https://github.com/CodySwannGT/lisa/compare/vv2.8.1...v2.8.2) (2026-04-29)


### Bug Fixes

* **postinstall:** heal stale local lisa marketplace registrations ([#446](https://github.com/CodySwannGT/lisa/issues/446)) ([7b6fe84](https://github.com/CodySwannGT/lisa/commit/7b6fe84652e7d1b108859ed0a97305e305ed28bf))

### [2.8.1](https://github.com/CodySwannGT/lisa/compare/vv2.8.0...v2.8.1) (2026-04-29)


### Bug Fixes

* **postinstall:** sync lockfile after manual invocations and preserve oxlint overrides ([#445](https://github.com/CodySwannGT/lisa/issues/445)) ([6be5fb5](https://github.com/CodySwannGT/lisa/commit/6be5fb5dad6aaa3df2da614a88e1ef66aa777164))

## [2.8.0](https://github.com/CodySwannGT/lisa/compare/vv2.7.0...v2.8.0) (2026-04-29)


### Features

* **tracker:** add GitHub Issues as PRD source and JIRA-replacement destination ([#444](https://github.com/CodySwannGT/lisa/issues/444)) ([022e118](https://github.com/CodySwannGT/lisa/commit/022e1182c630f4188cbda22c1fc81e27960f8d3d))

## [2.7.0](https://github.com/CodySwannGT/lisa/compare/vv2.6.4...v2.7.0) (2026-04-28)


### Features

* codify empirical verification as regression tests + block --no-verify ([#443](https://github.com/CodySwannGT/lisa/issues/443)) ([0b579e2](https://github.com/CodySwannGT/lisa/commit/0b579e2bb999b9694d68101eabb532120da9d643))

### [2.6.4](https://github.com/CodySwannGT/lisa/compare/vv2.6.3...v2.6.4) (2026-04-27)


### Bug Fixes

* **oxlint:** drop expo categories override that re-escalated correctness to error ([#442](https://github.com/CodySwannGT/lisa/issues/442)) ([6e74fed](https://github.com/CodySwannGT/lisa/commit/6e74fedf31649eedc0c9b64d79d7517449307a7f)), closes [CodySwannGT/lisa#345](https://github.com/CodySwannGT/lisa/issues/345)

### [2.6.3](https://github.com/CodySwannGT/lisa/compare/vv2.6.2...v2.6.3) (2026-04-27)


### Bug Fixes

* **oxlint:** warn-by-default + inline ignorePatterns in copy-overwrite ([#441](https://github.com/CodySwannGT/lisa/issues/441)) ([9abf9eb](https://github.com/CodySwannGT/lisa/commit/9abf9eb7480bf7766be58414ec453a58cbf770e8)), closes [CodySwannGT/lisa#345](https://github.com/CodySwannGT/lisa/issues/345)

### [2.6.2](https://github.com/CodySwannGT/lisa/compare/vv2.6.1...v2.6.2) (2026-04-27)


### Bug Fixes

* **oxlint:** loosen default rules to let ESLint own threshold-based limits ([#440](https://github.com/CodySwannGT/lisa/issues/440)) ([bf8e63e](https://github.com/CodySwannGT/lisa/commit/bf8e63eed6b1cc9035efe138e5b0a1794fe60b20)), closes [CodySwannGT/lisa#345](https://github.com/CodySwannGT/lisa/issues/345)

### [2.6.1](https://github.com/CodySwannGT/lisa/compare/vv2.6.0...v2.6.1) (2026-04-27)


### Bug Fixes

* **governance:** propagate oxlint deps + restore baseUrl in stack templates ([#439](https://github.com/CodySwannGT/lisa/issues/439)) ([2b1dd36](https://github.com/CodySwannGT/lisa/commit/2b1dd3640cc58098fd913fb3ded990cdee0d8f86)), closes [CodySwannGT/lisa#345](https://github.com/CodySwannGT/lisa/issues/345)

## [2.6.0](https://github.com/CodySwannGT/lisa/compare/vv2.5.1...v2.6.0) (2026-04-27)


### Features

* **lint:** add oxlint to the pipeline in hybrid mode ([#437](https://github.com/CodySwannGT/lisa/issues/437)) ([bcab4a6](https://github.com/CodySwannGT/lisa/commit/bcab4a6d0e891cbdaf3bece87fff53a5eb7f6353)), closes [#345](https://github.com/CodySwannGT/lisa/issues/345) [CodySwannGT/lisa#343](https://github.com/CodySwannGT/lisa/issues/343) [#345](https://github.com/CodySwannGT/lisa/issues/345) [CodySwannGT/lisa#343](https://github.com/CodySwannGT/lisa/issues/343) [CodySwannGT/lisa#343](https://github.com/CodySwannGT/lisa/issues/343) [CodySwannGT/lisa#343](https://github.com/CodySwannGT/lisa/issues/343)

### [2.5.1](https://github.com/CodySwannGT/lisa/compare/vv2.5.0...v2.5.1) (2026-04-27)

## [2.5.0](https://github.com/CodySwannGT/lisa/compare/vv2.4.0...v2.5.0) (2026-04-27)


### Features

* **intake:** add Linear as PRD source alongside Notion and Confluence ([#435](https://github.com/CodySwannGT/lisa/issues/435)) ([941bd18](https://github.com/CodySwannGT/lisa/commit/941bd189ed276492e5770f2b2270dd5771ce87c7))

## [2.4.0](https://github.com/CodySwannGT/lisa/compare/vv2.3.0...v2.4.0) (2026-04-27)


### Features

* **intake:** add Confluence as PRD source alongside Notion ([#434](https://github.com/CodySwannGT/lisa/issues/434)) ([b307cb5](https://github.com/CodySwannGT/lisa/commit/b307cb5f6ff8bd0f3b42e6c6ba94c14521336734))

## [2.3.0](https://github.com/CodySwannGT/lisa/compare/vv2.2.0...v2.3.0) (2026-04-26)


### Features

* **intake:** post product-friendly contextual comments on PRDs ([#431](https://github.com/CodySwannGT/lisa/issues/431)) ([c04521b](https://github.com/CodySwannGT/lisa/commit/c04521b73d66d840782a78a983ccf191c55b7972))


### Bug Fixes

* **trampoline:** use DI seam for spawn instead of vi.doMock ([#433](https://github.com/CodySwannGT/lisa/issues/433)) ([3740613](https://github.com/CodySwannGT/lisa/commit/37406134e4aefe0c02ddb72affc98fd57ae3b888))

## [2.2.0](https://github.com/CodySwannGT/lisa/compare/vv2.1.1...v2.2.0) (2026-04-26)


### Features

* **intake:** forbid mid-cycle confirmation prompts in intake skills ([#430](https://github.com/CodySwannGT/lisa/issues/430)) ([4cfe629](https://github.com/CodySwannGT/lisa/commit/4cfe629288f491bcd84c3a6356e07ca1e231b2e6))

### [2.1.1](https://github.com/CodySwannGT/lisa/compare/vv2.1.0...v2.1.1) (2026-04-26)


### Bug Fixes

* **lisa-update-projects:** use bun add -D <pkg>[@latest](https://github.com/latest), not bun update ([#428](https://github.com/CodySwannGT/lisa/issues/428)) ([6badd5c](https://github.com/CodySwannGT/lisa/commit/6badd5cfe2fc3bc417fdf4826b789d0dc84887dc))

## [2.1.0](https://github.com/CodySwannGT/lisa/compare/vv2.0.0...v2.1.0) (2026-04-26)


### Features

* add /lisa:intake batch scanner; move orchestration into 6 lifecycle skills ([#421](https://github.com/CodySwannGT/lisa/issues/421)) ([a654c48](https://github.com/CodySwannGT/lisa/commit/a654c48701e9bc6f2df84bdb3ca31c414c9baea9))


### Bug Fixes

* **tests:** stop mutating CI env vars in trampoline test ([#425](https://github.com/CodySwannGT/lisa/issues/425)) ([e1a4830](https://github.com/CodySwannGT/lisa/commit/e1a48302eced845c5d4c3f451197d61709f6361e)), closes [#421](https://github.com/CodySwannGT/lisa/issues/421)

## [2.0.0](https://github.com/CodySwannGT/lisa/compare/vv1.96.0...v2.0.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* collapse public command surface to 5 lifecycle verbs (#420)

### Features

* collapse public command surface to 5 lifecycle verbs ([#420](https://github.com/CodySwannGT/lisa/issues/420)) ([427f122](https://github.com/CodySwannGT/lisa/commit/427f12298cb01ae02b472d6504c7e1fd2af1bf79))

## [1.96.0](https://github.com/CodySwannGT/lisa/compare/vv1.95.0...v1.96.0) (2026-04-26)


### Features

* **codex:** add OpenAI Codex CLI as a target harness ([#416](https://github.com/CodySwannGT/lisa/issues/416)) ([18ef0de](https://github.com/CodySwannGT/lisa/commit/18ef0de1f9cf8cbacf3c9bcbc5b0ac8a19d2a3c6))
* **intake:** add PRD-to-ticket intake pipeline with shared gate skills ([#419](https://github.com/CodySwannGT/lisa/issues/419)) ([e69fe8c](https://github.com/CodySwannGT/lisa/commit/e69fe8cc84fd9e1460834cb4cd069908de0623d9))

## [1.95.0](https://github.com/CodySwannGT/lisa/compare/vv1.94.0...v1.95.0) (2026-04-25)


### Features

* **jira:** enforce ticket pre-flight gate for env, sign-in, scope, and relationships ([#414](https://github.com/CodySwannGT/lisa/issues/414)) ([6eaeebe](https://github.com/CodySwannGT/lisa/commit/6eaeebe5467e1bab6ece978f9bd54c85c20a34f0))

## [1.94.0](https://github.com/CodySwannGT/lisa/compare/vv1.93.0...v1.94.0) (2026-04-23)


### Features

* **coderabbit:** acknowledge nits without code changes ([#413](https://github.com/CodySwannGT/lisa/issues/413)) ([a418c6e](https://github.com/CodySwannGT/lisa/commit/a418c6eaad9d3afea7055a2f0f7f3b218bad0786))

## [1.93.0](https://github.com/CodySwannGT/lisa/compare/vv1.92.0...v1.93.0) (2026-04-23)


### Features

* **husky:** add .husky/pre-push.local extension slot ([#412](https://github.com/CodySwannGT/lisa/issues/412)) ([110fffb](https://github.com/CodySwannGT/lisa/commit/110fffbeb4929054e5451eb17ca52a4fea05f7b4)), closes [AcmeOrgA/frontend#583](https://github.com/AcmeOrgA/frontend/issues/583) [#1061](https://github.com/CodySwannGT/lisa/issues/1061) [#1157](https://github.com/CodySwannGT/lisa/issues/1157)

## [1.92.0](https://github.com/CodySwannGT/lisa/compare/vv1.91.1...v1.92.0) (2026-04-21)


### Features

* **skills:** preserve PRD source artifacts across generated tickets ([#409](https://github.com/CodySwannGT/lisa/issues/409)) ([50a8f85](https://github.com/CodySwannGT/lisa/commit/50a8f85fee32e6fe46040508210812c3d675e8e1))

### [1.91.1](https://github.com/CodySwannGT/lisa/compare/vv1.91.0...v1.91.1) (2026-04-19)


### Bug Fixes

* **ci:** fail playwright aggregator when any shard fails ([#408](https://github.com/CodySwannGT/lisa/issues/408)) ([19f177a](https://github.com/CodySwannGT/lisa/commit/19f177ac1c10cbbd10064897c053fa3f0fe148e0)), closes [#1964](https://github.com/CodySwannGT/lisa/issues/1964)

## [1.91.0](https://github.com/CodySwannGT/lisa/compare/vv1.90.0...v1.91.0) (2026-04-19)


### Features

* **migrations:** relocate project-specific audit exclusions to local file ([#406](https://github.com/CodySwannGT/lisa/issues/406)) ([55bbd51](https://github.com/CodySwannGT/lisa/commit/55bbd51deeff0cd6ed442027bdce2d3c3ebd4c84)), closes [#373](https://github.com/CodySwannGT/lisa/issues/373) [#1960](https://github.com/CodySwannGT/lisa/issues/1960)

## [1.90.0](https://github.com/CodySwannGT/lisa/compare/vv1.89.0...v1.90.0) (2026-04-19)


### Features

* **expo,rules:** add playwright-ci-debugging skill; codify branch-protection rule ([#405](https://github.com/CodySwannGT/lisa/issues/405)) ([0cd2cd3](https://github.com/CodySwannGT/lisa/commit/0cd2cd35118b6618d1c52e78cd2e97d8fe1dc53b))

## [1.89.0](https://github.com/CodySwannGT/lisa/compare/vv1.88.0...v1.89.0) (2026-04-15)


### Features

* **ci:** forward shard/cache inputs in expo create-only, add merge-reports job + integration test [SE-4551][SE-4552] ([#401](https://github.com/CodySwannGT/lisa/issues/401)) ([f9dbb86](https://github.com/CodySwannGT/lisa/commit/f9dbb8639de7575efd94237864cf86cae657b42f)), closes [#400](https://github.com/CodySwannGT/lisa/issues/400)


### Bug Fixes

* **hooks,ci:** resolve local bins in TS hooks; gate Playwright aggregator on has_config ([#404](https://github.com/CodySwannGT/lisa/issues/404)) ([d890d29](https://github.com/CodySwannGT/lisa/commit/d890d2979b6928f472e47b4c7cfde1d1bc6eed85))

## [1.88.0](https://github.com/CodySwannGT/lisa/compare/vv1.87.0...v1.88.0) (2026-04-15)


### Features

* **ci:** add optional Playwright sharding and Expo build cache ([#400](https://github.com/CodySwannGT/lisa/issues/400)) ([1a53158](https://github.com/CodySwannGT/lisa/commit/1a531581839bd4675ba70f3b089894d5a6e8f486))

## [1.87.0](https://github.com/CodySwannGT/lisa/compare/vv1.86.4...v1.87.0) (2026-04-15)


### Features

* **rules:** hoist orchestration selection to prevent task-list bypass ([#399](https://github.com/CodySwannGT/lisa/issues/399)) ([76cf9f9](https://github.com/CodySwannGT/lisa/commit/76cf9f928a7db94b7bdd2372e3f6e1a17606e570))

### [1.86.4](https://github.com/CodySwannGT/lisa/compare/vv1.86.3...v1.86.4) (2026-04-15)


### Bug Fixes

* **skill:** respect engines.bun=please-use-npm in lisa-update-projects ([#398](https://github.com/CodySwannGT/lisa/issues/398)) ([d0675ac](https://github.com/CodySwannGT/lisa/commit/d0675ac2df810e2957929c3f83b5c3378a3b782d))

### [1.86.3](https://github.com/CodySwannGT/lisa/compare/vv1.86.2...v1.86.3) (2026-04-14)


### Bug Fixes

* **commands:** reference intent-routing rule by name, not deleted file path ([#397](https://github.com/CodySwannGT/lisa/issues/397)) ([e0a6369](https://github.com/CodySwannGT/lisa/commit/e0a6369388104d0fbf1da402b3d126eca848bd02)), closes [#341](https://github.com/CodySwannGT/lisa/issues/341)

### [1.86.2](https://github.com/CodySwannGT/lisa/compare/vv1.86.1...v1.86.2) (2026-04-14)


### Bug Fixes

* **nestjs:** add sentry deps and dev binaries to knip ignore lists ([#396](https://github.com/CodySwannGT/lisa/issues/396)) ([e016364](https://github.com/CodySwannGT/lisa/commit/e0163644be209283eeb71132b41428a5aa453b1d))

### [1.86.1](https://github.com/CodySwannGT/lisa/compare/vv1.86.0...v1.86.1) (2026-04-14)

## [1.86.0](https://github.com/CodySwannGT/lisa/compare/vv1.85.10...v1.86.0) (2026-04-13)


### Features

* **nestjs:** block migration edits; rule: never rush; port PR [#390](https://github.com/CodySwannGT/lisa/issues/390) to source ([#393](https://github.com/CodySwannGT/lisa/issues/393)) ([ced8981](https://github.com/CodySwannGT/lisa/commit/ced8981f2f510e4a3f594302373c694377aafa5e))

### [1.85.10](https://github.com/CodySwannGT/lisa/compare/vv1.85.9...v1.85.10) (2026-04-13)


### Bug Fixes

* **jest:** skip worktree ignore when running from inside a worktree ([#389](https://github.com/CodySwannGT/lisa/issues/389)) ([0763085](https://github.com/CodySwannGT/lisa/commit/07630858fbe7c87e0562e7da4659c85bdc54f74c))

### [1.85.9](https://github.com/CodySwannGT/lisa/compare/vv1.85.8...v1.85.9) (2026-04-13)


### Documentation

* **intent-routing:** add orchestration section; collapse /plan:execute into /build ([#390](https://github.com/CodySwannGT/lisa/issues/390)) ([0309f86](https://github.com/CodySwannGT/lisa/commit/0309f866ae7a6192410636d46d4e37c546b9f6ab))

### [1.85.8](https://github.com/CodySwannGT/lisa/compare/vv1.85.7...v1.85.8) (2026-04-13)


### Bug Fixes

* **migrations:** apply CI guard to Rails projects with Node package.json ([#388](https://github.com/CodySwannGT/lisa/issues/388)) ([b6344d5](https://github.com/CodySwannGT/lisa/commit/b6344d54ce3bc2b9970f09f92d3a61359ff8917f))

### [1.85.7](https://github.com/CodySwannGT/lisa/compare/vv1.85.6...v1.85.7) (2026-04-13)


### Bug Fixes

* **postinstall:** skip Lisa in CI, rely on PR diff for drift detection ([#387](https://github.com/CodySwannGT/lisa/issues/387)) ([1b92142](https://github.com/CodySwannGT/lisa/commit/1b921429f5b2b81a5c8a3c2c00eea3b7f6b49d20))

### [1.85.6](https://github.com/CodySwannGT/lisa/compare/vv1.85.5...v1.85.6) (2026-04-13)


### Bug Fixes

* **tsconfig,trampoline:** drop noUnusedLocals for ESLint, sync CI trampoline ([#386](https://github.com/CodySwannGT/lisa/issues/386)) ([0133a8a](https://github.com/CodySwannGT/lisa/commit/0133a8a76cce87ad43919075da24ee32390203ac))

### [1.85.5](https://github.com/CodySwannGT/lisa/compare/vv1.85.4...v1.85.5) (2026-04-12)


### Bug Fixes

* trampoline lockfile regen, CDK jest cleanup, cdk tsconfig repair ([#385](https://github.com/CodySwannGT/lisa/issues/385)) ([19e2417](https://github.com/CodySwannGT/lisa/commit/19e2417073dc4134779ad0eede5992d54d45b458))

### [1.85.4](https://github.com/CodySwannGT/lisa/compare/vv1.85.3...v1.85.4) (2026-04-12)


### Bug Fixes

* preserve inline hook entries in settings.json during postinstall ([#384](https://github.com/CodySwannGT/lisa/issues/384)) ([38222c3](https://github.com/CodySwannGT/lisa/commit/38222c38d4668e7e194b7e4f187a35bfb62a5add))

### [1.85.3](https://github.com/CodySwannGT/lisa/compare/vv1.85.2...v1.85.3) (2026-04-12)


### Bug Fixes

* **postinstall:** preserve package.json merges across bun add via detached trampoline ([#383](https://github.com/CodySwannGT/lisa/issues/383)) ([d0d4048](https://github.com/CodySwannGT/lisa/commit/d0d4048db54d97f61493d966d257d9fa90f43da3))

### [1.85.2](https://github.com/CodySwannGT/lisa/compare/vv1.85.1...v1.85.2) (2026-04-12)


### Bug Fixes

* **templates:** pin handlebars resolution to >=4.7.9 ([#381](https://github.com/CodySwannGT/lisa/issues/381)) ([5d2b675](https://github.com/CodySwannGT/lisa/commit/5d2b675a904dd6bac2e69dd5844fb628f1b48c1b))

### [1.85.1](https://github.com/CodySwannGT/lisa/compare/vv1.83.2...v1.85.1) (2026-04-12)


### Bug Fixes

* bump version past 1.84.0 to unblock npm publish ([#380](https://github.com/CodySwannGT/lisa/issues/380)) ([ea8fd71](https://github.com/CodySwannGT/lisa/commit/ea8fd7107679186faad1c71b879257a7d881a528)), closes [#378](https://github.com/CodySwannGT/lisa/issues/378) [#377](https://github.com/CodySwannGT/lisa/issues/377) [#378](https://github.com/CodySwannGT/lisa/issues/378)

### [1.83.2](https://github.com/CodySwannGT/lisa/compare/vv1.84.0...v1.83.2) (2026-04-12)


### Bug Fixes

* **templates:** stage env var in expo scripts, axios floor bump, basic-ftp CVE ([#378](https://github.com/CodySwannGT/lisa/issues/378)) ([26c94c1](https://github.com/CodySwannGT/lisa/commit/26c94c13a8dcad8967bf79d8dfb335f8061f4ad7))

## [1.84.0](https://github.com/CodySwannGT/lisa/compare/vv1.83.1...v1.84.0) (2026-04-12)


### Features

* **migrations:** apply Lisa postinstall to all Node projects, preserve tsconfig scope ([#377](https://github.com/CodySwannGT/lisa/issues/377)) ([7528d03](https://github.com/CodySwannGT/lisa/commit/7528d0386fb39316f53282bdb2b66488e6ffe297)), closes [#103](https://github.com/CodySwannGT/lisa/issues/103)

### [1.83.1](https://github.com/CodySwannGT/lisa/compare/vv1.83.0...v1.83.1) (2026-04-12)


### Bug Fixes

* migrations framework + vitest worktree excludes ([#376](https://github.com/CodySwannGT/lisa/issues/376)) ([b14eb3b](https://github.com/CodySwannGT/lisa/commit/b14eb3b86373e9ee93b73df8359d584c33ffc9af)), closes [#373](https://github.com/CodySwannGT/lisa/issues/373)

## [1.83.0](https://github.com/CodySwannGT/lisa/compare/vv1.82.2...v1.83.0) (2026-04-12)


### Features

* **jira,verification:** ticket graph readers and spec-conformance gate ([#375](https://github.com/CodySwannGT/lisa/issues/375)) ([c15f9d9](https://github.com/CodySwannGT/lisa/commit/c15f9d90a9d4bb152f6c072afebb6867e94f8582))

### [1.82.2](https://github.com/CodySwannGT/lisa/compare/vv1.82.1...v1.82.2) (2026-04-11)

### [1.82.1](https://github.com/CodySwannGT/lisa/compare/vv1.82.0...v1.82.1) (2026-04-11)


### Bug Fixes

* move tsconfig include/exclude to create-only and add audit exclusions ([#373](https://github.com/CodySwannGT/lisa/issues/373)) ([e47bb64](https://github.com/CodySwannGT/lisa/commit/e47bb6421baa031e739e6c2e1be6ef2b2cb57156))

## [1.82.0](https://github.com/CodySwannGT/lisa/compare/vv1.81.7...v1.82.0) (2026-04-11)


### Features

* add workflow echo and skill/agent planning to intent routing ([#372](https://github.com/CodySwannGT/lisa/issues/372)) ([520faa2](https://github.com/CodySwannGT/lisa/commit/520faa2af16f887902fe715b3692edaf0a178205))

### [1.81.7](https://github.com/CodySwannGT/lisa/compare/vv1.81.6...v1.81.7) (2026-04-11)


### Bug Fixes

* remove tools restrictions from all agents — inherit all tools ([#371](https://github.com/CodySwannGT/lisa/issues/371)) ([dc9293c](https://github.com/CodySwannGT/lisa/commit/dc9293c60dc1689db85b99a2d750c757f7074f14))

### [1.81.6](https://github.com/CodySwannGT/lisa/compare/vv1.81.5...v1.81.6) (2026-04-11)


### Bug Fixes

* correct tool access for jira-agent, git-history-analyzer, and learner ([#370](https://github.com/CodySwannGT/lisa/issues/370)) ([70bfdb3](https://github.com/CodySwannGT/lisa/commit/70bfdb33b55dc3669d6074ed941c7b938194a2a3))

### [1.81.5](https://github.com/CodySwannGT/lisa/compare/vv1.81.4...v1.81.5) (2026-04-11)


### Bug Fixes

* clarify that tests/typecheck/lint are quality gates, not verification ([#369](https://github.com/CodySwannGT/lisa/issues/369)) ([ee4c21c](https://github.com/CodySwannGT/lisa/commit/ee4c21ca6e30bb1f50443d5d35df42fadf6217c9))

### [1.81.4](https://github.com/CodySwannGT/lisa/compare/vv1.81.3...v1.81.4) (2026-04-09)


### Bug Fixes

* add basic-ftp GHSA exception to typescript audit.ignore template ([#368](https://github.com/CodySwannGT/lisa/issues/368)) ([0735886](https://github.com/CodySwannGT/lisa/commit/073588693c7a3f5137edc9f08b701fa879104e00))
* minimatch v9+ compat and drop forced react-native-store-version ([#367](https://github.com/CodySwannGT/lisa/issues/367)) ([9b4dc25](https://github.com/CodySwannGT/lisa/commit/9b4dc254c3cccf458c0ed6a609f109550cac8924))

### [1.81.3](https://github.com/CodySwannGT/lisa/compare/vv1.81.2...v1.81.3) (2026-04-08)


### Bug Fixes

* remove per-prompt flow classification hook ([#366](https://github.com/CodySwannGT/lisa/issues/366)) ([2553321](https://github.com/CodySwannGT/lisa/commit/2553321c94dba16412601c987da2ca6cb64448b6)), closes [#363](https://github.com/CodySwannGT/lisa/issues/363)

### [1.81.2](https://github.com/CodySwannGT/lisa/compare/vv1.81.1...v1.81.2) (2026-04-08)


### Bug Fixes

* remove dangling sync-tasks.sh hook reference ([#365](https://github.com/CodySwannGT/lisa/issues/365)) ([06d3586](https://github.com/CodySwannGT/lisa/commit/06d3586b9d7883281bc7add5cea88ec55d3548bd)), closes [#340](https://github.com/CodySwannGT/lisa/issues/340) [#341](https://github.com/CodySwannGT/lisa/issues/341) [#340](https://github.com/CodySwannGT/lisa/issues/340) [#363](https://github.com/CodySwannGT/lisa/issues/363)

### [1.81.1](https://github.com/CodySwannGT/lisa/compare/vv1.81.0...v1.81.1) (2026-04-08)

## [1.81.0](https://github.com/CodySwannGT/lisa/compare/vv1.80.0...v1.81.0) (2026-04-08)


### Features

* strengthen intent routing rules to prevent classification bypass ([#363](https://github.com/CodySwannGT/lisa/issues/363)) ([4034577](https://github.com/CodySwannGT/lisa/commit/4034577f37d918f1db5c32ebcbe3fd4b300860cb))

## [1.80.0](https://github.com/CodySwannGT/lisa/compare/vv1.79.2...v1.80.0) (2026-04-07)


### Features

* add code review response workflow to Rails template ([#358](https://github.com/CodySwannGT/lisa/issues/358)) ([4734f0c](https://github.com/CodySwannGT/lisa/commit/4734f0c675ea3440bcba8be469eedee7b997e462))

### [1.79.2](https://github.com/CodySwannGT/lisa/compare/vv1.79.1...v1.79.2) (2026-04-07)


### Bug Fixes

* add build failure investigation rule and JIRA ticket relationship rule ([#361](https://github.com/CodySwannGT/lisa/issues/361)) ([99d4f01](https://github.com/CodySwannGT/lisa/commit/99d4f01535408bb9755eb9099790f3717c1144fa))

### [1.79.1](https://github.com/CodySwannGT/lisa/compare/vv1.79.0...v1.79.1) (2026-04-06)


### Bug Fixes

* add JIRA discipline rules for comments, dev panel, ADF mentions, and script discovery ([#357](https://github.com/CodySwannGT/lisa/issues/357)) ([2c28afa](https://github.com/CodySwannGT/lisa/commit/2c28afa25a2cf1df58ba67d4c6d0e89ebe39b731))

## [1.79.0](https://github.com/CodySwannGT/lisa/compare/vv1.78.9...v1.79.0) (2026-04-06)


### Features

* add notion-to-jira skill for PRD breakdown ([#356](https://github.com/CodySwannGT/lisa/issues/356)) ([f649983](https://github.com/CodySwannGT/lisa/commit/f6499837724d07b72e51fcb2ee8268dc9d9b0e3b))

### [1.78.9](https://github.com/CodySwannGT/lisa/compare/vv1.78.8...v1.78.9) (2026-04-06)


### Bug Fixes

* remove redundant CLAUDE.md instructions and make coverage skill incremental ([#355](https://github.com/CodySwannGT/lisa/issues/355)) ([c846678](https://github.com/CodySwannGT/lisa/commit/c84667868e890a2bb708a58efad9fc4a480b9882))

### [1.78.8](https://github.com/CodySwannGT/lisa/compare/vv1.78.7...v1.78.8) (2026-04-06)


### Bug Fixes

* optimize nightly complexity skill turn budget ([#354](https://github.com/CodySwannGT/lisa/issues/354)) ([53e9850](https://github.com/CodySwannGT/lisa/commit/53e98500113df46a17669e5b4300ae428e69b9d4))

### [1.78.7](https://github.com/CodySwannGT/lisa/compare/vv1.78.6...v1.78.7) (2026-04-06)


### Bug Fixes

* add tsc check before commit in nightly complexity skill ([#353](https://github.com/CodySwannGT/lisa/issues/353)) ([47e2e02](https://github.com/CodySwannGT/lisa/commit/47e2e0212beb0db5195c3f36784fe21dfec31a85))

### [1.78.6](https://github.com/CodySwannGT/lisa/compare/vv1.78.5...v1.78.6) (2026-04-06)


### Bug Fixes

* **ci:** exclude deleted files from nightly test improvement ([#352](https://github.com/CodySwannGT/lisa/issues/352)) ([b37cf11](https://github.com/CodySwannGT/lisa/commit/b37cf117fb651fe8cf648529be5956c37982a82b))

### [1.78.5](https://github.com/CodySwannGT/lisa/compare/vv1.78.4...v1.78.5) (2026-04-06)


### Bug Fixes

* add missing Setup Bun step to deploy job in deploy.yml ([#351](https://github.com/CodySwannGT/lisa/issues/351)) ([5b6d98e](https://github.com/CodySwannGT/lisa/commit/5b6d98e7791cb9c9d86491896bcecedc332b6a7d))

### [1.78.4](https://github.com/CodySwannGT/lisa/compare/vv1.78.3...v1.78.4) (2026-04-05)


### Bug Fixes

* add .claude/worktrees/** to ESLint ignore patterns ([#350](https://github.com/CodySwannGT/lisa/issues/350)) ([f941c80](https://github.com/CodySwannGT/lisa/commit/f941c80a0d4183b9cd0da89ed83aa40782cb28e2))

### [1.78.3](https://github.com/CodySwannGT/lisa/compare/vv1.78.2...v1.78.3) (2026-04-04)

### [1.78.2](https://github.com/CodySwannGT/lisa/compare/vv1.78.1...v1.78.2) (2026-04-04)


### Bug Fixes

* make .lisaignore prevent deletions and dogfood Lisa update ([#348](https://github.com/CodySwannGT/lisa/issues/348)) ([34bce6e](https://github.com/CodySwannGT/lisa/commit/34bce6e60783c9593554aba4d4881990dda46d27))

### [1.78.1](https://github.com/CodySwannGT/lisa/compare/vv1.78.0...v1.78.1) (2026-04-04)


### Bug Fixes

* remove keep exemptions for reusable workflow files ([#347](https://github.com/CodySwannGT/lisa/issues/347)) ([d573d59](https://github.com/CodySwannGT/lisa/commit/d573d5976c0ea154e1fa374e7f0e2acdbe008ea0))

## [1.78.0](https://github.com/CodySwannGT/lisa/compare/vv1.77.0...v1.78.0) (2026-04-04)


### Features

* require agents to confirm no blockers before starting work ([#346](https://github.com/CodySwannGT/lisa/issues/346)) ([5575a17](https://github.com/CodySwannGT/lisa/commit/5575a179c61bd2576f8540ca3195bb9ca622a1ab))

## [1.77.0](https://github.com/CodySwannGT/lisa/compare/vv1.76.6...v1.77.0) (2026-04-04)


### Features

* distribute rules via plugin hooks instead of copy-overwrite ([#341](https://github.com/CodySwannGT/lisa/issues/341)) ([30f202a](https://github.com/CodySwannGT/lisa/commit/30f202a126a260ff5d778ab443017dbe4bdcb0c0))

### [1.76.6](https://github.com/CodySwannGT/lisa/compare/vv1.76.5...v1.76.6) (2026-04-03)


### Bug Fixes

* prevent lint-on-edit from removing imports Claude plans to use ([#340](https://github.com/CodySwannGT/lisa/issues/340)) ([82ca177](https://github.com/CodySwannGT/lisa/commit/82ca17746535e136593a5272dd4eaf7b95c461eb))

### [1.76.5](https://github.com/CodySwannGT/lisa/compare/vv1.76.4...v1.76.5) (2026-04-03)


### Bug Fixes

* reduce nightly coverage increment to 2% and increase max-turns to 50 ([#339](https://github.com/CodySwannGT/lisa/issues/339)) ([f5b8f69](https://github.com/CodySwannGT/lisa/commit/f5b8f69f65122c5bd2ac4fb37d13675367157a30))

### [1.76.4](https://github.com/CodySwannGT/lisa/compare/vv1.76.3...v1.76.4) (2026-04-02)


### Bug Fixes

* guide nightly complexity to use concerns/services when ClassLength is at risk ([#338](https://github.com/CodySwannGT/lisa/issues/338)) ([51cf721](https://github.com/CodySwannGT/lisa/commit/51cf7213b74f2dd40275944ec5ff114c1b767da0))

### [1.76.3](https://github.com/CodySwannGT/lisa/compare/vv1.76.2...v1.76.3) (2026-04-02)


### Bug Fixes

* increase triage max-turns per ticket from 20 to 40 ([#337](https://github.com/CodySwannGT/lisa/issues/337)) ([a00f386](https://github.com/CodySwannGT/lisa/commit/a00f3861e7378181ca27af916874e7647e52b7c9))

### [1.76.2](https://github.com/CodySwannGT/lisa/compare/vv1.76.1...v1.76.2) (2026-04-02)


### Bug Fixes

* prevent nightly complexity reduction from exhausting turn limit ([#336](https://github.com/CodySwannGT/lisa/issues/336)) ([247092f](https://github.com/CodySwannGT/lisa/commit/247092f798e3e808d9d7e9bf8db8bb498040b376))

### [1.76.1](https://github.com/CodySwannGT/lisa/compare/vv1.76.0...v1.76.1) (2026-03-31)


### Bug Fixes

* increase nightly test coverage max-turns from 40 to 75 ([#335](https://github.com/CodySwannGT/lisa/issues/335)) ([3754113](https://github.com/CodySwannGT/lisa/commit/375411399671ae3b10dfecab5b1a123635a5cc8e))

## [1.76.0](https://github.com/CodySwannGT/lisa/compare/vv1.75.1...v1.76.0) (2026-03-31)


### Features

* add MySQL support to nightly test coverage workflow ([#334](https://github.com/CodySwannGT/lisa/issues/334)) ([edc6742](https://github.com/CodySwannGT/lisa/commit/edc67425c23553cd6bab2a4c34c031a5cc85671e))

### [1.75.1](https://github.com/CodySwannGT/lisa/compare/vv1.75.0...v1.75.1) (2026-03-27)


### Bug Fixes

* add coverage_increment input to TypeScript nightly test-coverage template ([#332](https://github.com/CodySwannGT/lisa/issues/332)) ([d85b912](https://github.com/CodySwannGT/lisa/commit/d85b9126ace72ff027b3db38cb9a496e57a2c45f))

## [1.75.0](https://github.com/CodySwannGT/lisa/compare/vv1.74.2...v1.75.0) (2026-03-26)


### Features

* improve security audit handling for Node.js and Rails ([#331](https://github.com/CodySwannGT/lisa/issues/331)) ([bbd110d](https://github.com/CodySwannGT/lisa/commit/bbd110da45ec260875a96c2608b71d38af48c0a5))


### Bug Fixes

* improve nightly complexity workflow reliability ([#330](https://github.com/CodySwannGT/lisa/issues/330)) ([924fe95](https://github.com/CodySwannGT/lisa/commit/924fe95a15fa28cf5c870f105cbe377d1a317d12))

### [1.74.2](https://github.com/CodySwannGT/lisa/compare/vv1.74.1...v1.74.2) (2026-03-26)


### Bug Fixes

* **rails:** use compact jq output in nightly complexity workflow ([#329](https://github.com/CodySwannGT/lisa/issues/329)) ([208edd3](https://github.com/CodySwannGT/lisa/commit/208edd390ad245cabcf8077b39f5d16b02786ea6))

### [1.74.1](https://github.com/CodySwannGT/lisa/compare/vv1.74.0...v1.74.1) (2026-03-25)

## [1.74.0](https://github.com/CodySwannGT/lisa/compare/vv1.73.2...v1.74.0) (2026-03-25)


### Features

* **expo:** expand playwright-selectors skill with battle-tested patterns ([#327](https://github.com/CodySwannGT/lisa/issues/327)) ([b0d8168](https://github.com/CodySwannGT/lisa/commit/b0d8168bb15b0a9276394f80710ec72d5f4c5c3f))

### [1.73.2](https://github.com/CodySwannGT/lisa/compare/vv1.73.1...v1.73.2) (2026-03-25)


### Bug Fixes

* reduce maxLinesPerFunction decrement from 5 to 2 ([#326](https://github.com/CodySwannGT/lisa/issues/326)) ([a15ba8e](https://github.com/CodySwannGT/lisa/commit/a15ba8ebefc2bcf2caf04fa6088b7e526836486e))

### [1.73.1](https://github.com/CodySwannGT/lisa/compare/vv1.73.0...v1.73.1) (2026-03-25)


### Bug Fixes

* filter CI plugins to only those from extraKnownMarketplaces ([#325](https://github.com/CodySwannGT/lisa/issues/325)) ([45e0abd](https://github.com/CodySwannGT/lisa/commit/45e0abd33b6240a4aebc5edafc97d14e5465b6f9))

## [1.73.0](https://github.com/CodySwannGT/lisa/compare/vv1.72.2...v1.73.0) (2026-03-25)


### Features

* auto-read plugins from .claude/settings.json in CI workflows ([#324](https://github.com/CodySwannGT/lisa/issues/324)) ([17838ef](https://github.com/CodySwannGT/lisa/commit/17838efa87513294822bbd2cc11d791e6caf628c))

### [1.72.2](https://github.com/CodySwannGT/lisa/compare/vv1.72.1...v1.72.2) (2026-03-25)


### Bug Fixes

* remove root: "test" from CDK vitest config to fix 0% coverage ([#323](https://github.com/CodySwannGT/lisa/issues/323)) ([c609c0f](https://github.com/CodySwannGT/lisa/commit/c609c0fe176907460c7c514105488ea9dae28f3e))

### [1.72.1](https://github.com/CodySwannGT/lisa/compare/vv1.72.0...v1.72.1) (2026-03-25)


### Bug Fixes

* resolve CDK vitest coverage paths relative to project root ([#322](https://github.com/CodySwannGT/lisa/issues/322)) ([bd31873](https://github.com/CodySwannGT/lisa/commit/bd3187318671786c127493a4c8e8d5113535f2b7))

## [1.72.0](https://github.com/CodySwannGT/lisa/compare/vv1.71.5...v1.72.0) (2026-03-24)


### Features

* add playwright_setup_command input to quality workflow ([#321](https://github.com/CodySwannGT/lisa/issues/321)) ([a6d5c78](https://github.com/CodySwannGT/lisa/commit/a6d5c78711f025c24e31d352018f0163b517abb9))

### [1.71.5](https://github.com/CodySwannGT/lisa/compare/vv1.71.4...v1.71.5) (2026-03-24)


### Bug Fixes

* refresh Lisa marketplace cache and skip Linux-only installs on macOS ([#320](https://github.com/CodySwannGT/lisa/issues/320)) ([bd6c8e3](https://github.com/CodySwannGT/lisa/commit/bd6c8e353727593d6accad51a4f34f95b433f2e5))

### [1.71.4](https://github.com/CodySwannGT/lisa/compare/vv1.71.3...v1.71.4) (2026-03-21)


### Bug Fixes

* nightly jira triage uses ticket_count for maxResults and filters by status ([#319](https://github.com/CodySwannGT/lisa/issues/319)) ([eae6a51](https://github.com/CodySwannGT/lisa/commit/eae6a51e728ef7fb19e23219579f8ee148c0679a))

### [1.71.3](https://github.com/CodySwannGT/lisa/compare/vv1.71.2...v1.71.3) (2026-03-21)


### Bug Fixes

* remove template apply from postinstall to prevent child-stack config overwrites ([#318](https://github.com/CodySwannGT/lisa/issues/318)) ([0c7f1c2](https://github.com/CodySwannGT/lisa/commit/0c7f1c2b8269488269e888a1ca0968fcdf67ee54))

### [1.71.2](https://github.com/CodySwannGT/lisa/compare/vv1.71.1...v1.71.2) (2026-03-21)


### Documentation

* add upstream bug fixing guidance to lisa-update-projects skill ([#317](https://github.com/CodySwannGT/lisa/issues/317)) ([acc46f8](https://github.com/CodySwannGT/lisa/commit/acc46f818ab4d5e8103e0464b5d8c8c38119666e))

### [1.71.1](https://github.com/CodySwannGT/lisa/compare/vv1.71.0...v1.71.1) (2026-03-21)


### Bug Fixes

* replace fse.readJson with readFile+JSON.parse in registerPlugins ([#316](https://github.com/CodySwannGT/lisa/issues/316)) ([d1bbd8e](https://github.com/CodySwannGT/lisa/commit/d1bbd8eee23cb829f9eef9c7dfc2c446884b92d4))

## [1.71.0](https://github.com/CodySwannGT/lisa/compare/vv1.70.1...v1.71.0) (2026-03-21)


### Features

* auto-register plugins at project scope after settings merge ([#313](https://github.com/CodySwannGT/lisa/issues/313)) ([0d7e999](https://github.com/CodySwannGT/lisa/commit/0d7e999d5b216d38dcfc2c26e8f0805ac55c864e))

### [1.70.1](https://github.com/CodySwannGT/lisa/compare/vv1.70.0...v1.70.1) (2026-03-20)


### Bug Fixes

* update Claude Code install command to use native installer ([#312](https://github.com/CodySwannGT/lisa/issues/312)) ([726bd93](https://github.com/CodySwannGT/lisa/commit/726bd934b35a09dd1bc9497bc9bc40c218d4b956))

## [1.70.0](https://github.com/CodySwannGT/lisa/compare/vv1.69.0...v1.70.0) (2026-03-20)


### Features

* add impeccable design plugin to expo and rails templates ([#311](https://github.com/CodySwannGT/lisa/issues/311)) ([a681bd6](https://github.com/CodySwannGT/lisa/commit/a681bd627de81cb0d6e24061cfe44b5924c1b9b3))

## [1.69.0](https://github.com/CodySwannGT/lisa/compare/vv1.68.0...v1.69.0) (2026-03-20)


### Features

* consolidate nightly workflows with shared skills and triage gate ([#310](https://github.com/CodySwannGT/lisa/issues/310)) ([38b9941](https://github.com/CodySwannGT/lisa/commit/38b994134a8ceb9039a09566f822c02277e3d6db))

## [1.68.0](https://github.com/CodySwannGT/lisa/compare/vv1.67.3...v1.68.0) (2026-03-20)


### Features

* agent flow architecture redesign with intent routing ([#309](https://github.com/CodySwannGT/lisa/issues/309)) ([15b3759](https://github.com/CodySwannGT/lisa/commit/15b3759886d59b29e9c3956e9c010286d18b3d85))

### [1.67.3](https://github.com/CodySwannGT/lisa/compare/vv1.67.2...v1.67.3) (2026-03-20)


### Bug Fixes

* use glob pattern for coverage directory in eslint ignore ([#308](https://github.com/CodySwannGT/lisa/issues/308)) ([6df913a](https://github.com/CodySwannGT/lisa/commit/6df913ae411d59a60a8d539ddc2bffd88c1588a8))

### [1.67.2](https://github.com/CodySwannGT/lisa/compare/vv1.67.1...v1.67.2) (2026-03-20)


### Bug Fixes

* exclude test files from typescript tsconfig template ([#307](https://github.com/CodySwannGT/lisa/issues/307)) ([d577082](https://github.com/CodySwannGT/lisa/commit/d5770821ccb029c75920337031dad81eb0a54584))

### [1.67.1](https://github.com/CodySwannGT/lisa/compare/vv1.67.0...v1.67.1) (2026-03-20)


### Bug Fixes

* test:integration pattern for nestjs and typescript template defaults ([#306](https://github.com/CodySwannGT/lisa/issues/306)) ([bcd7546](https://github.com/CodySwannGT/lisa/commit/bcd7546d5484523c70fae163ae1f3a725ec1200e))

## [1.67.0](https://github.com/CodySwannGT/lisa/compare/vv1.66.3...v1.67.0) (2026-03-20)


### Features

* move plugin rules to copy-overwrite for native .claude/rules loading ([#305](https://github.com/CodySwannGT/lisa/issues/305)) ([3680a60](https://github.com/CodySwannGT/lisa/commit/3680a60798eeb5d8cbf7c7a76fe300cd108a7b3e))

### [1.66.3](https://github.com/CodySwannGT/lisa/compare/vv1.66.2...v1.66.3) (2026-03-20)


### Bug Fixes

* skip AI co-authorship check for release commits ([#304](https://github.com/CodySwannGT/lisa/issues/304)) ([ae89833](https://github.com/CodySwannGT/lisa/commit/ae89833b00d7092e071336b421341c3c163a2a06))

### [1.66.2](https://github.com/CodySwannGT/lisa/compare/vv1.66.1...v1.66.2) (2026-03-20)


### Bug Fixes

* upstream template fixes from api-creator onboarding ([#303](https://github.com/CodySwannGT/lisa/issues/303)) ([68eaa0e](https://github.com/CodySwannGT/lisa/commit/68eaa0e243068cb90b808fb22b6429a0fabbcf4d))

### [1.66.1](https://github.com/CodySwannGT/lisa/compare/vv1.66.0...v1.66.1) (2026-03-19)


### Bug Fixes

* add --passWithNoTests to test:integration vitest scripts ([#302](https://github.com/CodySwannGT/lisa/issues/302)) ([caa4f44](https://github.com/CodySwannGT/lisa/commit/caa4f4428a6ce1d17b1f800d129ff741be4d3ff3))

## [1.66.0](https://github.com/CodySwannGT/lisa/compare/vv1.65.3...v1.66.0) (2026-03-19)


### Features

* add Vitest support for CDK stack ([#301](https://github.com/CodySwannGT/lisa/issues/301)) ([c035853](https://github.com/CodySwannGT/lisa/commit/c0358531e957dc870069b9befd487c2a07483709))

### [1.65.3](https://github.com/CodySwannGT/lisa/compare/vv1.65.2...v1.65.3) (2026-03-19)


### Bug Fixes

* prevent vitest devDependencies and test:watch script from bleeding into CDK/Expo stacks ([#300](https://github.com/CodySwannGT/lisa/issues/300)) ([b50748f](https://github.com/CodySwannGT/lisa/commit/b50748f8bafcf0a48a0ed7138e3052158b9659e1))

### [1.65.2](https://github.com/CodySwannGT/lisa/compare/vv1.65.1...v1.65.2) (2026-03-19)


### Bug Fixes

* prevent TypeScript vitest migration from deleting Jest configs in CDK/Expo stacks ([#299](https://github.com/CodySwannGT/lisa/issues/299)) ([24dc76e](https://github.com/CodySwannGT/lisa/commit/24dc76effdd58ebf8fe489a4a2b29ab1d06c687e))

### [1.65.1](https://github.com/CodySwannGT/lisa/compare/vv1.65.0...v1.65.1) (2026-03-19)

## [1.65.0](https://github.com/CodySwannGT/lisa/compare/vv1.64.0...v1.65.0) (2026-03-19)


### Features

* add Vitest templates, governance, CI/CD, and plugin updates ([#297](https://github.com/CodySwannGT/lisa/issues/297)) ([c276c0d](https://github.com/CodySwannGT/lisa/commit/c276c0d479eb26d73270d9f853e0d6fe7631484b))

## [1.64.0](https://github.com/CodySwannGT/lisa/compare/vv1.63.0...v1.64.0) (2026-03-19)


### Features

* migrate Lisa's own tests from Jest to Vitest ([#296](https://github.com/CodySwannGT/lisa/issues/296)) ([d8c76b8](https://github.com/CodySwannGT/lisa/commit/d8c76b8319c71aec761232f8806d6bd51f5cbcb4))

## [1.63.0](https://github.com/CodySwannGT/lisa/compare/vv1.62.0...v1.63.0) (2026-03-19)


### Features

* add Vitest config factories for TypeScript and NestJS stacks ([#295](https://github.com/CodySwannGT/lisa/issues/295)) ([3e1f4f0](https://github.com/CodySwannGT/lisa/commit/3e1f4f0b2037f98fe14f6e05b6b8f09f1a936b57))

## [1.62.0](https://github.com/CodySwannGT/lisa/compare/vv1.61.0...v1.62.0) (2026-03-18)


### Features

* implement Rails parity with TypeScript ecosystem ([#294](https://github.com/CodySwannGT/lisa/issues/294)) ([dd0243b](https://github.com/CodySwannGT/lisa/commit/dd0243b6ec76fe7e8af0d0a6a142c419c414f865))

## [1.61.0](https://github.com/CodySwannGT/lisa/compare/vv1.60.7...v1.61.0) (2026-03-18)


### Features

* add configurable coverage_increment input to nightly test coverage workflow ([#293](https://github.com/CodySwannGT/lisa/issues/293)) ([ac02e50](https://github.com/CodySwannGT/lisa/commit/ac02e508f039f9d4848a4f3f57f5d7ff2a0fbe28))

### [1.60.7](https://github.com/CodySwannGT/lisa/compare/vv1.60.6...v1.60.7) (2026-03-18)


### Bug Fixes

* add security audit failure handling to Claude workflows and rules ([#292](https://github.com/CodySwannGT/lisa/issues/292)) ([6b28d7b](https://github.com/CodySwannGT/lisa/commit/6b28d7bf8d5d4cfb45498265c47cd16ea09ffe83))

### [1.60.6](https://github.com/CodySwannGT/lisa/compare/vv1.60.5...v1.60.6) (2026-03-16)

### [1.60.5](https://github.com/CodySwannGT/lisa/compare/vv1.60.4...v1.60.5) (2026-03-16)


### Bug Fixes

* add git branch fallback to CodeRabbit trigger step in nightly workflows ([#290](https://github.com/CodySwannGT/lisa/issues/290)) ([a734419](https://github.com/CodySwannGT/lisa/commit/a734419e60863ec3411a72ccf3bb866fd9a3b4a6))

### [1.60.4](https://github.com/CodySwannGT/lisa/compare/vv1.60.3...v1.60.4) (2026-03-16)


### Bug Fixes

* make auto-merge step non-fatal in reusable nightly workflows ([#289](https://github.com/CodySwannGT/lisa/issues/289)) ([efb34cc](https://github.com/CodySwannGT/lisa/commit/efb34cc40ac23ded0e54467d4ff3868c8b7746c7))

### [1.60.3](https://github.com/CodySwannGT/lisa/compare/vv1.60.2...v1.60.3) (2026-03-16)


### Bug Fixes

* guide nightly coverage workflow to run test:cov before exploring source ([#288](https://github.com/CodySwannGT/lisa/issues/288)) ([1682f9c](https://github.com/CodySwannGT/lisa/commit/1682f9c58ce1eb318080a9879355a1286968f6a0))

### [1.60.2](https://github.com/CodySwannGT/lisa/compare/vv1.60.1...v1.60.2) (2026-03-14)


### Bug Fixes

* move typescript-lsp plugin to typescript merge ([#287](https://github.com/CodySwannGT/lisa/issues/287)) ([d441b86](https://github.com/CodySwannGT/lisa/commit/d441b86746928c28e16533c09cca9ef83a1ba5fa))

### [1.60.1](https://github.com/CodySwannGT/lisa/compare/vv1.60.0...v1.60.1) (2026-03-14)


### Code Refactoring

* remove manifest file system from Lisa ([#286](https://github.com/CodySwannGT/lisa/issues/286)) ([b15191b](https://github.com/CodySwannGT/lisa/commit/b15191b83b97c468e64352b6a65f590e35ccbd96))

## [1.60.0](https://github.com/CodySwannGT/lisa/compare/vv1.59.0...v1.60.0) (2026-03-13)


### Features

* **ci:** add Rails-specific reusable CI/CD workflows ([#285](https://github.com/CodySwannGT/lisa/issues/285)) ([65b3f51](https://github.com/CodySwannGT/lisa/commit/65b3f51b3ee476c841af483960590324ed2b0fa1))

## [1.59.0](https://github.com/CodySwannGT/lisa/compare/vv1.58.4...v1.59.0) (2026-03-13)


### Features

* **ci:** run Jira triage every 2 hours and document activation setup ([#283](https://github.com/CodySwannGT/lisa/issues/283)) ([c356322](https://github.com/CodySwannGT/lisa/commit/c3563227f8f87ad60b499510a06b6da54de9199b))


### Bug Fixes

* **ci:** trigger CodeRabbit review on bot-created PRs ([#284](https://github.com/CodySwannGT/lisa/issues/284)) ([9143e7b](https://github.com/CodySwannGT/lisa/commit/9143e7b5cdfa052b9a856b7fbfb41e9f4c9f722f))

### [1.58.4](https://github.com/CodySwannGT/lisa/compare/vv1.58.3...v1.58.4) (2026-03-12)


### Bug Fixes

* **ci:** use shell arithmetic for dynamic max-turns calculation ([#282](https://github.com/CodySwannGT/lisa/issues/282)) ([7d59724](https://github.com/CodySwannGT/lisa/commit/7d597247196c3da48dc0755c3beecbac8ec9134d))

### [1.58.3](https://github.com/CodySwannGT/lisa/compare/vv1.58.2...v1.58.3) (2026-03-12)


### Bug Fixes

* **ci:** scale Jira triage max-turns dynamically by ticket count ([#281](https://github.com/CodySwannGT/lisa/issues/281)) ([866e0b8](https://github.com/CodySwannGT/lisa/commit/866e0b83fcd898905d6160f363328509e0993d08))

### [1.58.2](https://github.com/CodySwannGT/lisa/compare/vv1.58.1...v1.58.2) (2026-03-12)


### Bug Fixes

* **ci:** restore Jira triage workflow max-turns to 40 ([#280](https://github.com/CodySwannGT/lisa/issues/280)) ([17a3155](https://github.com/CodySwannGT/lisa/commit/17a31559b18b7bd1f9649ba0703000655ff80088)), closes [#279](https://github.com/CodySwannGT/lisa/issues/279)

### [1.58.1](https://github.com/CodySwannGT/lisa/compare/vv1.58.0...v1.58.1) (2026-03-12)


### Bug Fixes

* **ci:** migrate Jira triage workflow from v2 to v3 API ([#279](https://github.com/CodySwannGT/lisa/issues/279)) ([ab836dc](https://github.com/CodySwannGT/lisa/commit/ab836dc085fc534c24532cfb092fadb044035979))

## [1.58.0](https://github.com/CodySwannGT/lisa/compare/vv1.57.3...v1.58.0) (2026-03-11)


### Features

* **ci:** add multi-repo Jira triage workflow with relevance gating ([#278](https://github.com/CodySwannGT/lisa/issues/278)) ([5d2e015](https://github.com/CodySwannGT/lisa/commit/5d2e015c5d0ba9774c0969c02e0abe195e1cf127))

### [1.57.3](https://github.com/CodySwannGT/lisa/compare/vv1.57.2...v1.57.3) (2026-03-11)


### Bug Fixes

* **ci:** fix auto-merge skipping when branch_name output is empty ([#277](https://github.com/CodySwannGT/lisa/issues/277)) ([f4ddea8](https://github.com/CodySwannGT/lisa/commit/f4ddea8f4b842b5320ce866d53fd5cace77b395a))

### [1.57.2](https://github.com/CodySwannGT/lisa/compare/vv1.57.1...v1.57.2) (2026-03-10)


### Bug Fixes

* **ci:** add persist-credentials: false to all Claude workflow checkouts ([#276](https://github.com/CodySwannGT/lisa/issues/276)) ([3f7d6e8](https://github.com/CodySwannGT/lisa/commit/3f7d6e868eb87cd6f6845990d92b64d174e621b3))

### [1.57.1](https://github.com/CodySwannGT/lisa/compare/vv1.57.0...v1.57.1) (2026-03-10)


### Bug Fixes

* **ci:** use action branch_name output for auto-merge PR lookup ([#275](https://github.com/CodySwannGT/lisa/issues/275)) ([0c34b2d](https://github.com/CodySwannGT/lisa/commit/0c34b2da4e62e4aa6b9b8c0cdbb771f4ae2f1721))

## [1.57.0](https://github.com/CodySwannGT/lisa/compare/vv1.56.9...v1.57.0) (2026-03-09)


### Features

* **ci:** add auto_merge input to PR-creating Claude workflows ([#274](https://github.com/CodySwannGT/lisa/issues/274)) ([54a1636](https://github.com/CodySwannGT/lisa/commit/54a1636b108ac784cfbe78896f3f8d3f572b9c3f))

### [1.56.9](https://github.com/CodySwannGT/lisa/compare/vv1.56.8...v1.56.9) (2026-03-09)


### Bug Fixes

* **jest:** add .test.ts pattern to CDK testRegex ([#273](https://github.com/CodySwannGT/lisa/issues/273)) ([2243461](https://github.com/CodySwannGT/lisa/commit/22434613f5d182aca6ce046b8851713f1db7f0c8))

### [1.56.8](https://github.com/CodySwannGT/lisa/compare/vv1.56.7...v1.56.8) (2026-03-06)


### Bug Fixes

* remove verify-completion.sh Stop hook ([#272](https://github.com/CodySwannGT/lisa/issues/272)) ([9f25d4d](https://github.com/CodySwannGT/lisa/commit/9f25d4dfca1cb436ec086e0e04f7b0f58f1cd66b))

### [1.56.7](https://github.com/CodySwannGT/lisa/compare/vv1.56.6...v1.56.7) (2026-03-05)


### Bug Fixes

* **ci:** add NODE_OPTIONS heap limit to test workflow steps ([430d046](https://github.com/CodySwannGT/lisa/commit/430d04660520d608384d796b48d4d8dddd59e020))

### [1.56.6](https://github.com/CodySwannGT/lisa/compare/vv1.56.5...v1.56.6) (2026-03-05)


### Bug Fixes

* point ts-jest to tsconfig.spec.json for correct test diagnostics ([2062e37](https://github.com/CodySwannGT/lisa/commit/2062e37e7260d599139e59f6216de3e7791c1736))

### [1.56.5](https://github.com/CodySwannGT/lisa/compare/vv1.56.4...v1.56.5) (2026-03-05)


### Bug Fixes

* remove paths from copy-overwrite tsconfig to prevent overriding project aliases ([a68e7a7](https://github.com/CodySwannGT/lisa/commit/a68e7a7ef5957b5c2e81097570e28689707ff003))

### [1.56.4](https://github.com/CodySwannGT/lisa/compare/vv1.56.3...v1.56.4) (2026-03-05)


### Bug Fixes

* change reusable workflow package_manager default from bun to npm ([2d83962](https://github.com/CodySwannGT/lisa/commit/2d83962b5747f6df97e53e40f44bf6021a0330a9))

### [1.56.3](https://github.com/CodySwannGT/lisa/compare/vv1.56.2...v1.56.3) (2026-03-05)


### Bug Fixes

* disable import/no-cycle for NestJS module files in slow lint config ([5b55d64](https://github.com/CodySwannGT/lisa/commit/5b55d640f8b995ef11ee099328f1c485778fdc8d))

### [1.56.2](https://github.com/CodySwannGT/lisa/compare/vv1.56.1...v1.56.2) (2026-03-05)


### Code Refactoring

* split monolithic plugins into layered, composable plugins ([30ac906](https://github.com/CodySwannGT/lisa/commit/30ac9067b78216a1bf6518aa3230c51c10ded73a))

### [1.56.1](https://github.com/CodySwannGT/lisa/compare/vv1.56.0...v1.56.1) (2026-03-05)


### Bug Fixes

* auto-bootstrap trustedDependencies via default postinstall script ([603f52a](https://github.com/CodySwannGT/lisa/commit/603f52affa41a01be23c5ebea88a54336bd89392))

## [1.56.0](https://github.com/CodySwannGT/lisa/compare/vv1.55.2...v1.56.0) (2026-03-05)


### Features

* move reduce-complexity skill to Expo plugin ([a29ed7c](https://github.com/CodySwannGT/lisa/commit/a29ed7c225c3d712e4e23eb5c8cad65a47b84f8c))


### Bug Fixes

* add debug-hook.sh cleanup to update-projects skill ([5109848](https://github.com/CodySwannGT/lisa/commit/51098482cfd0bca4e8a9f9e3591ef4a6bbce462f))
* broaden stale hook cleanup to all $CLAUDE_PROJECT_DIR references ([9bf597c](https://github.com/CodySwannGT/lisa/commit/9bf597c2d9688a7aa2e108a6e45c9c49e7c74e8e))
* move baseUrl and paths from published tsconfigs to copy-overwrite templates ([22896b5](https://github.com/CodySwannGT/lisa/commit/22896b54b694b828ef09499c143febe3dc6d9deb))
* remove .claude/commands/lisa from keep list in deletions.json ([80ac77f](https://github.com/CodySwannGT/lisa/commit/80ac77f9259d1d7f8dd5d72f251a48706cd8a0b2))
* revert workspace stripping and add stale plugin cleanup to update skill ([be7c3f6](https://github.com/CodySwannGT/lisa/commit/be7c3f6e866a266c5f89e6f6fb398a6f5876b422))


### Documentation

* fix markdown issues in reduce-complexity references ([3a85802](https://github.com/CodySwannGT/lisa/commit/3a85802fd0c2136b49d3a4f2465e9a0fa41aa7db))

### [1.55.2](https://github.com/CodySwannGT/lisa/compare/vv1.55.1...v1.55.2) (2026-03-05)


### Bug Fixes

* strip workspaces field from published npm package ([ac757f4](https://github.com/CodySwannGT/lisa/commit/ac757f466d2e0ca3f103f04aca870444f81bdf43))

### [1.55.1](https://github.com/CodySwannGT/lisa/compare/vv1.55.0...v1.55.1) (2026-03-05)


### Bug Fixes

* support legacy plugin keys in install script for transition period ([f42087b](https://github.com/CodySwannGT/lisa/commit/f42087b03c3b75157b7dfb9b595a4255114972f0))

## [1.55.0](https://github.com/CodySwannGT/lisa/compare/vv1.54.15...v1.55.0) (2026-03-05)


### Features

* nest plugin commands and unify namespace to /lisa-* ([2970c59](https://github.com/CodySwannGT/lisa/commit/2970c59735e135eec9c4059027c49c1669723bf2))

### [1.54.15](https://github.com/CodySwannGT/lisa/compare/vv1.54.14...v1.54.15) (2026-03-05)


### Bug Fixes

* commit built plugins for GitHub marketplace distribution ([c5ace7f](https://github.com/CodySwannGT/lisa/commit/c5ace7f9366ee3f6074a7b4c2cbbe177c7e6a023))
* rebuild plugins during release so version is committed to GitHub ([69b0ead](https://github.com/CodySwannGT/lisa/commit/69b0eada0a8f736a9fc2269de5350a367afa161d))
* sync plugin versions with Lisa package version ([89b70ad](https://github.com/CodySwannGT/lisa/commit/89b70ad8b39bde7e81f9583fa353e4db46fcf0c9))

### [1.54.14](https://github.com/CodySwannGT/lisa/compare/vv1.54.13...v1.54.14) (2026-03-05)


### Bug Fixes

* correct plugin manifest author field and marketplace command ([9f9fea7](https://github.com/CodySwannGT/lisa/commit/9f9fea7d106403bbc3515857aa7b4f19f3156662))

### [1.54.13](https://github.com/CodySwannGT/lisa/compare/vv1.54.12...v1.54.13) (2026-03-05)


### Bug Fixes

* register Lisa marketplace at project scope instead of user scope ([ebb74c7](https://github.com/CodySwannGT/lisa/commit/ebb74c78c7eaca05dc3d2abdc332bb44e21eb773))

### [1.54.12](https://github.com/CodySwannGT/lisa/compare/vv1.54.11...v1.54.12) (2026-03-05)


### Bug Fixes

* add trustedDependencies check to lisa-update-projects skill ([e047887](https://github.com/CodySwannGT/lisa/commit/e0478874f452b4a518a9afe0451f80d976afd150))

### [1.54.11](https://github.com/CodySwannGT/lisa/compare/vv1.54.10...v1.54.11) (2026-03-04)


### Bug Fixes

* add @codyswann/lisa to trustedDependencies template ([9fb10c9](https://github.com/CodySwannGT/lisa/commit/9fb10c9f50a2dd12165d9b6faf2cc9aebe4ed13c))

### [1.54.10](https://github.com/CodySwannGT/lisa/compare/vv1.54.9...v1.54.10) (2026-03-04)


### Bug Fixes

* **ci:** enforce TDD in Claude code review response workflow ([#254](https://github.com/CodySwannGT/lisa/issues/254)) ([faea047](https://github.com/CodySwannGT/lisa/commit/faea047c9587d0f3d56d1cd6b0aff3f1a3bf96b5))

### [1.54.9](https://github.com/CodySwannGT/lisa/compare/vv1.54.8...v1.54.9) (2026-03-04)


### Bug Fixes

* **ci:** add Node.js setup and dependency install to reusable Claude workflows ([3e43418](https://github.com/CodySwannGT/lisa/commit/3e434187340f62dfa34037f0bd3a68ad1cb4833a))

### [1.54.8](https://github.com/CodySwannGT/lisa/compare/vv1.54.7...v1.54.8) (2026-03-04)


### Bug Fixes

* **ci:** stop ZAP baseline scan from failing on warnings ([3a4932b](https://github.com/CodySwannGT/lisa/commit/3a4932b6f7b364b9c8626b84aff5fb722973353f))

### [1.54.7](https://github.com/CodySwannGT/lisa/compare/vv1.54.6...v1.54.7) (2026-03-03)


### Bug Fixes

* address CodeRabbit review comments on PR [#251](https://github.com/CodySwannGT/lisa/issues/251) ([8a0ce3a](https://github.com/CodySwannGT/lisa/commit/8a0ce3afcd65eae6592650bc65892dac36ce9dbd))
* **ci:** add git identity setup to claude reusable workflows ([6affd13](https://github.com/CodySwannGT/lisa/commit/6affd136806c834ec89b0ce77d35c2fdcc70a030))
* move tsconfig include/exclude from published configs to project root templates ([37a77b2](https://github.com/CodySwannGT/lisa/commit/37a77b217a713ef8f66c9fa7c9f3d3bce9cf4f91))

### [1.54.6](https://github.com/CodySwannGT/lisa/compare/vv1.54.5...v1.54.6) (2026-03-03)


### Bug Fixes

* **ci:** convert dispatch workflow to thin wrapper calling reusable workflow ([31e00d0](https://github.com/CodySwannGT/lisa/commit/31e00d0b80e163f4c0e821d1f722618074269620))

### [1.54.5](https://github.com/CodySwannGT/lisa/compare/vv1.54.4...v1.54.5) (2026-03-03)


### Bug Fixes

* **ci:** skip workflow file modifications in review response ([cf77f27](https://github.com/CodySwannGT/lisa/commit/cf77f273c8fe10c11d851369f2eac83efbfdfd48))
* **ci:** use repository_dispatch to route push events to claude-code-action ([5ae58ad](https://github.com/CodySwannGT/lisa/commit/5ae58ad14681e2004a9ec4826d5c49994535c655))

### [1.54.4](https://github.com/CodySwannGT/lisa/compare/vv1.54.3...v1.54.4) (2026-03-03)


### Bug Fixes

* use correct object format for extraKnownMarketplaces ([3e2dd2f](https://github.com/CodySwannGT/lisa/commit/3e2dd2f2ca7d81dc5bf9296eab970c78b9640fe7))

### [1.54.3](https://github.com/CodySwannGT/lisa/compare/vv1.54.2...v1.54.3) (2026-03-03)


### Bug Fixes

* **ci:** pass package_manager through auto-fix workflows to avoid npm cache error ([ce1e996](https://github.com/CodySwannGT/lisa/commit/ce1e99625bad85973c949428e7f5e4941ef3d7fb))

### [1.54.2](https://github.com/CodySwannGT/lisa/compare/vv1.54.1...v1.54.2) (2026-03-03)


### Bug Fixes

* **ci:** replace GITHUB_TOKEN with claude-code-action for CI re-trigger ([d8dfeaa](https://github.com/CodySwannGT/lisa/commit/d8dfeaa643069889b2555e072095a4ebc8f605ea))

### [1.54.1](https://github.com/CodySwannGT/lisa/compare/vv1.54.0...v1.54.1) (2026-03-03)


### Bug Fixes

* **scripts:** fail explicitly when no supported lockfile is detected ([b08ba20](https://github.com/CodySwannGT/lisa/commit/b08ba20a34d96a9f5a9edd34fde30661b8902033))
* **scripts:** remove global bun requirement and use version-aware yarn commands ([d119bc7](https://github.com/CodySwannGT/lisa/commit/d119bc71eb82ef106289bac4472ae6ffc249e37e))
* update lisa:update-projects to use package manager update ([628b99a](https://github.com/CodySwannGT/lisa/commit/628b99a2f764933e1c079ce0e6f07c58567787e0))


### Code Refactoring

* **commands:** extract lisa-update-projects skill and slim command to delegator ([7288095](https://github.com/CodySwannGT/lisa/commit/7288095ba67a7e22d7d611103d75ee6c5ef3291f))

## [1.54.0](https://github.com/CodySwannGT/lisa/compare/vv1.53.9...v1.54.0) (2026-03-02)


### Features

* **plugins:** update plugin configuration per project type ([782e368](https://github.com/CodySwannGT/lisa/commit/782e3689c73cae7fee61eb79b1b9bd5a6ee46d9d))

### [1.53.9](https://github.com/CodySwannGT/lisa/compare/vv1.53.8...v1.53.9) (2026-03-02)


### Bug Fixes

* **ci:** add missing permissions to claude.yml caller workflow ([f608946](https://github.com/CodySwannGT/lisa/commit/f6089466f3fa462f39c0ccfcb2ed0e40934d8130))

### [1.53.8](https://github.com/CodySwannGT/lisa/compare/vv1.53.7...v1.53.8) (2026-03-02)


### Bug Fixes

* **ci:** use Claude Code action for auto-update and add missing permissions ([15e6bb3](https://github.com/CodySwannGT/lisa/commit/15e6bb34d6ec95c6208877bce2e84a5ab0554b20))

### [1.53.7](https://github.com/CodySwannGT/lisa/compare/vv1.53.6...v1.53.7) (2026-03-02)


### Bug Fixes

* **ci:** replace autoupdate Docker action with gh api calls ([c0ce4b8](https://github.com/CodySwannGT/lisa/commit/c0ce4b8e9ec6634ea86d5bfb5bed550deff1883b))

### [1.53.6](https://github.com/CodySwannGT/lisa/compare/vv1.53.5...v1.53.6) (2026-03-02)

### [1.53.5](https://github.com/CodySwannGT/lisa/compare/vv1.53.4...v1.53.5) (2026-03-02)

### [1.53.4](https://github.com/CodySwannGT/lisa/compare/vv1.53.3...v1.53.4) (2026-03-02)


### Bug Fixes

* **ci:** use TRIGGER_TOKEN in auto-update workflow to trigger downstream CI ([f68ee34](https://github.com/CodySwannGT/lisa/commit/f68ee34182e707437046c1a6c67784b60f603044))

### [1.53.3](https://github.com/CodySwannGT/lisa/compare/vv1.53.2...v1.53.3) (2026-03-02)

### [1.53.2](https://github.com/CodySwannGT/lisa/compare/vv1.53.1...v1.53.2) (2026-03-02)


### Bug Fixes

* **ci:** add permissions to caller workflows for reusable workflow compatibility ([b520a4f](https://github.com/CodySwannGT/lisa/commit/b520a4f5994429fe44f8f0c5540fdb908cf83900))

### [1.53.1](https://github.com/CodySwannGT/lisa/compare/vv1.53.0...v1.53.1) (2026-03-02)


### Code Refactoring

* move k6, ZAP, and lighthouse from copy-overwrite to create-only ([267304f](https://github.com/CodySwannGT/lisa/commit/267304f636fd66c5144fc22b9e8b2ee4c08976a7))
* move MCPs to plugins, remove copy-overwrite READMEs ([77938c5](https://github.com/CodySwannGT/lisa/commit/77938c5b3d76558fed941b9ac3c2bf5e41c0b197))
* **rails:** move settings.json to merge, rules to plugin ([c83095f](https://github.com/CodySwannGT/lisa/commit/c83095ff1bc158671d70b8d739cbdfd472a0133d))

## [1.53.0](https://github.com/CodySwannGT/lisa/compare/vv1.52.5...v1.53.0) (2026-03-02)


### Features

* dogfood Lisa on itself via npm package self-install ([d30951d](https://github.com/CodySwannGT/lisa/commit/d30951d9e4b5c1846fb8ae6582611e28270cb64b))


### Bug Fixes

* **ci:** add permissions block to auto-update-pr-branches caller workflow ([14d10ea](https://github.com/CodySwannGT/lisa/commit/14d10ea263df7803370e091dce365002b529d78a))
* **ci:** ensure dist/ exists before tests and lint in CI ([a72b6d2](https://github.com/CodySwannGT/lisa/commit/a72b6d25e231e26a105b4c6de28bbea71032365c))
* **ci:** replace Unicode surrogate pair text with actual emoji in workflows ([e3541df](https://github.com/CodySwannGT/lisa/commit/e3541dff98ac1a48ba18bbe396189b09cf496ff1))
* **ci:** skip running Lisa on itself during postinstall ([2433dee](https://github.com/CodySwannGT/lisa/commit/2433dee8a2d213f5cae9b1d63ea5dd368da21db2))
* **ci:** update lockfile to @codyswann/lisa@1.52.6 ([5d154b2](https://github.com/CodySwannGT/lisa/commit/5d154b2e84de3a110ee479d54c9f7651149f26c3))
* resolve knip and moduleNameMapper issues from dogfood ([7f07a8f](https://github.com/CodySwannGT/lisa/commit/7f07a8f2a66dd55a32228144b390913cae02dc60))

### [1.52.5](https://github.com/CodySwannGT/lisa/compare/vv1.52.4...v1.52.5) (2026-03-02)


### Bug Fixes

* **ci:** replace secrets: inherit with explicit secrets for cross-repo workflows ([aa2e538](https://github.com/CodySwannGT/lisa/commit/aa2e538a412f12aea675ebfe290d2fde2ea702cc))

### [1.52.4](https://github.com/CodySwannGT/lisa/compare/vv1.52.3...v1.52.4) (2026-03-02)


### Code Refactoring

* migrate GitHub workflows from copy-overwrite to create-only ([107667b](https://github.com/CodySwannGT/lisa/commit/107667bcc1e7522d1c472cf356de055c8455fe20))


### Documentation

* fix plan text to scope workflow deletion correctly ([535a99d](https://github.com/CodySwannGT/lisa/commit/535a99d287eb577e1f7b0271171521503f4b992e))
* fix verification step to check workflows dir, not parent ([b8a8916](https://github.com/CodySwannGT/lisa/commit/b8a891633eec4099a9c0c6ec1021819469a6ffdd))

### [1.52.3](https://github.com/CodySwannGT/lisa/compare/vv1.52.2...v1.52.3) (2026-03-02)


### Code Refactoring

* migrate GitHub workflows to [@main](https://github.com/main) references ([#229](https://github.com/CodySwannGT/lisa/issues/229)) ([90efef5](https://github.com/CodySwannGT/lisa/commit/90efef5abea85d75160284d222d04c6afe1808f4))

### [1.52.2](https://github.com/CodySwannGT/lisa/compare/vv1.52.1...v1.52.2) (2026-03-01)

### [1.52.1](https://github.com/CodySwannGT/lisa/compare/vv1.52.0...v1.52.1) (2026-03-01)

## [1.52.0](https://github.com/CodySwannGT/lisa/compare/vv1.51.5...v1.52.0) (2026-03-01)


### Features

* reference quality.yml and release.yml from Lisa repo directly ([9c82a9f](https://github.com/CodySwannGT/lisa/commit/9c82a9f261eea1c9ae00320ba05bffa67fb7506c))

### [1.51.5](https://github.com/CodySwannGT/lisa/compare/vv1.51.4...v1.51.5) (2026-03-01)


### Bug Fixes

* downgrade minimatch to v3 and add CJS-compat default import ([eb2e917](https://github.com/CodySwannGT/lisa/commit/eb2e917b55abbf8479dac3cdf7d95d65f6561526))

### [1.51.4](https://github.com/CodySwannGT/lisa/compare/vv1.51.3...v1.51.4) (2026-03-01)


### Bug Fixes

* downgrade minimatch from ^10 to ^9 for CJS compatibility ([34dfaf4](https://github.com/CodySwannGT/lisa/commit/34dfaf410b6d0de7149a2af78e93c8e20df304d0))

### [1.51.3](https://github.com/CodySwannGT/lisa/compare/vv1.51.2...v1.51.3) (2026-03-01)


### Bug Fixes

* restore react-native import/ignore and set sonarjs/deprecation off in slow config ([25d41a7](https://github.com/CodySwannGT/lisa/commit/25d41a71488c7893c9f9907adc01905c63fb801c))

### [1.51.2](https://github.com/CodySwannGT/lisa/compare/vv1.51.1...v1.51.2) (2026-03-01)


### Bug Fixes

* add codyswann eslint workspace plugins to knip ignoreDependencies ([a9ba350](https://github.com/CodySwannGT/lisa/commit/a9ba35013b0dbccc847e8791a85fcd192731a5a6))
* add moduleNameMapper for @codyswann/lisa self-referencing imports in tests ([e1a5e76](https://github.com/CodySwannGT/lisa/commit/e1a5e76a364020a7bf4bd0973ac8422b95f2a6eb))
* update expo template imports to use @codyswann/lisa package paths ([e8beae9](https://github.com/CodySwannGT/lisa/commit/e8beae9d3797820ad78f6b2da48100d7b8298787))

### [1.51.1](https://github.com/CodySwannGT/lisa/compare/vv1.51.0...v1.51.1) (2026-03-01)


### Bug Fixes

* remove file:./eslint-plugin-code-organization from downstream template ([d26d9bd](https://github.com/CodySwannGT/lisa/commit/d26d9bd09273543dfd5372be6153b280c92100d0))

## [1.51.0](https://github.com/CodySwannGT/lisa/compare/vv1.50.3...v1.51.0) (2026-03-01)


### Features

* add --skip-git-check flag to bypass dirty git check during postinstall ([a9c3069](https://github.com/CodySwannGT/lisa/commit/a9c3069ed7f9b8e8c8f8978ff8dce82ca20cf01d))

### [1.50.3](https://github.com/CodySwannGT/lisa/compare/vv1.50.2...v1.50.3) (2026-03-01)


### Bug Fixes

* inline ESLint workspace plugins as local files in the Lisa package ([187564d](https://github.com/CodySwannGT/lisa/commit/187564d238ab6f0e7a9d8e28d420d2b870854f08))

### [1.50.2](https://github.com/CodySwannGT/lisa/compare/vv1.50.1...v1.50.2) (2026-03-01)


### Bug Fixes

* bundle ESLint workspace plugins into @codyswann/lisa tarball ([740c29e](https://github.com/CodySwannGT/lisa/commit/740c29ee5007efcce47c12e0f28c6f3337ba4531))

### [1.50.1](https://github.com/CodySwannGT/lisa/compare/vv1.50.0...v1.50.1) (2026-03-01)


### Bug Fixes

* publish workspace ESLint plugins to npm in release workflow ([2eaae68](https://github.com/CodySwannGT/lisa/commit/2eaae68e841dd36417b30055e38ffd3b691a0151))

## [1.50.0](https://github.com/CodySwannGT/lisa/compare/vv1.49.0...v1.50.0) (2026-03-01)


### Features

* run lisa update and strip hooks in postinstall; bump devDep to ^1.49.0 ([010811f](https://github.com/CodySwannGT/lisa/commit/010811f5e8ff8b8cabc2f078dca08ad72372f74f))


### Bug Fixes

* **postinstall:** warn on lisa template failure instead of silent || true ([8ba78b4](https://github.com/CodySwannGT/lisa/commit/8ba78b488288ea70b6120904fcf42c9b31e74d8f))


### Documentation

* replace absolute paths with portable placeholders in plan doc ([4e991ac](https://github.com/CodySwannGT/lisa/commit/4e991ac83a44e67067858926e16ef3f8dc340a40))

## [1.49.0](https://github.com/CodySwannGT/lisa/compare/vv1.48.0...v1.49.0) (2026-03-01)


### Features

* add plugin auto-install, deep-merge settings.json, and deduplicate plugin source ([#215](https://github.com/CodySwannGT/lisa/issues/215)) ([83b8ecc](https://github.com/CodySwannGT/lisa/commit/83b8ecc240da36d4ecad316ad474d9945b5f5711))

## [1.48.0](https://github.com/CodySwannGT/lisa/compare/vv1.47.1...v1.48.0) (2026-03-01)


### Features

* publish ESLint plugins as scoped @codyswann/ npm packages ([#214](https://github.com/CodySwannGT/lisa/issues/214)) ([86ec257](https://github.com/CodySwannGT/lisa/commit/86ec257746cab7f060f2518c3be6fc9a8dea50b0))

### [1.47.1](https://github.com/CodySwannGT/lisa/compare/vv1.47.0...v1.47.1) (2026-02-28)


### Bug Fixes

* **workflows:** enable full output and fix review response turn exhaustion ([#213](https://github.com/CodySwannGT/lisa/issues/213)) ([1f021e7](https://github.com/CodySwannGT/lisa/commit/1f021e73f4bf158ca4d71743859afd179b07e2ad))

## [1.47.0](https://github.com/CodySwannGT/lisa/compare/vv1.46.4...v1.47.0) (2026-02-27)


### Features

* upgrade Claude CI workflows with broader permissions, deploy auto-fix, and issue fallback ([#212](https://github.com/CodySwannGT/lisa/issues/212)) ([7305586](https://github.com/CodySwannGT/lisa/commit/7305586d71b8d6d4f392d2928e9596581081c9b2)), closes [#200](https://github.com/CodySwannGT/lisa/issues/200)

### [1.46.4](https://github.com/CodySwannGT/lisa/compare/vv1.46.3...v1.46.4) (2026-02-27)


### Bug Fixes

* add ./node_modules/.bin/ to allowed tools and minimatch GHSAs to audit ignores ([#211](https://github.com/CodySwannGT/lisa/issues/211)) ([cce554b](https://github.com/CodySwannGT/lisa/commit/cce554bb6e5b8c659406a15439a5b8af0b41ad7f))

### [1.46.3](https://github.com/CodySwannGT/lisa/compare/vv1.46.2...v1.46.3) (2026-02-26)


### Bug Fixes

* add continue-on-error to autoupdate workflow step ([#210](https://github.com/CodySwannGT/lisa/issues/210)) ([17744f0](https://github.com/CodySwannGT/lisa/commit/17744f0e5338bd5ad8d70b211cee1ce782393b5f))

### [1.46.2](https://github.com/CodySwannGT/lisa/compare/vv1.46.1...v1.46.2) (2026-02-26)


### Bug Fixes

* remove invalid workflows permission from autoupdate workflow ([#209](https://github.com/CodySwannGT/lisa/issues/209)) ([f0bbe9e](https://github.com/CodySwannGT/lisa/commit/f0bbe9ead24ca0387cd4df4e4ee0c2f00d7c2902))

### [1.46.1](https://github.com/CodySwannGT/lisa/compare/vv1.46.0...v1.46.1) (2026-02-26)


### Bug Fixes

* add workflows permission to autoupdate PR branches action ([#208](https://github.com/CodySwannGT/lisa/issues/208)) ([a651850](https://github.com/CodySwannGT/lisa/commit/a651850e89449694c3834b54f7a30ea02a934b85))

## [1.46.0](https://github.com/CodySwannGT/lisa/compare/vv1.45.0...v1.46.0) (2026-02-26)


### Features

* add node_modules/.bin to Claude workflow allowedTools ([39f7e6f](https://github.com/CodySwannGT/lisa/commit/39f7e6f47f7e010145e6d74877cae8e5704e3602))


### Bug Fixes

* use GitHub Action ref instead of Docker Hub for autoupdate action ([080be5c](https://github.com/CodySwannGT/lisa/commit/080be5c038b6a06fd6ee6f035d1ec1f6a049d380))


### Documentation

* improve lisa update-projects command with upstream check step ([98cbc36](https://github.com/CodySwannGT/lisa/commit/98cbc3651d640da03364cca35dcb37e5b8e6ce32))

## [1.45.0](https://github.com/CodySwannGT/lisa/compare/vv1.44.3...v1.45.0) (2026-02-24)


### Features

* add claude-nightly-code-complexity workflow ([#206](https://github.com/CodySwannGT/lisa/issues/206)) ([1d61247](https://github.com/CodySwannGT/lisa/commit/1d61247ef799cb53c70578e51f3b1f01001a386a))

### [1.44.3](https://github.com/CodySwannGT/lisa/compare/vv1.44.2...v1.44.3) (2026-02-24)

### [1.44.2](https://github.com/CodySwannGT/lisa/compare/vv1.44.1...v1.44.2) (2026-02-24)


### Bug Fixes

* resolve review threads after addressing CodeRabbit comments ([#204](https://github.com/CodySwannGT/lisa/issues/204)) ([d27ec09](https://github.com/CodySwannGT/lisa/commit/d27ec09b381da86e3d96f2e74c21a4b8e35dc18a))

### [1.44.1](https://github.com/CodySwannGT/lisa/compare/vv1.44.0...v1.44.1) (2026-02-24)


### Bug Fixes

* add coderabbitai to allowed_bots in code review response workflow ([#202](https://github.com/CodySwannGT/lisa/issues/202)) ([cdeaf4e](https://github.com/CodySwannGT/lisa/commit/cdeaf4eefc6777db4fc4144b5d75b9e4efcfc986))

## [1.44.0](https://github.com/CodySwannGT/lisa/compare/vv1.43.7...v1.44.0) (2026-02-24)


### Features

* upgrade Claude Code Action workflows ([#200](https://github.com/CodySwannGT/lisa/issues/200)) ([97f5444](https://github.com/CodySwannGT/lisa/commit/97f5444075ef3ce50348e6fe7cfd37eae50ddc57))

### [1.43.7](https://github.com/CodySwannGT/lisa/compare/vv1.43.6...v1.43.7) (2026-02-23)


### Bug Fixes

* handle bun package manager in issue-creation workflows and add security audit ignores ([#199](https://github.com/CodySwannGT/lisa/issues/199)) ([4d80ff6](https://github.com/CodySwannGT/lisa/commit/4d80ff618881d196f4f4f5a477d1848d189060ec))

### [1.43.6](https://github.com/CodySwannGT/lisa/compare/vv1.43.5...v1.43.6) (2026-02-23)


### Bug Fixes

* handle bun package manager in issue-creation CI workflows ([#198](https://github.com/CodySwannGT/lisa/issues/198)) ([b58ab53](https://github.com/CodySwannGT/lisa/commit/b58ab532f750182f6f12fd41a0c4d6418f08c087))
* **security:** add npm audit GHSA exclusions for minimatch and ajv ([#197](https://github.com/CodySwannGT/lisa/issues/197)) ([f5e707c](https://github.com/CodySwannGT/lisa/commit/f5e707cad504771feb941faf01d6ea7b8714bd2a))

### [1.43.5](https://github.com/CodySwannGT/lisa/compare/vv1.43.4...v1.43.5) (2026-02-23)


### Bug Fixes

* bump tar, add fast-xml-parser resolution, and add missing knip ignoreDependencies ([ca8dee1](https://github.com/CodySwannGT/lisa/commit/ca8dee18495392ec55dcfdb8c93ec593f7526270))

### [1.43.4](https://github.com/CodySwannGT/lisa/compare/vv1.43.3...v1.43.4) (2026-02-22)


### Documentation

* add Claude Code git worktree documentation ([#196](https://github.com/CodySwannGT/lisa/issues/196)) ([bffee3c](https://github.com/CodySwannGT/lisa/commit/bffee3c3c163ed3caf7c8336ce341e6266bb69e8))

### [1.43.3](https://github.com/CodySwannGT/lisa/compare/vv1.43.2...v1.43.3) (2026-02-19)


### Bug Fixes

* add npm audit exception handling for minimatch and ajv false positives ([#195](https://github.com/CodySwannGT/lisa/issues/195)) ([d7165b0](https://github.com/CodySwannGT/lisa/commit/d7165b06b57eb43c7991fa25bb9fbee14c43de1d))
* apply extra config assertions to Lighthouse preset overrides ([#194](https://github.com/CodySwannGT/lisa/issues/194)) ([40d7489](https://github.com/CodySwannGT/lisa/commit/40d748946b13eb23fa6eb28e463017289371fe45))

### [1.43.2](https://github.com/CodySwannGT/lisa/compare/vv1.43.1...v1.43.2) (2026-02-19)


### Bug Fixes

* **deps:** add minimatch >=10.2.1 resolution for ReDoS vulnerability ([#192](https://github.com/CodySwannGT/lisa/issues/192)) ([a1c1511](https://github.com/CodySwannGT/lisa/commit/a1c15116dc6ceb06d66b7dc6339a2f3445ef812f))
* **deps:** revert minimatch resolution, add GHSA-3ppc-4f35-3m26 audit ignore ([#193](https://github.com/CodySwannGT/lisa/issues/193)) ([57771a9](https://github.com/CodySwannGT/lisa/commit/57771a97ac1e9849cb69f6090705f365c793567f)), closes [#192](https://github.com/CodySwannGT/lisa/issues/192)

### [1.43.1](https://github.com/CodySwannGT/lisa/compare/vv1.43.0...v1.43.1) (2026-02-18)


### Bug Fixes

* **deps:** upgrade tar and fast-xml-parser in Expo template ([bf61b09](https://github.com/CodySwannGT/lisa/commit/bf61b0979ec00fbe3ab98ca39352fa1187392342))

## [1.43.0](https://github.com/CodySwannGT/lisa/compare/vv1.42.1...v1.43.0) (2026-02-16)


### Features

* add Expo verification rule, simulator/EAS scripts, Sentry plugin, and quick commands ([dc77a28](https://github.com/CodySwannGT/lisa/commit/dc77a28b1977aebafab827b640ce5601b95596f4))

### [1.42.1](https://github.com/CodySwannGT/lisa/compare/vv1.42.0...v1.42.1) (2026-02-16)


### Bug Fixes

* use esbuild-register for Jest config loading instead of ts-node ([105f768](https://github.com/CodySwannGT/lisa/commit/105f768848bd6695547919eb08c933ec5a8603c1))

## [1.42.0](https://github.com/CodySwannGT/lisa/compare/vv1.41.0...v1.42.0) (2026-02-16)


### Features

* add verify skills and expand verification contract ([078acf2](https://github.com/CodySwannGT/lisa/commit/078acf26ad6089403f7cf340850d1e72f1f40ab1))
* **rails:** add reek, flog, flay to pre-push hooks ([6d8126d](https://github.com/CodySwannGT/lisa/commit/6d8126d2f8fa5af3adacbbcc203f054acbe9363e))


### Bug Fixes

* deduplicate entire hooks in claude settings ([96b2e92](https://github.com/CodySwannGT/lisa/commit/96b2e92f1453c512621029ff70fed9281bda2636))

## [1.41.0](https://github.com/CodySwannGT/lisa/compare/vv1.40.0...v1.41.0) (2026-02-15)


### Features

* **expo:** add ops-specialist agent and ops skills ([19fb20f](https://github.com/CodySwannGT/lisa/commit/19fb20f09cf52a55af1ccf59f33f5ebfd7381e2c))

## [1.40.0](https://github.com/CodySwannGT/lisa/compare/vv1.39.3...v1.40.0) (2026-02-14)


### Features

* add commit-submit-pr-and-verify skills and commands ([8a4d88d](https://github.com/CodySwannGT/lisa/commit/8a4d88d3a5e4f413ef0084d7de41f8d4260a924c))


### Documentation

* update REFERENCE.0003.md with subagent skills and team best practices ([afcfe89](https://github.com/CodySwannGT/lisa/commit/afcfe892af1836c91d6ae7bb2ca56b4dce98e356))

### [1.39.3](https://github.com/CodySwannGT/lisa/compare/vv1.39.2...v1.39.3) (2026-02-14)


### Bug Fixes

* entire ([ff7ec3c](https://github.com/CodySwannGT/lisa/commit/ff7ec3cd739f5962701bb3fb8a5971db3d4f00c9))

### [1.39.2](https://github.com/CodySwannGT/lisa/compare/vv1.39.1...v1.39.2) (2026-02-14)


### Bug Fixes

* prevent trailing newline doubling in copy-contents guardrails block replacement ([b7c6df8](https://github.com/CodySwannGT/lisa/commit/b7c6df8f18acf0435c7373e8b7b0a7016e706b5a))
* **rails:** migrate rubocop require to plugins and use single quotes in Gemfile ([f2451e1](https://github.com/CodySwannGT/lisa/commit/f2451e14748269f7f89ae763a080b3a734130854))

### [1.39.1](https://github.com/CodySwannGT/lisa/compare/vv1.39.0...v1.39.1) (2026-02-14)

## [1.39.0](https://github.com/CodySwannGT/lisa/compare/vv1.38.0...v1.39.0) (2026-02-14)


### Features

* add plan execute command and .entire config ([5f2c310](https://github.com/CodySwannGT/lisa/commit/5f2c3107493dc2cf87322a3c3740713534eb2ef7))
* implement new fibonacci generator (TDD GREEN) ([bee8455](https://github.com/CodySwannGT/lisa/commit/bee8455cb46a6d7b6303005f8f62eabd1b5c7d41))
* replace fibonacci sequence generator with fresh TDD implementation ([d6e02a1](https://github.com/CodySwannGT/lisa/commit/d6e02a1736d84ac53f70580bdf5ee58d107d5cd9))
* replace fibonacci sequence generator with fresh TDD implementation ([98f605b](https://github.com/CodySwannGT/lisa/commit/98f605b475680cec817664b8d7c1ae3e147d8a17))


### Bug Fixes

* address CodeRabbit review comments in execute.md ([c1ac007](https://github.com/CodySwannGT/lisa/commit/c1ac00715ecfd9d2a5a243b2cd52fc5677a02919))
* guard entire hooks commands for silent failure when not installed ([9a8a420](https://github.com/CodySwannGT/lisa/commit/9a8a4204abb61c8040c7f0880ef7b9cf9ba9bb9d))
* remove stale axios vulnerability exclusion and fix Playwright terminology ([a2bb3e8](https://github.com/CodySwannGT/lisa/commit/a2bb3e8930bd853c6da6e773767b7c546b862d03))


### Code Refactoring

* remove existing fibonacci implementation ([e98fcaa](https://github.com/CodySwannGT/lisa/commit/e98fcaa37845fcbe91d8298d7a91d96a272cf204))


### Documentation

* update documentation and infrastructure for agent teams ([8b65b42](https://github.com/CodySwannGT/lisa/commit/8b65b4289966e011370c5d7d3e939834a44197ce))
* update eslint-disable example to use tuple pattern ([4403210](https://github.com/CodySwannGT/lisa/commit/440321005b6b5d573b52bed401ee28903a86f6ee))

## [1.38.0](https://github.com/CodySwannGT/lisa/compare/vv1.37.0...v1.38.0) (2026-02-13)


### Features

* **rails:** add action-controller and action-view best practices skills ([847d052](https://github.com/CodySwannGT/lisa/commit/847d052971c6d1baef022f10318b27186b09b60a))
* **rails:** add active-record-model-best-practices skill ([be9bb08](https://github.com/CodySwannGT/lisa/commit/be9bb0848bd0d4e09dd5844a1cf320d57be141b9))
* **rails:** add semantic versioning with VERSION file and release workflow ([d2f015d](https://github.com/CodySwannGT/lisa/commit/d2f015d108fa0baa602f2112dd7dbca8b080b152))


### Bug Fixes

* **rails:** improve CI template defaults from downstream learnings ([f71019b](https://github.com/CodySwannGT/lisa/commit/f71019b08cd23e09a0f50d31251f124c9aace127))
* **rails:** use deploy key and support staging in release workflow ([9d097a4](https://github.com/CodySwannGT/lisa/commit/9d097a4b5c783f475c7fafa8337e1c972404cf01))


### Documentation

* add agent team delegation rule to CLAUDE.md templates ([2f49ad2](https://github.com/CodySwannGT/lisa/commit/2f49ad260f957d5694e9b3408fb2642358b7ce0c))

## [1.37.0](https://github.com/CodySwannGT/lisa/compare/vv1.36.0...v1.37.0) (2026-02-12)


### Features

* **rails:** add complete rails/ governance pack ([4f32e7f](https://github.com/CodySwannGT/lisa/commit/4f32e7f1bf989dcef02f10b13e934454e4bbc975))
* **rails:** add mise and CI wrapper governance templates ([bb7d9ec](https://github.com/CodySwannGT/lisa/commit/bb7d9ecc028964354b5dad3ec547902c691c86d0))
* **rails:** add Rails project type and detector ([e742db6](https://github.com/CodySwannGT/lisa/commit/e742db61def786b9bfee2cf05b9ef106617a18ef))


### Documentation

* **rails:** add [@module](https://github.com/module) JSDoc preamble to Rails detector ([9efe3d8](https://github.com/CodySwannGT/lisa/commit/9efe3d8605f61c4670ec7492cef37be1592f4191))


### Code Refactoring

* **rails:** simplify templates and tests ([d26da6d](https://github.com/CodySwannGT/lisa/commit/d26da6d0a567f0391a51b72fc1e592bb63b318d4))

## [1.36.0](https://github.com/CodySwannGT/lisa/compare/vv1.35.0...v1.36.0) (2026-02-11)


### Features

* **all:** add setup-jira-cli SessionStart hook for env-based config ([aea5536](https://github.com/CodySwannGT/lisa/commit/aea5536d078fffb2122e5ec4a8692aafae6815a8))
* **typescript:** add jira-cli to remote environment install hook ([03b6ccc](https://github.com/CodySwannGT/lisa/commit/03b6cccb5056cc1775e0fc9c9053dbc2b9ba6778))


### Bug Fixes

* **typescript:** fix jira-cli tarball extraction in install-pkgs.sh ([12a4832](https://github.com/CodySwannGT/lisa/commit/12a4832ad8774bc55cbc5176aae98dde03b0919c))

## [1.35.0](https://github.com/CodySwannGT/lisa/compare/vv1.34.0...v1.35.0) (2026-02-11)


### Features

* **all:** add .coderabbit.yml as copy-overwrite template ([5b74e5e](https://github.com/CodySwannGT/lisa/commit/5b74e5e06bfdbf15dfc0004a739784cf549f8c09))

## [1.34.0](https://github.com/CodySwannGT/lisa/compare/vv1.33.1...v1.34.0) (2026-02-11)


### Features

* **expo:** exclude app routes and View files from test coverage ([64f9ba6](https://github.com/CodySwannGT/lisa/commit/64f9ba6f66c02a93b061d4a349733bad99dc0eb2))


### Code Refactoring

* improve test assertion diagnostics and add upstreaming rule ([c91223e](https://github.com/CodySwannGT/lisa/commit/c91223e29fbb232a4e247adda53ecd38edcadc7b))

### [1.33.1](https://github.com/CodySwannGT/lisa/compare/vv1.33.0...v1.33.1) (2026-02-10)


### Bug Fixes

* add team_name parameter to plan-create agent definitions ([47ddabe](https://github.com/CodySwannGT/lisa/commit/47ddabea5d9d4290cd18ed03e3291e309b7fe232))

## [1.33.0](https://github.com/CodySwannGT/lisa/compare/vv1.32.0...v1.33.0) (2026-02-10)


### Features

* rewrite fibonacci module with bigint generator ([e427fcb](https://github.com/CodySwannGT/lisa/commit/e427fcbe5b9ceb8353f1b1bf37cf8c627baa8614))


### Documentation

* add learnings from fibonacci rewrite to PROJECT_RULES.md ([10e48bf](https://github.com/CodySwannGT/lisa/commit/10e48bf63c71e938e3d89dea1fd75b3a736eea79))
* update PROJECT_RULES.md fibonacci examples to bigint ([2b2bdfb](https://github.com/CodySwannGT/lisa/commit/2b2bdfbe00212d814c6846717f8ee3aa6c9e8c8d))
* update test file preamble to reflect final state ([3a4ca0f](https://github.com/CodySwannGT/lisa/commit/3a4ca0f85ad285e2c1bad2be84f65229a0eda006))

## [1.32.0](https://github.com/CodySwannGT/lisa/compare/vv1.31.1...v1.32.0) (2026-02-10)


### Features

* replace Number-based fibonacci with BigInt generator ([46057df](https://github.com/CodySwannGT/lisa/commit/46057df02215c292e66e542994745fffb3d19c59))


### Code Refactoring

* apply review feedback and simplify fibonacci ([06a9bbb](https://github.com/CodySwannGT/lisa/commit/06a9bbbf8a287aefe08984e722b8b598abd772c3))

### [1.31.1](https://github.com/CodySwannGT/lisa/compare/vv1.31.0...v1.31.1) (2026-02-10)


### Bug Fixes

* add axios >=1.13.5 resolution to resolve GHSA-43fc-jf86-j433 ([36ec3a1](https://github.com/CodySwannGT/lisa/commit/36ec3a1bacefbfac365e7dbf0671b7ea7de358b7))
* add axios GHSA-43fc-jf86-j433 to pre-push audit ignore list ([361e0c7](https://github.com/CodySwannGT/lisa/commit/361e0c77a91495f73ab8ea06cfa2a926ea65c8ea))
* add axios to expo knip ignore and GHSA-43fc-jf86-j433 to audit ignores ([2be4d49](https://github.com/CodySwannGT/lisa/commit/2be4d49371779df2fe23ffbbb3028d4e15a40012))


### Documentation

* clarify that projects can add their own skills, commands, hooks, and agents ([7dfda50](https://github.com/CodySwannGT/lisa/commit/7dfda50c0af36abbf67796740fb27da8a306255a))
* restructure lisa.md to separate create-only files from override table ([ba05891](https://github.com/CodySwannGT/lisa/commit/ba05891be353b68ebd08529bc848288c1d70ad0e))

## [1.31.0](https://github.com/CodySwannGT/lisa/compare/vv1.30.0...v1.31.0) (2026-02-10)


### Features

* add domain planner agents and move review agents to template ([62a4995](https://github.com/CodySwannGT/lisa/commit/62a49958a93c48574ee644a7b33e42779a92d687))
* rewrite plan-create and plan-implement with phased workflows ([7bc3947](https://github.com/CodySwannGT/lisa/commit/7bc394762cb266995e578ab482da22b0ccd2c510))


### Bug Fixes

* use subagent types for coderabbit and code-simplifier in plan-implement ([02f1d93](https://github.com/CodySwannGT/lisa/commit/02f1d9352fc5d8f9e27b4e8c90926902cec264ef))


### Code Refactoring

* split plan.md into document format and governance rules ([36c9938](https://github.com/CodySwannGT/lisa/commit/36c9938aeb589e9a62d0cbe1bee7d50193cc6f82))

## [1.30.0](https://github.com/CodySwannGT/lisa/compare/vv1.29.1...v1.30.0) (2026-02-10)


### Features

* add fibonacci generator utility functions ([6150038](https://github.com/CodySwannGT/lisa/commit/61500387e85a7df11e92c257722ad0bb97f21779))


### Bug Fixes

* add GIT_SSH_COMMAND to git push and align archive instructions ([9ac076e](https://github.com/CodySwannGT/lisa/commit/9ac076ee89a5608cd29fcc26bdf0b5595ece10c8))
* resolve plan skill E2E test bugs ([73b687e](https://github.com/CodySwannGT/lisa/commit/73b687e5dfa9f061463bb268cf7854ff8256ca4d))


### Documentation

* add ESLint statement order and test isolation rules ([df44b8a](https://github.com/CodySwannGT/lisa/commit/df44b8a5131030b23d315d88bbd62ad575c328bd))
* add fibonacci generator implementation plan ([77c2c72](https://github.com/CodySwannGT/lisa/commit/77c2c727badd8800788a760299422e414c2869d6))


### Code Refactoring

* simplify plan skills and update E2E test docs ([82e5e20](https://github.com/CodySwannGT/lisa/commit/82e5e205096440337b2e0cc5be3486f66f700d0b))

### [1.29.1](https://github.com/CodySwannGT/lisa/compare/vv1.29.0...v1.29.1) (2026-02-09)

## [1.29.0](https://github.com/CodySwannGT/lisa/compare/vv1.28.0...v1.29.0) (2026-02-09)


### Features

* update plan-implement skill to accept arguments ([6e0002d](https://github.com/CodySwannGT/lisa/commit/6e0002d0fe8320dda15f70e0a29d82d8d20077f4))

## [1.28.0](https://github.com/CodySwannGT/lisa/compare/vv1.27.0...v1.28.0) (2026-02-09)


### Features

* consolidate commands into skills and rename to colon naming ([4e3fa4b](https://github.com/CodySwannGT/lisa/commit/4e3fa4bb7cf1b645883e51a4bd92d217761e0193))
* create command pass-throughs for all skills ([3b6c656](https://github.com/CodySwannGT/lisa/commit/3b6c656fe36312d01e94d0835c1f6c5d15413934))
* rewrite plan-create skill for Agent Teams with multi-phase research and review ([fc44757](https://github.com/CodySwannGT/lisa/commit/fc447579ed20ee472101cbb24af4fa67f21de5ba))


### Bug Fixes

* update deletions.json to restore commands and clean up colon-named skills ([a885816](https://github.com/CodySwannGT/lisa/commit/a885816645fe03cbcf4accce99244b9e72f49505))


### Code Refactoring

* address review findings and distribute jira:sync to downstream ([463a1fa](https://github.com/CodySwannGT/lisa/commit/463a1fae93f5a715c191ff04362e9cfa9a44ca99))
* rename skills from colon to hyphen naming and remove argument-hints ([d865b5e](https://github.com/CodySwannGT/lisa/commit/d865b5eb783a23b7da8b7ffd771269a986a8c41c))


### Documentation

* add skill architecture learnings to PROJECT_RULES.md ([91c3cd6](https://github.com/CodySwannGT/lisa/commit/91c3cd66492ece9f8963855b1fe690d2b2e563ae))
* update rules, agents, and docs for skills vs commands architecture ([cde8922](https://github.com/CodySwannGT/lisa/commit/cde89228ab1cbacdbde42f700bf4e91b092ecc5a))
* update verification docs to reference Playwright/Chrome Browser ([5253f1b](https://github.com/CodySwannGT/lisa/commit/5253f1bd1e150c0cd006db26ea9c574b2a28dd0e))
* update verification rules with CI/CD independence and Maestro support ([196a375](https://github.com/CodySwannGT/lisa/commit/196a37518062d1a2daa8d878e9e10720416b52fd))

## [1.27.0](https://github.com/CodySwannGT/lisa/compare/vv1.26.0...v1.27.0) (2026-02-09)


### Features

* add REFERENCE.0003.md with Agent Teams and updated reference ([51954bd](https://github.com/CodySwannGT/lisa/commit/51954bdb323187f8bb85c2bc676aa68672c4f535))
* add specialized agent team agents (implementer, tech-reviewer, product-reviewer, learner) ([25acace](https://github.com/CodySwannGT/lisa/commit/25acacedaaf50086405ebed27e831fbb1d495a7f))
* update agent prompt templates with specialized agents and new requirements ([e2e1ff1](https://github.com/CodySwannGT/lisa/commit/e2e1ff11e76cb0a596147df741b9d630e00abe0e))
* update plan rules with 6 workflow improvements ([0c02d09](https://github.com/CodySwannGT/lisa/commit/0c02d09488224a0a321f9e16fcc95ce421f14299))


### Documentation

* update REFERENCE.0003.md with Agent Teams documentation ([3958198](https://github.com/CodySwannGT/lisa/commit/3958198556b82cd10afbc1ac7cdd608036dfce6b))

## [1.26.0](https://github.com/CodySwannGT/lisa/compare/vv1.25.2...v1.26.0) (2026-02-08)


### Features

* add rule to enforce lockfile regeneration after dependency changes ([ff9d881](https://github.com/CodySwannGT/lisa/commit/ff9d88103045642525519a98369d7fbae4a4a62b))

### [1.25.2](https://github.com/CodySwannGT/lisa/compare/vv1.25.1...v1.25.2) (2026-02-08)


### Bug Fixes

* move graphql to defaults so projects can override version ([dfa65e8](https://github.com/CodySwannGT/lisa/commit/dfa65e8037ca8c7762c145b6af71d6065b228fcb))

### [1.25.1](https://github.com/CodySwannGT/lisa/compare/vv1.25.0...v1.25.1) (2026-02-08)


### Bug Fixes

* pin graphql to 15.10.1 for AppSync compatibility ([5750ff7](https://github.com/CodySwannGT/lisa/commit/5750ff73ff5af1a566f210a9cf7316b581a89c75))

## [1.25.0](https://github.com/CodySwannGT/lisa/compare/vv1.24.0...v1.25.0) (2026-02-08)


### Features

* add Jira create and verify commands and skills ([2d501fe](https://github.com/CodySwannGT/lisa/commit/2d501fe727798d9937e6117e55e8057b1802649d))
* add Lisa-managed files reference rule ([6abd811](https://github.com/CodySwannGT/lisa/commit/6abd81120dd8fc48628b3bb4f040e08b7e58d247))
* add OWASP ZAP baseline scanning to quality workflow ([018635d](https://github.com/CodySwannGT/lisa/commit/018635d7b0d0cf9c1ce56d1d62f66bcbcea32375))


### Bug Fixes

* add fast-xml-parser and gitleaks audit ignores to pre-push hook ([785665e](https://github.com/CodySwannGT/lisa/commit/785665e509977c089d3eef5ffc283d6cc1b846af))

## [1.24.0](https://github.com/CodySwannGT/lisa/compare/vv1.23.1...v1.24.0) (2026-02-08)


### Features

* add private flag to CDK package.lisa.json force section ([687fb13](https://github.com/CodySwannGT/lisa/commit/687fb139bb1e23a6b93b56130dd67d7c8822b5ad))


### Bug Fixes

* add gitleaks ignore for quality workflow curl auth variable ([a9634e1](https://github.com/CodySwannGT/lisa/commit/a9634e1c9efaccfc2713a3222a63d8f28bcabbcb))

### [1.23.1](https://github.com/CodySwannGT/lisa/compare/vv1.23.0...v1.23.1) (2026-02-08)


### Bug Fixes

* add fast-xml-parser audit ignore to quality.yml and pre-push ([c4d88cf](https://github.com/CodySwannGT/lisa/commit/c4d88cf005fde03a61c0cf2ca53bb6edd1394349))
* add GHSA-37qj-frw5-hhjh to CI audit ignore list ([b3b6bf1](https://github.com/CodySwannGT/lisa/commit/b3b6bf1c2d1863f88022a518969f65010e270c7e))

## [1.23.0](https://github.com/CodySwannGT/lisa/compare/vv1.22.0...v1.23.0) (2026-02-08)


### Features

* add CLAUDE.md rule to ignore knip configuration hints ([eff332c](https://github.com/CodySwannGT/lisa/commit/eff332ce71ee815fc8dba7f37bee103749b4f77f))
* move jest setup files from create-only to copy-overwrite ([5015e89](https://github.com/CodySwannGT/lisa/commit/5015e89d8579b70ccb325483f8287c945fd0fd7e))


### Documentation

* update jest.setup.ts references to jest.setup.local.ts ([44ad0bb](https://github.com/CodySwannGT/lisa/commit/44ad0bb113f4d6f04402c89da4bf666701d9eb79))


### Code Refactoring

* consolidate afterEach blocks and remove duplicate coverage exclusion ([a196e58](https://github.com/CodySwannGT/lisa/commit/a196e58ade796afabb826ab5012d747ef5e65136))

## [1.22.0](https://github.com/CodySwannGT/lisa/compare/vv1.21.7...v1.22.0) (2026-02-07)


### Features

* add /lisa:learn command for post-apply diff analysis ([a8aa568](https://github.com/CodySwannGT/lisa/commit/a8aa568bfb858e2f78d59528f29160409a160605))


### Bug Fixes

* add missing entries to OVERVIEW.md skills table and HUMAN.md call graph ([73b5a2c](https://github.com/CodySwannGT/lisa/commit/73b5a2cadd1161f133575e794c18d77f925c1d0b))

### [1.21.7](https://github.com/CodySwannGT/lisa/compare/vv1.21.6...v1.21.7) (2026-02-06)

### [1.21.6](https://github.com/CodySwannGT/lisa/compare/vv1.21.5...v1.21.6) (2026-02-05)


### Bug Fixes

* **cdk:** scope build to app directories and add prepare script ([c7f0de4](https://github.com/CodySwannGT/lisa/commit/c7f0de41e6ae86c2ff5709cc0d7e4e5ffbc03f1e))
* remove .ts extension from eslint.config.local import ([e92d3ab](https://github.com/CodySwannGT/lisa/commit/e92d3ab46963d18afd3852993f7aff893a8f3cb4))
* use module preserve and bundler resolution in tsconfig.eslint.json ([76e482f](https://github.com/CodySwannGT/lisa/commit/76e482f56ee69c6a569aa0f41ac6c3d82c96193b))

### [1.21.5](https://github.com/CodySwannGT/lisa/compare/vv1.21.4...v1.21.5) (2026-02-05)


### Bug Fixes

* **cdk:** disable sourceMap in tsconfig.cdk.json to prevent TS5053 conflict ([099820a](https://github.com/CodySwannGT/lisa/commit/099820a8dd906083d183f105dab749a2b00f121c))

### [1.21.4](https://github.com/CodySwannGT/lisa/compare/vv1.21.3...v1.21.4) (2026-02-05)


### Bug Fixes

* broaden integration test file pattern matching ([e0224bd](https://github.com/CodySwannGT/lisa/commit/e0224bd6e128cb066757831fd7be382734521a42))
* correct warmup directory ignore pattern from _warmup to .warmup ([44fb81a](https://github.com/CodySwannGT/lisa/commit/44fb81a13fef88e8db8e7598d0b20bf093df23eb))

### [1.21.3](https://github.com/CodySwannGT/lisa/compare/vv1.21.2...v1.21.3) (2026-02-05)


### Bug Fixes

* broaden integration test file pattern matching ([#149](https://github.com/CodySwannGT/lisa/issues/149)) ([0de108e](https://github.com/CodySwannGT/lisa/commit/0de108e3df94aa51a089df94eb471f3a314e35d9))

### [1.21.2](https://github.com/CodySwannGT/lisa/compare/vv1.21.1...v1.21.2) (2026-02-05)


### Bug Fixes

* add brace-expansion resolution and expo-modules-core to knip ignores ([5d1657e](https://github.com/CodySwannGT/lisa/commit/5d1657e86c5d65b7be5bb670c33010a64ba2a9dd))
* add brace-expansion resolution to typescript package.lisa.json ([b75fb51](https://github.com/CodySwannGT/lisa/commit/b75fb51c4fef1084a4c5d2f54c6870d1dd215969))
* add jest.config.js to typescript deletions ([6659af4](https://github.com/CodySwannGT/lisa/commit/6659af4d769bf83377a5360883373b5b41120f3e))
* add NestJS-specific knip.json with runtime dependency ignores ([72f4253](https://github.com/CodySwannGT/lisa/commit/72f42531eb762d9bd350e0d229f9014203ab4dba))
* replace ts-node with tsx in NestJS migration templates ([d210afb](https://github.com/CodySwannGT/lisa/commit/d210afbea8e2106dccf886814d2dc4980e51f741))

### [1.21.1](https://github.com/CodySwannGT/lisa/compare/vv1.21.0...v1.21.1) (2026-02-04)


### Bug Fixes

* add trailing newline to .gitignore ([19d3dea](https://github.com/CodySwannGT/lisa/commit/19d3dea3a99efb009cd1db87c1beca69bbff81a4))
* remove ts-node from forced dependencies, keep for NestJS only ([c24571c](https://github.com/CodySwannGT/lisa/commit/c24571c742901c17f83324f065ac43061bd678c2))

## [1.21.0](https://github.com/CodySwannGT/lisa/compare/vv1.20.1...v1.21.0) (2026-02-04)


### Features

* add /lisa:integration-test slash command ([ee5a689](https://github.com/CodySwannGT/lisa/commit/ee5a689708d7c507179469f5d70e078679b42b46))


### Bug Fixes

* move include/exclude from tsconfig.json to stack-specific configs ([126bd0e](https://github.com/CodySwannGT/lisa/commit/126bd0e83b8a6e5f39661c918895c42746bf26a1))

### [1.20.1](https://github.com/CodySwannGT/lisa/compare/vv1.20.0...v1.20.1) (2026-02-04)


### Bug Fixes

* add .claude-active-plan/** to eslint defaultIgnores ([43d841b](https://github.com/CodySwannGT/lisa/commit/43d841b134aac860f89a483d5b7acaa9a631b009))

## [1.20.0](https://github.com/CodySwannGT/lisa/compare/vv1.19.2...v1.20.0) (2026-02-03)


### Features

* add batch update and commit-and-pr scripts for local Lisa projects ([e6e99ba](https://github.com/CodySwannGT/lisa/commit/e6e99bace042efc0dced8954e123f67e43cc2b1a))


### Bug Fixes

* address code review findings in batch scripts ([1a60956](https://github.com/CodySwannGT/lisa/commit/1a6095607f600acfccde87cf8b5f2784240831cd))


### Code Refactoring

* simplify batch scripts ([e98d9d0](https://github.com/CodySwannGT/lisa/commit/e98d9d02ec6b926cee86b716209a14d750feeddf))

### [1.19.2](https://github.com/CodySwannGT/lisa/compare/vv1.19.1...v1.19.2) (2026-02-03)


### Bug Fixes

* resolve @isaacs/brace-expansion vulnerability via resolutions ([36c1f8a](https://github.com/CodySwannGT/lisa/commit/36c1f8af696185954233cbe5bd6fc5bfc73f3e3f))
* update @isaacs/brace-expansion to resolve critical vulnerability ([122a983](https://github.com/CodySwannGT/lisa/commit/122a98389af41a0e7ba7bbc2f944b95bf489a977))


### Documentation

* add Lisa Commands section to all README templates ([4c5007b](https://github.com/CodySwannGT/lisa/commit/4c5007bc13fb2595e9f0de1bd744784fbad15c61))

### [1.19.1](https://github.com/CodySwannGT/lisa/compare/vv1.19.0...v1.19.1) (2026-02-03)


### Bug Fixes

* address code review findings for project workflow removal ([367980c](https://github.com/CodySwannGT/lisa/commit/367980c0fdb99e4d3e3dfd60ba85e0b05c418fb8))


### Documentation

* add plan commands and rewrite HUMAN.md for plan workflow ([471455c](https://github.com/CodySwannGT/lisa/commit/471455c3aef041ab7320d8f033e69bed366e110c))

## [1.19.0](https://github.com/CodySwannGT/lisa/compare/vv1.18.1...v1.19.0) (2026-02-03)


### Features

* deprecate project workflow, add plan-* skills and commands ([b42327f](https://github.com/CodySwannGT/lisa/commit/b42327f15f9547bc59673f1084a0dff8c16d5abf))


### Bug Fixes

* add language specifiers to fenced code blocks in plan-* skills ([f97f31e](https://github.com/CodySwannGT/lisa/commit/f97f31ef8d6bede6a3524c41287260371c6343c7))


### Code Refactoring

* simplify skill workflows by merging plan creation into step 2 ([c21ab8c](https://github.com/CodySwannGT/lisa/commit/c21ab8caf1d08df4c16aab27e209d3af749fc4a6))

### [1.18.1](https://github.com/CodySwannGT/lisa/compare/vv1.18.0...v1.18.1) (2026-02-03)


### Documentation

* address review feedback on Claude-driven READMEs ([6409bc0](https://github.com/CodySwannGT/lisa/commit/6409bc0ca5fa03ba4cd891abb30d6121b42c5955))
* replace READMEs with Claude-driven format ([9676640](https://github.com/CodySwannGT/lisa/commit/967664067c63cca78e2c21327ca80ca86ad3fd00))
* simplify and align README templates ([c79a1c5](https://github.com/CodySwannGT/lisa/commit/c79a1c5c812701688e25e855887302ca2195072c))

## [1.18.0](https://github.com/CodySwannGT/lisa/compare/vv1.17.0...v1.18.0) (2026-02-03)


### Features

* **rules:** add Task Creation Specification to plan mode rules ([e88af2e](https://github.com/CodySwannGT/lisa/commit/e88af2e6f9650d182063e0e64ec0b95c031afa77))


### Bug Fixes

* **hooks:** scope dedup grep to Sessions section in track-plan-sessions.sh ([c1722be](https://github.com/CodySwannGT/lisa/commit/c1722be1d59e98a047718a2df07577d9b3ecea5b))
* **skills:** remove argument-hint from project-local-code-review skill ([5223ed5](https://github.com/CodySwannGT/lisa/commit/5223ed5450c4eb0c80b935576d243e53467574b0))


### Documentation

* add plan for task creation specification in plan rules ([8b87362](https://github.com/CodySwannGT/lisa/commit/8b8736286d57d74c12dd4c95a1f686d08aff3422))
* **plan:** expand plan mode rules with review tasks, archive steps, and draft PR requirement ([b57040f](https://github.com/CodySwannGT/lisa/commit/b57040f0397e2bfd7bbf71c157cc1871833849aa))

## [1.17.0](https://github.com/CodySwannGT/lisa/compare/vv1.16.0...v1.17.0) (2026-02-03)


### Features

* **all:** add Lisa-managed files list to CLAUDE.md template ([e905322](https://github.com/CodySwannGT/lisa/commit/e9053226c04bfd4ae554f7c1b0d536a98156b9fb))
* **nestjs:** add NestJS-specific slow lint config ([89f4d19](https://github.com/CodySwannGT/lisa/commit/89f4d1925760fd8df2e5822bcdfb42ebcd62a165))
* **nestjs:** exclude test files from tsconfig compilation ([12e9ce8](https://github.com/CodySwannGT/lisa/commit/12e9ce8b85956cfd2abcd33756a0ba2b874a5f62))


### Code Refactoring

* **all:** move managed files list from CLAUDE.md to .claude/rules/lisa.md ([04841b3](https://github.com/CodySwannGT/lisa/commit/04841b30a2e50fdf59122e4bcce3e0ef046cf590))

## [1.16.0](https://github.com/CodySwannGT/lisa/compare/vv1.15.0...v1.16.0) (2026-02-03)


### Features

* add plan mode enforcement hook and rules ([794dfd9](https://github.com/CodySwannGT/lisa/commit/794dfd93eeca76894a020cf114259de6fc77161d))
* **expo:** add create-only jest and babel template files ([8e09fc3](https://github.com/CodySwannGT/lisa/commit/8e09fc3c20a2bf7bf3a6a42e239144931b9e012f))
* **expo:** add nativewind-env.d.ts to tsconfig include array ([f9955cd](https://github.com/CodySwannGT/lisa/commit/f9955cd8792a9f38546583799eecb3bdb71b6ca9))


### Bug Fixes

* add serve to expo knip ignoreBinaries and fix expo tsconfig for .ts imports ([97a57a7](https://github.com/CodySwannGT/lisa/commit/97a57a7d3eb9ec884449b38acc5ee4d6729a096c))
* exclude components/ui from default coverage exclusions ([7b32b3a](https://github.com/CodySwannGT/lisa/commit/7b32b3a61d6b1cf75ae637bfb060925a30976243))
* guard sonarjs.configs access in eslint.base.ts template ([c51b51b](https://github.com/CodySwannGT/lisa/commit/c51b51bcc8b17853eaf2818c90b66544d388414d))
* ignore fast-xml-parser GHSA-37qj-frw5-hhjh in pre-push audit template ([37ff900](https://github.com/CodySwannGT/lisa/commit/37ff90070ebe000c21d1490b12373f5ddda362d7))
* remove jest-expo setup from expo setupFiles to prevent __DEV__ ordering issue ([80c986d](https://github.com/CodySwannGT/lisa/commit/80c986d84f2b7ede36bda1dcc58c3d381fb7f041))
* replace marker file with most-recent-file detection in track-plan-sessions hook ([106acd1](https://github.com/CodySwannGT/lisa/commit/106acd116312581aec1f3a153d58574e8c0181fe))
* update expo jest.expo.ts transformIgnorePatterns and testMatch ([39cc166](https://github.com/CodySwannGT/lisa/commit/39cc166929fc482e512c9215b8501bcbde9e2f42))
* use session-specific marker files for reliable active-plan detection ([b4bde86](https://github.com/CodySwannGT/lisa/commit/b4bde86edeedb778c9cf3d3814df787d8f915ec2))


### Documentation

* move plan rules from CLAUDE.md to dedicated rules file ([bdabfbe](https://github.com/CodySwannGT/lisa/commit/bdabfbe45fffcf30c16af6454d2c250233e248bf))

## [1.15.0](https://github.com/CodySwannGT/lisa/compare/vv1.14.0...v1.15.0) (2026-02-02)


### Features

* add OWASP ZAP baseline scanning for expo and nestjs stacks ([bfa3323](https://github.com/CodySwannGT/lisa/commit/bfa33233ca9d6e91616e53d8a0aa2f25556d8510))


### Bug Fixes

* add allowImportingTsExtensions to tsconfig.eslint.json files ([2febdaa](https://github.com/CodySwannGT/lisa/commit/2febdaa758e177d4a62a7c2c36b2a61c34425588))
* add jest.*.ts to tsconfig.eslint.json include patterns ([7fd8f34](https://github.com/CodySwannGT/lisa/commit/7fd8f34ffe283fe1f04c5d9c615aa456568aab90))
* add moduleNameMapper and transform for stack template test imports ([4518c7b](https://github.com/CodySwannGT/lisa/commit/4518c7be9b43b2fed608cdc32266776d0c7a0a64))
* move paths and include/exclude to copy-overwrite stack tsconfigs ([a7395f9](https://github.com/CodySwannGT/lisa/commit/a7395f95222754efae6189e9a11497ab01245301))
* replace jest-expo preset with manual RN resolution for jsdom compatibility ([be37371](https://github.com/CodySwannGT/lisa/commit/be373715f56c157c205206d7a0ecfab9aba7dbbe))
* use tsx instead of ts-node in CDK template to support array extends ([5e177f9](https://github.com/CodySwannGT/lisa/commit/5e177f98961278fd43d719783fdd594eceb96060))


### Documentation

* add project plan files ([bd613f9](https://github.com/CodySwannGT/lisa/commit/bd613f981552d467e958a14cc090a1966cd40ba5))
* update expo jest description and mark ZAP scanning complete ([76f2e35](https://github.com/CodySwannGT/lisa/commit/76f2e35c9c14307701ab9ae1cd764cfb0b977079))

## [1.14.0](https://github.com/CodySwannGT/lisa/compare/vv1.13.0...v1.14.0) (2026-02-02)


### Features

* add tsconfig and jest governance for expo, nestjs, and cdk stacks ([e63e95c](https://github.com/CodySwannGT/lisa/commit/e63e95ce3af50e0a39dabab9f321e1040047827a))
* add tsconfig and jest governance templates for typescript stack ([016fa85](https://github.com/CodySwannGT/lisa/commit/016fa85f0e9843c3898c1b1ad5c5151ae3ba24e8))


### Bug Fixes

* preserve per-path threshold keys in mergeThresholds ([f7a3b28](https://github.com/CodySwannGT/lisa/commit/f7a3b28bee9e222c0d7ff9b196bb021b780250df))
* resolve strict type errors in jest-base tests ([8d0bdb6](https://github.com/CodySwannGT/lisa/commit/8d0bdb6d24c32e97bcf86949ad422361ceaefd3d))


### Code Refactoring

* migrate Lisa's own tsconfig and jest to governed pattern ([b918faa](https://github.com/CodySwannGT/lisa/commit/b918faad6460f40b52e46592f460ff245ec7916d))


### Documentation

* add and update project plan files ([4c4a10d](https://github.com/CodySwannGT/lisa/commit/4c4a10d95b4e02ade67426b8e52fbc37c7df91bd))
* add tsconfig and jest governance documentation to OVERVIEW.md ([0893f0e](https://github.com/CodySwannGT/lisa/commit/0893f0e4239956fec761cdd5d289ed644476db45))

## [1.13.0](https://github.com/CodySwannGT/lisa/compare/vv1.12.9...v1.13.0) (2026-02-01)


### Features

* add skill definitions for all commands ([af50022](https://github.com/CodySwannGT/lisa/commit/af5002212f8f8217cd6ef78fa461b9f810eea378))
* add skill templates for copy-overwrite distribution ([dcfd6aa](https://github.com/CodySwannGT/lisa/commit/dcfd6aafe4fc9b13f77ec6f71d55e7bf6fa5bfe0))


### Code Refactoring

* convert commands to thin skill delegators ([284a16e](https://github.com/CodySwannGT/lisa/commit/284a16e6e931e72749d3e50efc5dd31feaeb8d5c))
* convert template commands to thin skill delegators ([21aac9b](https://github.com/CodySwannGT/lisa/commit/21aac9b1588151f39f5f5e4b8a38cc5fffed533c))


### Documentation

* add command-to-skill conversion plan ([a17ec98](https://github.com/CodySwannGT/lisa/commit/a17ec98c52033c3cd5f0c699b09ba3d8492c7978))

### [1.12.9](https://github.com/CodySwannGT/lisa/compare/vv1.12.8...v1.12.9) (2026-02-01)


### Documentation

* add whitepaper, TODO, and black-box development documentation ([223454b](https://github.com/CodySwannGT/lisa/commit/223454bc11420e026d5a602a2fd192f2ad02131c))
* expand and restructure OVERVIEW.md with detailed building blocks ([fc07988](https://github.com/CodySwannGT/lisa/commit/fc07988699eccebbee4557d71cdc6c709436a687))

### [1.12.8](https://github.com/CodySwannGT/lisa/compare/vv1.12.7...v1.12.8) (2026-01-30)

### [1.12.7](https://github.com/CodySwannGT/lisa/compare/vv1.12.6...v1.12.7) (2026-01-30)

### [1.12.6](https://github.com/CodySwannGT/lisa/compare/vv1.12.5...v1.12.6) (2026-01-30)


### Bug Fixes

* remove check-tired-boss hook from settings templates ([4723829](https://github.com/CodySwannGT/lisa/commit/47238299ca913b790734e2a5113172a9b06fc517))

### [1.12.5](https://github.com/CodySwannGT/lisa/compare/vv1.12.4...v1.12.5) (2026-01-30)


### Bug Fixes

* consolidate TypeScript settings.json to prevent hooks from being overwritten ([f8e65ae](https://github.com/CodySwannGT/lisa/commit/f8e65aefb4e96bb9b80443e115d0325384e96840))

### [1.12.4](https://github.com/CodySwannGT/lisa/compare/vv1.12.3...v1.12.4) (2026-01-29)

### [1.12.3](https://github.com/CodySwannGT/lisa/compare/vv1.12.2...v1.12.3) (2026-01-29)


### Bug Fixes

* **ci:** pin bun version to 1.3.8 in CI workflows ([cea84b3](https://github.com/CodySwannGT/lisa/commit/cea84b31c6907c85fa65f387c4812361923bf10e))
* **eslint:** guard sonarjs recommended config access ([dced480](https://github.com/CodySwannGT/lisa/commit/dced480275f466d5e00404ff121e9befe6fa72c0))
* **nestjs:** simplify deploy workflow and add AWS credential verification ([6e4cfda](https://github.com/CodySwannGT/lisa/commit/6e4cfda8ca389e823dab3278f04302c1450be836))
* **package-lisa:** detect project types from dependencies instead of top-level keys ([a654cf7](https://github.com/CodySwannGT/lisa/commit/a654cf73b14342a3aa9657c62feab7561b0047c4))


### Documentation

* update bun version references to 1.3.8 ([20fcc87](https://github.com/CodySwannGT/lisa/commit/20fcc87bfb56de75b46000450a57e7800a382937))

### [1.12.2](https://github.com/CodySwannGT/lisa/compare/vv1.12.1...v1.12.2) (2026-01-29)


### Bug Fixes

* **package-lisa:** sort expanded types so parents process before children ([e3e118b](https://github.com/CodySwannGT/lisa/commit/e3e118bafd9545ec303ef2db8194512687be7ed3))


### Documentation

* **commit:** clarify that all files must be committed regardless of relevance ([fab1d69](https://github.com/CodySwannGT/lisa/commit/fab1d69b0abca538db218afe0ab0a14fcdf14901))

### [1.12.1](https://github.com/CodySwannGT/lisa/compare/vv1.12.0...v1.12.1) (2026-01-29)


### Bug Fixes

* use npm_execpath for package manager agnostic prepare script ([bcae72f](https://github.com/CodySwannGT/lisa/commit/bcae72f29f5c1f4b5158bc70b4e0b9ca1feeaf97))


### Documentation

* rename GitHub README.md to GITHUB_ACTIONS.md ([e819cfe](https://github.com/CodySwannGT/lisa/commit/e819cfe5d0a7b421e9c8f8b6284696a65456bb0b))

## [1.12.0](https://github.com/CodySwannGT/lisa/compare/vv1.11.11...v1.12.0) (2026-01-29)


### Features

* **deps:** add @jest/globals to TypeScript template devDependencies ([cb5dc50](https://github.com/CodySwannGT/lisa/commit/cb5dc50c76cb2217502030872ce2d685e905bd20))
* **skills:** remove prompt-complexity-scorer skill ([5cbc3cf](https://github.com/CodySwannGT/lisa/commit/5cbc3cf78d0d46b3c231764155173f588b97ec7a))


### Documentation

* add updated Claude Code settings and hooks reference ([1d7b8e0](https://github.com/CodySwannGT/lisa/commit/1d7b8e0aaeead04aa640683d76c325056e41a60c))
* update documentation after prompt-complexity-scorer removal ([1220e73](https://github.com/CodySwannGT/lisa/commit/1220e73eb31ee7bdb106165cd91b78227ce48d96))

### [1.11.11](https://github.com/CodySwannGT/lisa/compare/vv1.11.10...v1.11.11) (2026-01-29)


### Bug Fixes

* **package-lisa:** translate package.lisa.json destPath to package.json ([fa551ea](https://github.com/CodySwannGT/lisa/commit/fa551eace19621a8f1993c7ee80fca2678b9dacd))


### Documentation

* **readme:** fix remaining tagged-merge reference in How It Works section ([20979e4](https://github.com/CodySwannGT/lisa/commit/20979e4fe3c14c99571bf43ab3718d726c0a6702))

### [1.11.10](https://github.com/CodySwannGT/lisa/compare/vv1.11.9...v1.11.10) (2026-01-29)


### Bug Fixes

* **package-lisa:** move templates to package-lisa directory ([cd5ef88](https://github.com/CodySwannGT/lisa/commit/cd5ef88da9c78bf888c21d1b8c61b523548b2ebd))


### Documentation

* update references to new package-lisa directory structure ([fd2c278](https://github.com/CodySwannGT/lisa/commit/fd2c278fe66b426010fa5eb8e95c35f7a23b8a78))

### [1.11.9](https://github.com/CodySwannGT/lisa/compare/vv1.11.8...v1.11.9) (2026-01-29)


### Bug Fixes

* **scripts:** add production branches to protected list ([bd72930](https://github.com/CodySwannGT/lisa/commit/bd7293048d218d4fbb4658a764b8b1026f209d86))

### [1.11.8](https://github.com/CodySwannGT/lisa/compare/vv1.11.7...v1.11.8) (2026-01-29)

### [1.11.7](https://github.com/CodySwannGT/lisa/compare/vv1.11.6...v1.11.7) (2026-01-29)

### [1.11.6](https://github.com/CodySwannGT/lisa/compare/vv1.11.5...v1.11.6) (2026-01-29)

### [1.11.5](https://github.com/CodySwannGT/lisa/compare/vv1.11.4...v1.11.5) (2026-01-29)

### [1.11.4](https://github.com/CodySwannGT/lisa/compare/vv1.11.3...v1.11.4) (2026-01-28)

### [1.11.3](https://github.com/CodySwannGT/lisa/compare/vv1.11.2...v1.11.3) (2026-01-28)

### [1.11.2](https://github.com/CodySwannGT/lisa/compare/vv1.11.1...v1.11.2) (2026-01-28)

### [1.11.1](https://github.com/CodySwannGT/lisa/compare/vv1.11.0...v1.11.1) (2026-01-28)

## [1.11.0](https://github.com/CodySwannGT/lisa/compare/vv1.10.0...v1.11.0) (2026-01-28)


### Features

* implement package-lisa strategy for governance-driven package.json ([92651b2](https://github.com/CodySwannGT/lisa/commit/92651b2297d7a6a4cfee5f16599d747e1ba79b9a))


### Documentation

* research complete for package.lisa.json implementation ([179ed72](https://github.com/CodySwannGT/lisa/commit/179ed724bd95133b4992962973cb8ba6cec6bc63))
* update commonalities documentation ([a09b21c](https://github.com/CodySwannGT/lisa/commit/a09b21c8c34210922216731de67e28957964b5be))

## [1.10.0](https://github.com/CodySwannGT/lisa/compare/vv1.9.5...v1.10.0) (2026-01-28)


### Features

* migrate from vitest to jest ([715b0fc](https://github.com/CodySwannGT/lisa/commit/715b0fc2f292e19e7986382a30e3b476de87a6f3))


### Bug Fixes

* **knip:** remove tagged-merge comments from source repo devDependencies ([f7295d3](https://github.com/CodySwannGT/lisa/commit/f7295d3537a99599a57cb86d4cb04de7ab8bb77e))
* **tagged-merge:** support nested tags in objects ([9a438d4](https://github.com/CodySwannGT/lisa/commit/9a438d4a9f48300da8eae37eb7738fe1c7d14f6a))

### [1.9.5](https://github.com/CodySwannGT/lisa/compare/vv1.9.4...v1.9.5) (2026-01-28)


### Bug Fixes

* **scripts:** use contains() for slow lint rules filter ([ffa0275](https://github.com/CodySwannGT/lisa/commit/ffa027593cc239e7fe9401606b78379a612fd93e))

### [1.9.4](https://github.com/CodySwannGT/lisa/compare/vv1.9.3...v1.9.4) (2026-01-28)


### Bug Fixes

* address PR [#105](https://github.com/CodySwannGT/lisa/issues/105) review comments from CodeRabbit ([7ce9566](https://github.com/CodySwannGT/lisa/commit/7ce95661ec4a77882d386c3514e4b307b0eb59d1))


### Documentation

* **project:** comprehensive debrief of tagged-merge implementation ([6f61ccc](https://github.com/CodySwannGT/lisa/commit/6f61cccef9da38563767b5c78cb1cb47ed9161d8))
* **research:** comprehensive analysis of tagged-merge implementation path ([6183a16](https://github.com/CodySwannGT/lisa/commit/6183a1687555350b5215811deb4b045f45ed54e8))

### [1.9.3](https://github.com/CodySwannGT/lisa/compare/vv1.9.2...v1.9.3) (2026-01-28)


### Code Refactoring

* **workflows:** consolidate lint-slow into quality.yml and add pre-push hook ([65a7763](https://github.com/CodySwannGT/lisa/commit/65a77639420b1b97af660f09f2e5d946ff8b16cc))

### [1.9.2](https://github.com/CodySwannGT/lisa/compare/vv1.9.1...v1.9.2) (2026-01-28)


### Documentation

* **setup-command:** clarify brief.md file handling instructions ([0e02184](https://github.com/CodySwannGT/lisa/commit/0e0218487283d7e97c5fe21fb44afd55b1660dfc))

### [1.9.1](https://github.com/CodySwannGT/lisa/compare/vv1.9.0...v1.9.1) (2026-01-28)


### Documentation

* add empirical verification rule ([03f7c76](https://github.com/CodySwannGT/lisa/commit/03f7c762d1e6703d886f5068f909b03cfb9415bb))
* improve verification section in plan template ([7fbcf12](https://github.com/CodySwannGT/lisa/commit/7fbcf12d032b5add2a1cbf50974eda687fb3ccd4))

## [1.9.0](https://github.com/CodySwannGT/lisa/compare/vv1.8.0...v1.9.0) (2026-01-27)


### Features

* **github-status-check:** add Lisa version checking ([ed954b6](https://github.com/CodySwannGT/lisa/commit/ed954b60657e7affb198bb57ca64e8aa031eaa05))

## [1.8.0](https://github.com/CodySwannGT/lisa/compare/vv1.7.1...v1.8.0) (2026-01-27)


### Features

* add version check when lisa runs on latest version ([a745069](https://github.com/CodySwannGT/lisa/commit/a7450693d12da44ba58c8a2b7eb71cd03efb3fd3))


### Bug Fixes

* **hooks:** correct JSON path for TaskCreate task ID extraction ([a7f1599](https://github.com/CodySwannGT/lisa/commit/a7f159938d86e75fc4121bbb1c93a283a68a5e45))

### [1.7.1](https://github.com/CodySwannGT/lisa/compare/vv1.7.0...v1.7.1) (2026-01-27)


### Code Refactoring

* simplify project slash commands by removing redundant sections ([de6cc52](https://github.com/CodySwannGT/lisa/commit/de6cc5207bcadba2311eab5506c99eedee313480))

## [1.7.0](https://github.com/CodySwannGT/lisa/compare/vv1.6.0...v1.7.0) (2026-01-27)


### Features

* add /project:document command to update docs after implementation ([ce666ad](https://github.com/CodySwannGT/lisa/commit/ce666adffe5d38e24fed86640904333dcd714615))

## [1.6.0](https://github.com/CodySwannGT/lisa/compare/vv1.5.1...v1.6.0) (2026-01-27)


### Features

* filter out failed actions older than a week in github status check ([e752496](https://github.com/CodySwannGT/lisa/commit/e7524960a4b3b908a078d33242ee7cf0491bc93f))

### [1.5.1](https://github.com/CodySwannGT/lisa/compare/vv1.5.0...v1.5.1) (2026-01-27)


### Bug Fixes

* exclude type-specific template directories from eslint slow config type checking ([0acdb88](https://github.com/CodySwannGT/lisa/commit/0acdb88e5806e748694ffb10230977e30fd58eeb))

## [1.5.0](https://github.com/CodySwannGT/lisa/compare/vv1.4.0...v1.5.0) (2026-01-27)


### Features

* add github-status-check script for PR and Actions monitoring ([cf4ab74](https://github.com/CodySwannGT/lisa/commit/cf4ab74cc8d46eee6228f15eb51480e4425d7a60))
* auto-load .env.local in github-status-check script ([6f819a4](https://github.com/CodySwannGT/lisa/commit/6f819a48e5833b417b2185ac9331d55853d4ad3c))
* filter dependabot PRs and add time ago display ([919fd4d](https://github.com/CodySwannGT/lisa/commit/919fd4dc65e14b006735fe68327b2e0c307fb46b))


### Bug Fixes

* filter out dependabot branches from failed actions ([adff697](https://github.com/CodySwannGT/lisa/commit/adff697f2b909d38017e93dd68011cd9a7d300db))
* show only PRs created by current user in open PRs section ([cc86cd0](https://github.com/CodySwannGT/lisa/commit/cc86cd06a241a9b4619a5c572fe05b13d850b214))

## [1.4.0](https://github.com/CodySwannGT/lisa/compare/vv1.3.0...v1.4.0) (2026-01-27)


### Features

* include Lisa version in generated manifest ([71fd867](https://github.com/CodySwannGT/lisa/commit/71fd8672b320b4fa81c9d135b6a19b3b37c28d78))

## [1.3.0](https://github.com/CodySwannGT/lisa/compare/vv1.2.0...v1.3.0) (2026-01-27)


### Features

* make Lisa values take precedence in merge strategy ([5377ec4](https://github.com/CodySwannGT/lisa/commit/5377ec4ed92618b4e097d6d7174527fa4c3d2b65))


### Bug Fixes

* remove duplicate .gitignore content after guardrails marker ([d4adeb9](https://github.com/CodySwannGT/lisa/commit/d4adeb9e526cf9a80f1f1c415ae3a8e35484a6df))

## [1.2.0](https://github.com/CodySwannGT/lisa/compare/vv1.1.0...v1.2.0) (2026-01-26)


### Features

* **tasks:** preserve task history across /clear with session-based storage ([7297b6a](https://github.com/CodySwannGT/lisa/commit/7297b6aebced9683c21b786e4a25654e98828f8f))

## [1.1.0](https://github.com/CodySwannGT/lisa/compare/v0.1.0...v1.1.0) (2026-01-26)


### Features

* add ast-grep integration for pattern-based linting ([e5ba9f7](https://github.com/CodySwannGT/lisa/commit/e5ba9f7cd51cbdedb6793c168b77b9bbe5518e64))
* add max-lines-per-function eslint rule ([d31a8d3](https://github.com/CodySwannGT/lisa/commit/d31a8d37c4d6ce0270960ad5677204e4fd0ba1f0))
* add outputs to deploy job for downstream jobs ([65a11ca](https://github.com/CodySwannGT/lisa/commit/65a11cabe7188e1badf274b0274b5839612cb3af))
* add Safety Net configuration to block --no-verify flags ([3ae4985](https://github.com/CodySwannGT/lisa/commit/3ae4985cf68153cef19f0f84f6ffb2cfde21b5b3))
* add slow lint rules with nightly workflow ([42d0dd0](https://github.com/CodySwannGT/lisa/commit/42d0dd0957a54fd79dff7bf4e38da3720e3704c5))
* add sonarjs/deprecation rule to slow ESLint configs ([e3791f6](https://github.com/CodySwannGT/lisa/commit/e3791f693528a296c01fabe9032730ed4eb3116f))
* add sonarjs/no-nested-functions and deprecation rules ([174e3ac](https://github.com/CodySwannGT/lisa/commit/174e3ac08b5bddc84bdcb6bcb5c431a0c2e214d9))
* add test coverage agent and slash command ([1d47648](https://github.com/CodySwannGT/lisa/commit/1d476482cd707dab162392fdc67170d036c6f694))
* **ast-grep:** add no-inline-component rules for Container/View pattern ([f204575](https://github.com/CodySwannGT/lisa/commit/f2045750d358db3cbf11a70e264109088d08ca99))
* change backup directory structure to use timestamp subdirectory ([35b2937](https://github.com/CodySwannGT/lisa/commit/35b2937278237932b073548d08bae2d6fac62d10))
* **ci:** add dead code detection job to Lisa's quality workflow ([0d60fcb](https://github.com/CodySwannGT/lisa/commit/0d60fcb23c7e60ba1e9897260cbc0635f777c862))
* **ci:** add dead code detection job to quality workflow ([b0c6152](https://github.com/CodySwannGT/lisa/commit/b0c6152a77de19a7477a575e8304fd3e0e74b58f))
* **ci:** add nightly workflow for slow ESLint rules ([a89bfed](https://github.com/CodySwannGT/lisa/commit/a89bfed11dd264ee5dcbd389b78bfe9c100e2ecc))
* **commands:** add /lisa:review-project slash command ([f25145c](https://github.com/CodySwannGT/lisa/commit/f25145c96076264d704ea6416faa1a44cc1b90a7))
* **commands:** add reduce-max-lines and reduce-max-lines-per-function commands ([ff4f29c](https://github.com/CodySwannGT/lisa/commit/ff4f29c6f21014baa3740a7f9dd98f21c4ce9a9b))
* **commands:** add reduce-max-lines and reduce-max-lines-per-function commands ([#78](https://github.com/CodySwannGT/lisa/issues/78)) ([9b77b4b](https://github.com/CodySwannGT/lisa/commit/9b77b4b494249ee3a7ac6d01b616877631c9e38f))
* **commands:** use subagents for task execution with parallel support ([cc546d9](https://github.com/CodySwannGT/lisa/commit/cc546d9569f53b66279038412aa3a96177532a5a))
* **core:** add .lisaignore support for skipping files during apply ([3b298f2](https://github.com/CodySwannGT/lisa/commit/3b298f2da57f291b1efee801cfaa07b1e0ce8069))
* **core:** add deletions.json support for managed file removal ([6552efd](https://github.com/CodySwannGT/lisa/commit/6552efdfa182c43a38854167862b67532cd261d4))
* **core:** add git dirty state check before applying changes ([67acf32](https://github.com/CodySwannGT/lisa/commit/67acf325cb33e46d21d34ccaaa80317f2e49ce8c))
* **eslint:** add lint:slow script for running slow rules periodically ([6db8940](https://github.com/CodySwannGT/lisa/commit/6db89400295964db70eb1d3840a97532f51c90e4))
* **eslint:** add precondition, entity, and security JSDoc tags ([8979db8](https://github.com/CodySwannGT/lisa/commit/8979db8458b5f52e3789772859360a6de8fcf2f7))
* **expo:** add amplify aws-exports copy step to deploy workflow ([6795135](https://github.com/CodySwannGT/lisa/commit/6795135cadb3eb84f74699435fa8f5e8598f53b5))
* **expo:** add new Lighthouse audit rules and relax config thresholds ([893cf15](https://github.com/CodySwannGT/lisa/commit/893cf15fc3d6e00bcdf3613002f683cfeecc3a48))
* **hooks:** add CLAUDE.md compliance hook for "I'm tired boss" rule ([205ecb4](https://github.com/CodySwannGT/lisa/commit/205ecb4511031e29509a74c9ba488983df4ee330))
* **hooks:** add debug hook for all 13 hook events ([555910e](https://github.com/CodySwannGT/lisa/commit/555910ea3673f3a4ed027e578550ec38e007d9ca))
* **hooks:** add knip dead code detection to pre-push hook ([51328ba](https://github.com/CodySwannGT/lisa/commit/51328ba38c6214901e00717ad8e90e0a121a0964))
* **hooks:** skip pre-push checks in Claude Code remote environment ([6520119](https://github.com/CodySwannGT/lisa/commit/6520119670128722fecf3e2294d15b27f8285d6f))
* **safety-net:** add block-git-stash rule ([9390bf0](https://github.com/CodySwannGT/lisa/commit/9390bf0ab581aa211ae6bd27e33c6675cb746c42))
* **tasks:** add task verification step to /project:verify command ([58752f8](https://github.com/CodySwannGT/lisa/commit/58752f80660c7826bd19a644bc13210ea48e4dd2))
* **tasks:** add verification metadata to task schema ([fd2accf](https://github.com/CodySwannGT/lisa/commit/fd2accfdb11a8fbec885ddc29dfb09ece00e7c83))
* **tasks:** create verification task list in /project:verify ([55981fe](https://github.com/CodySwannGT/lisa/commit/55981fe5af1234692f493fb530a2b6df5c646e99))
* **typescript:** add ast-grep integration for static code analysis ([40e437b](https://github.com/CodySwannGT/lisa/commit/40e437b139ba13b38668babe0c4997c53d1453d2))


### Bug Fixes

* add json, md, mdx to lint-staged prettier config ([c25ea69](https://github.com/CodySwannGT/lisa/commit/c25ea69f8ca0d7bcc98f3845243d954d934b51bd))
* add missing TypeScript type annotations for function parameters ([227c483](https://github.com/CodySwannGT/lisa/commit/227c483efb94abf94b1c184a35cdc3e2698cf623))
* add mjs extension to lint-staged patterns ([7e9d8e4](https://github.com/CodySwannGT/lisa/commit/7e9d8e4dee3553242e4376a9c07405ef32626085))
* add null safety for eslint import plugin settings ([f08e380](https://github.com/CodySwannGT/lisa/commit/f08e3808d16555752323b243c8adf3bda51064bc))
* add null safety for expo eslint.slow.config.ts ([a02b47d](https://github.com/CodySwannGT/lisa/commit/a02b47d5de87762428a33801e62303facea411db))
* add type annotations for all config function parameters ([f5c33b9](https://github.com/CodySwannGT/lisa/commit/f5c33b95ec9df42243cbe4a27b1daeb149c2502d))
* address PR review feedback for security and docs ([d4c0c21](https://github.com/CodySwannGT/lisa/commit/d4c0c214d8d7283c6faf547bdb63b462ce56d24d))
* allow process.env in config files and ignore .lisabak ([f136ec2](https://github.com/CodySwannGT/lisa/commit/f136ec20f891f70f16bfe07354070712c4499def))
* **ast-grep:** correct regex patterns in no-inline-component rules ([c7e372f](https://github.com/CodySwannGT/lisa/commit/c7e372f093069ddc6fbf314f1cde3acaeaa4dc76))
* block git commit -n short alias for --no-verify ([d367bed](https://github.com/CodySwannGT/lisa/commit/d367bed1322105dc90b763e46b946b02988fbcb2))
* block git push -n short alias for --no-verify ([aa9a64f](https://github.com/CodySwannGT/lisa/commit/aa9a64f25c01f075df6f52443fd77c1a7fc4675a))
* broaden spec file patterns to match integration-spec files ([d7edd94](https://github.com/CodySwannGT/lisa/commit/d7edd941b4e5d6d5a7cc890a5318ffd4ecec7e33))
* **cdk:** register sonarjs plugin in slow ESLint config ([3efb6eb](https://github.com/CodySwannGT/lisa/commit/3efb6eb3d8b10841a7806b6b0697ad2ffed1122f))
* **ci:** add OIDC token acquisition for npm publish ([a4de3e5](https://github.com/CodySwannGT/lisa/commit/a4de3e5463f946aea7bd6138d1df11dab3c5e326))
* **ci:** allow SonarCloud failures due to organization line limits ([64fb0cd](https://github.com/CodySwannGT/lisa/commit/64fb0cd1904cdff90de8c1c146285ec789634dd1))
* **ci:** detect specific SonarCloud line-limit errors instead of blanket-ignoring failures ([0215799](https://github.com/CodySwannGT/lisa/commit/0215799854477c30dd3bf947f4cc65fe9a78fe13))
* **ci:** remove flawed promotion detection that blocked all PR merges ([cf20020](https://github.com/CodySwannGT/lisa/commit/cf20020ab885242bd62ebfeb4c06a406080eef9b))
* **ci:** use standard-version strategy for automatic version bumps ([6f4da97](https://github.com/CodySwannGT/lisa/commit/6f4da9757a0451028462450aca101e7359ddaa0f))
* **commands:** clarify next step instructions are for user output ([14e043e](https://github.com/CodySwannGT/lisa/commit/14e043eaae311abb4d78d9da5d726b1195c44ff0))
* **core:** add explicit guard to prevent deletion of project root ([c1d2f5b](https://github.com/CodySwannGT/lisa/commit/c1d2f5b08903221129235d7b8519a8e27a761c7a))
* correct docker compose filename references ([5ef553a](https://github.com/CodySwannGT/lisa/commit/5ef553a9cea8b31af0ec67467d7012634594b87a))
* correct swapped max-lines and max-lines-per-function configs ([f063339](https://github.com/CodySwannGT/lisa/commit/f063339e245dc0259d673decd96dbb5a354d60e9))
* **eslint:** improve no-return-in-view error message clarity ([a8473b1](https://github.com/CodySwannGT/lisa/commit/a8473b1ee2da0c7f025cd7621eb9e8f9a76379c7))
* **eslint:** register sonarjs plugin in slow config files ([9f29672](https://github.com/CodySwannGT/lisa/commit/9f2967284b145413e538431278ed8078d18c3511))
* exclude template directories from ESLint in local config ([e997588](https://github.com/CodySwannGT/lisa/commit/e9975886417169858c26d92a76f645cfecec2703))
* **expo:** copy aws-exports file in lighthouse workflow ([539efaf](https://github.com/CodySwannGT/lisa/commit/539efaf817ab8991695833492ecc53d0486a86dc))
* **expo:** restore original Lighthouse thresholds, add new audit rules ([0f3fc21](https://github.com/CodySwannGT/lisa/commit/0f3fc21bf6327038bb33211a668e65260cdf74ea))
* extract duplicate string constant and enable husky in prepare ([662c915](https://github.com/CodySwannGT/lisa/commit/662c91574e85c9ecd79f6a06d0171d3d1b419800))
* include eslint.*.ts files in tsconfig.eslint.json ([7c198a6](https://github.com/CodySwannGT/lisa/commit/7c198a64cb7b7fe6fb90cee4a9662cf0b1796cf4))
* **knip:** simplify entry patterns and remove unused memfs dependency ([674a48d](https://github.com/CodySwannGT/lisa/commit/674a48df3fb04b58c6551de177c0603472e72a8b))
* log errors before exit and fix copy-contents writeFile ([d29f383](https://github.com/CodySwannGT/lisa/commit/d29f3830aedbc590551ed8652b9aeb53c7934ac6))
* **markdown:** add language specifiers to fenced code blocks in PR review command ([b869a6e](https://github.com/CodySwannGT/lisa/commit/b869a6ea2d011cb02956b1720f2676081d9f2ccc))
* prevent npm audit stderr from breaking jq parsing ([72c8140](https://github.com/CodySwannGT/lisa/commit/72c81401c98b6796bc503341b86ff8a3fd81f8ed))
* prevent silent failures in bun security scan ([576ddc1](https://github.com/CodySwannGT/lisa/commit/576ddc1cfa2b10c5f102cd74788816d93391d179))
* remove -n from git push block_args (it means --dry-run not --no-verify) ([4a9baab](https://github.com/CodySwannGT/lisa/commit/4a9baab55ca30a65c14dd6ca1990f7d18da383cb))
* remove duplicate k6 threshold and fix import order ([04b5ee1](https://github.com/CodySwannGT/lisa/commit/04b5ee13332ea361acd05b164d23f1f218371c2b))
* remove invalid GITHUB_OUTPUT env overrides in deploy workflow ([642f614](https://github.com/CodySwannGT/lisa/commit/642f61466057dbee715cc33e527709861cb422b4))
* remove Lisa header from .nvmrc files ([98e6ab1](https://github.com/CodySwannGT/lisa/commit/98e6ab15e45f05bdb2028e9961cbadbbe07f1c3d))
* restore node-tar GHSA-8qq5-rm4j-mr97 exclusion for bun audit ([4f26dd9](https://github.com/CodySwannGT/lisa/commit/4f26dd97c1a1014b4eebd0ccdecc0b57c7ce6ebb))
* restore project-specific knip config and remove unused deps ([b5d0b99](https://github.com/CodySwannGT/lisa/commit/b5d0b99f27e7e2a02d4a09ec1b9df5e31c09936e))
* **scripts:** correct syntax errors in cleanup-github-branches script ([71159e5](https://github.com/CodySwannGT/lisa/commit/71159e551561a47864143e5474562eb7691de35e))
* search for END_MARKER after BEGIN_MARKER in findGuardrailsBlock ([f6b487b](https://github.com/CodySwannGT/lisa/commit/f6b487b28288bd39c3947aecfae94f81e5054d86))
* **skills:** skip prompt-complexity-scorer for slash command invocations ([0b0d70a](https://github.com/CodySwannGT/lisa/commit/0b0d70a1f3b40aefb2473c34961dcf0d715eadd9))
* update ESLint config and document JSDoc decorator escaping ([a2a6afe](https://github.com/CodySwannGT/lisa/commit/a2a6afeb80f6f6c3bd3e9a35593a8870e7c5d2b3))
* use Bun setup action and correct install commands in deploy workflow ([019e3b3](https://github.com/CodySwannGT/lisa/commit/019e3b384f2f67e8bd314f550eb647631ba88f19))
* use specific glob pattern for config files in ESLint tsconfig ([e635444](https://github.com/CodySwannGT/lisa/commit/e635444a0e51b4246f88554c9c27fec5af6e2116))


### Documentation

* add Claude Code hooks and settings reference ([b6c389d](https://github.com/CodySwannGT/lisa/commit/b6c389d9ca70543c58b4d58f517181580e6e312c))
* add Claude Code task system and over-instruction analysis ([4d5669d](https://github.com/CodySwannGT/lisa/commit/4d5669d602f16fc0481f33554039767ca864b96e))
* add comprehensive task management system documentation ([01371c6](https://github.com/CodySwannGT/lisa/commit/01371c664bd199dc73cddf257d606e4f7f72cb9a))
* add Future Enhancements section to README ([c4f21f6](https://github.com/CodySwannGT/lisa/commit/c4f21f6562c723878b25b97e54badff72931d33e))
* add implementation plan for ast-grep integration ([fae59a4](https://github.com/CodySwannGT/lisa/commit/fae59a44a1be64e4a2ba887c946fff43ee4460d1))
* add OVERVIEW.md architecture guide with visual diagram ([d259dbc](https://github.com/CodySwannGT/lisa/commit/d259dbc7401b09fdff11f23632e5991c63a2a79c))
* add OVERVIEW.pdf architecture documentation ([b96b075](https://github.com/CodySwannGT/lisa/commit/b96b07546d19d3f82ca04ccf0b733d02205e8a37))
* add project rules for JSON parsing and hook behavior ([6f701b2](https://github.com/CodySwannGT/lisa/commit/6f701b2c800cb8bade439f70b5b0534960a33d96))
* add research document for ast-grep integration ([64bac18](https://github.com/CodySwannGT/lisa/commit/64bac182c8f5169593ceafe83d3b4f55ac94282e))
* add rule to update template files when modifying project files ([de69af5](https://github.com/CodySwannGT/lisa/commit/de69af5941044409ff466b3fa849698d6adae6a8))
* add SSH keepalive settings to submit-pr command ([fde367b](https://github.com/CodySwannGT/lisa/commit/fde367bb648bbe327b45c1a395fd3aba81f09a56))
* add system prompts reference to REFERENCE.md ([a12651e](https://github.com/CodySwannGT/lisa/commit/a12651e0742a7f925e6d7adf3e1beca53aafca49))
* add WebSocket support research for add-websockets project ([3690e71](https://github.com/CodySwannGT/lisa/commit/3690e7116832437d51063f11b25e61ab902923d4))
* **commands:** add next step guidance to project workflow commands ([360d3ae](https://github.com/CodySwannGT/lisa/commit/360d3aed7bc8b308903c2f5136afb72899462e2a))
* **commands:** improve fix-linter-error command clarity and structure ([f8b491d](https://github.com/CodySwannGT/lisa/commit/f8b491d84b9f8758eb81c747bc2ed3eb2cd1c6ed))
* expand REFERENCE.md with system prompts and tool names ([b9f8f1d](https://github.com/CodySwannGT/lisa/commit/b9f8f1d3a0d56d0e3ffa7a22a0b997612f64fb15))
* **HUMAN:** expand command reference with full workflow documentation ([aab38a0](https://github.com/CodySwannGT/lisa/commit/aab38a068a0cdef1e5c1569200d5b61661abb50c))
* **readme:** add reduce-max-lines commands to slash commands table ([fbf20dc](https://github.com/CodySwannGT/lisa/commit/fbf20dc80184f9f8fba25e5eddad00b44fa0d639))
* update README with maxLinesPerFunction threshold ([c864fa8](https://github.com/CodySwannGT/lisa/commit/c864fa8f3613a6e1fefee789e9a897d30c6d3a0d))


### Code Refactoring

* **cdk:** add CDK template ESLint TypeScript configs ([8f8960f](https://github.com/CodySwannGT/lisa/commit/8f8960fe9770581a266a79f5b36365bc23c20dd7))
* **ci:** simplify dead_code job to run knip directly ([b1976bd](https://github.com/CodySwannGT/lisa/commit/b1976bdaf2cef66f6458d1bd4fc6f0ad6b68b74f))
* **commands:** restructure PR review command with todo workflow ([79a11e9](https://github.com/CodySwannGT/lisa/commit/79a11e9a57c0d64f379a94278925a2f044760d84))
* **commands:** simplify PR review to use parallel subagents ([40c194b](https://github.com/CodySwannGT/lisa/commit/40c194b3070fcf9cbfb6565b80fbee32008d0594))
* **commands:** simplify PR review workflow to use project bootstrap ([0f00c83](https://github.com/CodySwannGT/lisa/commit/0f00c83a816cdc3b74fb1ca666a14f210acb32c7))
* **commands:** update PR review template with todo workflow ([994fb48](https://github.com/CodySwannGT/lisa/commit/994fb48deac1b6cb7c42c3862447e52c3dab743f))
* consolidate coding-philosophy skill into rules file ([e5ec120](https://github.com/CodySwannGT/lisa/commit/e5ec1208cdcea270f96b9a49d5f28d3ebeb37e28))
* **core:** use native fs readFile instead of fs-extra ([0258827](https://github.com/CodySwannGT/lisa/commit/0258827a86f6161428c3b8bb3a3e0f65be32184a))
* **docs:** simplify CLAUDE.md and add stash warning ([7e833d2](https://github.com/CodySwannGT/lisa/commit/7e833d25d5c3bbfd321130f210510bda63b50426))
* **eslint:** remove no-inline-styles references from configs ([57b7a6f](https://github.com/CodySwannGT/lisa/commit/57b7a6fdcc535f100ac84c61c340fb87fed36ec2))
* **eslint:** remove no-inline-styles rule and improve no-return-in-view message ([58c1d24](https://github.com/CodySwannGT/lisa/commit/58c1d2402630dcaa2ec9dc35c36034fe247d11d7))
* **expo:** migrate Expo template ESLint configs to .ts ([3b0b288](https://github.com/CodySwannGT/lisa/commit/3b0b2883ed9df5619cc22633adc964243105c459))
* **hooks:** remove env.local creation from install-pkgs hook ([0f7d082](https://github.com/CodySwannGT/lisa/commit/0f7d08232541396a0ddbbaea7536103669960624))
* implement block-based merge for copy-contents strategy ([17a31a1](https://github.com/CodySwannGT/lisa/commit/17a31a1e8dc37c6be2415f5932236aa93f7fbed6))
* migrate PROJECT_RULES.md to .claude/rules/ ([3af43a3](https://github.com/CodySwannGT/lisa/commit/3af43a3e5f0deeadf18cf662ea0f9d065e067e48))
* **nestjs:** add NestJS template ESLint TypeScript configs ([62d3a68](https://github.com/CodySwannGT/lisa/commit/62d3a683fc3f583035ff994bb7d8c2e29e4d955b))
* **plugins:** remove beads plugin references ([4fbd5d8](https://github.com/CodySwannGT/lisa/commit/4fbd5d8b51d561ce711d6e4893799c4d8af8b396))
* simplify bun security audit to use native bun audit ([c9bcdd2](https://github.com/CodySwannGT/lisa/commit/c9bcdd212a8315e1a01c899e4322245021ff8223))
* simplify slash commands to trust Claude's native task tools ([3ea7371](https://github.com/CodySwannGT/lisa/commit/3ea737102b909732786b0124ee06082f8f4852c6))
* **typescript:** migrate TypeScript template ESLint configs to .ts ([e2a4656](https://github.com/CodySwannGT/lisa/commit/e2a4656551a23242d6a8d972fff0e821504db3b0))
* **typescript:** move Vitest config to npm-package only ([1cf7a07](https://github.com/CodySwannGT/lisa/commit/1cf7a07e7b6231f3d518c441d7ddab9fc0c387b3))
* update NestJS deploy workflow for serverless deployment ([5dcb8e7](https://github.com/CodySwannGT/lisa/commit/5dcb8e7ca3a5894189591059a1391eb0ca35bb75))
* use determine_environment output in migrate and deploy jobs ([35838c0](https://github.com/CodySwannGT/lisa/commit/35838c0300dc8122d2a2df0b55d5115c183201ed))
