import { createClient } from '@supabase/supabase-js';
import { questionImageBucket } from './question-images';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const db = url?.startsWith('https://') && key?.startsWith('sb_publishable_')
  ? createClient(url, key)
  : null;

const messages = {
  draft_changed: '草稿已经修改或移除，请刷新后重新查看。',
  question_changed: '原题已经修改或删除。这份草稿已保留，请对照当前题目后处理。',
  'Invalid login credentials': '邮箱或密码有误。',
  'Failed to fetch': '无法连接题库，请检查网络或 Supabase 项目是否处于运行状态。',
};
const cacheLifetime = 2 * 60 * 1000;

function cacheKey(ownerId, key) {
  return `answer-room:v1:${ownerId}:${key}`;
}

function readCache(ownerId, key) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(ownerId, key)) ?? 'null');
    return cached && Date.now() - cached.savedAt < cacheLifetime ? cached.value : null;
  } catch {
    return null;
  }
}

function writeCache(ownerId, key, value) {
  try {
    localStorage.setItem(cacheKey(ownerId, key), JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Quota or private-browsing restrictions should not interrupt bank access.
  }
}

export function errorText(error) {
  return messages[error?.message] ?? error?.message ?? '操作失败，请重试。';
}

export async function result(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export function downloadQuestionImage(ownerId, name) {
  return result(db.storage.from(questionImageBucket).download(`${ownerId}/${name}`));
}

async function listAll(table, columns = '*', filters = {}) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await result(db.from(table).select(columns).match(filters).order('created_at', { ascending: false })
      .order('id').range(offset, offset + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function listMaterials(kind, ownerId, { force = false } = {}) {
  const key = `materials:${kind}`;
  if (!force) {
    const cached = readCache(ownerId, key);
    if (cached) {
      void listAll('learning_materials', 'id,title:content->>title,company:content->>company,author:content->>author', { kind })
        .then(value => writeCache(ownerId, key, value)).catch(() => {});
      return cached;
    }
  }
  const value = await listAll('learning_materials', 'id,title:content->>title,company:content->>company,author:content->>author', { kind });
  writeCache(ownerId, key, value);
  return value;
}

export async function loadBank(ownerId, { force = false } = {}) {
  const key = 'bank';
  if (!force) {
    const cached = readCache(ownerId, key);
    if (cached) {
      void Promise.all([listAll('questions'), listAll('question_drafts')])
        .then(([questions, drafts]) => writeCache(ownerId, key, { questions, drafts })).catch(() => {});
      return cached;
    }
  }
  const [questions, drafts] = await Promise.all([listAll('questions'), listAll('question_drafts')]);
  const value = { questions, drafts };
  writeCache(ownerId, key, value);
  return value;
}

export async function loadMaterial(kind, id, ownerId, { force = false } = {}) {
  const key = `material:${kind}:${id}`;
  if (!force) {
    const cached = readCache(ownerId, key);
    if (cached) {
      void result(db.from('learning_materials').select('*').eq('kind', kind).eq('id', id).maybeSingle())
        .then(value => writeCache(ownerId, key, value)).catch(() => {});
      return cached;
    }
  }
  const value = await result(db.from('learning_materials').select('*').eq('kind', kind).eq('id', id).maybeSingle());
  writeCache(ownerId, key, value);
  return value;
}

export async function updateRow(table, row, values) {
  const saved = await result(db.from(table).update(values).eq('id', row.id)
    .eq('version', row.version).select().maybeSingle());
  if (!saved) throw new Error('内容已经修改或删除，请刷新后重试。');
  return saved;
}
