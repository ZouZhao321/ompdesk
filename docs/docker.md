# Running ompdesk in Docker

The image builds ompdesk from source and runs the published `ompdesk` launcher
inside the container, so every flag and environment variable from the
[Quick Start](../README.md#quick-start) works the same way.

Two things make ompdesk different from an ordinary web app, and both shape how
the container has to be run:

- **It is not a self-contained service.** ompdesk reads the sessions the `omp`
  CLI already wrote, from `~/.omp/agent`. Without that directory mounted, the
  container starts with no sessions, no configuration and no model roles, and
  nothing it writes survives `docker rm`.
- **It can run a high-privilege agent.** Whatever the container can reach, the
  agent can change. The container boundary is the containment here — keep it
  intact rather than widening it, and only mount the projects you want the
  agent to touch.

## Quick start

```bash
OMPDESK_PASSWORD='a-long-random-password' \
OMP_UID=$(id -u) OMP_GID=$(id -g) docker compose up --build
```

Then open <http://127.0.0.1:30141> and log in with the username `omp` and that
password.

`docker-compose.yml` mounts `$HOME/.omp` and the current directory, publishes
the port on loopback only, and builds the image for the UID/GID you pass.
Override the rest with `OMP_HOME`, `OMPDESK_WORKSPACE`, `OMPDESK_PORT`, or put
any of these in a `.env` file next to the compose file.

The IDs are `OMP_UID`/`OMP_GID` rather than `UID`/`GID` because `UID` is
readonly in bash and cannot be set inline. Docker Desktop on macOS and Windows
needs neither — see [File ownership](#file-ownership).

## Without compose

```bash
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t ompdesk .

docker run --rm \
  -p 127.0.0.1:30141:30141 \
  -v "$HOME/.omp:/home/omp/.omp" \
  -v "$HOME/code:/workspace" \
  -e OMPDESK_AUTHENTICATED=1 \
  -e OMPDESK_PASSWORD='a-long-random-password' \
  ompdesk
```

Arguments after the image name reach the launcher directly:

```bash
docker run --rm -p 127.0.0.1:8080:8080 -e PORT=8080 ompdesk --port 8080
```

## File ownership

Bind mounts keep the ownership they have on the host, and the container runs as
a non-root user. On Linux, build the image with your own IDs
(`--build-arg UID=$(id -u) --build-arg GID=$(id -g)`, or `OMP_UID`/`OMP_GID`
under compose; the default is `1000`) or the server cannot write to the mounted
`~/.omp`. Docker Desktop on macOS and Windows remaps ownership itself, so the
defaults are fine there.

## Paths inside the container

| Path | What it holds |
| --- | --- |
| `/home/omp/.omp` | The omp home the CLI shares — sessions, `agent/config.yml`, the auth file. Mount it. |
| `/workspace` | Default project root, and what relative project paths resolve against. |
| `/app` | The build itself: `.next`, `node_modules`, `bin`. Immutable, do not mount over it. |

## Environment

The image presets `OMPDESK_HOSTNAME=0.0.0.0` (a container is only reachable
when it binds every interface) and `OMPDESK_NO_OPEN=1` (no browser in here to
open). Everything else behaves as documented in the README:

| Variable | Use |
| --- | --- |
| `PORT` | Port inside the container. Publish it with `-p`. |
| `OMPDESK_AUTHENTICATED` | Require the password lock. |
| `OMPDESK_PASSWORD` | The password, overriding any stored hash. |
| `OMPDESK_ALLOWED_HOSTS` | Exact external hostname, when a reverse proxy fronts the container. |

`--authenticated` on its own asks for a password on the terminal, which a
detached container has none of. Pass `OMPDESK_PASSWORD` instead, or set the
password once in **Settings → Access** and let it persist in the mounted
`~/.omp/agent/ompdesk-auth.json`.

## Exposing it beyond localhost

`0.0.0.0` inside the container is not the same as publishing on `0.0.0.0` on the
host — the `-p 127.0.0.1:30141:30141` above keeps it local. Before widening
that:

- Turn the password on. Basic Auth does not encrypt the password in transit, so
  terminate HTTPS at a trusted reverse proxy and set `OMPDESK_ALLOWED_HOSTS` to
  the hostname that proxy uses.
- Remember that the agent runs with the container's access to the mounts you
  gave it. Mount the narrowest project tree that is useful.

Full threat model for the password lock: [authentication.md](./authentication.md).

## What the image does not do

It runs ompdesk, and only ompdesk. It does not reach out to the host: an image
that `nsenter`s into the host's namespaces to run a build living on the host
filesystem would need `--privileged --pid=host`, would be tied to that one
machine's paths, and would give the agent the host rather than the container.
If you already run ompdesk from a checkout on the host, run it there with
`ompdesk` or a systemd unit — that is the simpler deployment, and this image is
for the case where you want it contained.
