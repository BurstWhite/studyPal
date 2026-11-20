/** Splits Markdown into the blocks `Markdown` renders. */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; rows: string[][] };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2]!,
      });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const current = lines[i]!;
        if (bullet.test(current)) items.push(current.replace(bullet, ""));
        else if (items.length > 0)
          items[items.length - 1] += ` ${current.trim()}`;
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split("|");
        // Skip the |---|---| separator row.
        if (!cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell)))
          rows.push(cells.map((cell) => cell.trim()));
        i++;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!)
    ) {
      body.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }
  return blocks;
}
