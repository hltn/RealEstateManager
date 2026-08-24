import { cosineSimilarity } from './cosine-similarity.util';

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 10);
  });

  it('should return 1 for scaled identical vectors', () => {
    const vecA = [1, 2, 3];
    const vecB = [2, 4, 6]; // scaled by 2
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 10);
  });

  it('should return 0 for orthogonal vectors', () => {
    const vecA = [1, 0];
    const vecB = [0, 1];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 10);
  });

  it('should return -1 for opposite vectors', () => {
    const vecA = [1, 2, 3];
    const vecB = [-1, -2, -3];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 10);
  });

  it('should return 0 for zero vector', () => {
    const vecA = [0, 0, 0];
    const vecB = [1, 2, 3];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it('should throw error for vectors with different dimensions', () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2];
    expect(() => cosineSimilarity(vecA, vecB)).toThrow(
      'Vectors must have same dimensions: got 3 and 2',
    );
  });

  it('should handle single-element vectors', () => {
    expect(cosineSimilarity([5], [5])).toBeCloseTo(1.0, 10);
    expect(cosineSimilarity([5], [-5])).toBeCloseTo(-1.0, 10);
  });

  it('should return correct value for partially similar vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 1, 0];
    // cos(angle) = 1 / sqrt(2) ≈ 0.7071
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.7071, 4);
  });
});
