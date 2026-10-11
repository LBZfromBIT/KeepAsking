import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  { gfm: true, breaks: true },
);

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }) as string);
}

/** Wrap the character range [start, end) of root's text content in <mark> elements */
export function wrapRange(root: HTMLElement, start: number, end: number, attrs: Record<string, string>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: { node: Text; s: number; e: number }[] = [];
  let pos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = (n as Text).length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) targets.push({ node: n as Text, s: s - pos, e: e - pos });
    pos += len;
    if (pos >= end) break;
  }
  for (const t of targets) {
    if (!t.node.data.slice(t.s, t.e).trim()) continue;
    let node = t.node;
    if (t.s > 0) node = node.splitText(t.s);
    if (t.e - t.s < node.length) node.splitText(t.e - t.s);
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v);
    node.parentNode!.insertBefore(mark, node);
    mark.appendChild(node);
  }
}

/** Character offsets of a range relative to container's text content */
export function rangeOffsets(container: HTMLElement, range: Range): { start: number; end: number; text: string } {
  const pre = document.createRange();
  pre.setStart(container, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const text = range.toString();
  return { start, end: start + text.length, text };
}
