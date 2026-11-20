"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/modals/ModalShell";
import { projectFileUrl, readProjectFileText, type ProjectFile } from "../projects-store";

export function MarkdownPreview({ projectId, file, onClose }: { projectId: string; file: ProjectFile; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    readProjectFileText(projectId, file.id, controller.signal)
      .then(setContent)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The file could not be opened.");
      });
    return () => controller.abort();
  }, [projectId, file.id]);

  return (
    <ModalShell title={file.name} onClose={onClose} className="flex max-h-[85dvh] w-[720px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-2xl border border-[var(--om-border)] bg-[var(--om-surface)] p-5">
      <h2 className="break-all pe-10 text-lg font-medium">{file.name}</h2>
      {error ? <p role="alert">{error}</p> : content === null ? <p role="status">Loading Markdown…</p> : (
        <pre tabIndex={0} className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--om-bg)] p-4 text-sm">{content || "This file is empty."}</pre>
      )}
      <a href={projectFileUrl(projectId, file.id)} className="self-start text-sm underline">Download Markdown</a>
    </ModalShell>
  );
}
