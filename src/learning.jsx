import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { categories, recruitmentLabels, sourceUrl } from '../supabase/functions/_shared/question.mjs';
import { db, errorText, listMaterials, result, updateRow } from './api';
import { MarkdownField, MarkdownText, saveImages } from './markdown';

const table = 'learning_materials';
const labels = { experiences: '网友经验', roadmaps: '学习路线' };
const newStep = () => ({ title: '', notes: '', topic: '', done: false });
const itemLink = (kind, id) => `#${kind}?${new URLSearchParams({ id })}`;
const topicLabel = ({ content: q }) => [q.topic, q.company, categories[q.category], recruitmentLabels[q.recruitment]].filter(Boolean).join(' · ');

function MaterialEditor({ kind, row, ownerId, companies, topics, onClose, onSaved }) {
  const roadmap = kind === 'roadmaps';
  const initial = row?.content;
  const [doc, setDoc] = useState(initial ?? { title: '', company: '', author: '', source: '', body: '' });
  const [steps, setSteps] = useState(() => (initial?.steps ?? (roadmap ? [newStep()] : []))
    .map(step => ({ ...step, key: crypto.randomUUID() })));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const staged = useRef(new Map());
  useEffect(() => { dialog.current.showModal(); }, []);
  const field = (name, maxLength) => ({ value: doc[name], maxLength,
    onChange: e => setDoc({ ...doc, [name]: e.target.value }) });
  function editStep(index, changes) {
    setSteps(current => current.map((step, i) => i === index ? { ...step, ...changes } : step));
  }
  function move(index, offset) {
    const reordered = [...steps];
    reordered.splice(index + offset, 0, reordered.splice(index, 1)[0]);
    setSteps(reordered);
  }
  async function submit(event) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const content = { ...doc, title: doc.title.trim(), company: doc.company.trim(),
        author: doc.author.trim(), source: doc.source.trim(),
        steps: steps.map(({ title, notes, topic, done }) => ({ title: title.trim(), notes, topic, done })) };
      if (!content.title) throw new Error('请填写标题。');
      if (!roadmap && !content.body.trim() && !content.source) throw new Error('请填写经验正文或来源。');
      const blank = content.steps.findIndex(step => !step.title);
      if (blank >= 0) throw new Error(`请填写第 ${blank + 1} 个阶段的名称。`);
      await saveImages(ownerId, [content.body, ...content.steps.map(step => step.notes)], staged.current);
      const saved = row ? await updateRow(table, row, { content })
        : await result(db.from(table).insert({ kind, content }).select().single());
      onSaved(saved);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  }
  return <dialog ref={dialog} aria-labelledby="material-editor-title"
    onCancel={e => { e.preventDefault(); if (!pending) onClose(); }}>
    <div className="dialog-head">
      <h2 id="material-editor-title">{row ? '编辑' : '新增'}{labels[kind]}</h2>
      <button type="button" className="icon-button" aria-label="关闭" disabled={pending} onClick={onClose}><X size={19} /></button>
    </div>
    <form onSubmit={submit}><fieldset className="editor-form material-fields" disabled={pending}>
      <label>标题<input {...field('title', 200)} required autoFocus placeholder={roadmap ? '例如：嵌入式 Linux 驱动学习路线' : '例如：大疆固件开发一面复盘'} /></label>
      <div className="form-grid">
        <label>公司<input {...field('company', 120)} list="material-companies" placeholder="可选，可直接输入" /></label>
        <datalist id="material-companies">{companies.map(name => <option key={name} value={name} />)}</datalist>
        <label>作者<input {...field('author', 160)} placeholder="可选，填写原作者" /></label>
      </div>
      <label>来源<input {...field('source', 2048)} placeholder="原帖链接或资料名称" /></label>
      <MarkdownField id="material-body" label={roadmap ? '路线说明' : '经验正文'} rows={6} maxLength={120000}
        value={doc.body} onChange={body => setDoc({ ...doc, body })} pending={pending} staged={staged.current} />
      {roadmap && <>
        {steps.map((step, index) => <section className="editor-question editor-question-card" key={step.key}>
          <div className="editor-question-head"><h3>阶段 {index + 1}</h3><div className="card-actions">
            <button type="button" className="icon-button" aria-label="上移阶段" disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label="下移阶段" disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="icon-button" aria-label="移除阶段" disabled={steps.length === 1}
              onClick={() => setSteps(steps.filter(s => s.key !== step.key))}><X size={16} /></button>
          </div></div>
          <label>阶段名称<input required maxLength={200} value={step.title} onChange={e => editStep(index, { title: e.target.value })} /></label>
          <label>关联题库主题<select value={step.topic} onChange={e => editStep(index, { topic: e.target.value })}>
            <option value="">不关联主题</option>
            {step.topic && !topics.has(step.topic) && <option value={step.topic}>原主题暂不可用</option>}
            {[...topics.values()].map(group => <option key={group.key} value={group.key}>{topicLabel(group)}</option>)}
          </select></label>
          <MarkdownField id={`notes-${step.key}`} label="阶段笔记" value={step.notes}
            onChange={notes => editStep(index, { notes })} maxLength={30000} rows={3} pending={pending} staged={staged.current} />
        </section>)}
        <button type="button" className="button secondary" disabled={steps.length >= 100}
          onClick={() => setSteps([...steps, { ...newStep(), key: crypto.randomUUID() }])}><Plus size={16} />添加阶段</button>
      </>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary">{pending ? '正在保存…' : '保存'}</button></div>
    </fieldset></form>
  </dialog>;
}

