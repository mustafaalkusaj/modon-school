export default function StudentLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "1rem",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: "3px solid var(--card-border, #e5e7eb)",
          borderTopColor: "var(--primary, #2563eb)",
          borderRadius: "50%",
          animation: "student-spin 0.7s linear infinite",
        }}
      />
      <span
        style={{
          fontSize: "0.875rem",
          color: "var(--text-secondary, #6b7280)",
        }}
      >
        جاري التحميل...
      </span>
      <style>{`@keyframes student-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
