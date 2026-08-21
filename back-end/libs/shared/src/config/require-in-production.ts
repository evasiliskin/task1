import { isProduction } from './environment.helper.js';

export function requireInProduction(
  value: string | undefined,
  variableName: string,
  developmentFallback: string,
): string {
  if (value !== undefined && value.length > 0) {
    return value;
  }

  if (isProduction()) {
    throw new Error(
      `${variableName} must be set in production; refusing to fall back to "${developmentFallback}"`,
    );
  }

  return developmentFallback;
}
