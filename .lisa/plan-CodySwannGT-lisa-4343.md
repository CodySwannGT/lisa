# Fix CDK template OIDC ownership and executable advertisements

Work item CodySwannGT/lisa#4343; native claimed/bound codex/4343-cdk-oidc-template in /tmp/lisa-4343-implementation at ce7d04cb888627d03cdbe74191bc2a09a5e15184. Complete ignored canonical context SHA256 2aa9348741bf4896793efb91081436ad18c0e45e79ba505deb5854e2d5a5b1ad. Claim/binding verified before this plan.

## Accepted outcome and contract

## Context / Business Value
A CDK app that already uses aws-cdk-github-oidc 5.2.0 cannot run the published Lisa updater because the shipped forced range is ^2.4.1. The range safety guard correctly refuses disjoint majors. Updating the supported CDK template restores ordinary updates while preserving host-owned construct versions. The same template also force-advertises infrastructure=bin/infrastructure.js, although no generator supplies that executable; source-only CDK apps must not receive a phantom package command.

## Reproduction
1. Use the public @codyswann/lisa 4.69.3 CDK package template at cdk/package-lisa/package.lisa.json.
2. Create a temporary package.json with dependencies aws-cdk-github-oidc set to exact 5.2.0, aws-cdk-lib 2.260.0 and constructs ^10.7.2.
3. Invoke PackageLisaStrategy.apply with that real template and a noninteractive context. An official CLI apply to an equivalent CDK app reproduces the same refusal.
4. For the executable regression, use cdk.json with an app entry and package.json with no bin. Apply the shipped template: it writes infrastructure=bin/infrastructure.js despite no generator creating that file. An explicit legitimate host bin receives that extra phantom entry too.

## Expected vs. Actual
Expected: an exact supported 5.2.0 host remains exact and normal template application succeeds. The existing host-ahead, contained-range preservation contract in src/strategies/package-lisa.ts supplies the expected behavior.
Actual: application aborts: dependencies.aws-cdk-github-oidc host "5.2.0" versus Lisa "^2.4.1" are disjoint and neither contains the other.

## Environment / Version
Reproduced with @codyswann/lisa 4.69.3, source ce7d04cb888627d03cdbe74191bc2a09a5e15184, Node 22.23.3 and npm 10.9.9. Last known good for this supported major: unknown. Reproducibility: every attempt (1/1 official CLI invocation).

## Technical Approach
Write new deterministic regressions loading the real shipped CDK template through PackageLisaStrategy before changing it. Move the runtime-coupled OIDC dependency from force to defaults at ^5.2.0, matching host ownership of aws-cdk-lib, and raise the forced constructs peer floor to ^10.7.2. Existing aws-cdk-lib 2.260.0 and Node 22.23.3 defaults satisfy the published peers/engine. Verify that no generated CDK source calls the legacy construct API. Preserve the package-range guard and dollar-reference overrides. Preserve both exact supported 5.2.0 and explicit legacy v2 host choices. Document that v2 hosts need deliberate source migration before adopting newer immutable-repository trust APIs. Preserve the generic forced-range guard; a forced constructs 11.x host must still be refused against the 10.x template. Remove only the forced bin advertisement from this same owning template. Preserve every existing explicit host bin value and do not generate a fake executable or change generic package merge behavior. Add real-strategy source-only app and legitimate-host-bin regressions first. Regenerate only affected derived artifacts through official generators.

## Acceptance Criteria
```gherkin
Scenario: Existing supported host updates without losing its pin
  Given the real CDK package template and a host with exact OIDC 5.2.0 and compatible CDK peers
  When the package strategy applies the template normally
  Then application succeeds and the written OIDC dependency remains exact 5.2.0

Scenario: A new app gets a coherent supported dependency set
  Given a fresh host without OIDC or constructs dependencies
  When the real CDK package template applies
  Then its OIDC and constructs floor choices satisfy OIDC 5.2.0's declared peers and the CDK default remains compatible

Scenario: Existing legacy application APIs remain host-owned
  Given an existing host with an explicit OIDC v2 dependency
  When the same real template applies
  Then its explicit OIDC v2 dependency remains unchanged rather than silently migrating the application API

Scenario: A forced disjoint peer major is still refused
  Given an existing host with constructs ^11.0.0 against the forced constructs 10.x template
  When the same real template applies
  Then the existing range guard refuses it without rewriting the host manifest

Scenario: Source-only CDK apps get no phantom executable
  Given a CDK app marker and a host package without a bin entry
  When the real CDK template applies
  Then no bin advertisement is added for an executable the template does not create

Scenario: Legitimate host executables remain host-owned
  Given a CDK app whose package declares an actual host-owned bin mapping
  When the real CDK template applies
  Then its bin mapping remains unchanged and no phantom infrastructure entry is added

Scenario: The corrected template reaches the published package
  Given the reviewed fix has merged through ordinary required checks
  When the ordinary release publishes its package
  Then npm's public package contains the corrected template and a normal apply to the supported temporary CDK host succeeds
```

