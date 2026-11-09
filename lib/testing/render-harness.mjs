import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageView } from "../../components/MessageView.tsx";
import { I18nProvider } from "../../hooks/useI18n";

// 服务端渲染会走组件真实的渲染路径（hooks、markdown、语法高亮），不需要 DOM，
// 这样抛错或消息消失会在这里暴露，而不是在浏览器里。
export function renderMessage(message, props = {}) {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(MessageView, { ...props, message })));
}

// 语法高亮把 token 包进 <span>，所以针对可见文本的断言先去掉标签。
export function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}
