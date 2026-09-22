export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);

  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(?<![a-zA-Z0-9_])_([^_]+)_(?![a-zA-Z0-9_])/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) {
    return false;
  }

  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

export function tableAlignment(cell: string | undefined): string {
  if (!cell) {
    return "";
  }

  const left = cell.startsWith(":");
  const right = cell.endsWith(":");

  if (left && right) {
    return ' style="text-align:center"';
  }
  if (right) {
    return ' style="text-align:right"';
  }
  if (left) {
    return ' style="text-align:left"';
  }
  return "";
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }

    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      closeLists();
      closeBlockquote();

      if (!inCodeBlock) {
        codeLang = line.slice(3).trim();
        html.push(`<pre><code${codeLang ? ` class=\"language-${escapeHtml(codeLang)}\"` : ""}>`);
        inCodeBlock = true;
      } else {
        html.push("</code></pre>");
        inCodeBlock = false;
        codeLang = "";
      }
      index += 1;
      continue;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      index += 1;
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeLists();
      closeBlockquote();
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparatorRow(lines[index + 1])) {
      closeLists();
      closeBlockquote();

      const headerCells = splitTableRow(line);
      const alignCells = splitTableRow(lines[index + 1]);

      html.push("<table>");
      html.push(
        `<thead><tr>${headerCells
          .map((cell, cellIndex) => `<th${tableAlignment(alignCells[cellIndex])}>${applyInlineMarkdown(cell)}</th>`)
          .join("")}</tr></thead>`,
      );

      index += 2;

      const bodyRows: string[] = [];
      while (index < lines.length && lines[index].includes("|") && !/^\s*$/.test(lines[index])) {
        bodyRows.push(lines[index]);
        index += 1;
      }

      if (bodyRows.length > 0) {
        html.push("<tbody>");
        for (const row of bodyRows) {
          const cells = splitTableRow(row);
          html.push(
            `<tr>${cells
              .map((cell, cellIndex) => `<td${tableAlignment(alignCells[cellIndex])}>${applyInlineMarkdown(cell)}</td>`)
              .join("")}</tr>`,
          );
        }
        html.push("</tbody>");
      }

      html.push("</table>");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeLists();
      closeBlockquote();
      const level = heading[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeLists();
      closeBlockquote();
      html.push("<hr />");
      index += 1;
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      closeLists();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      html.push(`<p>${applyInlineMarkdown(blockquote[1])}</p>`);
      index += 1;
      continue;
    }

    closeBlockquote();

    const unorderedItem = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedItem) {
      if (!inUl) {
        closeLists();
        html.push("<ul>");
        inUl = true;
      }

      const taskMatch = unorderedItem[1].match(/^\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === "x";
        html.push(
          `<li class="taskItem"><input type="checkbox" disabled ${checked ? "checked" : ""} />${applyInlineMarkdown(taskMatch[2])}</li>`,
        );
      } else {
        html.push(`<li>${applyInlineMarkdown(unorderedItem[1])}</li>`);
      }
      index += 1;
      continue;
    }

    const orderedItem = line.match(/^\d+\.\s+(.*)$/);
    if (orderedItem) {
      if (!inOl) {
        closeLists();
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${applyInlineMarkdown(orderedItem[1])}</li>`);
      index += 1;
      continue;
    }

    closeLists();
    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
    index += 1;
  }

  closeLists();
  closeBlockquote();

  if (inCodeBlock) {
    html.push("</code></pre>");
  }

  return html.join("\n");
}
