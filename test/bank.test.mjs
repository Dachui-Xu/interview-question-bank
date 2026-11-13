import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { normalizeQuestion, parseQuestionFile, sourceUrl, topicKey } from '../supabase/functions/_shared/question.mjs';

const question = normalizeQuestion({
  category: 'written', recruitment: 'campus', topic: '2026 年大疆固件开发',
  company: '大疆', prompt: '解释 volatile 的作用。', tags: ['C 语言', '嵌入式'],
});

test('JSON 往返保留主题与招聘类型，并指出无效题号', () => {
  const file = questions => JSON.stringify({ schemaVersion: 1, questions });
  assert.deepEqual(parseQuestionFile(file([question])), [question]);
  assert.equal(parseQuestionFile(file([{ category: 'written', prompt: '旧格式' }]))[0].recruitment, 'unspecified');
  assert.throws(() => parseQuestionFile(file([question, { ...question, category: ['written'] }])), /第 2 题/);
  assert.throws(() => parseQuestionFile(file([question, { ...question, prompt: ' ' }])), /第 2 题/);
  assert.throws(() => parseQuestionFile(file([{ ...question, recruitment: 'intern' }])), /第 1 题/);
  assert.notEqual(topicKey(question), topicKey({ ...question, recruitment: 'experienced' }));
  assert.notEqual(topicKey(question), topicKey({ ...question, category: 'interview' }));
  assert.equal(topicKey({ ...question, topic: '' }), '');
  assert.equal(sourceUrl('https://example.com/post'), 'https://example.com/post');
  assert.equal(sourceUrl('javascript:alert(1)'), null);
});

test('保存 Markdown 时保留缩进代码和换行，同时修剪公司名', () => {
  const content = normalizeQuestion({
    category: 'written', prompt: '    x = 1\n    y = 2\n', answer: '第一行  \n第二行\n', company: ' 公司 ',
  });
  assert.equal(content.prompt, '    x = 1\n    y = 2\n');
  assert.equal(content.answer, '第一行  \n第二行\n');
  assert.equal(content.company, '公司');
  assert.throws(() => normalizeQuestion({ ...content, prompt: ' \n\t ' }), /请填写题干/);
});

test('Postgres 隔离题库，限制 MCP 权限，事务审核草稿并检查版本', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated, anon, service_role;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261110000000_question_bank.sql', import.meta.url), 'utf8'));
    const owner = 'e5a35756-b2b2-411f-b49b-98c3d00895fe';
    const other = '3c536022-c785-4735-8898-de26f38fd459';
    await db.query('insert into auth.users(id) values ($1), ($2)', [owner, other]);
    const switchRole = async (role, user = '') => {
      await db.exec(`reset role; set role ${role};`);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    };

    await switchRole('anon');
    await assert.rejects(db.query('select * from public.questions'), /permission denied/);
    await assert.rejects(db.query('insert into public.questions(content) values ($1)', [question]), /permission denied/);

    await switchRole('authenticated', owner);
    const { rows: [initial] } = await db.query('insert into public.questions(content) values ($1) returning *', [question]);
    assert.equal(initial.version, 1);

    await switchRole('authenticated', other);
    assert.equal((await db.query('select * from public.questions')).rows.length, 0);
    assert.equal((await db.query("update public.questions set mastery = 'known' where id = $1 returning id", [initial.id])).rows.length, 0);
    await assert.rejects(db.query('insert into public.questions(owner_id, content) values ($1, $2)', [owner, question]), /permission denied/);

    await switchRole('service_role');
    await assert.rejects(db.query("update public.questions set mastery = 'known' where id = $1", [initial.id]), /permission denied/);
    const proposed = { ...question, answer: '提示编译器每次从对象读取。' };
    const { rows: [patch] } = await db.query(`
      insert into public.question_drafts(owner_id, content, question_id, base_version, base_content)
      values ($1, $2, $3, $4, $5) returning *
    `, [owner, proposed, initial.id, initial.version, initial.content]);
    const { rows: [addition] } = await db.query('insert into public.question_drafts(owner_id, content) values ($1, $2) returning *',
      [owner, { ...question, prompt: '中断中的共享变量如何处理？' }]);
    const approve = draft => db.query('select public.approve_question_draft($1, $2, $3)', [draft.id, draft.version, draft.content]);
    await assert.rejects(approve(patch), /permission denied/);

    await switchRole('authenticated', other);
    assert.equal((await db.query('select * from public.question_drafts')).rows.length, 0);
    await assert.rejects(approve(patch), /draft_changed/);

    await switchRole('authenticated', owner);
    assert.equal((await db.query('select content from public.questions where id = $1', [initial.id])).rows[0].content.answer, '');
    await db.query("update public.questions set mastery = 'known' where id = $1", [initial.id]);
    await approve(patch);
    await approve(addition);
    await assert.rejects(approve(addition), /draft_changed/);
    const { rows: [updated] } = await db.query('select * from public.questions where id = $1', [initial.id]);
    assert.equal(updated.content.answer, proposed.answer);
    assert.equal(updated.mastery, 'known');
    assert.equal(updated.version, 2);
    assert.equal((await db.query('select id from public.questions')).rows.length, 2);

    await switchRole('service_role');
    const { rows: [stale] } = await db.query(`
      insert into public.question_drafts(owner_id, content, question_id, base_version, base_content)
      values ($1, $2, $3, $4, $5) returning *
    `, [owner, question, updated.id, updated.version, updated.content]);
    await switchRole('authenticated', owner);
    await db.query('update public.questions set content = $1 where id = $2', [{ ...proposed, notes: '人工补充' }, updated.id]);
    await assert.rejects(approve(stale), /question_changed/);
    assert.equal((await db.query('select id from public.question_drafts')).rows.length, 1);
    await assert.rejects(db.query('insert into public.question_drafts(content) values ($1), ($2)',
      [question, { ...question, recruitment: 'bad' }]), /check constraint/);
    assert.equal((await db.query('select id from public.question_drafts')).rows.length, 1);
  } finally {
    await db.close();
  }
});
