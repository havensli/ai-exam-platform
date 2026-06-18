import { describe, it, expect } from 'vitest';
import { computeExamSummary, type SubmissionForSummary, type LevelThresholdForSummary } from './exam-summary';

function sub(overrides: Partial<SubmissionForSummary> = {}): SubmissionForSummary {
  return {
    submissionId: 'sub-1',
    employeeId: 'emp-1',
    employeeLevel: 'junior',
    aiTotalScore: null,
    humanFinalScore: null,
    ...overrides,
  };
}

describe('computeExamSummary', () => {
  it('computes assigned/submitted counts and submission rate', () => {
    const result = computeExamSummary(10, [sub(), sub(), sub()], []);
    expect(result.assignedCount).toBe(10);
    expect(result.submittedCount).toBe(3);
    expect(result.submissionRate).toBe(0.3);
  });

  it('returns a submission rate of 0 when nobody is assigned', () => {
    const result = computeExamSummary(0, [], []);
    expect(result.submissionRate).toBe(0);
  });

  it('computes avg/max/min from human-reviewed scores only', () => {
    const subs = [60, 70, 80, 90, 100].map((score) => sub({ humanFinalScore: score }));
    const result = computeExamSummary(5, subs, []);
    expect(result.avgScore).toBe(80);
    expect(result.maxScoreSeen).toBe(100);
    expect(result.minScoreSeen).toBe(60);
  });

  it('excludes submissions without a human review from avg/max/min', () => {
    const subs = [sub({ humanFinalScore: 80 }), sub({ humanFinalScore: null })];
    const result = computeExamSummary(2, subs, []);
    expect(result.avgScore).toBe(80);
    expect(result.submittedCount).toBe(2); // still counted as submitted
  });

  it('buckets scores into 10-point ranges, including the closed [90,100] bucket', () => {
    const subs = [55, 65, 95, 100].map((score) => sub({ humanFinalScore: score }));
    const result = computeExamSummary(4, subs, []);
    const byBucket = Object.fromEntries(result.scoreDistribution.map((b) => [b.bucket, b.count]));
    expect(byBucket['[50,60)']).toBe(1);
    expect(byBucket['[60,70)']).toBe(1);
    expect(byBucket['[90,100]']).toBe(2);
  });

  it('computes pass rate per level against the matching threshold', () => {
    const thresholds: LevelThresholdForSummary[] = [
      { level: 'senior', passScore: 80 },
      { level: 'junior', passScore: 60 },
    ];
    const subs = [
      sub({ employeeLevel: 'senior', humanFinalScore: 85 }),
      sub({ employeeLevel: 'senior', humanFinalScore: 70 }),
      sub({ employeeLevel: 'senior', humanFinalScore: 90 }),
      sub({ employeeLevel: 'junior', humanFinalScore: 50 }),
      sub({ employeeLevel: 'junior', humanFinalScore: 65 }),
      sub({ employeeLevel: 'junior', humanFinalScore: 70 }),
      sub({ employeeLevel: 'junior', humanFinalScore: 80 }),
    ];
    const result = computeExamSummary(7, subs, thresholds);
    expect(result.passRateByLevel.senior).toEqual({ passed: 2, total: 3, rate: 0.67 });
    expect(result.passRateByLevel.junior).toEqual({ passed: 3, total: 4, rate: 0.75 });
  });

  it('computes AI-vs-human average deviation and standard deviation', () => {
    const subs = [
      sub({ aiTotalScore: 70, humanFinalScore: 75 }),
      sub({ aiTotalScore: 80, humanFinalScore: 78 }),
      sub({ aiTotalScore: 90, humanFinalScore: 95 }),
    ];
    const result = computeExamSummary(3, subs, []);
    expect(result.aiVsHumanDeviation).not.toBeNull();
    expect(result.aiVsHumanDeviation?.sampleSize).toBe(3);
    expect(result.aiVsHumanDeviation?.avgDeviation).toBeCloseTo(2.67, 1);
  });

  it('returns null deviation when no submission has both an AI score and a human review', () => {
    const subs = [sub({ aiTotalScore: 70, humanFinalScore: null }), sub({ aiTotalScore: null, humanFinalScore: 80 })];
    const result = computeExamSummary(2, subs, []);
    expect(result.aiVsHumanDeviation).toBeNull();
  });

  it('handles a freshly published exam with zero submissions without throwing', () => {
    const result = computeExamSummary(5, [], [{ level: 'junior', passScore: 60 }]);
    expect(result.submittedCount).toBe(0);
    expect(result.avgScore).toBeNull();
    expect(result.scoreDistribution.every((b) => b.count === 0)).toBe(true);
    expect(result.passRateByLevel).toEqual({});
  });
});
