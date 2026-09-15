// Mermaid only auto-wraps a label onto multiple lines when it uses the special markdown-string
// syntax (`id["`backtick-quoted text`"]`) — the generator prompts emit plain `id[Text]` / `id{Text}`
// labels, so long labels would render as one unwrapped line and get clipped at the node's edge.
// Inserting literal <br/> tags works regardless of label syntax as long as htmlLabels is on, and
// Mermaid sizes each node box to fit the wrapped lines. Ported 1:1 from webapp/static/documents.js.

const LABEL_WRAP_MAX_CHARS = 18;

function wrapLabelText(text: string): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > LABEL_WRAP_MAX_CHARS) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("<br/>");
}

function wrapBracketLabels(source: string, open: string, close: string): string {
  const esc = (c: string) => c.replace(/[[\]{}]/g, "\\$&");
  const pattern = new RegExp(`${esc(open)}([^${esc(open)}${esc(close)}]+)${esc(close)}`, "g");
  return source.replace(pattern, (match, inner: string) => {
    if (/<br\s*\/?>/i.test(inner)) return match;
    return `${open}${wrapLabelText(inner)}${close}`;
  });
}

function wrapEdgeLabels(source: string): string {
  return source.replace(/(--\s+)(.+?)(\s+-->)/g, (match, pre: string, label: string, post: string) => {
    if (/<br\s*\/?>/i.test(label)) return match;
    return `${pre}${wrapLabelText(label)}${post}`;
  });
}

export function wrapMermaidLabels(source: string | null | undefined): string {
  if (!source) return "";
  let out = source;
  out = wrapBracketLabels(out, "[", "]");
  out = wrapBracketLabels(out, "{", "}");
  out = wrapEdgeLabels(out);
  return out;
}
