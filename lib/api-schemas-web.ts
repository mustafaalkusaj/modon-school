import { z } from "zod";

// ─── Announcements ─────────────────────────────────────────────
export const createAnnouncementSchema = z.object({
  schoolId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1, "العنوان مطلوب").max(500),
  body: z.string().trim().min(1, "المحتوى مطلوب").max(10000),
  mediaUrl: z.string().url().optional().nullable(),
  mediaType: z.enum(["image", "video", "document"]).optional().nullable(),
  isPinned: z.boolean().default(false),
  expiresAt: z.string().datetime().optional().nullable(),
});

// ─── Ads ────────────────────────────────────────────────────────
export const createAdSchema = z.object({
  schoolId: z.string().uuid().optional(),
  type: z.string().trim().min(1, "نوع الإعلان مطلوب"),
  title: z.string().trim().min(1, "العنوان مطلوب").max(500),
  body: z.string().trim().max(5000).optional().nullable(),
  bgColor: z.string().max(20).default("#4F46E5"),
  imageUrl: z.string().url().optional().nullable(),
  targetDate: z.string().optional().nullable(),
  socialUrl: z.string().url().optional().nullable(),
  socialLabel: z.string().max(100).optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
  docUrl: z.string().url().optional().nullable(),
  docPages: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().default(true),
});

// ─── Behavior ───────────────────────────────────────────────────
export const createBehaviorSchema = z.object({
  schoolId: z.string().uuid().optional().nullable(),
  student_id: z.string().uuid().optional().nullable(),
  student_name: z.string().trim().min(1, "اسم الطالب مطلوب").max(255),
  behavior_type: z.enum(["positive", "negative", "neutral"], {
    message: "نوع السلوك غير صالح",
  }),
  points: z.coerce.number().int().default(0),
  note: z.string().trim().max(2000).optional().nullable(),
});

// ─── Notifications ──────────────────────────────────────────────
export const sendNotificationSchema = z.object({
  schoolId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(5000),
  targetRole: z.enum(["all", "admin", "teacher", "parent", "student"]).optional(),
  branchId: z.string().uuid().optional().nullable(),
  classId: z.string().uuid().optional().nullable(),
});

// ─── Calendar Events ────────────────────────────────────────────
export const createEventSchema = z.object({
  schoolId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional().nullable(),
  event_type: z.string().trim().optional(),
  is_holiday: z.boolean().default(false),
});

// ─── Feature Flags ──────────────────────────────────────────────
export const updateFeatureFlagSchema = z.object({
  key: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  schoolId: z.string().uuid().optional(),
});

// ─── Assignments ────────────────────────────────────────────────
export const createAssignmentSchema = z.object({
  schoolId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional().nullable(),
  subject_id: z.string().uuid().optional().nullable(),
  class_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  max_score: z.coerce.number().min(0).max(1000).optional(),
});
