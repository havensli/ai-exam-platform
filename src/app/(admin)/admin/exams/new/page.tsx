'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { parseExamMarkdown } from '@/lib/examMarkdownImport';

interface RubricItem {
  name: string;
  weight: number;
  criteriaText: string;
  isCore: boolean;
  hiddenNotes: string;
}

interface Threshold {
  level: 'junior' | 'mid' | 'senior' | 'staff';
  passScore: number;
}

const LEVELS: { value: Threshold['level']; label: string }[] = [
  { value: 'junior', label: '初级' },
  { value: 'mid', label: '中级' },
  { value: 'senior', label: '高级' },
  { value: 'staff', label: '资深' },
];

const emptyItem = (): RubricItem => ({ name: '', weight: 10, criteriaText: '', isCore: false, hiddenNotes: '' });

const defaultThresholds = (): Threshold[] => [
  { level: 'junior', passScore: 60 },
  { level: 'mid', passScore: 70 },
  { level: 'senior', passScore: 80 },
  { level: 'staff', passScore: 90 },
];

export default function NewExamPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">加载中...</div>}>
      <NewExamForm />
    </Suspense>
  );
}

function NewExamForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const examId = searchParams.get('examId');
  const isEditMode = Boolean(examId);

  const [title, setTitle] = useState('');
  const [background, setBackground] = useState('');
  const [runCommand, setRunCommand] = useState('pytest tests/ -v');
  const [installCommand, setInstallCommand] = useState('pip install -r requirements.txt');
  const [deadline, setDeadline] = useState('');
  const [rubricItems, setRubricItems] = useState<RubricItem[]>([emptyItem()]);
  const [thresholds, setThresholds] = useState<Threshold[]>(defaultThresholds());
  const [employeesList, setEmployeesList] = useState<{ id: string; name: string; department: string | null; level: string }[]>([]);
  const [targetEmployeeIds, setTargetEmployeeIds] = useState<string[]>([]);
  const [targetLevels, setTargetLevels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  const [error, setError] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/employees')
      .then((r) => r.json())
      .then(({ data }) => setEmployeesList(data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!examId) return;
    fetch(`/api/exams/${examId}`)
      .then((r) => r.json())
      .then(({ data, error: e }) => {
        if (e || !data) { setError(e ?? '加载考试失败'); return; }
        setTitle(data.title);
        setBackground(data.background);
        setRunCommand(data.runCommand);
        setInstallCommand(data.installCommand ?? '');
        setDeadline(data.deadline ? new Date(data.deadline).toISOString().slice(0, 16) : '');
        if (data.rubricItems?.length) {
          setRubricItems(data.rubricItems.map((item: RubricItem) => ({
            name: item.name,
            weight: item.weight,
            criteriaText: item.criteriaText,
            isCore: item.isCore,
            hiddenNotes: item.hiddenNotes ?? '',
          })));
        }
        if (data.levelThresholds?.length) {
          setThresholds(data.levelThresholds.map((t: { level: Threshold['level']; passScore: string | number }) => ({
            level: t.level,
            passScore: Number(t.passScore),
          })));
        }
      })
      .catch(() => setError('加载考试失败'))
      .finally(() => setLoading(false));
  }, [examId]);

  function updateItem(i: number, field: keyof RubricItem, value: string | number | boolean) {
    setRubricItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  function updateThreshold(level: string, score: number) {
    setThresholds((prev) => prev.map((t) => t.level === level ? { ...t, passScore: score } : t));
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseExamMarkdown(String(reader.result ?? ''));
      if (!parsed.title && parsed.rubricItems.length === 0) {
        setError('无法解析该 Markdown 文件，请检查格式是否符合考试题目模板');
        return;
      }
      setError('');
      setImportWarnings(parsed.warnings);
      if (parsed.title) setTitle(parsed.title);
      if (parsed.background) setBackground(parsed.background);
      if (parsed.rubricItems.length) setRubricItems(parsed.rubricItems);
      if (parsed.thresholds.length) setThresholds(parsed.thresholds);
    };
    reader.onerror = () => setError('读取文件失败，请重试');
    reader.readAsText(file);
  }

  const weightSum = rubricItems.reduce((s, i) => s + (Number(i.weight) || 0), 0);

  async function save(publish = false) {
    if (weightSum !== 100) {
      setError(`考点权重合计为 ${weightSum}，必须等于 100`);
      return;
    }
    const invalidIndex = rubricItems.findIndex(
      (item) => !item.name.trim() || !item.criteriaText.trim() || !Number.isInteger(item.weight) || item.weight < 1
    );
    if (invalidIndex !== -1) {
      setError(`考点 ${invalidIndex + 1} 信息不完整：名称、评分细则不能为空，权重分必须为 ≥1 的整数`);
      return;
    }
    if (!deadline || Number.isNaN(new Date(deadline).getTime())) {
      setError('请填写截止时间');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title,
        background,
        runCommand,
        installCommand,
        deadline: new Date(deadline).toISOString(),
        rubricItems: rubricItems.map((item, i) => ({ ...item, orderIndex: i })),
        thresholds,
      };

      const res = isEditMode
        ? await fetch(`/api/exams/${examId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/exams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const { data, error: e } = await res.json();
      if (e) { setError(e); return; }

      if (publish) {
        await fetch(`/api/exams/${(data.id ?? examId)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetEmployeeIds: targetEmployeeIds.length ? targetEmployeeIds : undefined,
            targetLevels: targetLevels.length ? targetLevels : undefined,
          }),
        });
      }

      router.push('/admin/exams');
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">{isEditMode ? '编辑考试' : '新建考试'}</h1>

      {!isEditMode && (
        <Section title="从 Markdown 模板导入">
          <p className="text-xs text-gray-500">
            上传符合「考试题目」模板格式的 .md 文件，自动填充标题、背景、考点权重与职级合格线。
            Run / Install 命令、目标员工范围模板中不包含，导入后请手动核对再保存。
          </p>
          <input type="file" accept=".md,.markdown,text/markdown" onChange={handleImportFile} className="text-sm" />
          {importWarnings.length > 0 && (
            <ul className="text-xs text-amber-600 list-disc pl-4 space-y-0.5">
              {importWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </Section>
      )}

      <Section title="基本信息">
        <Field label="考试标题 *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} placeholder="AI 实战考核 V1" required />
        </Field>
        <Field label="背景说明 *">
          <textarea value={background} onChange={(e) => setBackground(e.target.value)} className={`${inp} min-h-[80px]`} placeholder="考试背景和技术要求..." />
        </Field>
        <Field label="Run 命令 *">
          <input value={runCommand} onChange={(e) => setRunCommand(e.target.value)} className={inp} placeholder="pytest tests/ -v" />
        </Field>
        <Field label="Install 命令">
          <input value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} className={inp} placeholder="pip install -r requirements.txt" />
        </Field>
        <Field label="截止时间 *">
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inp} required />
        </Field>
      </Section>

      <Section title={`考点与评分标准（权重合计：${weightSum} / 100）`}>
        {weightSum !== 100 && (
          <p className="text-xs text-red-500">权重合计必须等于 100，当前为 {weightSum}</p>
        )}
        {rubricItems.map((item, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 relative">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500">考点名称</label>
                <input value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)} className={inp} placeholder="考点名称" />
              </div>
              <div className="w-20">
                <label className="text-xs text-gray-500">权重分</label>
                <input type="number" value={item.weight} onChange={(e) => updateItem(i, 'weight', Number(e.target.value))} className={inp} min={1} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">评分细则</label>
              <textarea value={item.criteriaText} onChange={(e) => updateItem(i, 'criteriaText', e.target.value)} className={`${inp} min-h-[60px]`} placeholder="评分细则..." />
            </div>
            <div>
              <label className="text-xs text-gray-500">留白备注（仅阅卷人可见）</label>
              <input value={item.hiddenNotes} onChange={(e) => updateItem(i, 'hiddenNotes', e.target.value)} className={inp} placeholder="阅卷参考..." />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.isCore} onChange={(e) => updateItem(i, 'isCore', e.target.checked)} />
              核心考点
            </label>
            {rubricItems.length > 1 && (
              <button
                onClick={() => setRubricItems((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs"
              >
                删除
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setRubricItems((prev) => [...prev, emptyItem()])}
          className="w-full border-2 border-dashed border-gray-300 text-gray-500 rounded-lg py-2 text-sm hover:border-brand-400 hover:text-brand-500 transition"
        >
          + 添加考点
        </button>
      </Section>

      <Section title="职级合格线">
        <div className="grid grid-cols-2 gap-3">
          {thresholds.map((t) => (
            <div key={t.level} className="flex items-center gap-2">
              <span className="text-sm w-10 text-gray-600">{LEVELS.find((l) => l.value === t.level)?.label}</span>
              <input
                type="number"
                value={t.passScore}
                onChange={(e) => updateThreshold(t.level, Number(e.target.value))}
                className={`${inp} w-full`}
                min={0}
                max={100}
              />
              <span className="text-sm text-gray-400">分</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="目标范围（发布时生效，留空表示全员广播）">
        <div>
          <label className="text-xs text-gray-500 block mb-1">按职级筛选</label>
          <div className="flex gap-3">
            {LEVELS.map((l) => (
              <label key={l.value} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={targetLevels.includes(l.value)}
                  onChange={(e) =>
                    setTargetLevels((prev) =>
                      e.target.checked ? [...prev, l.value] : prev.filter((v) => v !== l.value)
                    )
                  }
                />
                {l.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">按具体员工筛选（可多选）</label>
          <select
            multiple
            value={targetEmployeeIds}
            onChange={(e) => setTargetEmployeeIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            className={`${inp} h-32`}
          >
            {employeesList.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}（{emp.department ?? '未知部门'} / {emp.level}）
              </option>
            ))}
          </select>
        </div>
      </Section>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button onClick={() => save(false)} disabled={saving} className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 font-medium hover:bg-gray-50 disabled:opacity-50 transition">
          保存草稿
        </button>
        <button onClick={() => save(true)} disabled={saving} className="flex-1 bg-brand-600 text-white rounded-lg py-2.5 font-medium hover:bg-brand-700 disabled:opacity-50 transition">
          {saving ? '处理中...' : '保存并发布'}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
