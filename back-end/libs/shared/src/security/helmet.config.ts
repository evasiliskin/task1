import type { NextFunction, Request, Response } from 'express';
import helmet, { type HelmetOptions } from 'helmet';

import { isProduction } from '../config/environment.helper.js';

const HSTS_MAX_AGE_ONE_YEAR = 31536000;

const DOCS_PATH_PREFIXES = ['/api-docs'] as const;

function isDocumentationRoute(path: string): boolean {
  return DOCS_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const baseOptions: Omit<HelmetOptions, 'contentSecurityPolicy'> = {
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  originAgentCluster: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  ...(isProduction() && {
    strictTransportSecurity: {
      maxAge: HSTS_MAX_AGE_ONE_YEAR,
      includeSubDomains: true,
      preload: true,
    },
  }),
  xContentTypeOptions: true,
  xDnsPrefetchControl: { allow: false },
  xDownloadOptions: true,
  xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
  xPoweredBy: false,
};

const strictCsp: HelmetOptions['contentSecurityPolicy'] = {
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", 'https:'],
    'font-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  },
};

const documentationCsp: HelmetOptions['contentSecurityPolicy'] = {
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", 'https:', 'wss:'],
    'font-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  },
};

// Helmet's HelmetOptions is incompatible with exactOptionalPropertyTypes (e.g. strictTransportSecurity).
// Options are valid at runtime; assertion is required for this library.
const strictOptions = {
  ...baseOptions,
  contentSecurityPolicy: strictCsp,
} as Readonly<HelmetOptions>;

const documentationOptions = {
  ...baseOptions,
  contentSecurityPolicy: documentationCsp,
} as Readonly<HelmetOptions>;

const helmetStrict = helmet(strictOptions);
const helmetDocumentation = helmet(documentationOptions);

export function createHelmetMiddleware() {
  return (request: Request, response: Response, next: NextFunction) => {
    return isDocumentationRoute(request.path)
      ? helmetDocumentation(request, response, next)
      : helmetStrict(request, response, next);
  };
}
