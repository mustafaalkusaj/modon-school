// Real account passwords must never be committed. Specs that log in as named
// accounts read them from the environment (or .env.e2e.local, which
// playwright.config.ts loads) and skip themselves when they are not set.
export const E2E_PASSWORD_ENV = {
  TEACHER_PRIMARY: "E2E_TEACHER_PRIMARY_PASSWORD",
  TEACHER_BOYS: "E2E_TEACHER_BOYS_PASSWORD",
  TEACHER_GIRLS: "E2E_TEACHER_GIRLS_PASSWORD",
  SCHOOL_ADMIN: "E2E_SCHOOL_ADMIN_PASSWORD",
  SUPER_ADMIN: "E2E_SUPER_ADMIN_PASSWORD",
  QA_SCHOOL_ADMIN: "E2E_QA_SCHOOL_ADMIN_PASSWORD",
} as const;

export type E2EAccountKey = keyof typeof E2E_PASSWORD_ENV;

export function e2ePassword(key: E2EAccountKey): string {
  return process.env[E2E_PASSWORD_ENV[key]] ?? "";
}

export function hasE2EPasswords(...keys: E2EAccountKey[]): boolean {
  return keys.every((key) => e2ePassword(key) !== "");
}
