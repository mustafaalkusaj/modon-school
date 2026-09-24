export function resolveWarmBaseUrl(
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      "APP_URL" | "OFFICIAL_DOMAIN_URL" | "NODE_ENV"
    >
  > = process.env,
) {
  const configuredUrl =
    env.APP_URL?.trim() ||
    env.OFFICIAL_DOMAIN_URL?.trim() ||
    "https://modon-school.com";
  const url = new URL(configuredUrl);
  const isLocalDevelopmentTarget =
    env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1");

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !isLocalDevelopmentTarget)
  ) {
    throw new Error("Invalid warm-up base URL configuration.");
  }

  return url.origin;
}
