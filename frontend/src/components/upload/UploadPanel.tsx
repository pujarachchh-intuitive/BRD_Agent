"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanSearch } from "lucide-react";
import { apiExtractDocuments, waitForJob } from "@/lib/api";
import { StartingPoint, saveStartingPoint } from "@/lib/templateLogic";
import { ExtractionResult, Job } from "@/lib/types";
import DocumentDropzone from "./DocumentDropzone";
import JobProgress, { startingJob } from "./JobProgress";

interface UploadPanelProps {
  onError: (message: string | null) => void;
  /** What to carry into the review page (a template, domain, typed fields), read when extraction
   * finishes so it includes anything changed while the documents were being read. */
  startingPoint?: () => StartingPoint | null;
}

/** "Upload documents" tab of New Request: pick files, extract, then go to the review page. */
export default function UploadPanel({ onError, startingPoint }: UploadPanelProps) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<Job<ExtractionResult> | null>(null);
  const isBusy = job !== null;

  async function handleExtract() {
    onError(null);
    setJob(startingJob("Uploading your documents"));
    try {
      const started = await apiExtractDocuments(files);
      const result = await waitForJob(started, setJob);
      const start = startingPoint?.();
      if (start) saveStartingPoint(result.extraction_id, start);
      router.push(`/new/review/${encodeURIComponent(result.extraction_id)}`);
    } catch (err) {
      setJob(null);
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel flex flex-col gap-4">
      <div>
        <h2 className="m-0">Start from your project documents</h2>
        <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
          Upload an SOW, proposal, requirements draft, or meeting notes. The AI reads them, fills in the request form
          with the source of each detail, and asks you about anything important that&apos;s missing. You review
          everything before any document is generated.
        </p>
      </div>

      <DocumentDropzone files={files} onChange={setFiles} disabled={isBusy} />

      <p className="m-0 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Your documents are sent to Google Gemini for processing. Only upload documents you&apos;re allowed to share.
      </p>

      {job ? (
        <JobProgress job={job} />
      ) : (
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" disabled={files.length === 0} onClick={handleExtract}>
            <ScanSearch size={16} /> Extract project information
          </button>
        </div>
      )}
    </section>
  );
}
