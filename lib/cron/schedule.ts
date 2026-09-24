// Minimal 5-field cron matcher (minute hour day-of-month month day-of-week),
// evaluated in UTC like Vercel Cron. Supports "*", numbers, lists "a,b",
// ranges "a-b" and steps "*/n" / "a-b/n".

type Field = { min: number; max: number };

const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 are Sunday)
];

export type CronSchedule = {
  sets: Set<number>[];
  domRestricted: boolean;
  dowRestricted: boolean;
};

function parseField(expr: string, field: Field): Set<number> {
  const values = new Set<number>();
  for (const part of expr.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid step in "${expr}"`);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = field.min;
      end = field.max;
    } else if (rangePart.includes("-")) {
      [start, end] = rangePart.split("-").map(Number);
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : field.max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < field.min || end > field.max || start > end) {
      throw new Error(`invalid cron field "${expr}"`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron expression must have 5 fields: "${expression}"`);
  const sets = parts.map((part, i) => parseField(part, FIELDS[i]));
  if (sets[4].has(7)) sets[4].add(0);
  return { sets, domRestricted: parts[2] !== "*", dowRestricted: parts[4] !== "*" };
}

export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  const [minutes, hours, dom, months, dow] = schedule.sets;
  if (!minutes.has(date.getUTCMinutes())) return false;
  if (!hours.has(date.getUTCHours())) return false;
  if (!months.has(date.getUTCMonth() + 1)) return false;

  const domOk = dom.has(date.getUTCDate());
  const dowOk = dow.has(date.getUTCDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (schedule.domRestricted && schedule.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}
