FROM node@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7
RUN apt-get update && apt-get install -y --no-install-recommends python3 strace procps jq && rm -rf /var/lib/apt/lists/*
RUN npm install --global bun@1.3.8 && test "$(node --version)" = v22.23.3 && test "$(bun --version)" = 1.3.8
LABEL lisa.verification.work-item="4407" lisa.verification.purpose="native-timing-tools-only"
