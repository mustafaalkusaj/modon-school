"use client";
import { useState, useCallback, useEffect } from "react";
import { fetchJsonWithAuthorizedSession, withJsonHeaders } from "@/lib/authorized-api";
import type { TeacherRecord, TeacherFormData } from "../_types";
import type { UserProfile } from "@/lib/auth";
import { resolveSchoolBranchForProfile } from "@/lib/school/context";

interface UseTeachersDataProps {
  profile: UserProfile | null;
  selectedSchoolId: string | null;
  scopeLoading: boolean;
}

/** One class/section/subject a teacher is assigned to. */
export interface TeacherAssignment {
  class_name: string;
  section: string | null;
  subject: string | null;
}

/** Keyed by teacher id — the shape /api/web/teachers/assignments returns. */
export type TeacherAssignmentsMap = Record<string, TeacherAssignment[]>;

export function useTeachersData({ profile, selectedSchoolId, scopeLoading }: UseTeachersDataProps) {
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [assignmentsMap, setAssignmentsMap] = useState<TeacherAssignmentsMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");

  const fetchTeachers = useCallback(async () => {
    const { school_id: schoolId } = await resolveSchoolBranchForProfile(profile, { selectedSchoolId });
    if (!schoolId) { setTeachers([]); setAssignmentsMap({}); return; }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ schoolId });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (subjectFilter) params.set("subject", subjectFilter);

      // Assignments load alongside the teachers, never before them: a failure
      // there only costs the class badges, so it must not block the table.
      const [teachersRes, assignmentsRes] = await Promise.all([
        fetchJsonWithAuthorizedSession<{ ok: boolean; teachers: TeacherRecord[]; total: number }>(
          `/api/web/teachers?${params.toString()}`
        ),
        fetchJsonWithAuthorizedSession<{ ok: boolean; data: TeacherAssignmentsMap }>(
          `/api/web/teachers/assignments?${params.toString()}`
        ),
      ]);

      const { response, payload } = teachersRes;
      if (!response.ok) throw new Error((payload as unknown as { error?: { message?: string } })?.error?.message || "تعذر تحميل الأساتذة");
      setTeachers(payload?.teachers ?? []);

      setAssignmentsMap(
        assignmentsRes.response.ok && assignmentsRes.payload?.data
          ? assignmentsRes.payload.data
          : {},
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الأساتذة");
    } finally {
      setLoading(false);
    }
  }, [profile, selectedSchoolId, search, statusFilter, subjectFilter]);

  const saveTeacher = useCallback(async (form: TeacherFormData, editingId: string | null) => {
    const { school_id: schoolId, branch_id: branchId } = await resolveSchoolBranchForProfile(profile, { selectedSchoolId });
    if (!schoolId) throw new Error("لا يمكن تحديد المدرسة");

    const method = editingId ? "PATCH" : "POST";
    const url = editingId ? `/api/web/teachers/${editingId}` : "/api/web/teachers";

    const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; teacher: TeacherRecord }>(
      url,
      { method, headers: withJsonHeaders(), body: JSON.stringify({ ...form, school_id: schoolId, branch_id: branchId }) }
    );
    if (!response.ok) throw new Error((payload as unknown as { error?: { message?: string } })?.error?.message || "تعذر حفظ المعلم");
    await fetchTeachers();
    return payload?.teacher;
  }, [profile, selectedSchoolId, fetchTeachers]);

  const deleteTeacher = useCallback(async (id: string) => {
    const { school_id: schoolId } = await resolveSchoolBranchForProfile(profile, { selectedSchoolId });
    const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean }>(
      `/api/web/teachers/${id}`,
      { method: "DELETE", headers: withJsonHeaders(), body: JSON.stringify({ school_id: schoolId }) }
    );
    if (!response.ok) throw new Error((payload as unknown as { error?: { message?: string } })?.error?.message || "تعذر حذف المعلم");
    setTeachers(prev => prev.filter(t => t.id !== id));
    setAssignmentsMap(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [profile, selectedSchoolId]);

  useEffect(() => {
    if (!profile || scopeLoading) return;
    void fetchTeachers();
  }, [fetchTeachers, profile, scopeLoading]);

  return {
    teachers,
    assignmentsMap,
    loading,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    subjectFilter,
    setSubjectFilter,
    refetch: fetchTeachers,
    saveTeacher,
    deleteTeacher,
  };
}
