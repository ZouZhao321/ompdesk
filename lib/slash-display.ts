/**
 * 技能指令在会话里的两种落盘形式：
 *
 * - `skill-prompt` 自定义消息，正文是 `<skill>` 信封，`details` 记用户敲的指令；
 * - 旧会话里由命令行客户端展开的 `<skill>` 信封，直接存在用户消息正文里。
 *
 * 两者都要还原成 `/skill:<名> <参数>` 再显示。
 */
const SKILL_EXPANSION_RE =
	/^<skill name="([^"\n]+)" location="([^"\n]+)">\nReferences are relative to [^\n]+\.\n\n([\s\S]*)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Restore a complete SDK skill expansion to its compact command form.
 *
 * The expression intentionally requires the opening envelope, matching
 * base-directory reference, final closing tag, and an optional two-newline args
 * suffix. This avoids collapsing ordinary text that merely starts with a
 * skill-looking tag. The greedy body capture makes the final closing tag win
 * when a skill body contains an example `</skill>` tag.
 */
export function skillExpansionToCommand(text: string): string | null {
	const match = text.match(SKILL_EXPANSION_RE);
	if (!match) return null;

	const [, name, , , args] = match;
	return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

/** `/skill-prompt` 消息的类型标签，与 SDK 的 `SKILL_PROMPT_MESSAGE_TYPE` 同值。 */
const SKILL_PROMPT_MESSAGE_TYPE = "skill-prompt";

/** The `SkillPromptDetails` fields that identify what the user asked for. */
export interface SkillPromptDetailsLike {
	name?: string;
	args?: string;
	/** The draft as submitted, `/skill:<name>` token in place. */
	prompt?: string;
}

/**
 * 用户手动调用的技能指令。
 *
 * SDK 用同一个 `skill-prompt` 类型记录自动加载的技能（`attribution: "agent"`、
 * `display: false`），只有 `attribution === "user"` 的那条是用户发起的回合。
 */
export function isUserSkillPrompt(message: { customType?: string; attribution?: string }): boolean {
	return message.customType === SKILL_PROMPT_MESSAGE_TYPE && message.attribution === "user";
}

/**
 * Compact command label for a stored `skill-prompt` custom message.
 *
 * The transcript row, session title, and list preview all show the command the
 * user typed rather than the skill body wrapped around it.
 */
export function skillPromptCommandLabel(details: SkillPromptDetailsLike | undefined): string {
	if (details?.prompt) return details.prompt;
	if (!details?.name) return "/skill";
	const args = details.args?.trim();
	return args ? `/skill:${details.name} ${args}` : `/skill:${details.name}`;
}
