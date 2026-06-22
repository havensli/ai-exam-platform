import { describe, it, expect } from 'vitest';
import { parseExamMarkdown } from './examMarkdownImport';

const FIXTURE = `# AI 考试题目：示例系统 V3
## 跨模块业务流程 —— 状态机 + 多表关联

## 一、项目背景

这是项目背景说明。

## 二、技术要求

| 项目 | 要求 |
|---|---|
| 技术栈 | Next.js |

## 三、核心数据模型与状态机

状态机说明文本。

## 四、功能需求

功能需求说明文本。

## 五、考点与评分标准（总分 100 分）

### 考点 1：项目搭建与部署(10 分)

| 评分要点 | 细则 |
|---|---|
| Vercel 部署 | 项目部署到 Vercel |

### 考点 2：UI 与交互体验(15 分)

| 评分要点 | 细则 |
|---|---|
| 风格统一 | 与系统视觉风格一致 |

### 考点 3：状态机设计(35 分，核心考点)

| 评分要点 | 细则 |
|---|---|
| 状态机完整性 | 覆盖所有分支 |

### 考点 4：多表关联与一致性(25 分，核心考点)

| 评分要点 | 细则 |
|---|---|
| 表结构设计 | 关联关系清晰 |

### 考点 5：需求理解与假设说明文档质量(15 分，核心考点)

| 评分要点 | 细则 |
|---|---|
| 关键留白点覆盖度 | 是否识别留白点 |

### 考点 6：满足延续性(附加项，0 分)

| 评分要点 | 细则 |
|---|---|
| 延续性 | 仅作参考 |

### 考点 7：反思题(0 分，不计分)

| 序号 | 题目 |
|---|---|
| 1 | 反思题内容 |

## 六、评分等级对照标准

| 职级 | 合格线 | 说明 |
|---|---|---|
| 资深工程师 | 90 分 | 要求严格 |
| 高级工程师 | 80 分 | 要求较高 |
| 中级工程师 | 70 分 | 要求中等 |
| 初级工程师 | 60 分 | 要求基础 |

## 七、提交要求

提交要求说明文本。

## 八、附:阅卷参考清单(仅供阅卷人使用，不对考生公开)

| 留白点 | 期望处理方式 |
|---|---|
| 分级审批阈值 | 自行设定并给出依据 |

## 九、考试纪律声明

纪律声明文本。
`;

describe('parseExamMarkdown', () => {
  const parsed = parseExamMarkdown(FIXTURE);

  it('extracts the title without the "AI 考试题目：" prefix', () => {
    expect(parsed.title).toBe('示例系统 V3');
  });

  it('only creates rubric items for scored 考点 (skips the two 0 分 ones)', () => {
    expect(parsed.rubricItems).toHaveLength(5);
    expect(parsed.rubricItems.map((i) => i.weight)).toEqual([10, 15, 35, 25, 15]);
  });

  it('sums scored rubric weights to 100', () => {
    expect(parsed.rubricItems.reduce((s, i) => s + i.weight, 0)).toBe(100);
  });

  it('flags 核心考点 items as isCore', () => {
    expect(parsed.rubricItems.map((i) => i.isCore)).toEqual([false, false, true, true, true]);
  });

  it('builds readable criteriaText from the rubric table rows', () => {
    expect(parsed.rubricItems[0].criteriaText).toBe('Vercel 部署：项目部署到 Vercel');
  });

  it('attaches the 阅卷参考清单 (section 八) to the 需求理解 rubric item hiddenNotes', () => {
    const reqItem = parsed.rubricItems.find((i) => i.name.includes('需求理解'));
    expect(reqItem?.hiddenNotes).toContain('阅卷参考清单');
    expect(reqItem?.hiddenNotes).toContain('分级审批阈值');
    parsed.rubricItems.filter((i) => !i.name.includes('需求理解')).forEach((i) => {
      expect(i.hiddenNotes).toBe('');
    });
  });

  it('parses level thresholds with correct level mapping', () => {
    expect(parsed.thresholds).toEqual([
      { level: 'staff', passScore: 90 },
      { level: 'senior', passScore: 80 },
      { level: 'mid', passScore: 70 },
      { level: 'junior', passScore: 60 },
    ]);
  });

  it('folds the two 0 分 考点 blocks into background instead of rubricItems', () => {
    expect(parsed.background).toContain('考点 6');
    expect(parsed.background).toContain('考点 7');
  });

  it('keeps sections 一/二/三/四/七/九 in background', () => {
    expect(parsed.background).toContain('这是项目背景说明');
    expect(parsed.background).toContain('功能需求说明文本');
    expect(parsed.background).toContain('提交要求说明文本');
    expect(parsed.background).toContain('纪律声明文本');
  });

  it('produces no warnings for a well-formed document', () => {
    expect(parsed.warnings).toEqual([]);
  });

  it('warns and falls back gracefully on malformed input', () => {
    const result = parseExamMarkdown('just some random text with no headings');
    expect(result.title).toBe('');
    expect(result.rubricItems).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
