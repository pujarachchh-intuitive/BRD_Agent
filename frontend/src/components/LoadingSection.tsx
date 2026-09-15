interface LoadingSectionProps {
  visible: boolean;
  message: string;
}

export default function LoadingSection({ visible, message }: LoadingSectionProps) {
  if (!visible) return null;
  return (
    <div
      className="mb-5 flex items-center gap-3.5 rounded-2xl border px-5 py-4.5 shadow-sm"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <span
        aria-hidden
        className="h-6.5 w-6.5 flex-shrink-0 animate-spin rounded-full border-[3px]"
        style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-primary)" }}
      />
      <p className="m-0">{message}</p>
    </div>
  );
}
