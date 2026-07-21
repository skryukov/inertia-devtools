/**
 * Type guard: value is a non-null, non-array object with at least one key.
 */
export function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

/**
 * Depth-cap sentinel written by the store's safeClone. Anything comparing
 * captured values (the props diff) must treat it as unknowable — two
 * truncated subtrees comparing "equal" says nothing about the real values.
 */
export const TOO_DEEP = '[too deep]'
