import { strToU8, zip } from 'fflate';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { categories, recruitmentLabels } from '../supabase/functions/_shared/question.mjs';
import { questionImageBucket, questionImageName } from './question-images.js';

const parser = unified().use(remarkParse).use(remarkGfm);

function collectImages(markdown, images) {
  const tree = parser.parse(markdown);
  const definitions = new Map();
  visit(tree, 'definition', ({ identifier, url }) => {
    if (!definitions.has(identifier)) definitions.set(identifier, url);
  });
  visit(tree, ['image', 'imageReference'], node => {
    const path = node.type === 'image' ? node.url : definitions.get(node.identifier);
    const name = questionImageName(path);
    if (name) images.add(name);
  });
}

function plainMarkdown(value) {
  return value.replace(/\s*\n\s*/g, ' ').replace(/[\\`*_{}\[\]<>#|~]/g, '\\$&');
}

export async function createMarkdownExport({ rows, topic, downloadImage }) {
  const title = topic?.content.topic || '笔面试题库';
  const fileTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ')
    .trim().slice(0, 80).replace(/[. ]+$/, '');
  const basename = topic ? `题库 - ${fileTitle || '主题'}` : title;
  const parts = [`# ${plainMarkdown(title)}`];
  const images = new Set();

  function addSection(heading, content) {
    if (!content) return;
    parts.push(heading, content);
    collectImages(content, images);
  }

  addSection('## 主题来源', topic?.source);
  for (const [index, { content }] of rows.entries()) {
    const fields = [
      ['主题', topic ? '' : content.topic],
      ['公司', content.company],
      ['类别', categories[content.category]],
      ['招聘类型', recruitmentLabels[content.recruitment]],
      ['知识点', content.tags?.join('、')],
    ];
    parts.push(`## 第 ${index + 1} 题`, fields.filter(([, value]) => value)
      .map(([label, value]) => `- **${label}** ${plainMarkdown(value)}`).join('\n'));
    addSection('### 题干', content.prompt);
    addSection('### 参考答案', content.answer);
    addSection('### 补充说明', content.notes);
    if (content.source !== topic?.source) addSection('### 来源', content.source);
  }

  const markdown = parts.join('\n\n') + '\n';
  if (!images.size) {
    return { name: `${basename}.md`, blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }) };
  }

  const files = { [`${basename}.md`]: strToU8(markdown) };
  const names = [...images];
  for (let start = 0; start < names.length; start += 4) {
    await Promise.all(names.slice(start, start + 4).map(async name => {
      try {
        const image = await downloadImage(name);
        if (!image.size) throw new Error('图片文件为空');
        files[`${questionImageBucket}/${name}`] = new Uint8Array(await image.arrayBuffer());
      } catch (cause) {
        throw new Error(`无法下载图片 ${name}，请重试导出。`, { cause });
      }
    }));
  }
  const archive = await new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => { if (error) reject(error); else resolve(data); });
  });
  return { name: `${basename}.zip`, blob: new Blob([archive], { type: 'application/zip' }) };
}
