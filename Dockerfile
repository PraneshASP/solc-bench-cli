# solc-bench sandbox: Solar, Slang, solx and oksolc next to Foundry's solc.
# Network is only used at image build time and in the fetch phase; benchmarks run with --network none.
# Node 26.13.0 "Lithium" (Active LTS), Debian 13 trixie
ARG BASE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

# ---------------------------------------------------------------- oksolc (built from a pinned commit)
FROM ${BASE} AS oksolc
ARG TARGETARCH
# oksolc requires exactly this Zig version (its build.zig rejects others).
ARG ZIG_VERSION=0.17.0
ARG ZIG_SHA256_ARM64=9e8d11661d4ae3bd57702a3832781e23ad151dde5798e16a5ccd503f65234ff8
ARG ZIG_SHA256_AMD64=1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026
# okcontract/oksolc tag v0.2.4 (2026-11-03). Zig dependencies are content-hash pinned in build.zig.zon.
ARG OKSOLC_COMMIT=4c94a99257342477ef58cc6fd418cc964c70d3c5

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    ARCH="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$ARCH" in \
      arm64) Z_ARCH=aarch64; Z_SHA="$ZIG_SHA256_ARM64" ;; \
      amd64) Z_ARCH=x86_64; Z_SHA="$ZIG_SHA256_AMD64" ;; \
      *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSL --proto '=https' --tlsv1.2 -o zig.tar.xz "https://ziglang.org/download/${ZIG_VERSION}/zig-${Z_ARCH}-linux-${ZIG_VERSION}.tar.xz"; \
    echo "$Z_SHA  zig.tar.xz" | sha256sum -c -; \
    mkdir /opt/zig && tar -xJf zig.tar.xz -C /opt/zig --strip-components=1 && rm zig.tar.xz; \
    mkdir /src && cd /src; \
    git -c core.hooksPath=/dev/null init -q; \
    git remote add origin https://github.com/okcontract/oksolc; \
    git -c protocol.allow=never -c protocol.https.allow=always fetch -q --depth 1 origin "$OKSOLC_COMMIT"; \
    git -c core.hooksPath=/dev/null -c advice.detachedHead=false checkout -q FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "$OKSOLC_COMMIT"; \
    ZIG_GLOBAL_CACHE_DIR=/tmp/zig-cache /opt/zig/zig build -Doptimize=ReleaseFast -Dstrip=true --prefix /out; \
    /out/bin/oksolc version

# ---------------------------------------------------------------- runtime image
FROM ${BASE}
ARG TARGETARCH

ARG FOUNDRY_VERSION=v1.9.0
ARG FOUNDRY_SHA256_ARM64=22d3060fa83515fb901690a2c59a5f552bd41c241886195b2159562fc4947abc
ARG FOUNDRY_SHA256_AMD64=8d17599b42e3139f1a9c171be3798c4ed8e743ae17b84cc3435e57bf2a51ae99

# Slang preview v0.2.0 (NomicFoundation/solx prerelease d95c1150, 2026-10-29)
ARG SLANG_TAG=d95c1150
ARG SLANG_BUILD=2026-10-29
ARG SLANG_SHA256_ARM64=5490d6e544bbb85b8dae2693920379a59e7f8c7e7f0272685f952a37004ab164
ARG SLANG_SHA256_AMD64=48f8b3d7b0d3db184d789d8ca1ebc8a87092154c230a99cff2aa12728cb0e145

# solx v0.1.8 (NomicFoundation/solx)
ARG SOLX_VERSION=0.1.8
ARG SOLX_SHA256_ARM64=f37684389be522d3062634ff8e83c5780255ff6789c93c5e141b494f873040d0
ARG SOLX_SHA256_AMD64=2f6b8feb6a28ac6297a2c0c5afa936e4c013e7175ca88a9bf8e435e61fa1a226

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# Every downloaded binary is pinned to a release and checked against its SHA-256 before use.
RUN set -eu; \
    ARCH="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$ARCH" in \
      arm64) F_SHA="$FOUNDRY_SHA256_ARM64"; S_SHA="$SLANG_SHA256_ARM64"; X_SHA="$SOLX_SHA256_ARM64" ;; \
      amd64) F_SHA="$FOUNDRY_SHA256_AMD64"; S_SHA="$SLANG_SHA256_AMD64"; X_SHA="$SOLX_SHA256_AMD64" ;; \
      *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
    esac; \
    fetch() { curl -fsSL --proto '=https' --tlsv1.2 -o "$1" "$2"; echo "$3  $1" | sha256sum -c -; }; \
    cd /tmp; \
    fetch foundry.tar.gz "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_${ARCH}.tar.gz" "$F_SHA"; \
    tar -xzf foundry.tar.gz -C /usr/local/bin forge solar; \
    fetch slang "https://github.com/NomicFoundation/solx/releases/download/${SLANG_TAG}/slang-linux-${ARCH}-gnu-${SLANG_BUILD}" "$S_SHA"; \
    fetch solx "https://github.com/NomicFoundation/solx/releases/download/${SOLX_VERSION}/solx-linux-${ARCH}-gnu-v${SOLX_VERSION}" "$X_SHA"; \
    install -m 0755 slang solx /usr/local/bin/; \
    rm -f foundry.tar.gz slang solx

COPY --from=oksolc /out/bin/oksolc /usr/local/bin/oksolc
RUN forge --version | head -1 && solar --version | head -1 && slang --version | head -1 \
 && solx --version | head -1 && oksolc version

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin bench \
 && mkdir -p /repos /work /results /src /home/bench/.svm /home/bench/.foundry \
 && install -d -m 0755 /opt/solc-bench /opt/solc-bench/dist \
 && chown bench:bench /repos /work /results /home/bench/.svm /home/bench/.foundry

COPY --chmod=0444 package.json /opt/solc-bench/package.json
COPY --chmod=0555 dist/ /opt/solc-bench/dist/

USER bench
WORKDIR /home/bench
ENV FOUNDRY_FFI=false \
    NODE_ENV=production

# Node permission model: the runner may only write to its workspace, results, clones and temp dirs.
# Child processes (forge, git) are not covered by it; the container sandbox (no network, read-only rootfs,
# no capabilities, non-root) contains those. PERM0002 is the known warning for --allow-child-process.
ENTRYPOINT ["node", "--permission", \
  "--allow-fs-read=/opt/solc-bench", "--allow-fs-read=/repos", "--allow-fs-read=/src", "--allow-fs-read=/work", \
  "--allow-fs-read=/results", "--allow-fs-read=/tmp", "--allow-fs-read=/home/bench", \
  "--allow-fs-write=/repos", "--allow-fs-write=/work", "--allow-fs-write=/results", "--allow-fs-write=/tmp", \
  "--allow-child-process", "--disable-warning=PERM0002", "--disallow-code-generation-from-strings", \
  "/opt/solc-bench/dist/runner/main.js"]
