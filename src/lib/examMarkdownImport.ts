// Parses exam spec markdown files written against the "AI 考试题目" template
// (see e.g. exam-v3-exception-waybill-approval.md) into the shape the
// /admin/exams/new form expects. Sections are matched by the template's
// Chinese-numeral heading convention ("## 一、...", "### 考点 N:...(X 分)")
// rather than by exact wording, so future template revisions (V4, V5, ...)
// that keep the same structure should still parse.

export interface ParsedRubricItem {
  name: string;
  weight: number;
  criteriaText: string;
  isCore: boolean;
  hiddenNotes: string;
}

export type ExamLevel = 'junior' | 'mid' | 'senior' | 'staff';

export interface ParsedThreshold {
  level: ExamLevel;
  passScore: number;
}

export interface ParsedExam {
  title: string;
  background: string;
  rubricItems: ParsedRubricItem[];
  thresholds: ParsedThreshold[];
  warnings: string[];
}

const SECTION_HEADING_RE = /^##\s+([一二三四五六七八九十]+)、(.*)$/gm;
const RUBRIC_HEADING_RE = /^###\s+考点\s*(\d+)[:：]\s*(.+)$/gm;
const LEVEL_KEYWORDS: Record<string, ExamLevel> = {
  资深: 'staff',
  高级: 'senior',
  中级: 'mid',
  初级: 'junior',
};

function splitSections(markdown: string): Map<string, { title: string; body: string }> {
  const sections = new Map<string, { title: string; body: string }>();
  const matches = [...markdown.matchAll(SECTION_HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : markdown.length;
    sections.set(m[1], { title: m[2].trim(), body: markdown.slice(start, end).trim() });
  }
  return sections;
}

function tableRows(markdown: string): string[][] {
  const lines = markdown.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  return lines
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

function tableToText(markdown: string): string {
  const rows = tableRows(markdown);
  if (rows.length <= 1) return markdown.trim();
  return rows.slice(1).map((cells) => cells.filter(Boolean).join('：')).join('\n');
}

function parseThresholds(body: string): ParsedThreshold[] {
  const thresholds: ParsedThreshold[] = [];
  for (const cells of tableRows(body)) {
    if (cells.length < 2) continue;
    const levelKey = Object.keys(LEVEL_KEYWORDS).find((k) => cells[0].includes(k));
    const scoreMatch = cells[1].match(/(\d+)/);
    if (levelKey && scoreMatch) {
      thresholds.push({ level: LEVEL_KEYWORDS[levelKey], passScore: parseInt(scoreMatch[1], 10) });
    }
  }
  return thresholds;
}

function parseRubricSection(body: string): { items: ParsedRubricItem[]; extraBlocks: string[] } {
  const matches = [...body.matchAll(RUBRIC_HEADING_RE)];
  const items: ParsedRubricItem[] = [];
  const extraBlocks: string[] = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headingRest = m[2].trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    const blockBody = body.slice(start, end).trim();

    const parenMatch = headingRest.match(/^(.*?)\(([^)]*)\)\s*$/);
    const name = (parenMatch ? parenMatch[1] : headingRest).trim();
    const paren = parenMatch ? parenMatch[2] : '';
    const weightMatch = paren.match(/(\d+)\s*分/);
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : 0;
    const isCore = paren.includes('核心考点');

    if (weight > 0) {
      items.push({ name, weight, criteriaText: tableToText(blockBody), isCore, hiddenNotes: '' });
    } else {
      extraBlocks.push(`### 考点 ${m[1]}：${headingRest}\n\n${blockBody}`);
    }
  }

  return { items, extraBlocks };
}

export function parseExamMarkdown(markdown: string): ParsedExam {
  const warnings: string[] = [];
  const normalized = markdown.replace(/\r\n/g, '\n');

  const h1Match = normalized.match(/^#\s+(.+)$/m);
  let title = '';
  let afterH1 = normalized;
  if (h1Match) {
    title = h1Match[1].replace(/^AI\s*考试题目[:：]\s*/, '').trim();
    afterH1 = normalized.slice(h1Match.index! + h1Match[0].length);
  } else {
    warnings.push('未找到一级标题（# ...），考试标题需手动填写');
  }
  if (!title) warnings.push('未能从标题行解析出标题文本');

  let subtitle = '';
  const subtitleMatch = afterH1.match(/^\s*##\s+(.+)$/m);
  if (subtitleMatch && !/^[一二三四五六七八九十]+、/.test(subtitleMatch[1])) {
    subtitle = subtitleMatch[1].trim();
  }

  const sections = splitSections(normalized);
  const backgroundParts: string[] = [];
  if (subtitle) backgroundParts.push(subtitle);

  for (const numeral of ['一', '二', '三', '四']) {
    const s = sections.get(numeral);
    if (s) backgroundParts.push(`## ${numeral}、${s.title}\n\n${s.body}`);
  }

  let rubricItems: ParsedRubricItem[] = [];
  const fiveSection = sections.get('五');
  if (fiveSection) {
    const { items, extraBlocks } = parseRubricSection(fiveSection.body);
    rubricItems = items;
    if (extraBlocks.length) {
      backgroundParts.push(`## 五、${fiveSection.title}（附加/不计分考点）\n\n${extraBlocks.join('\n\n')}`);
    }
  } else {
    warnings.push('未找到"五、考点与评分标准"章节，考点需手动添加');
  }

  if (rubricItems.length === 0) {
    warnings.push('未解析出任何计分考点，请手动添加考点');
  } else {
    const weightSum = rubricItems.reduce((s, i) => s + i.weight, 0);
    if (weightSum !== 100) {
      warnings.push(`解析出的考点权重合计为 ${weightSum}，请检查是否应为 100`);
    }
  }

  const sixSection = sections.get('六');
  let thresholds: ParsedThreshold[] = [];
  if (sixSection) {
    thresholds = parseThresholds(sixSection.body);
    backgroundParts.push(`## 六、${sixSection.title}\n\n${sixSection.body}`);
  }
  if (thresholds.length === 0) {
    warnings.push('未解析出职级合格线，沿用表单默认值');
  }

  for (const numeral of ['七', '九']) {
    const s = sections.get(numeral);
    if (s) backgroundParts.push(`## ${numeral}、${s.title}\n\n${s.body}`);
  }

  const eightSection = sections.get('八');
  if (eightSection && rubricItems.length > 0) {
    const targetIdx = rubricItems.findIndex((it) => /需求理解|假设说明|留白/.test(it.name));
    const idx = targetIdx >= 0 ? targetIdx : rubricItems.length - 1;
    const noteBlock = `## ${eightSection.title}\n\n${eightSection.body}`;
    rubricItems[idx] = {
      ...rubricItems[idx],
      hiddenNotes: [rubricItems[idx].hiddenNotes, noteBlock].filter(Boolean).join('\n\n'),
    };
  } else if (eightSection) {
    backgroundParts.push(`## 八、${eightSection.title}\n\n${eightSection.body}`);
    warnings.push('未找到合适的考点承载"阅卷参考清单"，已并入背景说明');
  }

  return {
    title,
    background: backgroundParts.join('\n\n').trim(),
    rubricItems,
    thresholds,
    warnings,
  };
}
