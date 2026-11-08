export class HermesHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(body || statusText || `HTTP ${status}`);
    this.name = 'HermesHttpError';
    this.status = status;
    this.body = body;
  }
}

/** Verdicts from a fenced session mutation (or the forwarding transport) that are
 *  transient: the write definitely did not commit on our terms, so ONE retry with a
 *  re-read fence + fresh idempotency key is safe and usually lands. Anything not
 *  listed (400 invalid_params, 401/403, not_found) is final — retrying would just
 *  re-answer the same thing. */
const RETRYABLE_DETAIL = /revision_conflict|stale_generation|owner_unreachable|owner_unavailable|session_busy|runtime_draining|storage_unavailable/i;
const NETWORK_ERROR = /failed to fetch|fetch failed|network|timed out|timeout|abort|offline|disconnected/i;

export function isRetryableMutationError(err: unknown): boolean {
  if (err instanceof HermesHttpError) return RETRYABLE_DETAIL.test(err.body || '');
  return err instanceof Error && NETWORK_ERROR.test(err.message || '');
}

/** Translate a transport failure into human-facing copy. Never show a raw
 *  {"detail":"..."} body or an AbortError stack to a phone user. */
export function friendlyHttpError(err: unknown, fallback: string): string {
  if (err instanceof HermesHttpError) {
    const detail = err.body || '';
    if (err.status === 401 || err.status === 403) return 'Your dashboard session expired. Sign in again.';
    if (err.status === 429) return 'Hermes is busy or rate-limited. Try again in a moment.';
    if (/revision_conflict|stale_generation/i.test(detail)) return 'This conversation changed elsewhere. Reload the list and try again.';
    if (/session_busy|runtime_draining/i.test(detail)) return 'The conversation is busy. Try again in a moment.';
    if (/owner_unreachable|owner_unavailable/i.test(detail)) return 'Hermes is unreachable. Check the connection and try again.';
    if (/storage_unavailable/i.test(detail)) return 'Hermes storage is unavailable. Try again shortly.';
    if (/not_found/i.test(detail)) return 'That session no longer exists. Reload the list.';
    if (err.status >= 500) return 'Hermes server returned an error. Check the server logs, then try again.';
    return fallback;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (NETWORK_ERROR.test(message)) return 'Hermes is unreachable. Check the connection and try again.';
  return message.trim() ? message : fallback;
}

export interface HermesRequestInit extends RequestInit {
  /** Skip automatically appending the active PWA profile query parameter. */
  skipProfile?: boolean;
  /** Abort the request after this many milliseconds. Defaults to 15s. */
  timeoutMs?: number;
}

export interface Http {
  <T>(path: string, init?: HermesRequestInit): Promise<T>;
  setProfile(name: string | undefined): void;
}

export function makeHttp(baseUrl = '', profile?: string): Http {
  let currentProfile = profile;

  async function http<T>(path: string, init: HermesRequestInit = {}): Promise<T> {
    const { skipProfile, timeoutMs = 15_000, signal: upstreamSignal, ...fetchInit } = init;
    let origin = 'http://localhost';
    if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
      origin = window.location.origin;
    }
    const url = new URL(`${baseUrl}${path}`, origin);
    if (currentProfile && !skipProfile && !url.searchParams.has('profile')) {
      url.searchParams.set('profile', currentProfile);
    }

    const headers = new Headers(fetchInit.headers);
    if (fetchInit.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const abortFromUpstream = (): void => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
    }
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(new Error('HTTP request timed out')), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        ...fetchInit,
        credentials: 'include',
        headers,
        signal: controller.signal,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }

    if (!response.ok) {
      throw new HermesHttpError(response.status, response.statusText, await response.text());
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  http.setProfile = (name: string | undefined): void => {
    currentProfile = name;
  };

  return http;
}
