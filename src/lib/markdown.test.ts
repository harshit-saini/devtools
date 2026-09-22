import { describe, expect, it } from "vitest";
import { applyInlineMarkdown, markdownToHtml } from "./markdown";

describe("applyInlineMarkdown", () => {
  it("does not italicize underscores inside identifiers", () => {
    expect(applyInlineMarkdown("user_id_field")).toBe("user_id_field");
  });

  it("still renders genuine underscore emphasis", () => {
    expect(applyInlineMarkdown("this is _italic_ text")).toBe("this is <em>italic</em> text");
  });

  it("renders strikethrough", () => {
    expect(applyInlineMarkdown("~~gone~~")).toBe("<del>gone</del>");
  });

  it("renders images before links so alt text isn't mistaken for link text", () => {
    expect(applyInlineMarkdown("![alt](https://example.com/x.png)")).toBe(
      '<img src="https://example.com/x.png" alt="alt" />',
    );
  });

  it("escapes HTML in the raw text before applying markdown", () => {
    expect(applyInlineMarkdown("<script>")).toBe("&lt;script&gt;");
  });
});

describe("markdownToHtml", () => {
  it("renders headings, paragraphs, and lists", () => {
    const html = markdownToHtml("# Title\n\nSome text\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Some text</p>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders task list checkboxes", () => {
    const html = markdownToHtml("- [x] done\n- [ ] pending");
    expect(html).toContain('<li class="taskItem"><input type="checkbox" disabled checked />done</li>');
    expect(html).toContain('<li class="taskItem"><input type="checkbox" disabled  />pending</li>');
  });

  it("renders a GFM table with header and body rows", () => {
    const html = markdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<th>B</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<td>2</td>");
  });

  it("keeps fenced code blocks verbatim, unescaped by inline rules", () => {
    const html = markdownToHtml("```js\nconst x = 1;\n```");
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain("const x = 1;");
  });
});
