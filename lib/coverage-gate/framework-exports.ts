/**
 * 框架按文件名或路径调用的导出。
 *
 * Next.js 与仓库根的配置加载器直接读文件，不产生 import 语句：路由方法、页面与布局的
 * 默认导出、元数据路由、配置文件的默认导出、命令行入口。这些导出没有生产引用是正常的，
 * 规则三跳过它们，生成基线时也跳过，避免把框架约定写进存量清单。
 */

import type { ExportedSymbol } from "./exports";

/** 路由文件里由框架按方法名调用的导出。 */
const ROUTE_METHODS: Record<string, true> = {
  GET: true,
  POST: true,
  PATCH: true,
  DELETE: true,
  PUT: true,
  HEAD: true,
  OPTIONS: true,
};

/** 路由文件里的段配置，Next.js 直接读取，同样没有 import 语句。 */
const ROUTE_SEGMENT_CONFIG: Record<string, true> = {
  dynamic: true,
  revalidate: true,
  runtime: true,
  preferredRegion: true,
  maxDuration: true,
  fetchCache: true,
};

/** `app/` 下的约定文件：默认导出与路由段配置由框架按文件名读取。 */
const APP_PAGE_FILES: Record<string, true> = {
  page: true,
  layout: true,
  template: true,
  loading: true,
  error: true,
  "not-found": true,
  "global-error": true,
};

const APP_PAGE_EXPORTS: Record<string, true> = {
  default: true,
  metadata: true,
  generateMetadata: true,
  viewport: true,
  generateViewport: true,
  generateStaticParams: true,
  dynamicParams: true,
  ...ROUTE_SEGMENT_CONFIG,
};

/** `app/` 下的元数据路由文件，默认导出由框架调用。 */
const APP_METADATA_FILES: Record<string, true> = {
  manifest: true,
  robots: true,
  sitemap: true,
  icon: true,
  "apple-icon": true,
  "opengraph-image": true,
  "twitter-image": true,
};

/** 仓库根的工具配置，默认导出由加载器读取。 */
const CONFIG_FILES: Record<string, true> = {
  "next.config": true,
  "tailwind.config": true,
  "postcss.config": true,
  "eslint.config": true,
};

/** 去掉目录与最后一节扩展名：`app/x/page.tsx` → `page`，`next.config.ts` → `next.config`。 */
function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

/** 框架按文件名或路径调用、不需要 import 的导出。 */
export function isFrameworkExport(file: string, symbol: ExportedSymbol): boolean {
  if (file.startsWith("bin/")) return true;

  const name = baseName(file);
  if (name === "route") {
    return ROUTE_METHODS[symbol.name] === true || ROUTE_SEGMENT_CONFIG[symbol.name] === true;
  }
  if (name === "instrumentation") return symbol.name === "register" || symbol.name === "onRequestError";
  if (name === "proxy") {
    return symbol.name === "default" || symbol.name === "proxy" || symbol.name === "config";
  }
  if (file.startsWith("app/")) {
    if (APP_METADATA_FILES[name] === true && symbol.name === "default") return true;
    if (APP_PAGE_FILES[name] === true && APP_PAGE_EXPORTS[symbol.name] === true) return true;
  }
  if (symbol.name !== "default") return false;
  return CONFIG_FILES[name] === true;
}
