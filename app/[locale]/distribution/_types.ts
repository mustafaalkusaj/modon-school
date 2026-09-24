export type DistributionItem = {
  id: string;
  school_id: string;
  academic_year: string;
  category: "uniform" | "book";
  grade: string | null;
  name: string;
  size_scale: "age" | "letter" | null;
  variants: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DistributionRecord = {
  id: string;
  school_id: string;
  student_id: string;
  item_id: string;
  status: 0 | 1 | 2 | 3;
  size: string | null;
  variant: string | null;
  note: string | null;
  delivered_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DistributionStock = {
  id: string;
  school_id: string;
  item_id: string;
  size: string;
  variant: string;
  quantity: number;
  academic_year: string;
};

export type DistributionSettings = {
  id: string;
  school_id: string;
  academic_year: string;
  size_scales: {
    age: { name: string; values: string[] };
    letter: { name: string; values: string[] };
  };
};

export type StudentBasic = {
  id: string;
  full_name: string;
  class_name: string;
  section: string | null;
  gender: string | null;
};

export type DeliveryStatus = 0 | 1 | 2 | 3;

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  0: "لم يُسلَّم",
  1: "مُستلم",
  2: "غير متوفر",
  3: "غير مطلوب",
};

export type ItemWithRecord = DistributionItem & {
  record: DistributionRecord | null;
};
