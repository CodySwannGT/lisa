# Old deployment runs

New NestJS, Expo, Rails, Harper Fabric, and CDK workflow templates refuse a run
whose commit is no longer the current tip of the deployment branch. GitHub
[reruns keep the original commit and ref](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
so retrying an old failure can otherwise overwrite a newer deployment.

The refusal reports both commits and tells the operator to rerun the latest
deployment for the branch, or start a manual run on the branch tip. A missing
branch or unavailable repository also stops the run; inability to verify the
branch is never treated as permission to deploy.

For a deliberate rollback, manually run the workflow **on the target branch**
with `force_stale_deploy: true` and `rollback_commit` set to the full commit SHA
to restore. Keep the environment input, where present, set to that same branch.
The approval input defaults to `false`, only applies to
manual runs, and records the non-tip commit and current tip in a warning and the
run summary. Inputs cannot be changed when rerunning an existing run: create a
manual run with the override and rollback commit instead. Leave `rollback_commit`
empty to use the selected run's original commit. Templates with an `environment` input
check that environment's branch; the other templates check the selected branch.

The concrete deployment and migration jobs also check their actual checkout,
because retrying only a failed job does not rerun successful upstream jobs.
NestJS and Expo normally check out the immutable commit produced by this run's
release, including its version bump. The rollback override selects the requested
rollback commit (or the original run commit if none was specified). Rails keeps
its existing branch checkout for normal runs and selects the requested commit
for a rollback. The release job still runs; this override controls the code
deployed afterward, and does not undo release tags or database changes.

Expo's native build workflow can submit apps to stores. The updated caller waits
for validation and release, passes the immutable source commit, and checks again
inside that reusable build job before submission. These new reusable-workflow
inputs are optional; callers that have not adopted them retain their behavior.
Enable `force_build` too when a rollback must rebuild and resubmit native apps
even though the workflow's app-configuration change detector would skip a build.

CDK's workflow releases only. Its initial check protects release entry; AWS
CodePipeline remains responsible for deployment. This change does not add a
second CDK deployer or validate CodePipeline executions.

These workflows are **create-only**: updating Lisa does not replace an existing
project's `deploy.yml`. Existing projects should adopt the
`force_stale_deploy` and `rollback_commit` inputs, `validate_deploy_commit` job, dependency from
`pre_deploy_gates`, and the check immediately after checkout in each concrete
deployment or migration job from their stack's updated template. Keep custom
deployment steps and environment configuration. Ensure the release commit
output, when used, is the commit the deployment actually checks out. Expo callers
must also adopt the native build dependencies and source/branch/approval inputs.

The check proves the branch tip at the time it runs. It is not a deployment lock
against a later concurrent push, and rerunning a historical workflow revision
that predates the guard still uses that historical workflow's behavior.
