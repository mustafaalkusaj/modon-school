import { cronMatches, parseCron, type CronSchedule } from "./schedule";

// Production runs as a single long-lived PM2 process (ecosystem.config.cjs,
// instances: 1), where vercel.json "crons" never fire. This scheduler calls
// the same routes on the same schedules (UTC), authenticated with
// CRON_SECRET exactly like Vercel Cron does.
//
// /api/cron/account-deletion is intentionally absent: its
// account_deletion_requests table does not exist in the database yet, so the
// job could only fail.
export const INTERNAL_CRON_JOBS = [
  { path: "/api/cron/scheduled-notifications", schedule: "*/5 * * * *" },
  { path: "/api/ops/warm", schedule: "0 6 * * *" },
  { path: "/api/cron/installment-reminder", schedule: "0 10 1 * *" },
  { path: "/api/cron/homework-deadline-reminder", schedule: "0 15 * * *" },
  { path: "/api/ops/weekly-report", schedule: "0 20 * * 5" },
  { path: "/api/ops/daily-report", schedule: "0 21 * * *" },
  { path: "/api/web/calendar/daily-check", schedule: "0 21 * * *" },
] as const;

const JOB_TIMEOUT_MS = 10 * 60_000;
// If the event loop stalls past a minute boundary, run the minutes we missed
// (bounded, so a long suspend does not replay hours of jobs).
const MAX_CATCH_UP_MINUTES = 5;

type ScheduledJob = { path: string; schedule: CronSchedule; running: boolean };

const STARTED = Symbol.for("modon.internalCronScheduler");

export function shouldStartInternalScheduler(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL === "1") return false; // Vercel runs vercel.json crons itself.
  if (env.NODE_ENV !== "production") return false;
  if ((env.INTERNAL_CRON ?? "").toLowerCase() === "off") return false;
  return true;
}

async function runJob(job: ScheduledJob, baseUrl: string, secret: string) {
  if (job.running) {
    console.warn(`[cron] ${job.path} still running; skipping this tick`);
    return;
  }
  job.running = true;
  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl}${job.path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
      cache: "no-store",
    });
    const ms = Date.now() - startedAt;
    if (res.ok) {
      console.info(`[cron] ${job.path} -> ${res.status} in ${ms}ms`);
    } else {
      console.error(`[cron] ${job.path} -> ${res.status} in ${ms}ms`);
    }
  } catch (error) {
    console.error(`[cron] ${job.path} failed:`, error);
  } finally {
    job.running = false;
  }
}

export function startInternalScheduler(env: NodeJS.ProcessEnv = process.env) {
  const globalState = globalThis as unknown as Record<symbol, boolean>;
  if (globalState[STARTED]) return;

  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; scheduled jobs will not run.");
    return;
  }
  globalState[STARTED] = true;

  const port = env.PORT || "3000";
  const baseUrl = env.INTERNAL_CRON_BASE_URL || `http://127.0.0.1:${port}`;
  const jobs: ScheduledJob[] = INTERNAL_CRON_JOBS.map((job) => ({
    path: job.path,
    schedule: parseCron(job.schedule),
    running: false,
  }));

  let lastMinute = Math.floor(Date.now() / 60_000);

  const tick = () => {
    const nowMinute = Math.floor(Date.now() / 60_000);
    const from = Math.max(lastMinute + 1, nowMinute - MAX_CATCH_UP_MINUTES + 1);
    for (let minute = from; minute <= nowMinute; minute += 1) {
      const at = new Date(minute * 60_000);
      for (const job of jobs) {
        if (cronMatches(job.schedule, at)) void runJob(job, baseUrl, secret);
      }
    }
    lastMinute = Math.max(lastMinute, nowMinute);
  };

  // Align ticks to just after each minute boundary.
  const msToNextMinute = 60_000 - (Date.now() % 60_000) + 1_000;
  setTimeout(() => {
    tick();
    setInterval(tick, 60_000).unref?.();
  }, msToNextMinute).unref?.();

  console.info(`[cron] internal scheduler started with ${jobs.length} jobs (UTC) against ${baseUrl}`);
}
