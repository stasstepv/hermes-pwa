import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRestClient } from './rest';
import { HermesHttpError } from './http';
import type { Http } from './http';

describe('makeRestClient', () => {
  let httpMock: ReturnType<typeof vi.fn<Parameters<Http>, ReturnType<Http>>> & Pick<Http, 'setProfile'>;
  let client: ReturnType<typeof makeRestClient>;

  function queryForCall(callIndex: number): URLSearchParams {
    const [path] = httpMock.mock.calls[callIndex] ?? [];
    return new URL(String(path), 'https://hermes.test').searchParams;
  }

  beforeEach(() => {
    const fn = vi.fn<Parameters<Http>, ReturnType<Http>>() as typeof httpMock;
    fn.setProfile = vi.fn();
    httpMock = fn;
    client = makeRestClient(httpMock as unknown as Http);
  });

  it('status maps raw response to GatewayStatus', async () => {
    httpMock.mockResolvedValue({
      auth_required: true,
      auth_providers: ['basic'],
      gateway_state: 'running',
      version: '0.1.0',
      release_date: '2024-01-01',
      gateway_running: true,
      active_sessions: 5,
    });
    const status = await client.status();
    expect(status.authRequired).toBe(true);
    expect(status.authProviders).toEqual(['basic']);
    expect(status.gatewayState).toBe('running');
    expect(status.version).toBe('0.1.0');
    expect(status.activeSessions).toBe(5);
  });

  it('status defaults authRequired to false and authProviders to empty', async () => {
    httpMock.mockResolvedValue({});
    const status = await client.status();
    expect(status.authRequired).toBe(false);
    expect(status.authProviders).toEqual([]);
    expect(status.gatewayState).toBeUndefined();
  });

  it('providers maps raw response to AuthProvider array', async () => {
    httpMock.mockResolvedValue({
      providers: [
        { name: 'basic', display_name: 'Basic Auth', supports_password: true },
        { name: 'oauth', display_name: 'OAuth' },
      ],
    });
    const providers = await client.providers();
    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({ name: 'basic', displayName: 'Basic Auth', supportsPassword: true });
    expect(providers[1]).toEqual({ name: 'oauth', displayName: 'OAuth', supportsPassword: false });
  });

  it('providers returns empty array when no providers field', async () => {
    httpMock.mockResolvedValue({});
    const providers = await client.providers();
    expect(providers).toEqual([]);
  });

  it('passwordLogin POSTs body and returns result', async () => {
    httpMock.mockResolvedValue({ ok: true, next: '/' });
    const result = await client.passwordLogin({ provider: 'basic', username: 'u', password: 'p' });
    expect(result.ok).toBe(true);
    expect(httpMock).toHaveBeenCalledWith('/auth/password-login', {
      method: 'POST',
      body: JSON.stringify({ provider: 'basic', username: 'u', password: 'p' }),
    });
  });

  it('me maps raw user with all fields', async () => {
    httpMock.mockResolvedValue({
      user_id: 'u-1',
      email: 'a@b.com',
      display_name: 'Alice',
      org_id: 'o-1',
      provider: 'basic',
      expires_at: 1234567890,
    });
    const user = await client.me();
    expect(user.userId).toBe('u-1');
    expect(user.email).toBe('a@b.com');
    expect(user.displayName).toBe('Alice');
    expect(user.orgId).toBe('o-1');
  });

  it('me provides defaults for missing fields', async () => {
    httpMock.mockResolvedValue({});
    const user = await client.me();
    expect(user.userId).toBe('unknown');
    expect(user.displayName).toBe('Hermes user');
    expect(user.provider).toBe('unknown');
    expect(user.expiresAt).toBe(0);
  });

  it('wsTicket maps raw ticket', async () => {
    httpMock.mockResolvedValue({ ticket: 'abc-123', ttl_seconds: 30 });
    const ticket = await client.wsTicket();
    expect(ticket.ticket).toBe('abc-123');
    expect(ticket.ttlSeconds).toBe(30);
  });

  it('wsTicket defaults ttlSeconds to 30 when missing', async () => {
    httpMock.mockResolvedValue({ ticket: 'xyz' });
    const ticket = await client.wsTicket();
    expect(ticket.ticket).toBe('xyz');
    expect(ticket.ttlSeconds).toBe(30);
  });

  it('profileSessions fetches only the release-scope local session slice', async () => {
    httpMock.mockResolvedValueOnce({
      sessions: [
        {
          id: 'local-chat',
          title: 'Local work',
          source: 'tui',
          last_active: 200,
          message_count: 12,
        },
      ],
    });

    const sessions = await client.profileSessions();

    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(queryForCall(0).get('profile')).toBe('default');
    expect(queryForCall(0).get('exclude_sources')).toContain('telegram');
    expect(queryForCall(0).get('exclude_sources')).toContain('discord');
    expect(queryForCall(0).get('exclude_sources')).toContain('cron');
    expect(queryForCall(0).get('exclude_sources')).toContain('curator');
    expect(sessions.map((s) => s.id)).toEqual(['local-chat']);
  });

  it('profileSessions scopes the local slice to the active profile', async () => {
    client.setActiveProfile('dev');
    httpMock.mockResolvedValueOnce({ sessions: [{ id: 'dev-local', title: 'Dev local', source: 'tui', last_active: 1 }] });

    const sessions = await client.profileSessions();

    expect(httpMock.setProfile).toHaveBeenCalledWith('dev');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(queryForCall(0).get('profile')).toBe('dev');
    expect(sessions.map((s) => s.id)).toEqual(['dev-local']);
  });

  it('profileSessions does not call the PWA messaging binding shim in the TUI/CLI release scope', async () => {
    httpMock.mockResolvedValueOnce({ sessions: [{ id: 'core-only', title: 'Core', source: 'tui', last_active: 1 }] });

    const sessions = await client.profileSessions();

    expect(sessions.map((s) => s.id)).toEqual(['core-only']);
    expect(httpMock.mock.calls.map(([path]) => String(path))).not.toContain(
      '/api/plugins/hermes-pwa/sessions/messaging-bindings?profile=default',
    );
  });

  it('archives sessions through the backend patch endpoint with fence identity', async () => {
    httpMock
      .mockResolvedValueOnce({ exists: true, runtime_revision: 7 }) // mutation-snapshot
      .mockResolvedValueOnce({ ok: true }); // PATCH
    await client.sessionUpdate('sess-1', { archived: true, profile: 'dev' });
    expect(httpMock).toHaveBeenNthCalledWith(1, '/api/sessions/sess-1/mutation-snapshot?profile=dev');
    const [, patchInit] = httpMock.mock.calls[1] ?? [];
    expect(patchInit?.method).toBe('PATCH');
    const body = JSON.parse(String(patchInit?.body));
    expect(body.archived).toBe(true);
    expect(body.profile).toBe('dev');
    expect(body.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(body.expected_revision).toBe(7);
  });

  it('deletes a session fenced with revision+generation, carrying the profile query', async () => {
    httpMock
      .mockResolvedValueOnce({ exists: true, runtime_revision: 3, runtime_generation: 1 }) // mutation-snapshot
      .mockResolvedValueOnce({ ok: true, deleted_ids: ['sess-1'] }); // DELETE
    await client.sessionDelete('sess-1', 'dev');
    expect(httpMock).toHaveBeenNthCalledWith(1, '/api/sessions/sess-1/mutation-snapshot?profile=dev');
    expect(httpMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^\/api\/sessions\/sess-1\?request_id=.+&expected_revision=3&expected_generation=1&profile=dev$/),
      { method: 'DELETE' },
    );
  });

  it('retries a fenced update once with a freshly-read fence on revision conflict', async () => {
    httpMock
      .mockResolvedValueOnce({ exists: true, runtime_revision: 7 }) // mutation-snapshot
      .mockRejectedValueOnce(new HermesHttpError(409, 'Conflict', '{"detail":"revision_conflict"}')) // PATCH attempt 1
      .mockResolvedValueOnce({ exists: true, runtime_revision: 8 }) // re-read snapshot
      .mockResolvedValueOnce({ ok: true }); // PATCH attempt 2 lands
    await expect(client.sessionUpdate('sess-1', { archived: true })).resolves.toEqual({ ok: true });
    expect(httpMock).toHaveBeenCalledTimes(4);
    const firstBody = JSON.parse(String(httpMock.mock.calls[1]?.[1]?.body));
    const retryBody = JSON.parse(String(httpMock.mock.calls[3]?.[1]?.body));
    expect(retryBody.expected_revision).toBe(8);
    expect(retryBody.request_id).not.toBe(firstBody.request_id);
  });

  it('retries a delete once on an owner transport hiccup, never on a final verdict', async () => {
    httpMock
      .mockResolvedValueOnce({ exists: true, runtime_revision: 2, runtime_generation: 1 })
      .mockRejectedValueOnce(new HermesHttpError(503, 'Service Unavailable', '{"detail":"owner_unreachable"}'))
      .mockResolvedValueOnce({ exists: true, runtime_revision: 2, runtime_generation: 1 })
      .mockResolvedValueOnce({ ok: true, deleted_ids: ['sess-1'] });
    await expect(client.sessionDelete('sess-1')).resolves.toEqual({ ok: true, deleted_ids: ['sess-1'] });
    expect(httpMock).toHaveBeenCalledTimes(4);

    httpMock.mockReset();
    httpMock
      .mockResolvedValueOnce({ exists: true, runtime_revision: 2, runtime_generation: 1 })
      .mockRejectedValueOnce(new HermesHttpError(400, 'Bad Request', '{"detail":"invalid_params"}'));
    await expect(client.sessionDelete('sess-2')).rejects.toThrow('invalid_params');
    expect(httpMock).toHaveBeenCalledTimes(2);
  });

  it('deletes profiles through the backend endpoint', async () => {
    httpMock.mockResolvedValue({ ok: true });
    await client.profileDelete('research');
    expect(httpMock).toHaveBeenCalledWith('/api/profiles/research', { method: 'DELETE' });
  });

  it('renames profiles through the backend endpoint', async () => {
    httpMock.mockResolvedValue({ ok: true });
    await client.profileRename('research', 'research-v2');
    expect(httpMock).toHaveBeenCalledWith('/api/profiles/research', {
      method: 'PATCH',
      body: JSON.stringify({ new_name: 'research-v2' }),
    });
  });

  it('sets model for a specific profile through the backend endpoint without active-profile query scoping', async () => {
    httpMock.mockResolvedValue({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4' });
    const result = await client.profileUpdateModel('research', { provider: 'anthropic', model: 'claude-sonnet-4' });
    expect(httpMock).toHaveBeenCalledWith('/api/profiles/research/model', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4' }),
      skipProfile: true,
    });
    expect(result).toEqual({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4' });
  });

  it('fetches pending plugin actions for the active profile', async () => {
    client.setActiveProfile('dev');
    httpMock.mockResolvedValue({
      items: [
        {
          id: 'approval-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          session_id: 'telegram:123',
          summary: 'rm -rf /tmp/example',
          high_impact: true,
          created_at: 123,
        },
      ],
    });

    const items = await client.pendingActions();

    expect(httpMock).toHaveBeenCalledWith('/api/plugins/hermes-pwa/actions/pending?profile=dev');
    expect(items[0]).toMatchObject({
      id: 'approval-1',
      kind: 'approval',
      sessionId: 'telegram:123',
      summary: 'rm -rf /tmp/example',
    });
  });

  it('maps push status without exposing private key fields', async () => {
    httpMock.mockResolvedValue({
      available: false,
      enabled: false,
      reason: 'missing vapid',
      vapid_public_key: 'public-key',
      vapid_private_key: 'should-not-map',
      subscriptions: [
        {
          id: 'sha256:abc',
          profile: 'default',
          label: 'iPhone',
          user_agent_hint: 'Mobile Safari',
          enabled: true,
          created_at: 1,
          updated_at: 2,
          last_success_at: null,
          last_error: null,
        },
      ],
    });

    const status = await client.pushStatus('default');

    expect(httpMock).toHaveBeenCalledWith('/api/plugins/hermes-pwa/push/status?profile=default');
    expect(status.available).toBe(false);
    expect(status.reason).toBe('missing vapid');
    expect(status.vapidPublicKey).toBe('public-key');
    expect(status.subscriptions[0]).toEqual({
      id: 'sha256:abc',
      profile: 'default',
      label: 'iPhone',
      userAgentHint: 'Mobile Safari',
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      lastSuccessAt: null,
      lastError: null,
    });
    expect(JSON.stringify(status)).not.toContain('should-not-map');
  });

  it('pushSubscribe posts body to the active profile by default', async () => {
    client.setActiveProfile('dev');
    httpMock.mockResolvedValue({ subscription: { id: 'sha256:sub', enabled: true, profile: 'dev' } });
    const body = { subscription: { endpoint: 'https://push.example/sub', keys: { p256dh: 'p', auth: 'a' } }, label: 'Android' };

    const result = await client.pushSubscribe(body);

    expect(httpMock).toHaveBeenCalledWith('/api/plugins/hermes-pwa/push/subscribe?profile=dev', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(result).toEqual({ id: 'sha256:sub', enabled: true, profile: 'dev' });
  });

  it('pushUnsubscribe and pushTest post profile-scoped narrow bodies', async () => {
    client.setActiveProfile('dev');
    httpMock.mockResolvedValue({ ok: true });
    await client.pushUnsubscribe({ id: 'sha256:sub' });
    await client.pushTest('sha256:sub');

    expect(httpMock).toHaveBeenNthCalledWith(1, '/api/plugins/hermes-pwa/push/unsubscribe?profile=dev', {
      method: 'POST',
      body: JSON.stringify({ id: 'sha256:sub' }),
    });
    expect(httpMock).toHaveBeenNthCalledWith(2, '/api/plugins/hermes-pwa/push/test?profile=dev', {
      method: 'POST',
      body: JSON.stringify({ id: 'sha256:sub' }),
    });
  });

  it('loads PWA update check status', async () => {
    httpMock.mockResolvedValue({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      update_available: true,
      can_apply: false,
      manual_required: true,
      install_method: 'unknown',
      instructions: [
        {
          id: 'npx-force-reinstall',
          label: 'npm / npx',
          command: 'npx -y hermes-pwa@latest install --force',
          steps: ['Run command'],
        },
      ],
    });

    const result = await client.updateCheck();

    expect(httpMock).toHaveBeenCalledWith('/api/plugins/hermes-pwa/update/check');
    expect(result.updateAvailable).toBe(true);
    expect(result.canApply).toBe(false);
    expect(result.instructions[0]?.command).toBe('npx -y hermes-pwa@latest install --force');
  });

  it('uses extended HTTP timeout for audio transcription and speech', async () => {
    httpMock.mockResolvedValueOnce({ text: 'transcript' });
    await client.audioTranscribe('data:audio/webm;base64,AAAA', 'audio/webm');
    expect(httpMock).toHaveBeenNthCalledWith(1, '/api/audio/transcribe', {
      method: 'POST',
      body: JSON.stringify({ data_url: 'data:audio/webm;base64,AAAA', mime_type: 'audio/webm' }),
      timeoutMs: 120_000,
    });

    httpMock.mockResolvedValueOnce({ data_url: 'data:audio/mpeg;base64,BBBB', mime_type: 'audio/mpeg' });
    await client.audioSpeak('hello');
    expect(httpMock).toHaveBeenNthCalledWith(2, '/api/audio/speak', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
      timeoutMs: 120_000,
    });
  });

  it('propagates HermesHttpError', async () => {
    httpMock.mockRejectedValue(new HermesHttpError(500, 'Error', 'boom'));
    await expect(client.status()).rejects.toThrow(HermesHttpError);
  });
});
