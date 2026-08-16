/**
 * Reply of `imports.claim` — the importId reserved for an Idempotency-Key.
 *
 * Deliberately does not report whether the claim was newly created. The gateway must publish on
 * every request regardless: a first request whose publish failed with 503 would otherwise leave a
 * claim that suppresses the retry's publish forever. Duplicate suppression stays in service-a's
 * `recordStarted`, where it already is.
 */
export interface IImportClaimView {
  importId: string;
}
