import { describe, it, expect } from 'vitest';
import { sumRubricWeights } from './api';

describe('sumRubricWeights', () => {
  it('sums weights across rubric items', () => {
    expect(sumRubricWeights([{ weight: 30 }, { weight: 30 }, { weight: 40 }])).toBe(100);
  });

  it('returns 0 for an empty list', () => {
    expect(sumRubricWeights([])).toBe(0);
  });

  it('does not implicitly clamp or round — callers compare the raw sum to 100', () => {
    expect(sumRubricWeights([{ weight: 45 }, { weight: 50 }])).toBe(95);
  });
});
