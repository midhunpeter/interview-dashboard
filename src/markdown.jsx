import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Link from "@tiptap/extension-link";

const markdownOptions = { breaks: true, gfm: true };
const sanitizeOptions = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "ul", "ol", "li", "del", "s", "u", "mark",
    "table", "thead", "tbody", "tr", "th", "td", "pre", "code",
    "h1", "h2", "h3", "blockquote", "hr", "a", "input",
  ],
  ALLOWED_ATTR: [],
  ADD_ATTR: (attribute, tag) => (
    (tag === "a" && ["href", "title"].includes(attribute))
    || (tag === "code" && attribute === "class")
    || (tag === "input" && ["type", "disabled", "checked"].includes(attribute))
    || (["th", "td"].includes(tag) && attribute === "align")
  ),
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// Use a dedicated sanitizer so these read-only rules cannot affect other HTML.
const markdownSanitizer = DOMPurify();
markdownSanitizer.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName !== "INPUT") return;
  if (node.getAttribute("type")?.toLowerCase() !== "checkbox") node.remove();
  else node.setAttribute("disabled", "");
});
markdownSanitizer.addHook("uponSanitizeAttribute", (node, attribute) => {
  if (attribute.attrName === "class") {
    attribute.keepAttr = node.nodeName === "CODE" && /^language-[\w.+#-]+$/.test(attribute.attrValue);
  }
});

const richTextExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
  Markdown,
  Underline,
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  Link.configure({ openOnClick: false, defaultProtocol: "https" }),
];

export function renderMarkdown(value = "") {
  return markdownSanitizer.sanitize(marked.parse(String(value), markdownOptions), sanitizeOptions);
}

export function MarkdownContent({ value, className = "", emptyText = "" }) {
  const html = useMemo(() => renderMarkdown(value), [value]);
  if (!String(value || "").trim()) return emptyText ? <p className={`markdown-empty ${className}`}>{emptyText}</p> : null;
  return <div className={`markdown-content ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function ToolbarButton({ editor, active = false, onClick, label, children }) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      disabled={!editor}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ label, helperText, value = "", onChange, placeholder, className = "", textareaClassName = "", ariaLabel }) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const editor = useEditor({
    extensions: richTextExtensions,
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel || label || "Rich text editor",
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChangeRef.current(currentEditor.getMarkdown()),
  });

  useEffect(() => {
    if (!editor) return;
    const nextValue = String(value || "");
    if (editor.getMarkdown() !== nextValue) {
      editor.commands.setContent(nextValue, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  const setLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Enter link URL", "https://");
    if (url?.trim()) editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const headingValue = [1, 2, 3].find((level) => editor?.isActive("heading", { level })) || "paragraph";
  const setHeading = (nextValue) => {
    if (!editor) return;
    if (nextValue === "paragraph") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: Number(nextValue) }).run();
  };

  return (
    <div className={`formatted-field rich-text-field ${className}`}>
      {label && <span className="formatted-field-label">{label}</span>}
      {helperText && <small className="formatted-field-helper">Demonstrates: {helperText}</small>}
      <div className="rich-text-toolbar" aria-label="Rich text formatting">
        <div className="rich-text-toolbar-group" aria-label="Text styling">
          <span>Text styling</span>
          <div className="rich-text-toolbar-controls">
            <ToolbarButton editor={editor} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} label="Bold"><strong>B</strong></ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} label="Italic"><em>I</em></ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} label="Underline"><u>U</u></ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} label="Strikethrough"><s>S</s></ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()} label="Inline code">&lt;/&gt;</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("highlight")} onClick={() => editor?.chain().focus().toggleHighlight().run()} label="Highlight">HL</ToolbarButton>
            <select value={headingValue} disabled={!editor} onChange={(event) => setHeading(event.target.value)} aria-label="Text block style">
              <option value="paragraph">Paragraph</option>
              <option value="1">H1</option>
              <option value="2">H2</option>
              <option value="3">H3</option>
            </select>
          </div>
        </div>
        <div className="rich-text-toolbar-group" aria-label="Structure and layout">
          <span>Structure &amp; layout</span>
          <div className="rich-text-toolbar-controls">
            <ToolbarButton editor={editor} active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} label="Bullet list">• List</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} label="Ordered list">1. List</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("taskList")} onClick={() => editor?.chain().focus().toggleTaskList().run()} label="Checklist">☑ List</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} label="Blockquote">❝</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("codeBlock")} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} label="Code block">Code</ToolbarButton>
            <ToolbarButton editor={editor} onClick={() => editor?.chain().focus().setHorizontalRule().run()} label="Horizontal rule">―</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("table")} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Insert 3 by 3 table">Table</ToolbarButton>
            <ToolbarButton editor={editor} active={editor?.isActive("link")} onClick={setLink} label={editor?.isActive("link") ? "Remove link" : "Add link"}>Link</ToolbarButton>
          </div>
        </div>
      </div>
      <div className={`rich-text-content ${textareaClassName} ${editor?.isEmpty ? "empty" : ""}`} data-placeholder={placeholder || "Write here…"}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
