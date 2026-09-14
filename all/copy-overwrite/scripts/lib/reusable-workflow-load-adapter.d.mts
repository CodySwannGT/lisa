import type { RunPage } from "./reusable-workflow-load-scan.mjs";
export declare const RUNS_PER_PAGE = 100;
export type GithubRequest = (path: string) => Promise<unknown>;
export interface AdapterOptions {
  readonly repo: string;
  readonly request: GithubRequest;
  readonly perPage?: number;
}
export declare function runsPath(
  repo: string,
  page: number,
  perPage: number
): string;
export declare function runPath(repo: string, id: number): string;
export declare function jobsPath(repo: string, id: number): string;
export declare function createRunPageFetcher(
  options: AdapterOptions
): (page: number) => Promise<RunPage>;
