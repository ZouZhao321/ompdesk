/**
 * 浏览器交互测试的 DOM 环境。
 *
 * Bun 没有内置 DOM，组件交互测试用 happy-dom 注册全局对象，渲染用 react-dom/client
 * 的 createRoot 配合 flushSync 同步出结果。每个用例都必须成对调用 installDom 与它返回
 * 的还原函数，避免全局状态影响同进程的其他测试文件。
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** 注册 DOM 全局对象，返回还原函数。 */
export function installDom() {
  GlobalRegistrator.register({ url: "http://localhost:30141" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return async () => {
    // React 的并发调度可能排在下一个任务里；先让它跑完再移除全局对象，
    // 否则卸载后的提交会读到不存在的 window。
    await new Promise((resolve) => setTimeout(resolve, 30));
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    await GlobalRegistrator.unregister();
  };
}

/**
 * 把组件同步渲染进一个挂到 body 上的容器。
 *
 * wrapper 用包住组件，例如 i18n Provider。rerender 使用同一个 root。
 */
export function mount(Component, props = {}, wrapper) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const element = (nextProps) =>
    wrapper ? createElement(wrapper, null, createElement(Component, nextProps)) : createElement(Component, nextProps);

  const render = (nextProps) => {
    flushSync(() => {
      root.render(element(nextProps));
    });
  };

  render(props);

  return {
    container,
    root,
    rerender: render,
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** 在元素上派发一次冒泡事件，返回事件对象。 */
export function dispatch(element, type, init = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}
