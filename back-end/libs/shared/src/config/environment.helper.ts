export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// eslint-disable-next-line unicorn/prevent-abbreviations -- `getNodeEnv` matches the `NODE_ENV` variable it reads; the plan's public API name.
export function getNodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}
