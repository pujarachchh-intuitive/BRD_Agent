"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSection from "@/components/LoadingSection";
import RequestForm from "@/components/form/RequestForm";
import { apiGenerate } from "@/lib/api";
import { CollectedForm } from "@/lib/formLogic";
import { addRunToHistory } from "@/lib/runHistory";

export default function NewRequestPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  async function handleGenerate(collected: CollectedForm) {
    setIsLoading(true);
    try {
      const data = await apiGenerate(collected);
      addRunToHistory({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
      router.push(`/runs/${data.run_id}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleValidationError(message: string) {
    setErrorMessage(message);
    errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <TopBar title="New Request" />
      <div className="app-content">
        <ErrorBanner ref={errorRef} message={errorMessage} />
        <LoadingSection visible={isLoading} message="Generating your documents — this usually takes 30-90 seconds..." />
        <RequestForm
          disabled={isLoading}
          onSubmit={handleGenerate}
          onValidationError={handleValidationError}
          onClearError={() => setErrorMessage(null)}
        />
      </div>
    </>
  );
}
