"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, UploadCloud } from "lucide-react";
import { withApiToken } from "@/lib/client-api";
import type { ImportResult } from "@/types/conversation";

interface ImportResponse {
  results: ImportResult[];
  total: {
    conversations: number;
    messages: number;
  };
}

export function ImportForm() {
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResponse(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: withApiToken(),
        body: formData
      });
      const data = (await res.json()) as ImportResponse | { error: string };

      if (!res.ok) {
        throw new Error("error" in data ? data.error : "导入失败");
      }

      setResponse(data as ImportResponse);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
            <UploadCloud size={20} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">选择本地文件</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              支持 JSON、Markdown、TXT、HTML。文件只会写入本机 SQLite。
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-2">
          <label htmlFor="files" className="text-sm font-medium">
            历史对话文件
          </label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept=".json,.md,.markdown,.txt,.html,.htm,application/json,text/plain,text/markdown,text/html"
            className="block w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[var(--accent-strong)]"
          />
          <p className="text-xs text-[var(--muted)]">
            可以一次选择多个文件，系统会按扩展名调用对应 adapter。
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UploadCloud size={16} strokeWidth={1.8} />
          <span>{pending ? "导入中" : "开始导入"}</span>
        </button>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle size={16} strokeWidth={1.8} />
            <span>{error}</span>
          </div>
        ) : null}
      </form>

      <aside className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold">导入结果</h2>
        {!response ? (
          <div className="mt-5 rounded-lg border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            选择文件后，成功数量、消息数量和失败原因会显示在这里。
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--surface-subtle)] p-3">
                <div className="text-2xl font-semibold">{response.total.conversations}</div>
                <div className="text-xs text-[var(--muted)]">conversations</div>
              </div>
              <div className="rounded-lg bg-[var(--surface-subtle)] p-3">
                <div className="text-2xl font-semibold">{response.total.messages}</div>
                <div className="text-xs text-[var(--muted)]">messages</div>
              </div>
            </div>

            <div className="space-y-3">
              {response.results.map((result) => (
                <div
                  key={result.fileName}
                  className="rounded-lg border border-[var(--line)] p-3 text-sm"
                >
                  <div className="flex items-start gap-2">
                    {result.ok ? (
                      <CheckCircle2
                        className="mt-0.5 text-[var(--accent)]"
                        size={16}
                        strokeWidth={1.8}
                      />
                    ) : (
                      <AlertTriangle
                        className="mt-0.5 text-red-600"
                        size={16}
                        strokeWidth={1.8}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <FileText size={14} strokeWidth={1.8} />
                        <span className="truncate">{result.fileName}</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {result.adapter ?? "未匹配 adapter"}
                      </div>
                      <div className="mt-2 text-xs">
                        {result.importedConversations} 条对话，{result.importedMessages} 条消息
                      </div>
                      {result.errors.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-600 dark:text-red-300">
                          {result.errors.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
