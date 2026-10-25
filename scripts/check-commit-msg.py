import re
import sys

ALLOWED_TYPES = ("feat", "fix", "refactor", "test", "docs", "chore", "perf")
SKIP_PREFIXES = ("Merge ", "Revert ", "fixup! ", "squash! ", "amend! ")
SUBJECT_PATTERN = re.compile(r"^(?P<type>[a-z]+)(?P<scope>\([^()\s]+\))?: (?P<description>.+)$")
MAX_SUBJECT_LENGTH = 72


def read_subject(path):
    with open(path, encoding="utf-8") as message_file:
        for line in message_file:
            stripped = line.rstrip("\r\n")
            if stripped.strip():
                return stripped
    return ""


def validate(subject):
    if not subject:
        return "提交标题为空"
    if any(subject.startswith(prefix) for prefix in SKIP_PREFIXES):
        return None
    match = SUBJECT_PATTERN.match(subject)
    if match is None:
        return "提交标题须写成 `type(scope): 描述`，例如 `fix(chat-input): 手机档流式按钮补齐 44px 命中区`"
    commit_type = match.group("type")
    if commit_type not in ALLOWED_TYPES:
        return f"type `{commit_type}` 不在允许范围内，允许：{'、'.join(ALLOWED_TYPES)}"
    description = match.group("description")
    if description.endswith((".", "。")):
        return "描述结尾不要加句号"
    if len(subject) > MAX_SUBJECT_LENGTH:
        return f"标题 {len(subject)} 个字符，超过上限 {MAX_SUBJECT_LENGTH}"
    return None


def main():
    if len(sys.argv) != 2:
        print("用法：python scripts/check-commit-msg.py <提交信息文件>", file=sys.stderr)
        return 2
    subject = read_subject(sys.argv[1])
    error = validate(subject)
    if error is None:
        return 0
    print(f"提交标题不合规：{error}", file=sys.stderr)
    print("格式说明见 AGENTS.md 第三章。", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
