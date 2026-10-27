/** Failure of a public widget call; the controller turns it into `{ error: code }` with this status. */
export class WidgetError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 415 | 422 | 429 | 501 | 503,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
