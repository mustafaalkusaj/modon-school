export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { shouldStartInternalScheduler, startInternalScheduler } = await import(
    "@/lib/cron/internal-scheduler"
  );
  if (shouldStartInternalScheduler()) {
    startInternalScheduler();
  }
}
