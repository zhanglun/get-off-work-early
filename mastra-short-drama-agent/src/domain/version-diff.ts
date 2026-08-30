export interface DiffChange {
  path: string;
  before: unknown;
  after: unknown;
}

export function collectDiff(before: unknown, after: unknown, path = ''): DiffChange[] {
  if (Object.is(before, after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    return [{ path: path || '$', before, after }];
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    return [{ path: path || '$', before, after }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => collectDiff(
    (before as Record<string, unknown>)[key],
    (after as Record<string, unknown>)[key],
    path ? `${path}.${key}` : key,
  ));
}
