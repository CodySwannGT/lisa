# Prose surface (must be ignored)

Documentation legitimately shows concrete versions in examples. None of these
are policy pins, so the duplicate-version check must never flag them:

```bash
npm install -g @ast-grep/cli@0.40.4
bunx @codyswann/lisa@2.243.0
```

The project currently runs on bun 1.3.8 and Node 22.21.1.
