/** 日志面板的英文文案。 */
export const chromeLogs: Record<string, string> = {
	"settings.logs.title": "Logs",
	"settings.logs.description":
		"The current server process's log file, straight from omp's rotating log. Read-only; prompts, completions, tool arguments, file contents, and credentials are never written here.",
	"settings.logs.download": "Download",

	"settings.logs.level": "Level",
	"settings.logs.levelAria": "Log level",
	"settings.logs.keyword": "Keyword",
	"settings.logs.keywordPlaceholder": "Filter by text",
	"settings.logs.keywordAria": "Log keyword",
	"settings.logs.file": "File",
	"settings.logs.fileAria": "Log file",
	"settings.logs.noFileYet": "No file yet",
	"settings.logs.currentFile": "current file",
	"settings.logs.rotation": "rotation",

	"settings.logs.level.all": "All levels",
	"settings.logs.level.error": "Error and above",
	"settings.logs.level.warn": "Warn and above",
	"settings.logs.level.info": "Info and above",
	"settings.logs.level.debug": "Debug",

	"settings.logs.following": "Following",
	"settings.logs.followLatest": "Follow latest",
	"settings.logs.resume": "Resume",
	"settings.logs.pause": "Pause",
	"settings.logs.refreshing": "Refreshing…",
	"settings.logs.refresh": "Refresh",

	"settings.logs.lastWrite": "Last write {time}",
	"settings.logs.active": "active",
	"settings.logs.noFileSelected": "No file selected",
	"settings.logs.pollingPaused": "Polling paused",

	"settings.logs.state.loading.title": "Loading logs…",
	"settings.logs.state.loading.detail": "Reading the current process log.",
	"settings.logs.state.error.title": "Could not load logs",
	"settings.logs.state.no-files.title": "No log file yet",
	"settings.logs.state.no-files.detail":
		"ompdesk creates this process's log file with its first record. Send a message or retry a request, then refresh.",
	"settings.logs.state.catching-up.title": "Catching up…",
	"settings.logs.state.catching-up.detail":
		"The log file is longer than one page; reading the backlog before showing matches.",
	"settings.logs.state.no-matches.title": "No matching entries",
	"settings.logs.state.no-matches.detail":
		"Only the newest part of this file is read; try a broader level, another keyword, or an older rotation.",
	"settings.logs.state.empty.title": "This log file is empty",
	"settings.logs.state.empty.detail": "No entries have been written to it yet.",
	"settings.logs.invalidResponse": "The logs response was not valid JSON",
	"settings.logs.timeout": "Reading logs timed out; try again.",
};
