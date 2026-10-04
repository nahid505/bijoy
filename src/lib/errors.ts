/** Business-rule violation with a user-facing (Bangla) message. Safe to show to users. */
export class UserError extends Error {
  /** optional per-field messages, shown under the matching form inputs */
  constructor(message?: string, public readonly fields?: Record<string, string[]>) {
    super(message);
  }
}
