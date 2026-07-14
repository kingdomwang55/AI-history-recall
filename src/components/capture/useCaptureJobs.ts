"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/components/capture/apiFetch";
import type { ApiState, JobSummary } from "@/components/capture/capture-types";
import { withApiToken } from "@/lib/client-api";

export function useCaptureJobs({
  defaultJobInstruction,
  setState,
  setResult
}: {
  defaultJobInstruction: string;
  setState: (value: ApiState) => void;
  setResult: (value: string) => void;
}) {
  const [jobInstruction, setJobInstruction] = useState(defaultJobInstruction);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [batchSize, setBatchSize] = useState(5);
  const [maxBatches, setMaxBatches] = useState(10);
  const [batchDelaySeconds, setBatchDelaySeconds] = useState(12);
  const [maxAttempts, setMaxAttempts] = useState(3);

  const refreshJobs = useCallback(async () => {
    const response = await apiFetch("/api/capture/jobs");
    const data = await response.json();
    const nextJobs = (data.jobs ?? []) as JobSummary[];
    setJobs(nextJobs);
    setSelectedJobId((current) => current || nextJobs[0]?.id || "");
  }, []);

  const createJob = useCallback(async () => {
    setState("planning");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/jobs", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction: jobInstruction })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      if (data.job?.id) {
        setSelectedJobId(data.job.id);
      }
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "创建采集任务失败");
    } finally {
      setState("idle");
    }
  }, [jobInstruction, refreshJobs, setResult, setState]);

  const runJobBatch = useCallback(async () => {
    if (!selectedJobId) {
      return;
    }

    setState("capturing");
    setResult("");
    try {
      const response = await apiFetch(`/api/capture/jobs/${selectedJobId}`, {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ batchSize, maxAttempts })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "执行任务批次失败");
    } finally {
      setState("idle");
    }
  }, [batchSize, maxAttempts, refreshJobs, selectedJobId, setResult, setState]);

  const runJobUntilIdle = useCallback(async () => {
    if (!selectedJobId) {
      return;
    }

    setState("runningAll");
    setResult("");
    try {
      const response = await apiFetch(`/api/capture/jobs/${selectedJobId}`, {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({
          batchSize,
          maxAttempts,
          maxBatches,
          batchDelayMs: batchDelaySeconds * 1000,
          runUntilIdle: true
        })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "连续执行任务失败");
    } finally {
      setState("idle");
    }
  }, [
    batchDelaySeconds,
    batchSize,
    maxAttempts,
    maxBatches,
    refreshJobs,
    selectedJobId,
    setResult,
    setState
  ]);

  return {
    jobInstruction,
    setJobInstruction,
    jobs,
    selectedJobId,
    setSelectedJobId,
    batchSize,
    setBatchSize,
    maxBatches,
    setMaxBatches,
    batchDelaySeconds,
    setBatchDelaySeconds,
    maxAttempts,
    setMaxAttempts,
    refreshJobs,
    createJob,
    runJobBatch,
    runJobUntilIdle
  };
}
