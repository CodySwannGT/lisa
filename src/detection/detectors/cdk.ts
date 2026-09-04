import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { pathExists } from "../../utils/index.js";

/**
 * Detector for AWS CDK applications.
 *
 * `cdk.json` is the discriminator, and deliberately the only one. Depending on
 * a CDK package answers a different question: `aws-cdk-lib`, `@aws-cdk/*` and
 * `constructs` say the repository USES CDK types, which any construct library
 * or Amplify Gen 2 backend does, while `cdk.json` says the repository IS a CDK
 * app — it has an entrypoint, a synth target, and the `bin/`, `lib/`, `lambda/`
 * layout the CDK preset assumes.
 *
 * The `aws-cdk` CLI is not a substitute signal either. It arrives directly in
 * toolchains that only build constructs, so matching the dependency exactly
 * rather than by prefix would narrow the bug without fixing it.
 *
 * This matters beyond a wrong preset. The preset's knip `entry` globs include
 * generic directory names — `config/`, `util/`, `utils/`, `functions/` — so a
 * mis-detected repository that happens to have one of them gives knip a
 * fraction of the codebase to analyse and a passing exit code. A dead-code gate
 * that reports success having measured almost nothing is worse than the loud
 * no-matches failure that surfaced this.
 */
export class CDKDetector implements IProjectTypeDetector {
  readonly type = "cdk" as const;

  /**
   * Detect whether the project is a CDK application.
   * @param destDir - Project directory to check
   * @returns True when the project has a cdk.json
   */
  async detect(destDir: string): Promise<boolean> {
    return pathExists(path.join(destDir, "cdk.json"));
  }
}
