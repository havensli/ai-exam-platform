export interface SubmissionForSummary {
  submissionId: string;
  employeeId: string;
  employeeLevel: string;
  aiTotalScore: number | null;
  humanFinalScore: number | null;
}

export interface LevelThresholdForSummary {
  level: string;
  passScore: number;
}

export interface ScoreBucket {
  bucket: string;
  count: number;
}

export interface LevelPassRate {
  passed: number;
  total: number;
  rate: number;
}

export interface AiVsHumanDeviation {
  avgDeviation: number;
  stdDeviation: number;
  sampleSize: number;
}

export interface ExamSummary {
  assignedCount: number;
  submittedCount: number;
  submissionRate: number;
  avgScore: number | null;
  maxScoreSeen: number | null;
  minScoreSeen: number | null;
  scoreDistribution: ScoreBucket[];
  passRateByLevel: Record<string, LevelPassRate>;
  aiVsHumanDeviation: AiVsHumanDeviation | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bucketLabel(i: number): string {
  return i === 9 ? '[90,100]' : `[${i * 10},${i * 10 + 10})`;
}

/**
 * Pure aggregation over already-fetched rows — kept separate from the DB
 * queries so it can be unit tested without a live Postgres connection.
 */
export function computeExamSummary(
  assignedCount: number,
  submissions: SubmissionForSummary[],
  thresholds: LevelThresholdForSummary[],
): ExamSummary {
  const submittedCount = submissions.length;
  const submissionRate = assignedCount > 0 ? round2(submittedCount / assignedCount) : 0;

  const reviewedScores = submissions
    .filter((s): s is SubmissionForSummary & { humanFinalScore: number } => s.humanFinalScore !== null)
    .map((s) => s.humanFinalScore);

  const avgScore = reviewedScores.length
    ? round2(reviewedScores.reduce((a, b) => a + b, 0) / reviewedScores.length)
    : null;
  const maxScoreSeen = reviewedScores.length ? Math.max(...reviewedScores) : null;
  const minScoreSeen = reviewedScores.length ? Math.min(...reviewedScores) : null;

  const scoreDistribution: ScoreBucket[] = Array.from({ length: 10 }, (_, i) => ({
    bucket: bucketLabel(i),
    count: 0,
  }));
  for (const score of reviewedScores) {
    const idx = score >= 100 ? 9 : Math.max(0, Math.min(9, Math.floor(score / 10)));
    scoreDistribution[idx].count += 1;
  }

  const thresholdMap = new Map(thresholds.map((t) => [t.level, t.passScore]));
  const passRateByLevel: Record<string, LevelPassRate> = {};
  for (const s of submissions) {
    if (s.humanFinalScore === null) continue;
    const passScore = thresholdMap.get(s.employeeLevel);
    if (passScore === undefined) continue;
    const entry = passRateByLevel[s.employeeLevel] ?? { passed: 0, total: 0, rate: 0 };
    entry.total += 1;
    if (s.humanFinalScore >= passScore) entry.passed += 1;
    passRateByLevel[s.employeeLevel] = entry;
  }
  for (const level of Object.keys(passRateByLevel)) {
    const entry = passRateByLevel[level];
    entry.rate = entry.total > 0 ? round2(entry.passed / entry.total) : 0;
  }

  const deviations = submissions
    .filter((s) => s.humanFinalScore !== null && s.aiTotalScore !== null)
    .map((s) => (s.humanFinalScore as number) - (s.aiTotalScore as number));

  let aiVsHumanDeviation: AiVsHumanDeviation | null = null;
  if (deviations.length) {
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const variance = deviations.reduce((a, b) => a + (b - avgDeviation) ** 2, 0) / deviations.length;
    aiVsHumanDeviation = {
      avgDeviation: round2(avgDeviation),
      stdDeviation: round2(Math.sqrt(variance)),
      sampleSize: deviations.length,
    };
  }

  return {
    assignedCount,
    submittedCount,
    submissionRate,
    avgScore,
    maxScoreSeen,
    minScoreSeen,
    scoreDistribution,
    passRateByLevel,
    aiVsHumanDeviation,
  };
}
