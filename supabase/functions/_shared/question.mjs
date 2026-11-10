export const categories = { written: '笔试', interview: '面试' };
export const recruitmentLabels = { campus: '校招', experienced: '社招', unspecified: '未填写' };
export const masteryLabels = { known: '会', unsure: '模糊', unknown: '不会' };

export const emptyQuestion = {
  category: 'interview', recruitment: 'unspecified', topic: '',
  prompt: '', answer: '', company: '', source: '', tags: [], notes: '',
};

export const textFields = {
  topic: { label: '主题', max: 160 },
  prompt: { label: '题干', max: 12000 },
  answer: { label: '参考答案', max: 24000 },
  company: { label: '公司', max: 120 },
  source: { label: '来源', max: 2048 },
  notes: { label: '补充说明', max: 12000 },
};

export function normalizeQuestion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('每题需要是一个 JSON 对象');
  }
  if (typeof input.category !== 'string' || !Object.hasOwn(categories, input.category)) {
    throw new Error('类别应为 written 或 interview');
  }
  const recruitment = input.recruitment ?? 'unspecified';
  if (typeof recruitment !== 'string' || !Object.hasOwn(recruitmentLabels, recruitment)) {
    throw new Error('招聘类型应为 campus、experienced 或 unspecified');
  }
  const content = { category: input.category, recruitment };

  for (const [field, { label, max }] of Object.entries(textFields)) {
    const value = input[field] ?? '';
    if (typeof value !== 'string') throw new Error(`${label}应为文字`);
    if (value.includes('\0')) throw new Error(`${label}含有无效字符`);
    content[field] = value.trim();
    if (content[field].length > max) throw new Error(`${label}最多 ${max} 字符`);
  }
  if (!content.prompt) throw new Error('请填写题干');

  const tags = input.tags ?? [];
  if (!Array.isArray(tags)) throw new Error('知识点应为文字数组');
  if (tags.some(tag => typeof tag !== 'string' || tag.includes('\0') || tag.trim().length > 40)) {
    throw new Error('知识点应为不超过 40 字符的文字');
  }
  content.tags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (content.tags.length > 20) throw new Error('每题最多添加 20 个知识点');
  return content;
}

export function parseQuestionFile(text) {
  let file;
  try {
    file = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('无法解析 JSON 文件');
  }
  if (file?.schemaVersion !== 1 || !Array.isArray(file.questions)) {
    throw new Error('请选择 schemaVersion 为 1 且包含 questions 数组的 JSON 文件');
  }
  if (!file.questions.length) throw new Error('文件中没有题目');
  return file.questions.map((question, index) => {
    try {
      return normalizeQuestion(question);
    } catch (error) {
      throw new Error(`第 ${index + 1} 题 · ${error.message}`);
    }
  });
}

export function sourceUrl(value) {
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

export function topicKey({ topic, company, category, recruitment }) {
  return topic ? JSON.stringify([topic, company, category, recruitment]) : '';
}
