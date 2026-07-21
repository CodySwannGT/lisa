import yaml from "js-yaml";

const parsed = yaml.load("verified: true");

if (parsed?.verified !== true) {
  throw new Error("Dependency-backed workflow fixture did not execute");
}

console.log("E2E_COVERAGE_DEPENDENCY_FIXTURE_OK");
