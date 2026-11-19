/**
 * 文件树交互测试的共用装置：把目录列表请求换成可编排的响应，并把组件挂进
 * `test-support/dom-harness.mjs` 提供的 DOM 环境。
 *
 * 这里只做测试夹具，不实现任何界面行为；断言留在各自的用例文件里。
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { mount } from "./dom-harness.mjs";

/** 目录列表请求的响应替身；只实现组件真正读取的三个成员。 */
export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 从请求地址里取出被列出的目录，供按目录编排结果。 */
export function listedDir(url) {
  const [pathname] = url.split("?");
  return `/${decodeURIComponent(pathname.slice("/api/files/".length))}`;
}

/**
 * 安装 fetch 替身。
 *
 * `plan` 以目录绝对路径为键，值是响应、响应数组或 `"throw"`：数组按调用次数依次取用，
 * 用完之后一直用最后一个，这样「先失败、后成功」的重试过程可以编排出来。Git 状态请求
 * 返回非仓库结果，不参与断言。
 *
 * @returns 请求记录与还原函数
 */
export function stubFetch(plan) {
  const previous = globalThis.fetch;
  const calls = [];
  const taken = new Map();
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/git/status")) return jsonResponse(200, { isGitRepository: false, files: [] });
    const dir = listedDir(url);
    const entry = plan[dir];
    if (entry === undefined) return jsonResponse(200, { entries: [] });
    const sequence = Array.isArray(entry) ? entry : [entry];
    const index = Math.min(taken.get(dir) ?? 0, sequence.length - 1);
    taken.set(dir, (taken.get(dir) ?? 0) + 1);
    const outcome = sequence[index];
    if (outcome === "throw") throw new TypeError("Failed to fetch");
    return jsonResponse(outcome.status, outcome.body);
  };
  return {
    calls,
    callsFor: (dir) => calls.filter((url) => listedDir(url) === dir).length,
    restore: () => (globalThis.fetch = previous),
  };
}

/** React 的状态更新与请求回调都排在任务队列里，等几拍再同步刷新，断言才看得到落地结果。 */
export async function settle(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

/**
 * 把文件树挂进 DOM，并装好 fetch 替身。
 *
 * @param FileExplorer 文件树组件
 * @param I18nProvider 语言包 Provider
 * @param props 组件 props
 * @param plan 目录响应编排，见 `stubFetch`
 * @param locale 界面语言
 */
export async function mountExplorer(FileExplorer, I18nProvider, props, { plan = {}, locale = "en" } = {}) {
  globalThis.localStorage.setItem("pi-locale", locale);
  const stub = stubFetch(plan);
  const wrapper = ({ children }) => createElement(I18nProvider, { initialLocale: locale }, children);
  const view = mount(FileExplorer, props, wrapper);
  await settle();
  return { ...view, stub };
}

/** 按可见名称找到目录行。名称在行内的 span 上，点击事件挂在它的父节点。 */
export function rowByName(container, name) {
  const label = [...container.querySelectorAll("span")].find((node) => node.textContent === name);
  return label?.parentElement;
}

/** 点开（或重试）一个目录，并等界面稳定。 */
export async function clickRow(container, name) {
  const row = rowByName(container, name);
  if (!row) throw new Error(`expected a row named ${name}`);
  flushSync(() => row.click());
  await settle();
  return row;
}

/** 当前面板里所有失败提示的文字。 */
export function alerts(container) {
  return [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
}
