import { create } from 'zustand';
import { mergeSessionsByLineage, sessionPinId, type Session } from '../domain/session';
import { friendlyHttpError } from '../transport/http';
import type { RpcClient } from '../transport/jsonrpc';
import type { RestClient } from '../transport/rest';
import { LONG_RPC_TIMEOUT_MS } from '../transport/timeouts';

const PINNED_SESSIONS_STORAGE_KEY = 'hermes-pwa.pinnedSessions.v1';

export interface SessionsStore {
  sessions: Session[];
  loading: boolean;
  error: string | undefined;
  pinnedIds: string[];

  load(rest: RestClient): Promise<void>;
  create(rpc: RpcClient, params?: { profile?: string; cwd?: string }): Promise<string>;
  resume(rpc: RpcClient, sessionId: string, profile?: string): Promise<Record<string, unknown> | undefined>;
  archive(rest: RestClient, session: Session, archived: boolean): Promise<void>;
  delete(rest: RestClient, session: Session): Promise<void>;
  togglePin(session: Session): void;
  setPinnedIds(ids: string[]): void;
}

function readPinnedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  } catch {
    return [];
  }
}

function writePinnedIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Best-effort local preference only.
  }
}

function sessionIdFromResult(raw: unknown): string {
  if (!raw || typeof raw !== 'object') throw new Error('session.create returned an invalid response.');
  const record = raw as Record<string, unknown>;
  const id = record.session_id ?? record.id;
  if (typeof id !== 'string' || !id) throw new Error('session.create returned no session_id.');
  return id;
}

const initialPinnedIds = readPinnedIds();

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  loading: false,
  error: undefined,
  pinnedIds: initialPinnedIds,

  async load(rest) {
    set({ loading: true, error: undefined });
    try {
      const sessions = await rest.profileSessions();
      set({ sessions: mergeSessionsByLineage([], sessions ?? []), loading: false });
    } catch (err) {
      set({ loading: false, error: friendlyHttpError(err, 'Failed to load sessions.') });
    }
  },

  async create(rpc, params = {}) {
    set({ loading: true, error: undefined });
    try {
      const result = await rpc.request('session.create', params);
      set({ loading: false });
      return sessionIdFromResult(result);
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to create session.' });
      throw err;
    }
  },

  async resume(rpc, sessionId, profile) {
    set({ loading: true, error: undefined });
    try {
      const params: Record<string, unknown> = { session_id: sessionId };
      if (profile) params.profile = profile;
      const raw = await rpc.request<Record<string, unknown>>('session.resume', params, { timeoutMs: LONG_RPC_TIMEOUT_MS });
      set({ loading: false });
      return raw;
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to resume session.' });
      return undefined;
    }
  },

  async archive(rest, session, archived) {
    set({ error: undefined });
    try {
      await rest.sessionUpdate(session.id, { archived, ...(session.profile ? { profile: session.profile } : {}) });
      const sessions = get().sessions.map((item) => (item.id === session.id ? { ...item, archived } : item));
      set({ sessions });
    } catch (err) {
      set({ error: friendlyHttpError(err, 'Failed to update session.') });
      throw err;
    }
  },

  async delete(rest, session) {
    set({ error: undefined });
    try {
      await rest.sessionDelete(session.id, session.profile);
      const sessions = get().sessions.filter((item) => item.id !== session.id);
      const pinnedIds = get().pinnedIds.filter((id) => id !== sessionPinId(session) && id !== session.id);
      set({ sessions, pinnedIds });
      writePinnedIds(pinnedIds);
    } catch (err) {
      set({ error: friendlyHttpError(err, 'Failed to delete session.') });
      throw err;
    }
  },

  togglePin(session) {
    const id = sessionPinId(session);
    const current = get().pinnedIds;
    const pinnedIds = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
    set({ pinnedIds });
    writePinnedIds(pinnedIds);
  },

  setPinnedIds(ids) {
    const pinnedIds = [...new Set(ids.filter(Boolean))];
    set({ pinnedIds });
    writePinnedIds(pinnedIds);
  },
}));
