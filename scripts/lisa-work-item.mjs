#!/usr/bin/env node

// The installed copy lives under all/copy-overwrite. Keeping this tiny entrypoint
// makes the exact same implementation available to Lisa's own hooks and CI.
await import("../all/copy-overwrite/scripts/lisa-work-item.mjs");
