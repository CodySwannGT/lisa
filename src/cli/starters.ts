export const SETUP_TYPES = [
  "rails",
  "typescript",
  "expo",
  "nestjs",
  "cdk",
  "wiki",
  "harper-wiki",
] as const;

/**
 * Supported starter-backed project setup types.
 */
export type SetupType = (typeof SETUP_TYPES)[number];

/**
 * Metadata for a starter repository used by setup-project.
 */
export interface Starter {
  readonly owner: string;
  readonly repo: string;
  readonly template: true;
}

export const STARTERS: Record<SetupType, Starter> = {
  rails: { owner: "CodySwannGT", repo: "railsstarter", template: true },
  typescript: {
    owner: "CodySwannGT",
    repo: "typescriptstarter",
    template: true,
  },
  expo: { owner: "CodySwannGT", repo: "expostarter", template: true },
  nestjs: { owner: "CodySwannGT", repo: "nestjsstarter", template: true },
  cdk: { owner: "CodySwannGT", repo: "cdkstarter", template: true },
  wiki: { owner: "CodySwannGT", repo: "wikistarter", template: true },
  "harper-wiki": {
    owner: "CodySwannGT",
    repo: "harperwikistarter",
    template: true,
  },
};

/**
 * Check whether a raw string is a supported setup type.
 * @param value - Raw setup type value
 * @returns True when value is a supported setup type
 */
export function isSetupType(value: string): value is SetupType {
  return SETUP_TYPES.includes(value as SetupType);
}

/**
 * Resolve the configured starter template for a setup type.
 * @param type - Valid Lisa setup type
 * @returns Starter repository metadata
 */
export function resolveStarter(type: SetupType): Starter {
  return STARTERS[type];
}