## Quality / Documentation / Cleanup
Develop the regressions first and capture RED/GREEN. Run the affected package strategy and CDK detection tests, normal lint/type/artifact checks and required CI. Review relevant CDK/update guidance and add only necessary migration documentation. Remove temporary experiments from tracked source. Use ordinary commits and hooks, ordinary release, and exact public package readback before terminal closeout.

## Out of Scope
General dependency-merge algorithm changes, weakening the disjoint-range guard, application-specific IAM/OIDC migration, live AWS changes, other framework/tooling upgrades, global agent configuration changes.

## Target Backend Environment
None — no runtime behavior change: config-only. This work corrects a shipped package-governance template; it does not edit deployed application constructs.

## Repository
lisa

## Source Artifacts
Reference: [Published OIDC 5.2.0 peer/engine metadata](https://registry.npmjs.org/aws-cdk-github-oidc/5.2.0).
Reference: [OIDC 5.2.0 API documentation](https://unpkg.com/aws-cdk-github-oidc@5.2.0/API.md).

## Source Precedence
Business rules: this bug's acceptance criteria and existing range-preservation contract. Data/API compatibility: the published package metadata and versioned vendor API reference. Visual and flow axes: not applicable; no UI is changed. Conflicts must be reported rather than resolved by weakening the guard.

## Links
[Owning template at the reproduced source](https://github.com/CodySwannGT/lisa/blob/ce7d04cb888627d03cdbe74191bc2a09a5e15184/cdk/package-lisa/package.lisa.json).

## Relationship Search
Ran git log --all --oneline -- cdk/package-lisa/package.lisa.json and git log --all --oneline --grep=OIDC. Prior history concerns shared tooling, detection and CI roles, not this template's supported major. Ran gh issue list --repo CodySwannGT/lisa --search 'aws-cdk-github-oidc' and 'OIDC template' --state all. Results 3533/3711 concern app detection and 3365/3528 concern CI role provisioning; all closed and no duplicate open leaf found.

## Validation Journey
Run the new real-template regression with exact 5.2.0, explicit v2, absent dependencies, a forced constructs 11.x disjoint-major fixture, source-only app/no-bin and explicit legitimate-host-bin fixtures. Capture the actual pre-fix refusal and post-fix successful written manifest plus the still-refused edge. After ordinary release, fetch the exact public npm version/integrity, inspect the shipped template and run ordinary CLI apply to an owned temporary CDK app. Keep all temporary directories/cache state owned and no AWS lookups or global configuration writes.
[EVIDENCE: test-run-log: cdk-oidc-template-red-green]
[EVIDENCE: cli-output: published-cdk-template-apply]
[EVIDENCE: state-dump: published-cdk-template-metadata]


## Execution

1. Builder owns only CDK package template host-owned OIDC5.2 default and matching forced constructs peer floor plus focused real package-strategy regression proof. Preserve strict disjoint-range rejection and unrelated work.
2. Root non-author reviews exact diff/RED and GREEN proof and actual template minimum compatibility. No generator API changes, starter dependency lowering or managed-CLI bypass.
3. Normal hooks/small ticket-linked commit and PR; authentic review, CI and ordinary merge. Configured public release, npm published-package byte/source identity and fresh actual starter reapply verify the owning upstream outcome.
4. Publish required typed evidence, canonical usage/backlinks/nativecloseout before starter39 consumes the published release.

## Builder proof

Exact Node22.23.3/Bun1.3.8 frozen install and build:dist both passed. The real-template CDK-marker regression first failed three acceptance scenarios (existing exact5.2, fresh OIDC default, minimum constructs peer); legacyv2 preservation and forced constructs11 rejection passed as baseline controls. After moving only OIDC ownership to defaults ^5.2.0 and raising constructs to ^10.7.2, the same five cases passed. The existing real-template detection assertion was updated for that intentional ownership change; combined strategy/detection/doctor suites passed108 cases in4files. Generic force-range algorithm is untouched. Primary versioned5.2 metadata declares constructs^10.7.2, CDKlib^2.260.0 and Node22–26; existing CDK/Node defaults satisfy them. No shipped CDK source constructs the OIDC provider, so external application APIs remain the host's explicit migration responsibility.

Independent root review, required CI and exact public package/apply readback remain delivery prerequisites. No deployed AWS or consumer migration is established by these local tests.

## Non-author review follow-up

The same CDK package force.bin advertised bin/infrastructure.js although no generator emits it. Root owns this integrated-source defect review. Builder adds source-only app/no-bin and explicit legitimate-host-bin RED/GREEN, removes only the forced advertisement and narrowly updates the old detection assertion. Existing host bin choices remain unchanged.

Executable follow-up proof: the two new real-template cases failed on the reviewed first commit (fresh no-bin gets a phantom advertisement; explicit host mapping gets an extra phantom key), while the five OIDC/peer cases passed. Removing only force.bin makes all110cases in4files pass, preserving actual host executable content and mapping. The affected detection assertion now pins absence of forced bin. No generic merge behavior or executable generation changed.

## Full-suite follow-up
The normal pre-push run found that the installed-base adoption tables still named OIDC as forced and assumed a current forced bin. Align the shipped-table assertion with the current template while retaining explicit historical OIDC/bin diagnostics. Link the same published versioned API through its package artifact URL, without changing the reference guard. Preserve the actual failed full-suite run and rerun normal gates.
