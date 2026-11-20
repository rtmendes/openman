"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStudioDrafts, getStudioRevision, saveStudioDrafts, type StudioVersion } from "@/lib/agent/client";

type SaveStatus = "local" | "opening" | "ready" | "saving" | "saved" | "offline" | "conflict";
type LocalDraft<T> = { items: T[]; revision: number; dirty: boolean };
const serialize = (rows: unknown[]) => JSON.stringify(rows, (key, value) => key === "error" ? undefined : value);

export function useStudioDrafts<T>(draftKey: string | undefined, legacyKey: string, newItem: () => T) {
  const [items, setItems] = useState<T[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(draftKey ? "opening" : "local");
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState({ revision: 0, serialized: "" });
  const [recovery, setRecovery] = useState<T[] | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const state = useRef({ revision: 0, saved: "", busy: false, conflict: false, items: [] as T[] });
  const cacheKey = draftKey ? `mahara:studio-drafts:${draftKey}` : legacyKey;
  const recoveryKey = cacheKey + ":recovery";

  useEffect(() => {
    let active = true;
    const local = (() => {
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null") as LocalDraft<T> | T[] | null;
        if (cached && !Array.isArray(cached) && Array.isArray(cached.items)) return cached;
        const legacy = cached ?? JSON.parse(sessionStorage.getItem(legacyKey) ?? "[]");
        return { items: Array.isArray(legacy) ? legacy.slice(0, 12) : [], revision: 0, dirty: Array.isArray(legacy) && legacy.length > 0 };
      } catch { return { items: [], revision: 0, dirty: false }; }
    })();
    async function load() {
      let rows = local.items.length ? local.items : [newItem()];
      let saved = serialize(rows);
      try {
        const backup = JSON.parse(sessionStorage.getItem(recoveryKey) ?? "null");
        if (active && Array.isArray(backup)) setRecovery(backup);
      } catch { /* Ignore invalid local backups. */ }
      if (draftKey) {
        try {
          const { draft, versions: history } = await getStudioDrafts<T>();
          if (!active) return;
          if (draft) {
            state.current.revision = draft.revision;
            saved = serialize(draft.items);
            setSavedSnapshot({ revision: draft.revision, serialized: saved });
            if (!(local.dirty && local.revision === draft.revision)) {
              if (local.dirty && serialize(local.items) !== saved) {
                setRecovery(local.items);
                try { sessionStorage.setItem(recoveryKey, serialize(local.items)); } catch { /* Recovery stays in memory. */ }
              }
              rows = draft.items;
            }
          } else if (local.dirty) {
            saved = "[]";
          }
          setVersions(history);
          setOnline(true);
          setStatus(history.length ? "saved" : "ready");
        } catch {
          if (!active) return;
          setStatus("offline");
        }
      }
      if (!active) return;
      state.current.saved = saved;
      state.current.items = rows;
      setItems(rows);
      setHydrated(true);
    }
    void Promise.resolve().then(load);
    return () => { active = false; };
  }, [cacheKey, draftKey, legacyKey, newItem, recoveryKey]);

  const flush = useCallback(async () => {
    const remote = state.current;
    if (!draftKey || !online || remote.busy || remote.conflict) return;
    const serialized = serialize(remote.items);
    if (serialized === remote.saved) return;
    remote.busy = true;
    setStatus("saving");
    try {
      const result = await saveStudioDrafts(remote.revision, JSON.parse(serialized) as unknown[]);
      if (!result) {
        remote.conflict = true;
        setStatus("conflict");
        return;
      }
      remote.revision = result.revision;
      remote.saved = serialized;
      setSavedSnapshot({ revision: result.revision, serialized });
      setVersions((current) => [{ revision: result.revision, created_at: result.savedAt }, ...current.filter((entry) => entry.revision !== result.revision)].slice(0, 100));
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ items: remote.items, revision: remote.revision, dirty: serialize(remote.items) !== serialized }));
      } catch { /* Local recovery is optional. */ }
      setStatus("saved");
      if (serialize(remote.items) !== serialized) setSaveAttempt((count) => count + 1);
    } catch {
      setStatus("offline");
    } finally {
      remote.busy = false;
    }
  }, [cacheKey, draftKey, online]);

  useEffect(() => {
    if (!hydrated) return;
    state.current.items = items;
    const dirty = serialize(items) !== state.current.saved;
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ items, revision: state.current.revision, dirty: dirty || !online })); }
    catch { /* Local recovery is optional. */ }
    if (!dirty || !online) return;
    const timeout = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timeout);
  }, [cacheKey, flush, hydrated, items, online, saveAttempt]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  async function reopen() {
    if (state.current.busy) return;
    setStatus("opening");
    try {
      const { draft, versions: history } = await getStudioDrafts<T>();
      if (draft && serialize(state.current.items) !== serialize(draft.items)) {
        setRecovery(state.current.items);
        try { sessionStorage.setItem(recoveryKey, serialize(state.current.items)); } catch { /* Recovery stays in memory. */ }
      }
      const rows = draft?.items ?? state.current.items;
      state.current.conflict = false;
      state.current.revision = draft?.revision ?? 0;
      state.current.saved = serialize(draft?.items ?? []);
      setSavedSnapshot({ revision: state.current.revision, serialized: state.current.saved });
      state.current.items = rows;
      setItems(rows);
      setVersions(history);
      setOnline(true);
      setStatus(draft ? "saved" : "ready");
      setSaveAttempt((count) => count + 1);
    } catch { setStatus("offline"); }
  }

  return {
    items, setItems, hydrated, status, versions, recovery, reopen,
    savedRevision: online && savedSnapshot.revision > 0 && savedSnapshot.serialized === serialize(items) ? savedSnapshot.revision : undefined,
    clearRecovery: () => {
      setRecovery(null);
      try { sessionStorage.removeItem(recoveryKey); } catch { /* Recovery is cleared for this visit. */ }
    },
    retry: () => offlineRetry(), readVersion: async (revision: number) => (await getStudioRevision<T>(revision)).draft.items,
  };

  function offlineRetry() {
    if (!online) return void reopen();
    void flush();
  }
}
