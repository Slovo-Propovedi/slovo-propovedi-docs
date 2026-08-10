#!/usr/bin/env node

// Validates that openAPI.yaml is syntactically valid YAML.
// Exits 0 on success, 1 on failure so the pre-commit hook can block the commit.

import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const OPENAPI_SPEC_PATH = new URL("../openAPI.yaml", import.meta.url);

const specSource = readFileSync(OPENAPI_SPEC_PATH, "utf8");

let parsed;
try {
  parsed = load(specSource);
} catch (error) {
  console.error(`openAPI.yaml is not valid YAML: ${error.message}`);
  process.exit(1);
}

if (parsed === undefined || parsed === null) {
  console.error("openAPI.yaml is empty — expected an OpenAPI specification.");
  process.exit(1);
}

console.log("openAPI.yaml parses as valid YAML.");
