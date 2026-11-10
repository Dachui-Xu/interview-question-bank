import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { db, downloadQuestionImage, result } from './api';
import { questionImageBucket as bucket, questionImageName } from './question-images';

const extensions = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
  ['image/gif', 'gif'], ['image/avif', 'avif'],
]);
const textFields = ['prompt', 'answer', 'notes'];
export const ImageOwner = createContext(null);
const StagedImages = createContext(null);
const MarkdownRenderer = lazy(() => import('./markdown-renderer'));

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
      maxLength={maxLength} rows={rows} required={required && !preview} disabled={pending} hidden={preview} placeholder={placeholder} />
    {preview && <div className="markdown-preview"><MarkdownText staged={staged}>{value || '暂无内容'}</MarkdownText></div>}
    {error && <p className="editor-hint image-error" role="alert">{error}</p>}
  </div>;
}
