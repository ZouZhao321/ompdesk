# Security policy

ompdesk drives a coding agent that can read and write files, run commands, and
spend provider credits. The security boundary is the machine running the server
and, when enabled, the password lock in front of it.

## Supported versions

The latest `1.x` release receives security fixes. Older releases should be
upgraded; fixes are not backported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

<https://github.com/ZouZhao321/ompdesk/security/advisories/new>

Do not open a public issue for a vulnerability. Include the ompdesk version,
the operating system, reproduction steps, and the impact you observed. A proof
of concept helps; real credentials and personal data do not.

There is no bug bounty. Reports are handled on a best-effort basis, and the fix
is released before the advisory is published.

## In scope

- Authentication or password-recovery bypass.
- Cross-site request forgery, clickjacking, or host-header bypass that reaches
  an authenticated action.
- File reads or writes outside the allowed roots, including path traversal and
  symbolic-link escapes.
- Command injection through worktree, skill, plugin, Git, or file operations.
- Script execution through Markdown, Mermaid, HTML, DOCX, PDF, or image
  previews.
- Server-side request forgery that reaches an internal service without an
  authenticated operator asking for it.
- Exposure of credentials, session content, or logs across users or sessions.

## Out of scope

- Attacks that require a shell on the host, administrator rights, or a
  compromised operating system account.
- Code execution or file access caused by a project the operator explicitly
  trusted in the trust dialog.
- Tool calls, commands, or content produced by a model or provider that the
  operator approved. ompdesk is a workspace for a high-privilege agent; running
  it is the decision to let that agent act.
- Missing HTTPS, an exposed port, or a weak password chosen by the operator.
  The server binds to loopback by default; remote access belongs behind a
  trusted tunnel or reverse proxy.
- Vulnerabilities in `omp` itself or in upstream dependencies. Report those to
  their maintainers; ompdesk will pick up the fix when it updates the package.

## Deployment expectations

Keep the default loopback binding. If access leaves the machine, use a trusted
VPN or a TLS reverse proxy and turn on the password lock. The password protects
against a port scanner; it does not encrypt traffic. See
[docs/deployment.md](./docs/deployment.md) and
[docs/authentication.md](./docs/authentication.md).
