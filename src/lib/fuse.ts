type FuseOptions<T> = {
  keys: Array<keyof T>;
  threshold?: number;
  ignoreLocation?: boolean;
};

type FuseResult<T> = {
  item: T;
  score: number;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const levenshtein = (a: string, b: string): number => {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const matrix = Array.from({ length: aLen + 1 }, () => new Array<number>(bLen + 1));

  for (let i = 0; i <= aLen; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[aLen][bLen];
};

const scoreFor = (query: string, target: string): number => {
  if (!query || !target) return 1;
  if (target.includes(query)) return 0;
  const distance = levenshtein(query, target);
  const length = Math.max(query.length, target.length);
  return length ? distance / length : 1;
};

class Fuse<T> {
  private list: T[];
  private keys: Array<keyof T>;
  private threshold: number;

  constructor(list: T[], options: FuseOptions<T>) {
    this.list = list;
    this.keys = options.keys;
    this.threshold = options.threshold ?? 0.4;
  }

  search(pattern: string): Array<FuseResult<T>> {
    const normalizedQuery = normalize(pattern);
    if (!normalizedQuery) return [];

    const results: Array<FuseResult<T>> = [];

    this.list.forEach((item) => {
      let bestScore = 1;
      this.keys.forEach((key) => {
        const value = item[key];
        if (typeof value !== 'string') return;
        const normalizedValue = normalize(value);
        const score = scoreFor(normalizedQuery, normalizedValue);
        if (score < bestScore) {
          bestScore = score;
        }
      });

      if (bestScore <= this.threshold) {
        results.push({ item, score: bestScore });
      }
    });

    return results.sort((a, b) => a.score - b.score);
  }
}

export type { FuseOptions, FuseResult };
export default Fuse;
