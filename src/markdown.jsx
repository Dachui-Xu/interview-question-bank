import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { Bold, Code, ImagePlus, Italic } from 'lucide-react';
import { db, downloadQuestionImage, result } from './api';
import { questionImageBucket as bucket, questionImageName } from './question-images';
import { clipboardMarkdown } from './markdown-paste';

const extensions = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
  ['image/gif', 'gif'], ['image/avif', 'avif'],
]);
const textFields = ['prompt', 'answer', 'notes'];
export const ImageOwner = createContext(null);
const StagedImages = createContext(null);
const MarkdownRenderer = lazy(() => import('./markdown-renderer'));
const formats = [
  { label: '加粗', icon: Bold, marker: '**', key: 'b' },
  { label: '斜体', icon: Italic, marker: '*', key: 'i' },
  { label: '行内代码', icon: Code, marker: '`' },
];

function SavedImage({ name, alt, file }) {
  const ownerId = useContext(ImageOwner);
  const [state, setState] = useState({});
  useEffect(() => {
    let active = true;
    let objectUrl;
    async function load() {
      try {
        const blob = file ?? await downloadQuestionImage(ownerId, name);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ name, url: objectUrl });
      } catch {
        if (active) setState({ name, failed: true });
      }
    }
    load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ownerId, name, file]);
  if (state.name === name && state.url) return <img src={state.url} alt={alt} loading="lazy" />;
  return <span className="markdown-image-status">{state.name === name && state.failed ? '图片暂时无法加载' : '正在加载图片…'}</span>;
}

function MarkdownImage({ src, alt }) {
  const staged = useContext(StagedImages);
  const name = questionImageName(src);
  if (name) return <SavedImage key={name} name={name} alt={alt} file={staged?.get(name)?.file} />;
  if (/^https?:\/\//i.test(src)) return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
  return <span className="markdown-image-status">{alt || '图片地址不可用'}</span>;
}

const components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  img: MarkdownImage,
};

export function MarkdownText({ children, className = '', staged }) {
  return <StagedImages.Provider value={staged}>
    <div className={`markdown ${className}`}>
      <Suspense fallback={<span className="markdown-image-status">正在加载内容…</span>}>
        <MarkdownRenderer components={components}>{children}</MarkdownRenderer>
      </Suspense>
    </div>
  </StagedImages.Provider>;
}

export async function saveImages(ownerId, questions, staged) {
  for (const [name, image] of staged) {
    if (image.uploaded || !questions.some(question => textFields.some(field => question[field].includes(`${bucket}/${name}`)))) continue;
    await result(db.storage.from(bucket).upload(`${ownerId}/${name}`, image.file, {
      contentType: image.file.type, cacheControl: '0',
    }));
    image.uploaded = true;
  }
}

