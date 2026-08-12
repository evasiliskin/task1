/**
 * Starter default: points at the gateway running locally via
 * `pnpm --filter api-gateway run start:dev` (see back-end/api-gateway/.env.example).
 *
 * For a real deployment, wire this up with Angular's file-replacement
 * environments (`ng generate environments`) or a runtime-config approach -
 * intentionally left as a single file here to keep this starter simple.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/v1',
};
