import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight,
  Eye, FileText, Github, Layers, LogOut, Pencil, Plus, RefreshCw, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import {
  categories, emptyQuestion, masteryLabels, normalizeQuestion, parseQuestionFile, recruitmentLabels, sourceUrl, textFields, topicKey,
} from '../supabase/functions/_shared/question.mjs';
import { db, downloadQuestionImage, errorText, loadBank, result, updateRow } from './api';
import { ImageOwner, MarkdownField, MarkdownText, saveImages } from './markdown';
import './style.css';

const tabs = { library: '题库', practice: '练习', drafts: '草稿' };
const emptyFilters = { company: '', tag: '', category: '', recruitment: '', mastery: '' };
const topicLink = (route, key) => `#${route}?${new URLSearchParams({ topic: key })}`;

function groupTopics(rows) {
  const groups = new Map();
  const singles = [];
  for (const row of rows) {
    const key = topicKey(row.content);
    if (!key) {
      singles.push(row);
      continue;
    }
    if (!groups.has(key)) groups.set(key, { key, content: row.content, rows: [], source: '' });
    const group = groups.get(key);
    group.rows.push(row);
    group.source ||= row.content.source;
  }
  return { groups, singles };
}

function Brand() {
  return <a className="brand" href="#library"><span className="brand-icon"><BookOpen size={19} /></span>答题间</a>;
}

function RepositoryLink() {
  return <a className="icon-button repository-link" href="https://github.com/Dachui-Xu/interview-question-bank"
    target="_blank" rel="noreferrer" aria-label="GitHub 项目仓库" title="GitHub 项目仓库"><Github size={18} /></a>;
}

function Artwork() {
  return <div className="artwork" aria-hidden="true">
    <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
    <div className="art-back" />
    <div className="art-card"><span className="art-label"><BookOpen size={13} /> 我的题卡</span>
      <span className="art-lines"><i /><i /><i /></span>
      <span className="art-tags"><i /><i /></span>
    </div>
    <span className="art-check"><Check size={24} strokeWidth={2.8} /></span>
  </div>;
}

