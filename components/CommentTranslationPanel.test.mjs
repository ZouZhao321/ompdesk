import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { CommentTranslationPanel } = await jiti.import("./CommentTranslationPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: "en" },
      React.createElement(CommentTranslationPanel, { active: true, ...props }),
    ),
  );
}

test("asks for a project directory before listing anything", () => {
  assert.match(render({ cwd: undefined }), /No project directory selected/);
});

test("generation stays disabled while nothing is checked", () => {
  const html = render({ cwd: "/project" });
  assert.match(html, /Select all on page/);
  assert.match(html, /0 selected/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Generate \(0\)<\/button>/);
});
