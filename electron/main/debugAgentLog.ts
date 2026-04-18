/** Stale debug session — no-op to avoid fetch to dead server. */
export function agentLog(
  _location: string,
  _message: string,
  _data: Record<string, unknown>,
  _hypothesisId: string,
): void {
  /* no-op */
}
