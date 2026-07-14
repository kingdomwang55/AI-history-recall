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
  const [selectedCount, setSelectedCount] = useState(0);
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
      setSelectedCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <form
        onSubmit={handleSubmit}
        className="panel p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <UploadCloud size={20} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-base font-semibold">选择本地文件</h2>
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
            onChange={(event) => setSelectedCount(event.currentTarget.files?.length ?? 0)}
            accept=".json,.md,.markdown,.txt,.html,.htm,application/json,text/plain,text/markdown,text/html"
            className="block w-full rounded-[7px] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-3 text-sm file:mr-4 file:rounded-[6px] file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--foreground)] hover:file:bg-[var(--surface-subtle)]"
          />
          <p className="text-xs text-[var(--muted)]">
            可以一次选择多个文件，系统会按扩展名调用对应 adapter。
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || selectedCount === 0}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-[7px] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-disabled)] disabled:opacity-100"
        >
          <UploadCloud size={16} strokeWidth={1.8} />
          <span>{pending ? "导入中" : selectedCount ? `导入 ${selectedCount} 个文件` : "选择文件后导入"}</span>
        </button>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
            <AlertTriangle size={16} strokeWidth={1.8} />
            <span>{error}</span>
          </div>
        ) : null}
      </form>

      <aside className="panel p-5">
        <h2 className="text-base font-semibold">导入结果</h2>
        {!response ? (
          <div className="mt-4 border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--muted)]">
            选择文件后，成功数量、消息数量和失败原因会显示在这里。
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-l-2 border-[var(--accent)] bg-[var(--surface-subtle)] p-3">
                <div className="text-2xl font-semibold">{response.total.conversations}</div>
                <div className="text-xs text-[var(--muted)]">conversations</div>
              </div>
              <div className="border-l-2 border-[var(--accent)] bg-[var(--surface-subtle)] p-3">
                <div className="text-2xl font-semibold">{response.total.messages}</div>
                <div className="text-xs text-[var(--muted)]">messages</div>
              </div>
            </div>

            <div className="space-y-3">
              {response.results.map((result) => (
                <div
                  key={result.fileName}
                  className="border-t border-[var(--line)] py-3 text-sm first:border-t-0"
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
                        className="mt-0.5 text-[var(--danger)]"
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
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--danger)]">
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
