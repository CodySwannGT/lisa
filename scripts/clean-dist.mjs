#!/usr/bin/env node
/** Remove stale compiled output before TypeScript rebuilds `dist/`. */
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
await rm(distDir, { force: true, recursive: true });
