---
disable-model-invocation: true
description: "Declare the checks that govern this repository from the audit's findings and your answers, and generate the control register. Declares nothing that is not supported, and never imposes Lisa's own thresholds on an unsupported stack."
argument-hint: "[path]"
---

Use the /lisa-configure skill to decide which road this repository takes with `lisa controls seed`, declare each check the audit report or an operator's answer supports in the gates block of .lisa.config.json (asking the operator one decision at a time and proposing each threshold at the value measured today), have the declaration checked by `lisa controls declaration-check`, and write the control register with `lisa controls register`, changing nothing else. $ARGUMENTS
