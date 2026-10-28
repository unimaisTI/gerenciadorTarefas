import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SuggestionProps } from '@tiptap/suggestion';
import {
  AtSign,
  Bold,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { DirectoryUserDto, RichNode } from '@hub/shared';
import { useToast } from '@/design-system';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDirectory } from '@/lib/queries';
import { isUploadableImage, uploadImage } from '@/lib/uploads';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

type Person = Pick<DirectoryUserDto, 'id' | 'name' | 'jobTitle'>;
type MentionProps = SuggestionProps<Person, { id: string; label: string }>;

function normalize(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Lista de pessoas ao digitar "@" (RF-8.2). DOM simples, navegável pelo teclado; a escolha
 * vira um nó de menção com o id da pessoa, que o servidor usa para notificar.
 */
function mentionPopup() {
  let el: HTMLDivElement | null = null;
  let props: MentionProps | null = null;
  let index = 0;

  const draw = () => {
    if (!el || !props) return;
    el.replaceChildren();
    if (!props.items.length) {
      const empty = document.createElement('div');
      empty.className = 'mention-empty';
      empty.textContent = 'Ninguém encontrado.';
      el.appendChild(empty);
    }
    props.items.forEach((person, i) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(i === index));
      option.className = 'mention-option';
      const name = document.createElement('strong');
      name.textContent = person.name;
      option.appendChild(name);
      if (person.jobTitle) {
        const job = document.createElement('span');
        job.textContent = person.jobTitle;
        option.appendChild(job);
      }
      option.addEventListener('mousedown', (e) => {
        e.preventDefault();
        props?.command({ id: person.id, label: person.name });
      });
      el?.appendChild(option);
    });
    const rect = props.clientRect?.();
    if (rect) {
      el.style.left = `${String(rect.left + window.scrollX)}px`;
      el.style.top = `${String(rect.bottom + window.scrollY + 4)}px`;
    }
  };

  return {
    onStart: (p: MentionProps) => {
      props = p;
      index = 0;
      el = document.createElement('div');
      el.className = 'mention-popup';
      el.setAttribute('role', 'listbox');
      el.setAttribute('aria-label', 'Mencionar pessoa');
      document.body.appendChild(el);
      draw();
    },
    onUpdate: (p: MentionProps) => {
      props = p;
      index = 0;
      draw();
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const count = props?.items.length ?? 0;
      if (event.key === 'ArrowDown' && count) {
        index = (index + 1) % count;
        draw();
        return true;
      }
      if (event.key === 'ArrowUp' && count) {
        index = (index + count - 1) % count;
        draw();
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && count) {
        const person = props?.items[index];
        if (person) props?.command({ id: person.id, label: person.name });
        return true;
      }
      if (event.key === 'Escape') {
        el?.remove();
        el = null;
        return true;
      }
      return false;
    },
    onExit: () => {
      el?.remove();
      el = null;
      props = null;
    },
  };
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 cursor-pointer items-center justify-center rounded-xs border-0 text-gray-600 hover:bg-navy-050 hover:text-navy-700',
        active ? 'bg-navy-050 text-navy-700' : 'bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

export interface RichTextEditorProps {
  value: RichNode | null;
  onChange?: (doc: RichNode) => void;
  editable?: boolean;
  placeholder?: string;
  /** Mostra o botão de menção (comentários). Digitar "@" funciona sempre que editável. */
  mentions?: boolean;
  /** Tarefa onde as imagens coladas são guardadas. Sem ela, colar imagem fica desligado. */
  uploadTaskId?: string;
  label: string;
  minHeight?: number;
  className?: string;
}

/**
 * Texto rico com negrito, listas, links, checklist (RF-6.5, RF-8.1), menções e prints colados.
 * Guarda JSON do Tiptap, nunca HTML; o modo leitura usa o mesmo editor.
 */
