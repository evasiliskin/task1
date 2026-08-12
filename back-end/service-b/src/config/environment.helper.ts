export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// eslint-disable-next-line unicorn/prevent-abbreviations -- name is fixed by the plan/consumers (NODE_ENV)
export function getNodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}
