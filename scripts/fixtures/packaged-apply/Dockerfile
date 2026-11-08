FROM node:24.21.0-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git jq python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --allow-scripts=bun bun@1.4.4
# No host directories, credentials, or agent homes are mounted or copied here.
# The controller pins the actual image ID and inspects the stopped container.
