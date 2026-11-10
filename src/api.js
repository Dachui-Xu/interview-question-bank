import { createClient } from '@supabase/supabase-js';

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

export function errorText(error) {
  return messages[error?.message] ?? error?.message ?? '操作失败，请重试。';
}

export async function result(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

async function listAll(table) {
  const rows = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = await result(db.from(table).select('*').order('created_at', { ascending: false })
      .order('id').range(offset, offset + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function loadBank() {
  const [questions, drafts] = await Promise.all([listAll('questions'), listAll('question_drafts')]);
  return { questions, drafts };
}

export async function updateRow(table, row, values) {
  const saved = await result(db.from(table).update(values).eq('id', row.id)
    .eq('version', row.version).select().maybeSingle());
  if (!saved) throw new Error('内容已经修改或删除，请刷新后重试。');
  return saved;
}
