"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Job } from "@/lib/types";

/** Stand-in shown from the click until the backend returns the real job, so the page locks its
 * controls immediately instead of after the upload completes. */
export function startingJob(stage: string): Job<never> {
  return { job_id: "", kind: "document_extraction", status: "running", stage, progress: [], result: null, error: null };
}

/** A running job's current stage, with a tick for each step finished so far. */
export default function JobProgress({ job }: { job: Job | null }) {
  const [elapsed, setElapsed] = useState(0);
  const jobId = job?.job_id;
  const isRunning = job?.status === "running";

  useEffect(() => {
    if (!jobId || !isRunning) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [jobId, isRunning]);

  if (!job) return null;
  return (
    <div className="job-progress" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        {job.status === "running" && (
          <span
            aria-hidden
            className="h-5 w-5 flex-shrink-0 animate-spin rounded-full border-[3px]"
            style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-primary)" }}
          />
        )}
        <p className="m-0 font-semibold">{job.stage}…</p>
        {job.status === "running" && (
          <span className="ml-auto text-sm" style={{ color: "var(--color-text-muted)" }}>
            {elapsed}s
          </span>
        )}
      </div>
      {job.progress.length > 0 && (
        <ul className="job-progress-steps">
          {job.progress.map((step, index) => (
            <li key={index}>
              <Check size={14} aria-hidden /> {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
