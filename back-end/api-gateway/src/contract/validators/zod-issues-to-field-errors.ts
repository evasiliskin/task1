import { type IFieldError } from '@task1/shared/errors/index';
import { type z } from 'zod';

// Request schemas nest under params/query/body (see model-binder.decorator.ts). The handler
// receives them merged flat, so the client-facing field name drops the section prefix.
const REQUEST_SECTIONS = new Set(['params', 'query', 'body']);

function toField(path: readonly PropertyKey[]): string {
  const segments = path.map(String);

  return segments.length > 0 && REQUEST_SECTIONS.has(segments[0] ?? '')
    ? segments.slice(1).join('.')
    : segments.join('.');
}

function toConstraints(issue: z.core.$ZodIssue): Record<string, number> | undefined {
  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    return { min: issue.minimum };
  }

  if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
    return { max: issue.maximum };
  }

  return undefined;
}

export function toFieldErrors(issues: readonly z.core.$ZodIssue[]): IFieldError[] {
  return issues.map((issue) => {
    const constraints = toConstraints(issue);

    return {
      field: toField(issue.path),
      errorType: issue.code.toUpperCase(),
      message: issue.message,
      ...(constraints !== undefined && { constraints }),
    };
  });
}
