"use client";

import { useEffect } from "react";

export default function StudentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[student] unhandled error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
        }}
      >
        ⚠️
      </div>
      <h2
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          color: "var(--text-primary, #111)",
          margin: 0,
        }}
      >
        حدث خطأ غير متوقع
      </h2>
      <p
        style={{
          fontSize: "0.875rem",
          color: "var(--text-secondary, #6b7280)",
          margin: 0,
          maxWidth: 360,
        }}
      >
        نعتذر عن هذا الخطأ. يرجى المحاولة مرة أخرى.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "0.5rem",
          padding: "0.5rem 1.5rem",
          borderRadius: "0.5rem",
          border: "none",
          background: "var(--primary, #2563eb)",
          color: "#fff",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
