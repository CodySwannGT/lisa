#!/usr/bin/env node

import { createProgram } from "./cli/index.js";

const program = createProgram();
program.parseAsync().catch(error => {
  console.error(
    "Error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
