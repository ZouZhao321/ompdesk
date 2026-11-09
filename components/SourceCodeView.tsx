"use client";

import { Fragment, memo, type CSSProperties } from "react";
import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";

/** 源码与译文行共用的字号与行高。 */
export const SOURCE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 1.6,
};

export const SOURCE_LINE_NUMBER_STYLE: CSSProperties = {
  width: 48,
  minWidth: 48,
  padding: "0 10px",
  textAlign: "right",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
  firstLineNumber: number;
  translations: ReadonlyMap<number, string> | null;
  translationLabel: string;
  isDark: boolean;
};

function TranslationRow({
  text,
  label,
  wrapLines,
  isDark,
}: {
  text: string;
  label: string;
  wrapLines: boolean;
  isDark: boolean;
}) {
  return (
    // 译文行不参与 .file-source-line 选择器，也不带 data-line-number：
    // 它不属于任何源码行，选区到行号的映射与原文件保持一致。
    <span className="file-comment-translation" style={{ display: "flex", minWidth: "100%" }}>
      <span aria-hidden="true" className="file-comment-translation-gutter" style={SOURCE_LINE_NUMBER_STYLE} />
      <span
        className="file-comment-translation-content"
        style={{
          ...SOURCE_CODE_STYLE,
          // 注释色取自当前主题的 comment token，与正文注释完全一致。
          ...((isDark ? vscDarkPlus : vs).comment as CSSProperties),
          flex: "1 1 auto",
          minWidth: 0,
          padding: "0 10px 0 0",
          whiteSpace: wrapLines ? "pre-wrap" : "pre",
          overflowWrap: wrapLines ? "anywhere" : "normal",
          background: "color-mix(in srgb, currentColor 8%, transparent)",
        }}
      >
        {label && <span style={{ fontWeight: 600 }}>{label}</span>}
        {text}
      </span>
    </span>
  );
}

function SourceCodeRenderer({
  rows,
  stylesheet,
  useInlineStyles,
  wrapLines,
  firstLineNumber,
  translations,
  translationLabel,
  isDark,
}: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const lineNumber = firstLineNumber + lineIndex;
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber =
      Array.isArray(firstChildClasses) && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;
    const translation = translations?.get(lineNumber);

    return (
      <Fragment key={`source-line-${lineNumber}`}>
        <span className="file-source-line" data-line-number={lineNumber} style={{ display: "flex", minWidth: "100%" }}>
          {lineNumberNode &&
            renderSyntaxNode({
              node: lineNumberNode,
              stylesheet,
              useInlineStyles,
              key: `source-line-number-${lineNumber}`,
            })}
          <span
            className="file-source-line-content"
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              overflowWrap: wrapLines ? "anywhere" : "normal",
              whiteSpace: wrapLines ? "pre-wrap" : "pre",
            }}
          >
            {contentNodes.map((node, tokenIndex) =>
              renderSyntaxNode({
                node,
                stylesheet,
                useInlineStyles,
                key: `source-token-${lineNumber}-${tokenIndex}`,
              }),
            )}
          </span>
        </span>
        {translation !== undefined && (
          <TranslationRow text={translation} label={translationLabel} wrapLines={wrapLines} isDark={isDark} />
        )}
      </Fragment>
    );
  });
}

export interface SourceViewProps {
  content: string;
  language: string;
  wrapLines: boolean;
  isDark: boolean;
  /** 预览片段从第几行开始编号，源码查看器为 1。 */
  firstLineNumber?: number;
  /** 源码行号 → 译文；为空时显示与原文件完全一致。 */
  translations?: ReadonlyMap<number, string> | null;
  /** 译文行前缀，例如「翻译：」。 */
  translationLabel?: string;
}

/**
 * 源码渲染：查看器与面板预览共用这一份实现与样式，避免两处显示分叉。
 * 高亮结果按内容、主题与译文缓存，父级重渲染不再重新分词。
 */
export const SourceView = memo(function SourceView({
  content,
  language,
  wrapLines,
  isDark,
  firstLineNumber = 1,
  translations = null,
  translationLabel = "",
}: SourceViewProps) {
  return (
    <SyntaxHighlighter
      className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
      language={language === "text" ? "plaintext" : language}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      startingLineNumber={firstLineNumber}
      lineNumberStyle={{
        ...SOURCE_LINE_NUMBER_STYLE,
      }}
      customStyle={{
        margin: 0,
        padding: 0,
        border: 0,
        background: "var(--bg)",
        ...SOURCE_CODE_STYLE,
        width: wrapLines ? "100%" : "max-content",
        minWidth: "100%",
        minHeight: "100%",
        overflow: "visible",
      }}
      codeTagProps={{
        style: {
          fontFamily: "var(--font-mono)",
          overflowWrap: wrapLines ? "anywhere" : "normal",
        },
      }}
      renderer={(rendererProps) => (
        <SourceCodeRenderer
          {...rendererProps}
          wrapLines={wrapLines}
          firstLineNumber={firstLineNumber}
          translations={translations}
          translationLabel={translationLabel}
          isDark={isDark}
        />
      )}
      wrapLongLines={wrapLines}
    >
      {content}
    </SyntaxHighlighter>
  );
});
