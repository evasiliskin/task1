export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getNodeEnvironment(): string {
  return process.env.NODE_ENV ?? 'development';
}
