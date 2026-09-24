import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PASS_PERCENTAGE = 50;

export async function resolveSchoolPassPercentage(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("grade_schemes")
      .select("pass_score")
      .eq("school_id", schoolId)
      .eq("is_default", true);

    if (error || !data || data.length === 0) {
      return DEFAULT_PASS_PERCENTAGE;
    }

    const scores = (data as Array<{ pass_score: number | string | null }>)
      .map((row) => Number(row.pass_score))
      .filter((score) => Number.isFinite(score) && score > 0);

    if (scores.length === 0) {
      return DEFAULT_PASS_PERCENTAGE;
    }

    const distinct = new Set(scores);
    return distinct.size === 1 ? scores[0] : DEFAULT_PASS_PERCENTAGE;
  } catch {
    return DEFAULT_PASS_PERCENTAGE;
  }
}
