# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
* **hooks:** remove env.local creation from install_pkgs hook ([0f7d082](https://github.com/CodySwannGT/lisa/commit/0f7d08232541396a0ddbbaea7536103669960624))
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
