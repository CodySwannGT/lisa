import type { CopyStrategy } from "../core/config.js";
import type { ICopyStrategy } from "./strategy.interface.js";
import { CopyOverwriteStrategy } from "./copy-overwrite.js";
import { CopyContentsStrategy } from "./copy-contents.js";
import { CreateOnlyStrategy } from "./create-only.js";
import { MergeStrategy } from "./merge.js";
import { TaggedMergeStrategy } from "./tagged-merge.js";

export type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
export { CopyOverwriteStrategy } from "./copy-overwrite.js";
export { CopyContentsStrategy } from "./copy-contents.js";
export { CreateOnlyStrategy } from "./create-only.js";
export { MergeStrategy } from "./merge.js";
export { TaggedMergeStrategy } from "./tagged-merge.js";

/**
 * Registry for copy strategies
 */
export class StrategyRegistry {
  private readonly strategies: Map<CopyStrategy, ICopyStrategy>;

  /**
   * Initialize strategy registry with provided or default strategies
   * @param strategies - Optional array of strategies (uses defaults if omitted)
   */
  constructor(strategies?: readonly ICopyStrategy[]) {
    const allStrategies = strategies ?? [
      new CopyOverwriteStrategy(),
      new CopyContentsStrategy(),
      new CreateOnlyStrategy(),
      new MergeStrategy(),
      new TaggedMergeStrategy(),
    ];

    this.strategies = new Map(allStrategies.map(s => [s.name, s]));
  }

  /**
   * Get a strategy by name
   * @param name - Name of the strategy to retrieve
   * @returns The strategy instance with the given name
   */
  get(name: CopyStrategy): ICopyStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    return strategy;
  }

  /**
   * Check if a strategy exists
   * @param name - Name of the strategy to check
   * @returns True if the strategy is registered
   */
  has(name: CopyStrategy): boolean {
    return this.strategies.has(name);
  }

  /**
   * Get all registered strategies
   * @returns Array of all strategy instances
   */
  getAll(): readonly ICopyStrategy[] {
    return Array.from(this.strategies.values());
  }
}

/**
 * Create default strategy registry
 * @returns New StrategyRegistry instance with all default strategies
 */
export function createStrategyRegistry(): StrategyRegistry {
  return new StrategyRegistry();
}
