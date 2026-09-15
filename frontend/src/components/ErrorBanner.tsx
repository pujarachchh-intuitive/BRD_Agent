import { forwardRef } from "react";
import { AlertCircle } from "lucide-react";

interface ErrorBannerProps {
  message: string | null;
}

const ErrorBanner = forwardRef<HTMLDivElement, ErrorBannerProps>(function ErrorBanner({ message }, ref) {
  if (!message) return null;
  return (
    <div
      ref={ref}
      role="alert"
      className="mb-5 flex items-start gap-2.5 rounded-[calc(var(--radius)+2px)] border px-4 py-3.5 font-medium shadow-sm"
      style={{
        background: "var(--color-error-bg)",
        borderColor: "var(--color-error-border)",
        color: "var(--color-error-text)",
      }}
    >
      <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
});

export default ErrorBanner;
