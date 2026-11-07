import fs from "fs";
import path from "path";
import { isCommentSourceFile, isSkippedCommentSourceDir, type CommentSourceFile } from "./comment-entries";
import { listGitFiles } from "./git-listing";

/**
 * 列出参与词条提取的文件，路径相对 root。
 * git 仓库以 .gitignore 为准，被忽略的备份、产物与临时目录不进结果；
 * 非仓库退回目录遍历。两条路径都只保留 .ts 与 .tsx。
 */
export async function listCommentSourcePaths(root: string): Promise<string[]> {
	const gitFiles = await listGitFiles(root);
	const candidates = gitFiles ?? walkCommentSourcePaths(root);
	return candidates.filter(isCommentSourceFile);
}

/** 目录遍历兜底：跳过依赖、产物、工作副本与临时目录。 */
export function walkCommentSourcePaths(root: string): string[] {
	const paths: string[] = [];
	const walk = (absoluteDir: string, relativeDir: string) => {
		for (const dirent of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
			const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				if (!isSkippedCommentSourceDir(dirent.name)) {
					walk(path.join(absoluteDir, dirent.name), relativePath);
				}
				continue;
			}
			if (dirent.isFile() && isCommentSourceFile(relativePath)) {
				paths.push(relativePath);
			}
		}
	};
	walk(root, "");
	return paths;
}

/** 读取词条来源文件的内容；词条提取本身仍是纯函数。 */
export async function readCommentSourceFiles(root: string): Promise<CommentSourceFile[]> {
	const paths = await listCommentSourcePaths(root);
	return paths.map((relativePath) => ({
		path: relativePath,
		content: fs.readFileSync(path.join(root, relativePath), "utf8"),
	}));
}
