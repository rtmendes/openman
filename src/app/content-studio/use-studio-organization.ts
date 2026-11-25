"use client";

import { useEffect, useRef, useState } from "react";
import { getStudioWorkspace, saveStudioWorkspace } from "@/lib/agent/client";
import { defaultStudioOrganization, studioOrganizationSchema, type StudioOrganization } from "@/lib/studio/organization";

export function useStudioOrganization(cloud: boolean) {
  const [snapshot, setSnapshot] = useState({ revision: 0, organization: defaultStudioOrganization });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(false);
  const writeLock = useRef(false);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        if (cloud) {
          const result = await getStudioWorkspace();
          if (current) setSnapshot(result);
        } else {
          const cached = studioOrganizationSchema.safeParse(JSON.parse(localStorage.getItem("mahara:studio-organization:local") ?? "null"));
          if (current) setSnapshot({ revision: 0, organization: cached.success ? cached.data : defaultStudioOrganization });
        }
        if (current) { setAvailable(true); setStatus(""); }
      } catch (error) {
        if (current) { setAvailable(false); setStatus(error instanceof Error ? error.message : "Couldn’t open the workspace."); }
      } finally { if (current) setLoading(false); }
    }
    void Promise.resolve().then(load);
    return () => { current = false; };
  }, [cloud, attempt]);

  async function save(change: StudioOrganization) {
    if (!available || writeLock.current || loading) return false;
    const validated = studioOrganizationSchema.safeParse(change);
    if (!validated.success) {
      setStatus(validated.error.issues[0]?.message ?? "Check the workspace settings.");
      return false;
    }
    writeLock.current = true;
    setSaving(true);
    setStatus("");
    try {
      if (cloud) {
        const { revision } = await saveStudioWorkspace(snapshot.revision, validated.data);
        setSnapshot({ revision, organization: validated.data });
      } else {
        localStorage.setItem("mahara:studio-organization:local", JSON.stringify(validated.data));
        setSnapshot({ revision: 0, organization: validated.data });
      }
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Couldn’t save the workspace.");
      return false;
    } finally { writeLock.current = false; setSaving(false); }
  }

  return { data: snapshot.organization, status, loading, available, saving, save,
    reload: () => { setLoading(true); setAttempt((value) => value + 1); } };
}
