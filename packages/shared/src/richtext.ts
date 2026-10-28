import { z } from 'zod';

/**
 * Texto rico é guardado como JSON do Tiptap (ProseMirror), nunca como HTML: a interface
 * renderiza pelo próprio editor, então não há HTML do usuário para injetar (RNF-03).
 * Mesmo assim o servidor limpa nós/marcas fora da lista e links que não sejam http(s)/mailto.
 */
export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'text',
  'hardBreak',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'mention',
  'image',
]);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline']);
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
/** Só imagens enviadas ao próprio sistema (colar print), nunca endereço externo. */
export const UPLOADED_IMAGE_SRC = /^\/api\/files\/[0-9a-f-]{36}$/;
const MAX_DEPTH = 20;

const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string().max(40),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richNodeSchema).max(2000).optional(),
    marks: z
      .array(z.object({ type: z.string().max(40), attrs: z.record(z.string(), z.unknown()).optional() }))
      .max(10)
      .optional(),
    text: z.string().max(20000).optional(),
  }),
);

export const richDocSchema = richNodeSchema.refine((n) => n.type === 'doc', {
  message: 'Documento inválido.',
});

function sanitizeNode(node: RichNode, depth: number): RichNode | null {
  if (depth > MAX_DEPTH || !ALLOWED_NODES.has(node.type)) return null;
  if (node.type === 'image' && !node.attrs) return null;
  const out: RichNode = { type: node.type };
  if (node.text !== undefined) out.text = node.text;

  if (node.attrs) {
    const attrs: Record<string, unknown> = {};
    if (node.type === 'heading') attrs.level = Math.min(Math.max(Number(node.attrs.level) || 2, 2), 4);
    if (node.type === 'taskItem') attrs.checked = node.attrs.checked === true;
    if (node.type === 'mention') {
      attrs.id = typeof node.attrs.id === 'string' ? node.attrs.id : null;
      attrs.label = typeof node.attrs.label === 'string' ? node.attrs.label.slice(0, 120) : null;
    }
    if (node.type === 'image') {
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
      if (!UPLOADED_IMAGE_SRC.test(src)) return null;
      attrs.src = src;
      attrs.alt = typeof node.attrs.alt === 'string' ? node.attrs.alt.slice(0, 200) : null;
    }
    if (Object.keys(attrs).length) out.attrs = attrs;
  }

  if (node.marks) {
    const marks = node.marks.flatMap((m) => {
      if (!ALLOWED_MARKS.has(m.type)) return [];
      if (m.type !== 'link') return [{ type: m.type }];
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href : '';
      return SAFE_URL.test(href) ? [{ type: 'link', attrs: { href } }] : [];
    });
    if (marks.length) out.marks = marks;
  }

  if (node.content) {
    out.content = node.content
      .map((c) => sanitizeNode(c, depth + 1))
      .filter((c): c is RichNode => c !== null);
  }
  return out;
}

export function sanitizeRichDoc(doc: RichNode): RichNode {
  return sanitizeNode(doc, 0) ?? { type: 'doc', content: [] };
}

/** Texto puro do documento (busca global, e-mails, prévias). */
export function richDocToText(doc: RichNode | null | undefined): string {
  if (!doc) return '';
  const parts: string[] = [];
  const walk = (n: RichNode) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    if (n.type === 'mention' && typeof n.attrs?.label === 'string') parts.push(`@${n.attrs.label}`);
    n.content?.forEach(walk);
    if (['paragraph', 'heading', 'listItem', 'taskItem'].includes(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

/** IDs dos usuários mencionados (RF-8.2). */
export function richDocMentions(doc: RichNode | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (n: RichNode) => {
    if (n.type === 'mention' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return [...ids];
}

export function textToRichDoc(text: string): RichNode {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
  };
}
