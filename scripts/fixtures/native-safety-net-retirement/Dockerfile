FROM oven/bun:1.4.4 AS bun
FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash git jq python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /
