/** 日志面板的简体中文文案。 */
export const chromeLogs: Record<string, string> = {
	"settings.logs.title": "日志",
	"settings.logs.description":
		"当前服务进程的日志文件，直接来自 omp 的滚动日志。只读；提示词、补全、工具参数、文件内容和凭据都不会写入这里。",
	"settings.logs.download": "下载",

	"settings.logs.level": "级别",
	"settings.logs.levelAria": "日志级别",
	"settings.logs.keyword": "关键词",
	"settings.logs.keywordPlaceholder": "按文本过滤",
	"settings.logs.keywordAria": "日志关键词",
	"settings.logs.file": "文件",
	"settings.logs.fileAria": "日志文件",
	"settings.logs.noFileYet": "暂无文件",
	"settings.logs.currentFile": "当前文件",
	"settings.logs.rotation": "轮转",

	"settings.logs.level.all": "全部级别",
	"settings.logs.level.error": "ERROR 及以上",
	"settings.logs.level.warn": "WARN 及以上",
	"settings.logs.level.info": "INFO 及以上",
	"settings.logs.level.debug": "DEBUG",

	"settings.logs.following": "正在跟随",
	"settings.logs.followLatest": "跟随最新",
	"settings.logs.resume": "继续",
	"settings.logs.pause": "暂停",
	"settings.logs.refreshing": "正在刷新…",
	"settings.logs.refresh": "刷新",

	"settings.logs.lastWrite": "最后写入 {time}",
	"settings.logs.active": "当前",
	"settings.logs.noFileSelected": "未选择文件",
	"settings.logs.pollingPaused": "轮询已暂停",

	"settings.logs.state.loading.title": "正在加载日志…",
	"settings.logs.state.loading.detail": "正在读取当前进程日志。",
	"settings.logs.state.error.title": "无法加载日志",
	"settings.logs.state.no-files.title": "还没有日志文件",
	"settings.logs.state.no-files.detail":
		"ompdesk 会在写入第一条记录时创建当前进程的日志文件。发送一条消息或重试一次请求，然后刷新。",
	"settings.logs.state.catching-up.title": "正在追赶…",
	"settings.logs.state.catching-up.detail": "日志文件超过一页，正在读取积压内容后再显示匹配项。",
	"settings.logs.state.no-matches.title": "没有匹配的条目",
	"settings.logs.state.no-matches.detail":
		"这里只读取该文件的最新部分；可以试试更宽的级别、其它关键词，或更早的轮转文件。",
	"settings.logs.state.empty.title": "该日志文件为空",
	"settings.logs.state.empty.detail": "还没有向它写入任何条目。",
	"settings.logs.invalidResponse": "日志响应不是有效的 JSON",
	"settings.logs.timeout": "读取日志超时，请重试。",
};
