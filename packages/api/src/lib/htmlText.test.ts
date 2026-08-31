import { describe, it, expect } from "vitest";
import {
  extractText,
  normalizeText,
  truncateUtf8,
  MAX_TEXT_BYTES,
} from "./htmlText.js";

describe("extractText", () => {
  it("pulls the title and meta description", () => {
    const result = extractText(
      `<html><head><title>Monthly Report</title>` +
        `<meta name="description" content="Sales for August"></head>` +
        `<body><p>Body</p></body></html>`,
    );
    expect(result.title).toBe("Monthly Report");
    expect(result.description).toBe("Sales for August");
  });

  it("reads a description with the attributes in reverse order", () => {
    const result = extractText(
      `<meta content="Reversed order" name="description">`,
    );
    expect(result.description).toBe("Reversed order");
  });

  it("returns empty strings when title and description are absent", () => {
    const result = extractText("<p>No head at all</p>");
    expect(result.title).toBe("");
    expect(result.description).toBe("");
  });

  it("drops script contents so code is not searchable", () => {
    const result = extractText(
      `<body><p>visible</p><script>const secret = "notsearchable";</script></body>`,
    );
    expect(result.text).toContain("visible");
    expect(result.text).not.toContain("notsearchable");
  });

  it("drops style, svg, template and noscript contents", () => {
    const result = extractText(
      `<style>.a{color:red}</style>` +
        `<svg><title>icontitle</title></svg>` +
        `<template>templated</template>` +
        `<noscript>noscripted</noscript>` +
        `<p>kept</p>`,
    );
    expect(result.text).toBe("kept");
  });

  it("drops comments", () => {
    const result = extractText("<p>kept</p><!-- commented out -->");
    expect(result.text).not.toContain("commented");
  });

  it("does not glue words together across tag boundaries", () => {
    const result = extractText("<table><tr><td>foo</td><td>bar</td></tr></table>");
    expect(result.text).not.toContain("foobar");
    expect(result.text).toContain("foo");
    expect(result.text).toContain("bar");
  });

  it("separates paragraphs with a blank line", () => {
    // チャンク分割が段落境界を優先できるよう、\n\n を残す。
    const result = extractText("<p>first</p><p>second</p>");
    expect(result.text).toBe("first\n\nsecond");
  });

  it("turns a line break element into a single newline", () => {
    expect(extractText("first<br>second").text).toBe("first\nsecond");
  });

  it("keeps head content out of the body text", () => {
    // title / description は別フィールドで持つので、本文に混ぜると二重に数えてしまう。
    const result = extractText(
      "<html><head><title>Report</title></head><body><p>body</p></body></html>",
    );
    expect(result.title).toBe("Report");
    expect(result.text).toBe("body");
  });

  it("decodes named and numeric entities", () => {
    const result = extractText("<p>&lt;tag&gt; &amp; &#65; &#x42; &yen;100</p>");
    expect(result.text).toBe("<tag> & A B ¥100");
  });

  it("leaves unknown entities alone", () => {
    const result = extractText("<p>&nosuchentity;</p>");
    expect(result.text).toBe("&nosuchentity;");
  });

  it("keeps Japanese text intact", () => {
    const result = extractText(
      "<html><head><title>月次レポート</title></head><body><p>売上は前月比で増加した。</p></body></html>",
    );
    expect(result.title).toBe("月次レポート");
    expect(result.text).toBe("売上は前月比で増加した。");
  });

  it("does not report truncation for ordinary documents", () => {
    expect(extractText("<p>short</p>").truncated).toBe(false);
  });

  it("truncates very large documents", () => {
    const huge = `<p>${"あ".repeat(MAX_TEXT_BYTES)}</p>`;
    const result = extractText(huge);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(
      MAX_TEXT_BYTES,
    );
  });
});

describe("normalizeText", () => {
  it("folds full-width latin to half-width via NFKC", () => {
    expect(normalizeText("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("folds half-width katakana to full-width via NFKC", () => {
    expect(normalizeText("ﾚﾎﾟｰﾄ")).toBe("レポート");
  });

  it("collapses runs of spaces and tabs", () => {
    expect(normalizeText("a  \t  b")).toBe("a b");
  });

  it("collapses three or more newlines into a blank line", () => {
    expect(normalizeText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("normalizes CRLF", () => {
    expect(normalizeText("a\r\nb")).toBe("a\nb");
  });
});

describe("truncateUtf8", () => {
  it("returns the input untouched when it fits", () => {
    expect(truncateUtf8("hello", 100)).toEqual({
      text: "hello",
      truncated: false,
    });
  });

  it("cuts on a code point boundary for multibyte text", () => {
    // 「あ」は UTF-8 で3バイト。7バイト上限なら2文字までしか入らない。
    const result = truncateUtf8("あああ", 7);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("ああ");
  });

  it("does not split a surrogate pair", () => {
    // 絵文字は UTF-8 で4バイト、UTF-16 では2コード単位。
    const result = truncateUtf8("😀😀", 6);
    expect(result.text).toBe("😀");
    expect(result.text).not.toContain("�");
  });
});