function Login({ loading }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await result(db.auth.signInWithPassword({ email: form.get('email').trim(), password: form.get('password') }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  }
  return <div className="entry page">
    <header className="entry-header"><Brand /><RepositoryLink /></header>
    <main className="entry-layout">
      <section className="entry-story">
        <span className="eyebrow">笔试 · 面试</span>
        <h1>你的私人<br />笔面试题库</h1>
        <p>用公司和知识点归类题目，逐题练习，把还没掌握的留到下次复习。</p>
        <Artwork />
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <span className="tile-icon"><Layers size={22} /></span>
        <h2 id="login-title">登录答题间</h2>
        <p className="muted">用题库账号继续学习。</p>
        <form onSubmit={login}>
          <label>邮箱<input name="email" type="email" autoComplete="username" placeholder="you@example.com" required /></label>
          <label>密码<input name="password" type="password" autoComplete="current-password" placeholder="输入你的密码" required /></label>
          <button className="button primary" disabled={!db || pending || loading}>{pending ? '正在登录…' : '登录'}<ArrowRight size={17} /></button>
        </form>
        {!db && <p className="notice">题库还未连接 Supabase，请先配置项目地址和公开客户端密钥。</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(db));
  useEffect(() => {
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return session ? <ImageOwner.Provider value={session.user.id}>
    <Bank key={session.user.id} ownerId={session.user.id} />
  </ImageOwner.Provider> : <Login loading={loading} />;
}

function SelectFilter({ name, value, options, onChange }) {
  return <label className="filter"><span>{name}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">全部</option>
      {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  </label>;
}

function Filters({ filters, setFilters, companies, tags }) {
  const change = field => value => setFilters(current => ({ ...current, [field]: value }));
  return <section className="filter-bar" aria-label="筛选条件">
    <SelectFilter name="公司" value={filters.company} options={companies.map(value => [value, value])} onChange={change('company')} />
    <SelectFilter name="知识点" value={filters.tag} options={tags.map(value => [value, value])} onChange={change('tag')} />
    <SelectFilter name="类别" value={filters.category} options={Object.entries(categories)} onChange={change('category')} />
    <SelectFilter name="招聘类型" value={filters.recruitment} options={Object.entries(recruitmentLabels)} onChange={change('recruitment')} />
    <SelectFilter name="掌握状态" value={filters.mastery} options={[['unrated', '未标记'], ...Object.entries(masteryLabels)]} onChange={change('mastery')} />
    {Object.values(filters).some(Boolean) && <button className="button text-button" onClick={() => setFilters(emptyFilters)}>清除筛选</button>}
  </section>;
}

function Metadata({ question, mastery }) {
  return <div className="chips">
    <span className="chip category">{categories[question.category]}</span>
    {question.company && <span className="chip">{question.company}</span>}
    {question.recruitment !== 'unspecified' && <span className="chip">{recruitmentLabels[question.recruitment]}</span>}
    {question.tags.map(tag => <span className="chip" key={tag}>{tag}</span>)}
    {mastery && <span className={`chip mastery ${mastery}`}>{masteryLabels[mastery]}</span>}
  </div>;
}

function Source({ value }) {
  const link = sourceUrl(value);
  return link
    ? <a className="source-link" href={link} target="_blank" rel="noreferrer">{value}<ArrowUpRight size={15} /></a>
    : <MarkdownText>{value}</MarkdownText>;
}

function QuestionDetails({ question, sharedSource }) {
  return <div className="question-details">
    <section><h4>参考答案</h4><MarkdownText>{question.answer || '尚未填写参考答案。'}</MarkdownText></section>
    {question.notes && <section><h4>补充说明</h4><MarkdownText>{question.notes}</MarkdownText></section>}
    {question.source && question.source !== sharedSource && <section><h4>来源</h4><Source value={question.source} /></section>}
  </div>;
}

function Empty({ title, detail, action }) {
  return <section className="empty"><span className="tile-icon"><BookOpen size={23} /></span>
    <h3>{title}</h3><p>{detail}</p>{action}</section>;
}

function Practice({ rows, busy, onMark, sharedSource }) {
  const [index, setIndex] = useState(0);
  const activeIndex = Math.min(index, rows.length - 1);
  const row = rows[activeIndex];
  function move(step) {
    setIndex(activeIndex + step);
  }
  if (!row) return <Empty title="没有可练习的题目" detail="可以清除筛选，或先到题库新增一题。" />;
  return <PracticeCard key={row.id} row={row} index={activeIndex} total={rows.length} move={move} busy={busy} onMark={onMark} sharedSource={sharedSource} />;
}

function PracticeCard({ row, index, total, move, busy, onMark, sharedSource }) {
  const [revealed, setRevealed] = useState(false);
  return <article className="practice-card card">
    <div className="practice-progress"><span>第 {index + 1} 题</span><span>{index + 1} / {total}</span></div>
    <progress aria-label="当前练习位置" value={index + 1} max={total} />
    <Metadata question={row.content} mastery={row.mastery} />
    <MarkdownText className="question-prompt practice-prompt">{row.content.prompt}</MarkdownText>
    {revealed
      ? <><QuestionDetails question={row.content} sharedSource={sharedSource} /><div className="mark-row" aria-label="掌握状态">
        {Object.entries(masteryLabels).map(([value, label]) =>
          <button key={value} className={`button secondary ${row.mastery === value ? 'selected' : ''}`}
            aria-pressed={row.mastery === value} disabled={busy} onClick={() => onMark(row, value)}>{label}</button>)}
      </div></>
      : <button className="button primary" onClick={() => setRevealed(true)}><Eye size={17} />显示答案</button>}
    <div className="practice-nav">
      <button className="button secondary" disabled={index === 0} onClick={() => move(-1)}><ArrowLeft size={16} />上一题</button>
      <button className="button secondary" disabled={index + 1 === total} onClick={() => move(1)}>下一题<ArrowRight size={16} /></button>
    </div>
  </article>;
}

function Exam({ rows, sharedSource }) {
  const [paper] = useState(rows);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const answered = Object.values(answers).filter(value => value.trim()).length;
  return <>
    <div className="section-line">
      <h2>{submitted ? '对照答案' : '主题考试'} <small>已作答 {answered} / {paper.length}</small></h2>
      {submitted && <button className="button secondary" onClick={() => { setAnswers({}); setSubmitted(false); }}>重新考试</button>}
    </div>
    <div className="card-list">{paper.map((row, index) => <article className="card question-card" key={row.id}>
      <span className="eyebrow">第 {index + 1} 题</span>
      <MarkdownText className="question-prompt">{row.content.prompt}</MarkdownText>
      {submitted ? <>
        <div className="exam-response"><h4>我的作答</h4><MarkdownText>{answers[row.id] || '未作答'}</MarkdownText></div>
        <QuestionDetails question={row.content} sharedSource={sharedSource} />
      </> : <label>我的作答<textarea rows={4} placeholder="在这里写下你的答案或解题思路"
        value={answers[row.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [row.id]: event.target.value }))} /></label>}
    </article>)}</div>
    {!submitted && <div className="exam-submit">
      <p className="muted">作答保留在本次考试，交卷后统一查看参考答案。</p>
      <button className="button primary" onClick={() => { setSubmitted(true); window.scrollTo(0, 0); }}>交卷并查看答案<Check size={16} /></button>
    </div>}
  </>;
}

function splitTags(value) {
  return value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean);
}

function QuestionFields({ entry, update, staged, pending }) {
  const { id, content, tagInput } = entry;
  const tagInputId = `tag-input-${id}`;
  const markdownField = (name, rows, placeholder, required = false) => ({
    id: `question-${name}-${id}`,
    label: textFields[name].label,
    value: content[name],
    onChange: value => update({ content: { ...content, [name]: value } }),
    maxLength: textFields[name].max,
    rows, placeholder, required, staged, pending,
  });
  function addTags(event) {
    event.preventDefault();
    update({
      content: { ...content, tags: [...new Set([...content.tags, ...splitTags(tagInput)])] },
      tagInput: '',
    });
  }
  return <>
    <MarkdownField {...markdownField('prompt', 3, '用 Markdown 写题干，或将图片拖到这里', true)} />
    <MarkdownField {...markdownField('answer', 4, '填写参考答案或解题思路')} />
    <div className="tag-editor">
      <label htmlFor={tagInputId}>知识点</label>
      <div className="tag-input"><input id={tagInputId} value={tagInput} list="knowledge-tags" placeholder="输入标签，按回车添加"
        onChange={event => update({ tagInput: event.target.value })}
        onKeyDown={event => { if (event.key === 'Enter') addTags(event); }} />
        <button type="button" className="button secondary" disabled={!tagInput.trim()} onClick={addTags}>添加</button></div>
      <div className="chips">{content.tags.map(tag => <button key={tag} type="button" className="chip chip-remove" aria-label={`移除 ${tag}`}
        onClick={() => update({ content: { ...content, tags: content.tags.filter(item => item !== tag) } })}>{tag}<X size={12} /></button>)}</div>
    </div>
    <MarkdownField {...markdownField('notes', 3, '记录易错点或追问')} />
  </>;
}

function QuestionEditor({ initial, draft, multiple, companies, tags, topics, ownerId, onClose, onSave, onApprove }) {
  const [metadata, setMetadata] = useState(() => {
    const { topic, category, company, recruitment } = initial;
    return { topic, category, company, recruitment };
  });
  const [entries, setEntries] = useState([{ id: 0, content: initial, tagInput: '' }]);
  const [source, setSource] = useState(initial.source);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const nextId = useRef(1);
  const addedId = useRef(null);
  const staged = useRef(new Map());
  const matchedTopic = topics.get(topicKey({ ...metadata, topic: metadata.topic.trim(), company: metadata.company.trim() }));
  const inheritedSource = multiple ? matchedTopic?.source : '';
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (addedId.current === null) return;
    dialog.current.querySelector(`#question-prompt-${addedId.current}`)?.focus();
    addedId.current = null;
  }, [entries.length]);

  const field = name => ({
    value: metadata[name],
    onChange: event => setMetadata(current => ({ ...current, [name]: event.target.value })),
  });
  function addQuestion() {
    const id = nextId.current++;
    addedId.current = id;
    setEntries(current => [...current, { id, content: emptyQuestion, tagInput: '' }]);
  }
  function updateEntry(id, change) {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...change } : entry));
  }
  function selectTopic(event) {
    const selection = topics.get(event.target.value);
    if (!selection) return;
    const { topic, category, company, recruitment } = selection.content;
    setMetadata({ topic, category, company, recruitment });
  }
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      const { topic, company, category, recruitment } = metadata;
      const questions = entries.map(({ content, tagInput }, index) => {
        try {
          return normalizeQuestion({
            ...content, topic, company, category, recruitment, source: inheritedSource || source,
            tags: [...content.tags, ...splitTags(tagInput)],
          });
        } catch (failure) {
          if (entries.length === 1) throw failure;
          throw new Error(`第 ${index + 1} 题 · ${errorText(failure)}`);
        }
      });
      await saveImages(ownerId, questions, staged.current);
      if (event.nativeEvent.submitter?.value === 'approve') await onApprove(questions[0]);
      else await onSave(questions);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  }
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="editor-title">
    <div className="dialog-head">
      <div><span className="eyebrow">{draft ? '草稿审核' : '题库编辑'}</span>
        <h2 id="editor-title">{draft ? (draft.question_id ? '审核修改建议' : '审核新题') : (initial.prompt ? '编辑题目' : '新增题目')}</h2></div>
      <button type="button" className="icon-button" onClick={onClose} disabled={pending} aria-label="关闭"><X size={20} /></button>
    </div>
    <div className={draft?.base_content ? 'editor-grid' : undefined}>
      {draft?.base_content && <aside className="original">
        <h3>提交草稿时的原题</h3><Metadata question={draft.base_content} />
        {draft.base_content.topic && <p className="muted original-prompt">主题 · {draft.base_content.topic}</p>}
        <MarkdownText className="original-prompt">{draft.base_content.prompt}</MarkdownText><QuestionDetails question={draft.base_content} />
      </aside>}
      <form className="editor-form" onSubmit={submit}>
        {topics.size > 0 && <label>沿用已有主题<select value={topics.has(topicKey(metadata)) ? topicKey(metadata) : ''} onChange={selectTopic}>
          <option value="">选择主题并带入招聘信息</option>
          {[...topics.values()].map(({ key, content: saved }) => <option key={key} value={key}>
            {[saved.topic, saved.company, categories[saved.category], recruitmentLabels[saved.recruitment]].filter(Boolean).join(' · ')}
          </option>)}
        </select></label>}
        <label>主题<input {...field('topic')} maxLength={textFields.topic.max}
          placeholder="填写主题名称，可留空" /></label>
        <div className="form-grid">
          <label>公司<input {...field('company')} maxLength={textFields.company.max} placeholder="填写公司名称，可留空" /></label>
          {companies.length > 0 && <label>已有公司<select {...field('company')} value={companies.includes(metadata.company) ? metadata.company : ''}>
            <option value="">选择已有公司</option>
            {companies.map(company => <option key={company} value={company}>{company}</option>)}
          </select></label>}
        </div>
        <div className="form-grid">
          <label>类别<select {...field('category')}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>招聘类型<select {...field('recruitment')}>{Object.entries(recruitmentLabels).map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        <label>{inheritedSource ? '主题来源（自动沿用）' : '来源'}<input value={inheritedSource || source} readOnly={Boolean(inheritedSource)}
          onChange={event => setSource(event.target.value)} maxLength={textFields.source.max} placeholder="网页链接或来源说明" /></label>
        {multiple && <p className="editor-hint">本次录入的题目共用主题、招聘信息和来源。</p>}
        <datalist id="knowledge-tags">{tags.map(tag => <option key={tag} value={tag} />)}</datalist>
        {entries.map((entry, index) => <section className={multiple ? 'editor-question editor-question-card' : 'editor-question'}
          key={entry.id} aria-labelledby={multiple ? `question-title-${entry.id}` : undefined}>
          {multiple && <div className="editor-question-head">
            <h3 id={`question-title-${entry.id}`}>第 {index + 1} 题</h3>
            {entries.length > 1 && <button type="button" className="icon-button" aria-label={`移除第 ${index + 1} 题`} disabled={pending}
              onClick={() => setEntries(current => current.filter(item => item.id !== entry.id))}><Trash2 size={16} /></button>}
          </div>}
          <QuestionFields entry={entry} update={change => updateEntry(entry.id, change)} staged={staged.current} pending={pending} />
        </section>)}
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="dialog-actions">
          {multiple && <button type="button" className="button secondary" disabled={pending} onClick={addQuestion}><Plus size={17} />再加一题</button>}
          {draft && <button className="button secondary" value="save" disabled={pending}>保存草稿</button>}
          <button className="button primary" value={draft ? 'approve' : 'save'} disabled={pending}>{pending ? '正在保存…'
            : draft ? '确认入库' : entries.length > 1 ? `保存 ${entries.length} 道题` : '保存题目'}<Check size={16} /></button>
        </div>
      </form>
    </div>
  </dialog>;
}