function RoadmapSteps({ row, topics, topicLink, busy, onToggle }) {
  const { steps } = row.content;
  const count = steps.filter(step => step.done).length;
  return <section aria-label="学习阶段">
    <div className="section-line"><h2>学习阶段 <small>{count} / {steps.length} 已完成</small></h2></div>
    <progress className="route-progress" aria-label="学习进度" value={count} max={steps.length} />
    <ol className="stage-list">{steps.map((step, index) => <li className="card stage-card" key={index}>
      <label className="stage-toggle"><input type="checkbox" checked={step.done} disabled={busy}
        onChange={() => onToggle(index)} aria-label={`完成阶段 ${index + 1}：${step.title}`} />
        <span><small>阶段 {index + 1}</small><strong>{step.title}</strong></span></label>
      {step.notes && <MarkdownText>{step.notes}</MarkdownText>}
      {step.topic && (topics.has(step.topic)
        ? <a className="button secondary" href={topicLink('library', step.topic)}><BookOpen size={16} />{topics.get(step.topic).content.topic}</a>
        : <p className="muted">关联主题暂不可用</p>)}
    </li>)}</ol>
  </section>;
}

export function LearningSpace({ kind, id, ownerId, topics, companies, topicLink, refreshKey, Confirm }) {
  const label = labels[kind];
  const roadmap = kind === 'roadmaps';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const token = ++sequence.current;
    setError('');
    const request = id ? result(db.from(table).select('*').eq('kind', kind).eq('id', id).maybeSingle()) : listMaterials(kind);
    request.then(value => { if (sequence.current === token) setData({ id, value }); })
      .catch(failure => { if (sequence.current === token) setError(errorText(failure)); });
    return () => { sequence.current++; };
  }, [kind, id, refreshKey, retry]);
  useEffect(() => { setEditing(null); setDeleting(null); }, [id]);
  const loaded = data?.id === id;
  const row = loaded && id ? data.value : null;
  const rows = loaded && !id ? data.value : [];
  const availableCompanies = [...new Set(rows.map(r => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const term = search.trim().toLocaleLowerCase();
  const visible = rows.filter(r => (!company || company === r.company)
    && [r.title, r.company, r.author].some(value => value.toLocaleLowerCase().includes(term)));

  function saved(next) {
    sequence.current++;
    setData({ id: next.id, value: next });
    setEditing(null);
    setError('');
    if (id !== next.id) location.hash = itemLink(kind, next.id);
  }
  async function toggle(index) {
    setBusy(true);
    const token = ++sequence.current;
    const steps = row.content.steps.map((step, i) => i === index ? { ...step, done: !step.done } : step);
    const content = { ...row.content, steps };
    setData({ id, value: { ...row, content } });
    try {
      const next = await updateRow(table, row, { content });
      if (token === sequence.current) setData({ id, value: next });
    } catch (failure) {
      if (token === sequence.current) { setData({ id, value: row }); setError(errorText(failure)); }
    }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      const deleted = await result(db.from(table).delete().eq('id', deleting.id).eq('version', deleting.version).select('id').maybeSingle());
      if (!deleted) throw new Error('资料已经修改或删除，请重新读取。');
      location.hash = kind;
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); setDeleting(null); }
  }
  const current = row?.content;
  const url = current && sourceUrl(current.source);
  return <>
    <section className="section-heading material-heading">
      {id && <a className="back-link" href={`#${kind}`}><ArrowLeft size={16} />返回{label}</a>}
      <div className="material-heading-line"><h1>{current?.title ?? label}</h1>
        {!id && <button className="button primary" onClick={() => setEditing({})}><Plus size={17} />{roadmap ? '新增路线' : '收藏经验'}</button>}
        {row && <div className="card-actions"><button className="button secondary" disabled={busy} onClick={() => setEditing({ row })}><Pencil size={16} />编辑</button>
          <button className="icon-button" disabled={busy} aria-label={`删除${label}`} onClick={() => setDeleting(row)}><Trash2 size={17} /></button></div>}
      </div>
      {current && <div className="material-meta">
        {current.company && <span className="chip">{current.company}</span>}
        {current.author && <span>作者 · {current.author}</span>}
        {current.source && (url ? <a href={url} target="_blank" rel="noreferrer">查看原文</a> : <span>来源 · {current.source}</span>)}
      </div>}
    </section>
    {error && <div className="notice error" role="alert">{error} <button className="button secondary" onClick={() => setRetry(n => n + 1)}>重新读取</button></div>}
    {!loaded && !error && <p className="loading" role="status">正在读取{label}…</p>}
    {loaded && id && !row && <div className="empty"><h2>找不到这份资料</h2><a href={`#${kind}`}>查看{label}</a></div>}
    {current?.body && <article className="card material-body"><MarkdownText>{current.body}</MarkdownText></article>}
    {current && roadmap && <RoadmapSteps row={row} topics={topics} topicLink={topicLink} busy={busy} onToggle={toggle} />}
    {loaded && !id && <>
      {rows.length > 0 && <div className="filter-bar material-filters">
        <label>搜索<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="标题、公司或作者" /></label>
        <label>公司<select value={company} onChange={e => setCompany(e.target.value)}><option value="">全部公司</option>
          {availableCompanies.map(name => <option key={name}>{name}</option>)}</select></label></div>}
      {visible.length ? <>
        <p className="material-count">{visible.length} {roadmap ? '条路线' : '篇经验'}</p>
        <div className="material-list">{visible.map(item => <a className="card material-card" key={item.id} href={itemLink(kind, item.id)}>
          <h2>{item.title}</h2><div className="material-meta">
            {item.company && <span className="chip">{item.company}</span>}{item.author && <span>{item.author}</span>}
          </div>
        </a>)}</div>
      </> : <section className="empty"><h2>{rows.length ? '没有匹配的资料' : `还没有${label}`}</h2>
        {rows.length ? <button className="button secondary" onClick={() => { setSearch(''); setCompany(''); }}>清除筛选</button>
          : <p>{roadmap ? '建立一条路线，从第一个学习阶段开始。' : '收藏一篇面经，记下原帖和对你有用的细节。'}</p>}
      </section>}
    </>}
    {editing && <MaterialEditor kind={kind} row={editing.row} topics={topics} companies={[...new Set([...availableCompanies, ...companies])]}
      ownerId={ownerId} onClose={() => setEditing(null)} onSaved={saved} />}
    {deleting && <Confirm title={`删除这份${label}？`} detail={deleting.content.title} busy={busy}
      onCancel={() => setDeleting(null)} onConfirm={remove} />}
  </>;
}
