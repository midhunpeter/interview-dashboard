import { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

const markdownOptions = { breaks: true, gfm: false };
const sanitizeOptions = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "ul", "li"],
  ALLOWED_ATTR: [],
};

export function renderMarkdown(value = "") {
  return DOMPurify.sanitize(marked.parse(String(value), markdownOptions), sanitizeOptions);
}

export function MarkdownContent({ value, className = "", emptyText = "" }) {
  const html = useMemo(() => renderMarkdown(value), [value]);
  if (!String(value || "").trim()) return emptyText ? <p className={`markdown-empty ${className}`}>{emptyText}</p> : null;
  return <div className={`markdown-content ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FormattedTextarea({ label, value = "", onChange, placeholder, className = "", textareaClassName = "", ariaLabel }) {
  const textareaRef = useRef(null);
  const [mode, setMode] = useState("edit");

  const replaceSelection = (replacement, selectedStart, selectedEnd) => {
    onChange(replacement.value);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selectedStart, selectedEnd);
    });
  };

  const wrapSelection = (prefix, suffix, fallback) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const content = selected || fallback;
    const inserted = `${prefix}${content}${suffix}`;
    replaceSelection(
      { value: `${value.slice(0, start)}${inserted}${value.slice(end)}` },
      start + prefix.length,
      start + prefix.length + content.length,
    );
  };

  const makeBulletList = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    if (!selected) {
      const placeholderText = "list item";
      const inserted = `- ${placeholderText}`;
      replaceSelection(
        { value: `${value.slice(0, start)}${inserted}${value.slice(end)}` },
        start + 2,
        start + inserted.length,
      );
      return;
    }
    const inserted = selected.split("\n").map((line) => `- ${line.replace(/^\s*-\s?/, "")}`).join("\n");
    replaceSelection(
      { value: `${value.slice(0, start)}${inserted}${value.slice(end)}` },
      start,
      start + inserted.length,
    );
  };

  return (
    <div className={`formatted-field ${className}`}>
      {label && <span className="formatted-field-label">{label}</span>}
      <div className="formatting-bar">
        <div className="formatting-tools" aria-label="Text formatting">
          <button type="button" disabled={mode !== "edit"} onClick={() => wrapSelection("**", "**", "bold text")} aria-label="Bold"><strong>B</strong></button>
          <button type="button" disabled={mode !== "edit"} onClick={() => wrapSelection("*", "*", "italic text")} aria-label="Italic"><em>I</em></button>
          <button type="button" disabled={mode !== "edit"} onClick={makeBulletList} aria-label="Bullet list">•</button>
        </div>
        <div className="formatting-mode" aria-label="Editor mode">
          <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Edit</button>
          <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview</button>
        </div>
      </div>
      {mode === "edit" ? (
        <textarea
          ref={textareaRef}
          className={textareaClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel || label}
        />
      ) : (
        <MarkdownContent value={value} className="formatted-preview" emptyText="Nothing to preview yet." />
      )}
    </div>
  );
}
