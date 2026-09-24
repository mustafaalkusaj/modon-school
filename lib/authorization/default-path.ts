import {
  getPathForPageCode,
  type PageCode,
} from "@/lib/authorization/page-access";
import { DEFAULT_PATH_BY_ROLE, type UserRole } from "@/types/roles";

export type AuthorizationScopeLevel =
  | "super_admin"
  | "group_admin"
  | "branch_user"
  | "restricted"
  | null;

export function buildDefaultPath(
  role: UserRole,
  allowedPages: PageCode[],
  isSinglePageUser: boolean,
  scopeLevel?: AuthorizationScopeLevel | null,
) {
  if (
    scopeLevel === "group_admin" &&
    role === "admin" &&
    allowedPages.length === 0
  ) {
    return "/group";
  }

  if (
    allowedPages.length > 0 &&
    (isSinglePageUser || !allowedPages.includes("dashboard"))
  ) {
    return getPathForPageCode(allowedPages[0]) ?? DEFAULT_PATH_BY_ROLE[role];
  }

  const rolePath = DEFAULT_PATH_BY_ROLE[role];

  // branch_user profiles are forbidden from /dashboard — sending them there
  // after login dead-ends at /access-denied with no reachable landing page.
  if (scopeLevel === "branch_user" && rolePath === "/dashboard") {
    return "/branch-overview";
  }

  return rolePath;
}
