# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# Trusted fixed recipe only. Application/package files never enter this build context.
ARG TARGETARCH
FROM --platform=linux/amd64 node@sha256:25330af3531fb5e23318554a0aa911125b6e91b1b777edf7655501d207c067a2 AS node-amd64
FROM --platform=linux/arm64 node@sha256:a0ddbc73510e98f5e824fd64266ffe1c2c343ba9cf260d95ca2985ad632a3f3e AS node-arm64
FROM node-${TARGETARCH} AS node-runtime
FROM --platform=linux/amd64 ruby@sha256:bcb412ff5c2bdace9af8171c410745e227aea813fa951caab539b2f18623d239 AS ruby-amd64
FROM --platform=linux/arm64 ruby@sha256:2836fb28bf6f9f1d88015861df0b52424daeb499f2816ed9e4ef31c3bc181909 AS ruby-arm64
FROM ruby-${TARGETARCH}
ARG TARGETARCH
COPY --from=node-runtime /usr/local/bin/node /opt/node/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /opt/node/lib/node_modules
ENV PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
RUN apt-get update && apt-get install --yes --no-install-recommends \
    bash ca-certificates curl git unzip passwd build-essential pkg-config libmariadb-dev libmariadb-dev-compat libyaml-dev libvips42 libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*
COPY npm-updater-gate-supervisor.c /tmp/npm-updater-gate-supervisor.c
RUN cc -std=c11 -Wall -Wextra -Werror -O2 /tmp/npm-updater-gate-supervisor.c \
    -o /usr/local/bin/lisa-npm-supervisor && rm /tmp/npm-updater-gate-supervisor.c
RUN set -eu; \
    curl --fail --location --silent --show-error https://registry.npmjs.org/npm/-/npm-11.21.0.tgz --output /tmp/npm.tgz; \
    test "$(openssl dgst -sha512 -binary /tmp/npm.tgz | base64 -w0)" = 'Zov8KhamNneiLdELtj5YALtNmJW4L4fCLTzjfpzXG2w6MSHcf0UxgdlK5uloCuksWT+7mGUU7wi79cO6RqivPg=='; \
    mkdir /opt/npm; tar -xzf /tmp/npm.tgz --strip-components=1 -C /opt/npm; \
    ln -s /opt/npm/bin/npm-cli.js /opt/node/bin/npm; \
    curl --fail --location --silent --show-error https://rubygems.org/downloads/bundler-2.4.10.gem --output /tmp/bundler.gem; \
    echo 'b9806fa944063a6a8676a8f9ed4c7c776a36c3bc82f26c5760867a0285b4a121  /tmp/bundler.gem' | sha256sum --check --strict; \
    gem install --local /tmp/bundler.gem --no-document; \
    rm /tmp/npm.tgz /tmp/bundler.gem
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) bun_arch=x64; bun_sha=0322b17f0722da76a64298aad498225aedcbf6df1008a1dee45e16ecb226a3f1; gh_arch=amd64; gh_sha=83d5c2ccad5498f58bf6368acb1ab32588cf43ab3a4b1c301bf36328b1c8bd60; leaks_arch=x64; leaks_sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;; \
      arm64) bun_arch=aarch64; bun_sha=4e9deb6814a7ec7f68725ddd97d0d7b4065bcda9a850f69d497567e995a7fa33; gh_arch=arm64; gh_sha=06f86ec7103d41993b76cd78072f43595c34aaa56506d971d9860e67140bf909; leaks_arch=arm64; leaks_sha=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;; \
      *) echo 'Unsupported qualified architecture' >&2; exit 1 ;; \
    esac; \
    curl --fail --location --silent --show-error "https://github.com/oven-sh/bun/releases/download/bun-v1.3.8/bun-linux-${bun_arch}.zip" --output /tmp/bun.zip; \
    echo "${bun_sha}  /tmp/bun.zip" | sha256sum --check --strict; \
    unzip -p /tmp/bun.zip "bun-linux-${bun_arch}/bun" > /usr/local/bin/bun; chmod 755 /usr/local/bin/bun; \
    curl --fail --location --silent --show-error "https://github.com/cli/cli/releases/download/v2.96.0/gh_2.96.0_linux_${gh_arch}.tar.gz" --output /tmp/gh.tgz; \
    echo "${gh_sha}  /tmp/gh.tgz" | sha256sum --check --strict; \
    tar -xzOf /tmp/gh.tgz "gh_2.96.0_linux_${gh_arch}/bin/gh" > /usr/local/bin/gh; chmod 755 /usr/local/bin/gh; \
    curl --fail --location --silent --show-error "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_${leaks_arch}.tar.gz" --output /tmp/gitleaks.tgz; \
    echo "${leaks_sha}  /tmp/gitleaks.tgz" | sha256sum --check --strict; \
    tar -xzOf /tmp/gitleaks.tgz gitleaks > /usr/local/bin/gitleaks; chmod 755 /usr/local/bin/gitleaks; \
    rm /tmp/bun.zip /tmp/gh.tgz /tmp/gitleaks.tgz; \
    node --version; node /opt/npm/bin/npm-cli.js --version; ruby --version; bundle _2.4.10_ --version; \
    /usr/sbin/useradd --uid 2001 --user-group --create-home candidate
USER 2001:2001
WORKDIR /workspace