function Confirm({ title, detail, busy, onCancel, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog className="confirm" ref={dialog} aria-labelledby="confirm-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="confirm-title">{title}</h2><p>{detail}</p>
    <div className="dialog-actions">
      <button className="button secondary" onClick={onCancel} disabled={busy}>取消</button>
      <button className="button danger" onClick={onConfirm} disabled={busy}>确认</button>
    </div>
  </dialog>;
}

function Bank({ ownerId }) {
  const [hash, setHash] = useState(() => location.hash.slice(1));
  const [path, query] = hash.split('?');
  const route = path === 'exam' || Object.hasOwn(tabs, path) ? path : 'library';
  const selectedTopic = new URLSearchParams(query).get('topic');
  const [bank, setBank] = useState({ questions: [], drafts: [] });
  const [filters, setFilters] = useState(emptyFilters);
  const [editor, setEditor] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState(null);
  const importInput = useRef(null);
  const loadingVersion = useRef(0);

  async function refresh() {
    const version = ++loadingVersion.current;
    setLoading(true);
    try {
      const next = await loadBank();
      if (version === loadingVersion.current) setBank(next);
    } catch (error) {
      if (version === loadingVersion.current) setNotice({ error: true, text: errorText(error) });
    } finally {
      if (version === loadingVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    const onHash = () => { setHash(location.hash.slice(1)); setNotice(null); };
    addEventListener('hashchange', onHash);
    refresh();
    return () => { removeEventListener('hashchange', onHash); loadingVersion.current++; };
  }, []);

  const { questions, drafts } = bank;
  const [companies, tags] = useMemo(() => [
    [...new Set(questions.map(row => row.content.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [...new Set(questions.flatMap(row => row.content.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  ], [questions]);
  const topics = useMemo(() => groupTopics(questions).groups, [questions]);
  const topic = selectedTopic && route !== 'drafts' ? topics.get(selectedTopic) : null;
  const filtered = questions.filter(({ content, mastery }) =>
    (!filters.category || filters.category === content.category)
    && (!filters.company || filters.company === content.company)
    && (!filters.tag || content.tags.includes(filters.tag))
    && (!filters.recruitment || filters.recruitment === content.recruitment)
    && (!filters.mastery || filters.mastery === (mastery || 'unrated')));
  const { groups, singles } = groupTopics(filtered);
  const listed = topic ? topic.rows : singles;

  async function mutate(action, text) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(text ? { text } : null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const report = error => setNotice({ error: true, text: errorText(error) });

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const rows = parseQuestionFile(await file.text()).map(content => ({ content }));
      await mutate(() => result(db.from('question_drafts').insert(rows)), `已导入 ${rows.length} 条待审核草稿。`);
    } catch (error) {
      report(error);
    }
  }

  async function download() {
    setExporting(true);
    setNotice(null);
    try {
      const { createMarkdownExport } = await import('./export-markdown');
      const file = await createMarkdownExport({
        rows: topic?.rows ?? questions, topic, downloadImage: name => downloadQuestionImage(ownerId, name),
      });
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      report(error);
    } finally {
      setExporting(false);
    }
  }

  function save(contents) {
    const [content] = contents;
    if (editor.draft) return mutate(() => updateRow('question_drafts', editor.row, { content }), '草稿已保存。');
    if (editor.row) return mutate(() => updateRow('questions', editor.row, { content }), '题目已更新。');
    const rows = contents.map(question => ({ content: question }));
    return mutate(() => result(db.from('questions').insert(rows)), `已添加 ${rows.length} 道题。`);
  }

  function approve(content) {
    return mutate(() => result(db.rpc('approve_question_draft', {
      draft_id: editor.row.id, expected_version: editor.row.version, approved_content: content,
    })), '草稿已确认入库。');
  }

  async function remove() {
    const table = deletion.draft ? 'question_drafts' : 'questions';
    try {
      await mutate(async () => {
        const deleted = await result(db.from(table).delete().eq('id', deletion.row.id)
          .eq('version', deletion.row.version).select('id').maybeSingle());
        if (!deleted) throw new Error('内容已经修改或删除，请刷新后重试。');
        setDeletion(null);
      }, deletion.draft ? '草稿已丢弃。' : '题目已删除。');
    } catch (error) {
      setDeletion(null);
      report(error);
    }
  }

  const newButton = <button className="button primary" onClick={() => {
    const { topic: title, company, category, recruitment } = topic?.content ?? emptyQuestion;
    setEditor({ initial: { ...emptyQuestion, topic: title, company, category, recruitment } });
  }}><Plus size={18} />新增题目</button>;
  return <>
    <header className="topbar"><div className="page topbar-inner">
      <Brand />
      <nav aria-label="主导航">{Object.entries(tabs).map(([key, label]) => <a href={`#${key}`} key={key}
        aria-current={route === key || (route === 'exam' && key === 'practice') ? 'page' : undefined}>{label}{key === 'drafts' && drafts.length > 0 && <span className="nav-count">{drafts.length}</span>}</a>)}</nav>
      <div className="toolbar">
        <button className="icon-button" aria-label="刷新题库" title="刷新题库" disabled={busy || loading}
          onClick={() => { setNotice(null); refresh(); }}><RefreshCw size={17} /></button>
        <button className="icon-button" aria-label="退出登录" title="退出登录" onClick={() => result(db.auth.signOut()).catch(report)}><LogOut size={17} /></button>
        <RepositoryLink />
      </div>
    </div></header>
    <main className="page dashboard">
      {route === 'library' && !selectedTopic && <section className="hero">
        <div className="hero-copy"><span className="eyebrow"><Layers size={15} />个人学习空间</span><h1>笔面试题库</h1>
          <p>把零散的题目整理进同一个地方，按公司和知识点随时复习。</p>
          <div className="hero-actions">{newButton}
            <a className="button secondary" href="#practice">开始练习<ArrowRight size={17} /></a></div>
        </div><Artwork />
      </section>}
      {route === 'practice' && !selectedTopic && <section className="section-heading"><span className="eyebrow"><BookOpen size={15} />刷题练习</span>
        <h1>按自己的节奏练习</h1><p className="muted">先回想解法，再展开答案并标记掌握状态。</p></section>}
      {route === 'drafts' && <section className="section-heading"><span className="eyebrow"><Sparkles size={15} />整理与审核</span>
        <h1>待审核草稿</h1><p className="muted">在这里查看 Codex 提交的题目，也可以从 JSON 导入一批待审核的新题。</p></section>}
      {notice && <p className={`notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {topic && <section className="section-heading topic-heading">
        <a className="back-link" href="#library"><ArrowLeft size={16} />返回题库</a>
        <h1>{topic.content.topic}</h1><Metadata question={{ ...topic.content, tags: [] }} />
        {topic.source && <div className="topic-source"><span>来源</span><Source value={topic.source} /></div>}
        <div className="hero-actions">
          {route !== 'library' && <a className="button secondary" href={topicLink('library', topic.key)}>学习题目</a>}
          {route !== 'practice' && <a className="button secondary" href={topicLink('practice', topic.key)}>逐题练习</a>}
          {route !== 'exam' && <a className="button primary" href={topicLink('exam', topic.key)}>开始考试<ArrowRight size={17} /></a>}
        </div>
      </section>}
      {!selectedTopic && (route === 'library' || route === 'practice') && <Filters filters={filters} setFilters={setFilters} companies={companies} tags={tags} />}
      {route === 'library' && <div className="section-line">
        <h2>{topic ? '主题题目' : '题目与主题'} <small>{topic ? topic.rows.length : filtered.length} 题</small></h2>
        <div className="section-actions">
          <button className="button secondary" onClick={download}
            disabled={exporting || loading || (selectedTopic && !topic) || !(topic?.rows.length ?? questions.length)}>
            <ArrowDownToLine size={16} />{exporting ? '正在导出…' : '导出 Markdown'}
          </button>
          {topic && newButton}
        </div>
      </div>}
      {route === 'drafts' && <div className="section-line">
        <h2>待处理 <small>{drafts.length} 条</small></h2>
        <input type="file" ref={importInput} accept=".json,application/json" hidden onChange={importFile} />
        <button className="button secondary" onClick={() => importInput.current.click()} disabled={busy || loading}><Upload size={16} />导入 JSON</button>
      </div>}
      {loading && !questions.length && !drafts.length ? <p className="loading" role="status">正在读取题库…</p>
        : (selectedTopic && route !== 'drafts' && !topic) || (route === 'exam' && !topic) ? <Empty title="找不到这个主题" detail="题目可能已移到其他主题。"
          action={<a className="button secondary" href="#library">返回题库</a>} />
        : route === 'exam' ? <Exam key={topic.key} rows={topic.rows} sharedSource={topic.source} />
        : route === 'practice' ? <Practice key={topic?.key ?? JSON.stringify(filters)} rows={topic?.rows ?? filtered} busy={busy} sharedSource={topic?.source}
          onMark={(row, mastery) => mutate(() => updateRow('questions', row, { mastery })).catch(report)} />
        : route === 'drafts' ? (drafts.length ? <div className="card-list">{drafts.map(row => <article className="card draft-card" key={row.id}>
          <span className="tile-icon"><FileText size={20} /></span>
          <div className="draft-copy"><span className="eyebrow">{row.question_id ? '修改建议' : '新增题目'}</span>
            <MarkdownText className="question-prompt">{row.content.prompt}</MarkdownText>
            {row.content.topic && <p className="muted draft-topic">{row.content.topic}</p>}<Metadata question={row.content} /></div>
          <div className="card-actions"><button className="icon-button" onClick={() => setDeletion({ row, draft: true })} aria-label="丢弃草稿"><Trash2 size={17} /></button>
            <button className="button secondary" onClick={() => setEditor({ row, draft: true })}>审核<ChevronRight size={16} /></button></div>
        </article>)}</div> : <Empty title="暂时没有草稿" detail="从 Codex 提交题目，或导入 JSON 后，草稿会出现在这里。" />)
        : (listed.length || (!topic && groups.size) ? <div className="card-list">
          {!topic && [...groups.values()].map(group => <article className="card topic-card" key={group.key}>
            <span className="tile-icon"><Layers size={21} /></span>
            <div className="draft-copy"><span className="eyebrow">主题 · {group.rows.length} 题</span>
              <h3><a href={topicLink('library', group.key)}>{group.content.topic}</a></h3>
              <Metadata question={{ ...group.content, tags: [] }} />
            </div>
            <a className="button secondary" href={topicLink('library', group.key)}>打开主题<ChevronRight size={16} /></a>
          </article>)}
          {listed.map(row => <article className="card question-card" key={row.id}>
          <div className="question-head"><Metadata question={row.content} mastery={row.mastery} />
            <div className="card-actions"><button className="icon-button" onClick={() => setEditor({ row })} aria-label="编辑题目"><Pencil size={17} /></button>
              <button className="icon-button" onClick={() => setDeletion({ row })} aria-label="删除题目"><Trash2 size={17} /></button></div></div>
          <MarkdownText className="question-prompt">{row.content.prompt}</MarkdownText><QuestionDetails question={row.content} sharedSource={topic?.source} />
        </article>)}</div> : <Empty title={questions.length ? '没有匹配的题目' : '从第一道题开始'}
          detail={questions.length ? '换个公司、知识点或掌握状态试试。' : '录入题干和参考答案，之后可以随时回来练习。'}
          action={!questions.length ? newButton : null} />)}
    </main>
    {editor && <QuestionEditor initial={editor.row?.content ?? editor.initial ?? emptyQuestion} draft={editor.draft ? editor.row : null} multiple={!editor.row}
      companies={companies} tags={tags} topics={topics} ownerId={ownerId} onClose={() => setEditor(null)} onSave={save} onApprove={approve} />}
    {deletion && <Confirm busy={busy} title={deletion.draft ? '丢弃这条草稿？' : '删除这道题？'}
      detail={deletion.draft ? '草稿会从待审核列表移除。' : '题目及其掌握状态将被删除。'} onCancel={() => setDeletion(null)} onConfirm={remove} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
