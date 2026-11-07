import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses omp's own skill discovery (the same `loadSkills` AgentSession startup
// runs), so `.omp/skills`, `~/.omp/agent/skills`, `.claude/skills`, plugin
// skills, and `.agents/skills` are all included with identical precedence.
export const GET = withRequestLog("/api/skills", getRouteHandler);

async function getRouteHandler(req: Request) {
	if (!isApiRequestAllowed(req)) {
		return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
	}

	const { searchParams } = new URL(req.url);
	const cwd = searchParams.get("cwd");
	if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

	try {
		const allowedRoots = await getAllowedFileRoots();
		if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}
		return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
	} catch {
		return NextResponse.json({ error: "Unable to load skills" }, { status: 500 });
	}
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file
export const PATCH = withRequestLog("/api/skills", async (req: Request) => {
	if (!isApiRequestAllowed(req)) {
		return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
	}
	if (!hasJsonContentType(req)) {
		return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
	}

	let filePath = "";
	let disableModelInvocation: unknown;
	let resolvedFilePath: string | undefined;
	try {
		const body = (await req.json()) as { filePath?: unknown; disableModelInvocation?: unknown };
		filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
		disableModelInvocation = body.disableModelInvocation;
		if (!filePath) {
			auditFailure("skill.toggle", undefined, { status: 400, reason: "filePath-required" });
			return NextResponse.json({ error: "filePath required" }, { status: 400 });
		}
		if (typeof disableModelInvocation !== "boolean") {
			auditFailure("skill.toggle", filePath, { status: 400, reason: "invalid-flag" });
			return NextResponse.json({ error: "disableModelInvocation must be boolean" }, { status: 400 });
		}
		if (path.basename(filePath).toLowerCase() !== "skill.md") {
			auditFailure("skill.toggle", filePath, { status: 400, reason: "not-skill-md" });
			return NextResponse.json({ error: "Only SKILL.md files can be changed" }, { status: 400 });
		}

		try {
			resolvedFilePath = realpathSync(filePath);
		} catch {
			auditFailure("skill.toggle", filePath, { status: 404, reason: "file-not-found" });
			return NextResponse.json({ error: "file not found" }, { status: 404 });
		}
		if (path.basename(resolvedFilePath).toLowerCase() !== "skill.md") {
			auditFailure("skill.toggle", resolvedFilePath, { status: 400, reason: "not-skill-md" });
			return NextResponse.json({ error: "Only SKILL.md files can be changed" }, { status: 400 });
		}
		if (!statSync(resolvedFilePath).isFile()) {
			auditFailure("skill.toggle", resolvedFilePath, { status: 400, reason: "not-a-file" });
			return NextResponse.json({ error: "file must be a regular file" }, { status: 400 });
		}

		const allowedRoots = new Set(await getAllowedFileRoots());
		allowedRoots.add(getAgentDir());
		// Globally installed skills live in ~/.agents/skills and are symlinked into
		// the agent's skills dir; isExistingFilePathAllowed resolves the symlink, so
		// the real target sits outside getAgentDir(). Allow the global skills root
		// too (the SDK always treats ~/.agents/skills as trusted).
		const globalSkillsDir = path.join(homedir(), ".agents", "skills");
		if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
		if (!isExistingFilePathAllowed(resolvedFilePath, allowedRoots)) {
			auditFailure("skill.toggle", resolvedFilePath, { status: 403, reason: "access-denied" });
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}

		const content = readFileSync(resolvedFilePath, "utf8");
		const key = "disable-model-invocation";

		// Use parseFrontmatter to check current value, then do a surgical line edit
		// to preserve the original YAML formatting of all other fields.
		const { frontmatter } = parseFrontmatter(content);
		const alreadySet = Boolean(frontmatter[key]);

		let updated = content;
		if (disableModelInvocation && !alreadySet) {
			// Add key after the opening --- line
			updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
			// If no frontmatter exists, create one
			if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
		} else if (!disableModelInvocation && alreadySet) {
			// Remove the key line entirely
			updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
		}

		writeFileSync(resolvedFilePath, updated, "utf8");
		auditSuccess("skill.toggle", resolvedFilePath, {
			disabledModelInvocation: disableModelInvocation,
		});
		return NextResponse.json({ success: true });
	} catch (error) {
		auditFailure("skill.toggle", resolvedFilePath ?? (filePath || undefined), {
			status: 500,
			error,
		});
		return NextResponse.json({ error: "Unable to update skill metadata" }, { status: 500 });
	}
});
