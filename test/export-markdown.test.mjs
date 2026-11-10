import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createMarkdownExport } from '../src/export-markdown.js';
import { normalizeQuestion } from '../supabase/functions/_shared/question.mjs';

const name = 'e06c8d6d-cb2b-4817-890c-8d9ce8939e4c.png';
const path = `question-images/${name}`;
const row = content => ({ content: normalizeQuestion({ category: 'written', ...content }) });

test('保留原始 Markdown，将去重后的上传图片放在文档引用的路径', async () => {
  const referenceName = '2b36a853-e1ac-4806-b7f9-9c2683395cf1.jpg';
  const referencePath = `question-images/${referenceName}`;
  const prompt = `**寄存器**\n\n![示意图](${path} "插图")`;
  const answer = `| 字段 | 含义 |\n| --- | --- |\n| bit0 | 启用 |\n\n![同一张图](${path})\n\n![引用图][图]\n\n[图]: ./${referencePath}`;
  const source = 'https://example.com/questions';
  const first = row({ topic: '固件 / 笔试', company: '某公司', prompt, answer, source });
  const topic = { content: first.content, source };
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const downloaded = [];
  const file = await createMarkdownExport({
    rows: [first, row({ prompt: '另一道题', notes: '![外链图](https://example.com/diagram.png)', source })],
    topic,
    downloadImage: async filename => {
      downloaded.push(filename);
      return new Blob([bytes], { type: 'image/png' });
    },
  });

  assert.equal(file.name, '题库 - 固件 笔试.zip');
  const files = unzipSync(new Uint8Array(await file.blob.arrayBuffer()));
  const markdown = strFromU8(files[file.name.replace(/\.zip$/, '.md')]);
  assert.deepEqual(downloaded, [name, referenceName]);
  assert.deepEqual(files[path], bytes);
  assert.deepEqual(files[referencePath], bytes);
  assert.ok(markdown.includes(prompt));
  assert.ok(markdown.includes(answer));
  assert.ok(markdown.includes('![外链图](https://example.com/diagram.png)'));
  assert.equal(markdown.split(source).length, 2);
});

test('无上传图片时直接导出 Markdown，代码示例中的图片语法保持原样', async () => {
  const answer = ['```markdown', `![示例](${path})`, '```'].join('\n');
  const file = await createMarkdownExport({
    rows: [row({ prompt: '说明语法', answer })],
    downloadImage: async () => assert.fail('代码示例不应下载图片'),
  });
  assert.equal(file.name, '笔面试题库.md');
  assert.ok((await file.blob.text()).includes(answer));
});

test('上传图片下载失败时不生成缺图的导出包', async () => {
  await assert.rejects(createMarkdownExport({
    rows: [row({ prompt: `![题图](${path})` })],
    downloadImage: async () => { throw new Error('not found'); },
  }), /无法下载图片/);
});
