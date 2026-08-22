export type AgentMessageBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'label'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'rule' };

function listMatch(line: string) {
  const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
  if (unordered) return { ordered: false, text: unordered[1] };
  const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, text: ordered[1] };
  return null;
}

function isBlockStart(line: string) {
  const text = line.trim();
  return Boolean(
    /^#{1,3}\s+/.test(text)
    || /^```/.test(text)
    || /^>\s?/.test(text)
    || /^([-*+])\s+/.test(text)
    || /^\d+[.)]\s+/.test(text)
    || /^(?:-{3,}|_{3,}|\*{3,})$/.test(text),
  );
}

export function parseAgentMessage(content: string): AgentMessageBlock[] {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: AgentMessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([\w-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fence[1] || '', text: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const quoteLines: string[] = [];
    while (index < lines.length) {
      const quote = lines[index].trim().match(/^>\s?(.*)$/);
      if (!quote) break;
      quoteLines.push(quote[1]);
      index += 1;
    }
    if (quoteLines.length) {
      blocks.push({ kind: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    const firstList = listMatch(rawLine);
    if (firstList) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = listMatch(lines[index]);
        if (!current || current.ordered !== firstList.ordered) break;
        items.push(current.text);
        index += 1;
        while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
          items[items.length - 1] += `\n${lines[index].trim()}`;
          index += 1;
        }
      }
      blocks.push({ kind: 'list', ordered: firstList.ordered, items });
      continue;
    }

    const label = line.match(/^\*\*(.+?)\*\*$|^__(.+?)__$/);
    if (label) {
      blocks.push({ kind: 'label', text: label[1] || label[2] });
      index += 1;
      continue;
    }

    const paragraph: string[] = [rawLine.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}
