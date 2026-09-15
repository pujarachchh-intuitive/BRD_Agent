import { forwardRef } from "react";

interface ErrorBannerProps {
  message: string | null;
}

const ErrorBanner = forwardRef<HTMLDivElement, ErrorBannerProps>(function ErrorBanner({ message }, ref) {
  if (!message) return null;
  return (
    <div
      ref={ref}
      role="alert"
      className="mb-5 rounded-[var(--radius)] border px-4 py-3 font-medium"
      style={{
        background: "var(--color-error-bg)",
        borderColor: "var(--color-error-border)",
        color: "var(--color-error-text)",
      }}
    >
      {message}
    </div>
  );
});

export default ErrorBanner;
