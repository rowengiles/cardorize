import { type ReactNode } from "react";

// Minimal, dependency-free, XSS-safe Markdown renderer for LLM output.
// Renders to React elements (never dangerouslySetInnerHTML), handling the
// subset of Markdown that Claude actually emits: headings, bold, italic,
// inline code, code fences, blockquotes, ordered/unordered lists, links, rules.

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/;

function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyPrefix}${k++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = lm[2].trim();
      // Only allow http(s) links; anything else renders as plain text.
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>,
        );
      } else {
        out.push(lm[1]);
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  const isSpecial = (l: string) =>
    /^```/.test(l) ||
    /^#{1,6}\s/.test(l) ||
    /^\s*[-*+]\s+/.test(l) ||
    /^\s*\d+[.)]\s+/.test(l) ||
    /^>\s?/.test(l) ||
    /^\s*([-*_])\1\1+\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // consume closing fence
      blocks.push(
        <pre key={k++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading (shift down one level so an LLM's ## renders as an in-panel h3)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const tag = `h${Math.min(h[1].length + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
      const Tag = tag;
      blocks.push(<Tag key={k++}>{renderInline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      blocks.push(<hr key={k++} />);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++}>{renderInline(buf.join(" "), `q${k}`)}</blockquote>);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*+]\s+/, ""), `u${k}_${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={k++}>{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""), `o${k}_${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={k++}>{items}</ol>);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: gather consecutive plain lines
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isSpecial(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={k++}>{renderInline(buf.join(" "), `p${k}`)}</p>);
  }

  return <div className="markdown">{blocks}</div>;
}
