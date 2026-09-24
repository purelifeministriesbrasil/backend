export type UseCaseResult<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; kind: "expected"; error: E; message: string }
  | { ok: false; kind: "infrastructure"; error: E; retryable: boolean }
  | { ok: false; kind: "duplicate"; error: E };
