import type { ReactNode } from "react";

/**
 * Shows model-written text with headings, bold, and lists. Everything is
 * rendered as text nodes, so nothing a model or a web page wrote can run.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*\n]+\*\*$/.test(part)) {
      out.push(<strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>);
    } else {
      out.push(part);
    }
  });
  return out;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "para"; lines: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", lines: para });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="board-prose-rich">
      {parse(text.trim()).map((block, i) => {
        if (block.kind === "heading") {
          return (
            <p key={i} className={`board-prose-heading is-h${Math.min(block.level, 3)}`}>
              {inline(block.text, `h${i}`)}
            </p>
          );
        }
        if (block.kind === "list") {
          const items = block.items.map((item, j) => <li key={j}>{inline(item, `l${i}-${j}`)}</li>);
          return block.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {inline(line, `p${i}-${j}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