export function RichTextEditor({
  value,
  onChange,
  editable = true,
  placeholder,
  mentions = false,
  uploadTaskId,
  label,
  minHeight = 96,
  className,
}: RichTextEditorProps) {
  const toast = useToast();
  const directory = useDirectory();
  const people = useRef<Person[]>([]);
  people.current = directory.data ?? [];
  const editorRef = useRef<Editor | null>(null);
  const taskIdRef = useRef(uploadTaskId);
  taskIdRef.current = uploadTaskId;
  const fileInput = useRef<HTMLInputElement>(null);
  const touched = useRef(false);

  const insertImages = (files: File[]) => {
    const taskId = taskIdRef.current;
    const images = files.filter(isUploadableImage);
    if (!images.length) return false;
    if (!taskId) {
      toast('Salve a tarefa antes de colar imagens.', 'info');
      return true;
    }
    for (const file of images) {
      uploadImage(taskId, file)
        .then((f) => editorRef.current?.chain().focus().setImage({ src: f.url, alt: f.name }).run())
        .catch((e: unknown) => {
          toast(errorMessage(e), 'danger');
        });
    }
    return true;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: true,
          autolink: true,
          protocols: ['http', 'https', 'mailto'],
          isAllowedUri: (url) => SAFE_URL.test(url),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ HTMLAttributes: { class: 'rich-image', loading: 'lazy' } }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderText: ({ node }) => `@${String(node.attrs.label ?? '')}`,
        suggestion: {
          char: '@',
          items: ({ query }: { query: string }) => {
            const q = normalize(query);
            return people.current.filter((p) => normalize(p.name).includes(q)).slice(0, 6);
          },
          render: mentionPopup,
        },
      }),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: (value) ?? '',
    editable,
    editorProps: {
      attributes: {
        'aria-label': label,
        class: cn('rich-text outline-none', editable && 'px-[14px] py-2.5'),
        style: editable ? `min-height:${String(minHeight)}px` : '',
      },
      // Colar ou arrastar um print sobe a imagem para a tarefa.
      handlePaste: (_view, event) => insertImages(Array.from(event.clipboardData?.files ?? [])),
      handleDrop: (_view, event) => insertImages(Array.from((event).dataTransfer?.files ?? [])),
      handleDOMEvents: {
        focus: () => {
          touched.current = true;
          return false;
        },
      },
    },
    // Só avisa mudança depois que a pessoa mexeu: ao abrir, o editor normaliza o conteúdo
    // (atributos padrão das extensões) e isso não pode parecer uma edição não salva.
    onUpdate: ({ editor: e }) => {
      if (touched.current) onChange?.(e.getJSON() as RichNode);
    },
  });
  editorRef.current = editor;

  // Atualiza o conteúdo quando o valor muda por fora (ex.: outra pessoa editou).
  useEffect(() => {
    if (editor.isFocused || !value) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  if (!editable) return <EditorContent editor={editor} className={className} />;

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Endereço do link (https://...)', previous ?? 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (!SAFE_URL.test(url.trim())) {
      window.alert('Use um endereço que comece com https://');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className={cn('rounded-sm border border-subtle bg-white focus-within:border-navy-400', className)}>
      <div role="toolbar" aria-label={`Formatação: ${label}`} className="flex flex-wrap gap-0.5 border-b border-subtle p-1">
        <ToolButton label="Negrito" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolButton>
        <ToolButton label="Itálico" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </ToolButton>
        <ToolButton label="Tachado" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
        </ToolButton>
        <ToolButton label="Lista" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolButton>
        <ToolButton label="Lista numerada" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </ToolButton>
        <ToolButton label="Checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks size={15} />
        </ToolButton>
        <ToolButton label="Link" active={editor.isActive('link')} onClick={setLink}>
          <LinkIcon size={15} />
        </ToolButton>
        {mentions && (
          <ToolButton label="Mencionar pessoa (ou digite @)" onClick={() => editor.chain().focus().insertContent('@').run()}>
            <AtSign size={15} />
          </ToolButton>
        )}
        {uploadTaskId && (
          <>
            <ToolButton label="Inserir imagem (ou cole um print)" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={15} />
            </ToolButton>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                insertImages(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
