#!/usr/bin/env python3
"""阻止直接推送 main：main 只接受经 PR 的合并。"""

import sys

PROTECTED = "refs/heads/main"


def main() -> int:
    blocked = []
    for line in sys.stdin:
        parts = line.split()
        if len(parts) < 4:
            continue
        _local_ref, _local_sha, remote_ref, _remote_sha = parts[:4]
        if remote_ref == PROTECTED:
            blocked.append(remote_ref)
    if blocked:
        print("main 只接受合并，禁止直接推送。请开分支并走 pull request。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
