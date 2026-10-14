"use client";

import { useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";

// Mirrors webapp/ingestion/parsers.py's limits, so most problems are caught before uploading.
// The backend re-checks everything regardless.
export const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Problem with a candidate file, given the files already chosen; null if it's fine. */
function checkFile(file: File, chosen: File[], existingCount: number): string | null {
  const ext = extensionOf(file.name);
  if (ext === ".doc") return `${file.name}: old .doc files aren't supported. Save it as .docx in Word first.`;
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return `${file.name}: only PDF, DOCX, TXT, and MD files are supported.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 15 MB.`;
  if (existingCount + chosen.length >= MAX_FILES) return `You can upload at most ${MAX_FILES} documents.`;
  const total = chosen.reduce((sum, f) => sum + f.size, 0) + file.size;
  if (total > MAX_TOTAL_BYTES) return "The documents add up to more than 30 MB in total.";
  return null;
}

interface DocumentDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** Files already part of the extraction (for "add another document"), counted toward the limit. */
  existingCount?: number;
}

export default function DocumentDropzone({ files, onChange, disabled, existingCount = 0 }: DocumentDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const next = [...files];
    const found: string[] = [];
    for (const file of Array.from(incoming)) {
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      const problem = checkFile(file, next, existingCount);
      if (problem) found.push(problem);
      else next.push(file);
    }
    setProblems(found);
    onChange(next);
  }

  function removeFile(index: number) {
    setProblems([]);
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div
        className={`dropzone${isDragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={30} aria-hidden />
        <p className="m-0 font-semibold">Drop your project documents here, or click to choose</p>
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          PDF, DOCX, TXT, or MD · up to {MAX_FILES} files · 15 MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // allows choosing the same file again after removing it
          }}
        />
      </div>

      {problems.length > 0 && (
        <ul className="dropzone-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}`}>
              <FileText size={16} aria-hidden />
              <span className="file-list-name">{file.name}</span>
              <span className="file-list-size">{formatSize(file.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => removeFile(index)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
