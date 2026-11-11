# ompdesk serves its API on Bun, not Node: the omp SDK (`@oh-my-pi/pi-*`) is
# published as TypeScript sources that import `bun:` builtins, so both stages
# start from the Bun release that package.json's `engines.bun` floor requires.
ARG BUN_VERSION=1.4.2

# ---------------------------------------------------------------------------
# Build: install dependencies and produce the Next.js production build.
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-debian AS build

WORKDIR /app

# Manifests first, so the dependency layer is reused until they actually change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# 镜像每次都是全新产物，不存在「装上新版本、目录里却留着旧版本文件」的情况，所以
# 这里固定用 `.next`：运行阶段按这个路径整目录拷走，不依赖版本号拼出来的名字。
RUN OMPDESK_DIST_DIR=.next bun run build

# ---------------------------------------------------------------------------
# Runtime: the built app, its dependencies, and the CLI that launches them.
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-debian AS runtime

# git is a runtime dependency, not a build-time one: the worktree switcher, the
# diff view and skill updates all shell out to it (lib/worktree.ts,
# lib/git-changes.ts, lib/skill-updates.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Bind mounts keep their host ownership, so the container user has to match the
# user that owns `~/.omp` and the project checkouts on the host. 1000 is the
# usual first human account on Linux; override for anything else:
#   docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) .
# Docker Desktop on macOS and Windows remaps ownership itself and needs neither.
# The Bun base image already uses GID 1000, so both the group and the user are
# created only when the requested ids are still free; the final `USER` is
# numeric so it works either way.
ARG UID=1000
ARG GID=1000
RUN set -eux; \
    if ! getent group "${GID}" > /dev/null; then groupadd --gid "${GID}" omp; fi; \
    if ! getent passwd "${UID}" > /dev/null; then \
      useradd --uid "${UID}" --gid "${GID}" --create-home --home-dir /home/omp omp; \
    fi; \
    mkdir -p /home/omp/.omp/agent /workspace; \
    chown -R "${UID}:${GID}" /home/omp /workspace

WORKDIR /app

# node_modules ships as-is rather than being pruned: `serverExternalPackages`
# and the webpack externals rule in next.config.ts deliberately keep every
# `@oh-my-pi/*` import out of the bundle, so the SDK must exist on disk when
# the API routes run.
COPY --from=build --chown=omp:omp /app/node_modules ./node_modules
COPY --from=build --chown=omp:omp /app/.next ./.next
COPY --from=build --chown=omp:omp /app/public ./public
COPY --from=build --chown=omp:omp /app/bin ./bin
COPY --from=build --chown=omp:omp /app/next.config.ts /app/package.json ./

# A container is only reachable from outside when the server binds every
# interface, so the image opts out of the loopback-only rule with
# OMPDESK_ALLOW_NON_LOOPBACK; publish the port to 127.0.0.1 on the host to keep
# it local. OMPDESK_NO_OPEN because there is no browser in here to open.
ENV HOME=/home/omp \
    NODE_ENV=production \
    PORT=30141 \
    OMPDESK_DIST_DIR=.next \
    OMPDESK_HOSTNAME=0.0.0.0 \
    OMPDESK_ALLOW_NON_LOOPBACK=1 \
    OMPDESK_NO_OPEN=1

# `~/.omp/agent` is the directory the omp CLI writes: mount the host's copy here
# and a terminal session continues in the browser. `/workspace` is the default
# project root, and is where relative project paths resolve.
VOLUME ["/home/omp/.omp"]
EXPOSE 30141

USER ${UID}:${GID}
# Not /app: the launcher records its own cwd as OMPDESK_LAUNCH_CWD so relative
# project paths in the browser resolve against it.
WORKDIR /workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun --eval 'const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 30141}/`); process.exit(r.status < 500 ? 0 : 1)'

# The published CLI, so the container honours the same flags and environment
# variables as a local `ompdesk` — including `--authenticated`. `foreground`
# keeps the server in the entrypoint process instead of detaching: a container
# whose PID 1 exits would be torn down with it.
#
# It stays in ENTRYPOINT rather than CMD: any argument after the image name
# replaces CMD wholesale, so `docker run <image> --port 8080` would lose
# `foreground` and detach a server whose parent exits immediately. Options still
# reach the launcher — `docker run <image> --port 8080` becomes
# `foreground --port 8080` — but a subcommand does not, which is why the image
# is documented as running the server and nothing else.
ENTRYPOINT ["bun", "/app/bin/ompdesk.js", "foreground"]
