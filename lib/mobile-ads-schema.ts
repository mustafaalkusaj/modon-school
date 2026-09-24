import { z } from "zod";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);

const nullableHttpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Only HTTPS URLs are allowed.",
  })
  .nullable()
  .optional()
  .transform((value) => value || null);

const nullableTimestamp = z
  .string()
  .trim()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Invalid timestamp.",
  })
  .transform((value) => new Date(value).toISOString())
  .nullable()
  .optional()
  .transform((value) => value || null);

export const mobileAdMutationSchema = z
  .object({
    type: z.enum(["image", "countdown", "video", "document"]),
    title: z.string().trim().min(1).max(140),
    body: nullableText(1500),
    bg_color: z
      .string()
      .trim()
      .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i)
      .nullable()
      .optional()
      .transform((value) => value || null),
    image_url: nullableHttpsUrl,
    target_date: nullableTimestamp,
    social_url: nullableHttpsUrl,
    social_label: nullableText(80),
    video_url: nullableHttpsUrl,
    doc_url: nullableHttpsUrl,
    doc_pages: z.number().int().min(1).max(10_000).nullable().optional(),
    is_active: z.boolean().optional().default(true),
    starts_at: nullableTimestamp,
    ends_at: nullableTimestamp,
  })
  .strict()
  .superRefine((ad, ctx) => {
    if (ad.type === "video" && !ad.video_url) {
      ctx.addIssue({
        code: "custom",
        path: ["video_url"],
        message: "Video ads require a valid HTTPS video URL.",
      });
    }
    if (ad.type === "document" && !ad.doc_url) {
      ctx.addIssue({
        code: "custom",
        path: ["doc_url"],
        message: "Document ads require a valid HTTPS document URL.",
      });
    }
    if (ad.type === "countdown" && !ad.target_date) {
      ctx.addIssue({
        code: "custom",
        path: ["target_date"],
        message: "Countdown ads require a valid target date.",
      });
    }
    if (
      ad.starts_at &&
      ad.ends_at &&
      Date.parse(ad.ends_at) <= Date.parse(ad.starts_at)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "End time must be after start time.",
      });
    }
  });

export type MobileAdMutation = z.infer<typeof mobileAdMutationSchema>;
