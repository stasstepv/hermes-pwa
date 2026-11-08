import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesHttpError, friendlyHttpError, isRetryableMutationError, makeHttp } from './http';

describe('HermesHttpError', () => {
  it('constructs with status, statusText, and body', () => {
    const err = new HermesHttpError(404, 'Not Found', 'missing');
    expect(err.status).toBe(404);
    expect(err.body).toBe('missing');
    expect(err.message).toBe('missing');
    expect(err.name).toBe('HermesHttpError');
  });

  it('falls back to statusText when body is empty', () => {
    const err = new HermesHttpError(500, 'Internal Server Error', '');
    expect(err.message).toBe('Internal Server Error');
  });

  it('falls back to HTTP <status> when both body and statusText are empty', () => {
    const err = new HermesHttpError(503, '', '');
    expect(err.message).toBe('HTTP 503');
  });
});

describe('makeHttp', () => {
  const fetchSpy = vi.spyOn(globalThis as { fetch: typeof fetch }, 'fetch');

  beforeEach(() => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('calls fetch with the correct URL and default options', async () => {
    const http = makeHttp('https://api.example.com');
    await http('/test');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.any(Headers),
      })
    );
  });

  it('sets content-type header for JSON body', async () => {
    const http = makeHttp('');
    await http('/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('can skip the automatically appended active profile query parameter', async () => {
    const http = makeHttp('https://api.example.com', 'kimi-profile');
    await http('/api/profiles/kimi-profile/model', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'kimi-coding', model: 'kimi-k2-turbo-preview' }),
      skipProfile: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/api/profiles/kimi-profile/model',
      expect.objectContaining({ method: 'PUT' }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect('skipProfile' in init).toBe(false);
  });

  it('appends the active profile only when the request has no explicit profile query', async () => {
    const http = makeHttp('https://api.example.com', 'research');

    await http('/api/model/info');
    await http('/api/profiles/sessions?profile=all&limit=100');
    await http('/api/cron/jobs?profile=dev');

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/model/info?profile=research',
      expect.any(Object),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/profiles/sessions?profile=all&limit=100',
      expect.any(Object),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://api.example.com/api/cron/jobs?profile=dev',
      expect.any(Object),
    );
  });

  it('preserves existing content-type header', async () => {
    const http = makeHttp('');
    await http('/test', {
      method: 'POST',
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('text/plain');
  });

  it('returns parsed JSON on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: 42 }), { status: 200 })
    );
    const http = makeHttp('http://localhost');
    const result = await http<{ data: number }>('/test');
    expect(result).toEqual({ data: 42 });
  });

  it('returns undefined on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const http = makeHttp('http://localhost');
    const result = await http('/test');
    expect(result).toBeUndefined();
  });

  it('throws HermesHttpError on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('bad request', { status: 400, statusText: 'Bad Request' })
    );
    const http = makeHttp('http://localhost');
    await expect(http('/test')).rejects.toThrow(HermesHttpError);
  });

  it('throws with correct message on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not found', { status: 404, statusText: 'Not Found' })
    );
    const http = makeHttp('http://localhost');
    await expect(http('/test')).rejects.toThrow('not found');
  });

  it('includes status and body in thrown error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('server error', { status: 500, statusText: 'Server Error' })
    );
    const http = makeHttp('http://localhost');
    try {
      await http('/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HermesHttpError);
      expect((err as HermesHttpError).status).toBe(500);
      expect((err as HermesHttpError).body).toBe('server error');
    }
  });

  it('aborts fetch when the request timeout elapses', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));

    const http = makeHttp('http://localhost');
    const request = http('/slow', { timeoutMs: 15 });
    const rejection = expect(request).rejects.toThrow('HTTP request timed out');
    await vi.advanceTimersByTimeAsync(15);

    await rejection;
  });
});

describe('isRetryableMutationError', () => {
  it('flags transient fence verdicts and transport hiccups', () => {
    expect(isRetryableMutationError(new HermesHttpError(409, 'Conflict', '{"detail":"revision_conflict"}'))).toBe(true);
    expect(isRetryableMutationError(new HermesHttpError(503, 'Service Unavailable', 'owner_unavailable: default: gateway not running'))).toBe(true);
    expect(isRetryableMutationError(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isRetryableMutationError(new Error('HTTP request timed out'))).toBe(true);
  });

  it('treats final verdicts as final', () => {
    expect(isRetryableMutationError(new HermesHttpError(400, 'Bad Request', '{"detail":"invalid_params"}'))).toBe(false);
    expect(isRetryableMutationError(new HermesHttpError(401, 'Unauthorized', '{"detail":"authentication_required"}'))).toBe(false);
    expect(isRetryableMutationError(new HermesHttpError(404, 'Not Found', '{"detail":"not_found"}'))).toBe(false);
    expect(isRetryableMutationError('not even an error')).toBe(false);
  });
});

describe('friendlyHttpError', () => {
  it('maps backend details to human copy, never raw JSON', () => {
    expect(friendlyHttpError(new HermesHttpError(409, 'Conflict', '{"detail":"revision_conflict"}'), 'fb')).toBe(
      'This conversation changed elsewhere. Reload the list and try again.',
    );
    expect(friendlyHttpError(new HermesHttpError(503, 'Service Unavailable', 'owner_unavailable: default: gateway down'), 'fb')).toBe(
      'Hermes is unreachable. Check the connection and try again.',
    );
    expect(friendlyHttpError(new HermesHttpError(403, 'Forbidden', ''), 'fb')).toBe('Your dashboard session expired. Sign in again.');
    expect(friendlyHttpError(new HermesHttpError(429, 'Too Many Requests', ''), 'fb')).toBe(
      'Hermes is busy or rate-limited. Try again in a moment.',
    );
    expect(friendlyHttpError(new HermesHttpError(500, 'Server Error', 'boom'), 'fb')).toBe(
      'Hermes server returned an error. Check the server logs, then try again.',
    );
    expect(friendlyHttpError(new HermesHttpError(404, 'Not Found', '{"detail":"not_found"}'), 'fb')).toBe(
      'That session no longer exists. Reload the list.',
    );
  });

  it('covers non-HermesHttpError failures', () => {
    expect(friendlyHttpError(new TypeError('Failed to fetch'), 'fb')).toBe('Hermes is unreachable. Check the connection and try again.');
    expect(friendlyHttpError(new Error('   '), 'fb')).toBe('fb');
    expect(friendlyHttpError(undefined, 'fb')).toBe('fb');
    expect(friendlyHttpError('weird string', 'fb')).toBe('weird string');
  });
});