export function MarkdownField({ id, label, value, onChange, maxLength, rows, required, placeholder, staged, pending }) {
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  const textarea = useRef(null);

  function replaceSelection(start, end, text, selectionStart = start + text.length, selectionEnd = selectionStart) {
    const editor = textarea.current;
    if (editor.value.length - (end - start) + text.length > maxLength) {
      setError(`${label}超过长度限制，请缩短内容后再试。`);
      return;
    }
    editor.focus();
    editor.setSelectionRange(start, end);
    // Use the browser's editing history when it supports text insertion.
    if (!document.execCommand?.('insertText', false, text)) {
      editor.setRangeText(text, start, end);
      onChange(editor.value);
    }
    editor.setSelectionRange(selectionStart, selectionEnd);
    setError('');
  }

  function applyFormat(marker) {
    const { selectionStart, selectionEnd, value: text } = textarea.current;
    let start = selectionStart;
    let end = selectionEnd;
    let selected = text.slice(start, end);
    if (selected && !selected.trim()) {
      start = end;
      selected = '';
    } else if (selected) {
      start += selected.length - selected.trimStart().length;
      selected = selected.trim();
      end = start + selected.length;
    }
    const wrapsSelection = selected.startsWith(marker) && selected.endsWith(marker)
      && (marker !== '*' || !selected.startsWith('**') || selected.startsWith('***'));
    const wrapsInEditor = start >= marker.length && text.slice(start - marker.length, start) === marker
      && text.startsWith(marker, end)
      && (marker !== '*' || /(?<!\*)\*(?:\*\*)*$/.test(text.slice(0, start)));
    if (selected.length >= marker.length * 2 && wrapsSelection) {
      const unwrapped = selected.slice(marker.length, -marker.length);
      replaceSelection(start, end, unwrapped, start, start + unwrapped.length);
    } else if (wrapsInEditor) {
      replaceSelection(start - marker.length, end + marker.length, selected, start - marker.length, end - marker.length);
    } else {
      const selection = start + marker.length;
      replaceSelection(start, end, marker + selected + marker, selection, selection + selected.length);
    }
  }

  function handlePaste(event) {
    let text;
    try {
      text = clipboardMarkdown(event.clipboardData);
    } catch {
      return;
    }
    if (text === null) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    replaceSelection(selectionStart, selectionEnd, text.replace(/\r\n?/g, '\n'));
  }

  function handleShortcut(event) {
    if (event.nativeEvent.isComposing || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
    const format = formats.find(item => item.key === event.key.toLowerCase());
    if (!format) return;
    event.preventDefault();
    if (!event.repeat) applyFormat(format.marker);
  }

  function insert(files) {
    const images = [...files];
    if (pending || !images.length) return;
    if (images.some(file => !extensions.has(file.type) || !file.size || file.size > 6 * 1024 * 1024)) {
      setError('请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片，每张不超过 6 MB。');
      return;
    }
    const items = images.map(file => ({
      file, name: `${crypto.randomUUID()}.${extensions.get(file.type)}`,
      alt: file.name.replace(/[\[\]\\\r\n]/g, '').slice(0, 100),
    }));
    const position = preview ? value.length : textarea.current.selectionEnd;
    const markup = items.map(({ name, alt }) => `![${alt || '图片'}](${bucket}/${name})`).join('\n\n');
    const next = `${value.slice(0, position)}\n\n${markup}\n\n${value.slice(position)}`;
    if (next.length > maxLength) {
      setError(`${label}超过长度限制，请缩短内容后再插入。`);
      return;
    }
    for (const { name, file } of items) staged.set(name, { file, uploaded: false });
    onChange(next);
    setError('');
  }

  return <div className="markdown-field" onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  }} onDrop={event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    insert(event.dataTransfer.files);
  }}>
    <div className="markdown-field-head">
      <label htmlFor={id}>{label}</label>
      <div className="markdown-tools">
        {!preview && formats.map(({ label: format, icon: Icon, marker, key }) =>
          <button key={format} type="button" disabled={pending} className="markdown-tool format-tool"
            aria-label={format} title={key ? format + '（Ctrl / ⌘ + ' + key.toUpperCase() + '）' : format}
            aria-keyshortcuts={key ? 'Control+' + key.toUpperCase() + ' Meta+' + key.toUpperCase() : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(marker)}><Icon size={15} /></button>)}
        <input ref={input} type="file" accept={[...extensions.keys()].join(',')} multiple hidden
          onChange={event => { insert(event.target.files); event.target.value = ''; }} />
        <button type="button" disabled={pending} className="markdown-tool" onClick={() => input.current.click()}
          aria-label={`${label}插入图片`}><ImagePlus size={15} />插图</button>
        <button type="button" disabled={pending} className="markdown-tool" aria-pressed={preview} onClick={() => setPreview(current => !current)}
          aria-label={preview ? `编辑${label}` : `预览${label}`}>
          {preview ? '编辑' : '预览'}
        </button>
      </div>
    </div>
    <textarea ref={textarea} id={id} value={value} onChange={event => onChange(event.target.value)}
      onPaste={handlePaste} onKeyDown={handleShortcut}
      maxLength={maxLength} rows={rows} required={required && !preview} disabled={pending} hidden={preview} placeholder={placeholder} />
    {preview && <div className="markdown-preview"><MarkdownText staged={staged}>{value || '暂无内容'}</MarkdownText></div>}
    {error && <p className="editor-hint image-error" role="alert">{error}</p>}
  </div>;
}
