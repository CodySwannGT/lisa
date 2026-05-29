---
description: "Migrate an existing hand-rolled wiki onto the lisa-wiki kernel — phased and compatibility-first, with a strict no-loss guarantee (renaming is fine; losing functionality or data is not). Ends by running /doctor."
argument-hint: "[--phase <0|1|1b|2|3|4|5>]"
---

Use the lisa-wiki-migrate skill to move this repo's bespoke wiki onto the kernel in reviewable phases: inventory, adopt kernel, absorb documentation, consolidate runtime + connectors, normalize by touch, then hard-enforce — parity-checking each migrated artifact before deleting the old one, and finishing with /doctor. $ARGUMENTS
