"use client";

import { useState, useCallback, useEffect } from "react";
import { getSupabase } from "@/lib/supabase";
import type {
  DistributionItem,
  DistributionRecord,
  DistributionStock,
  DistributionSettings,
  StudentBasic,
  DeliveryStatus,
} from "../_types";
import {
  DEFAULT_UNIFORM_ITEMS,
  DEFAULT_BOOKS,
  DEFAULT_SIZE_SCALES,
  ACADEMIC_YEAR,
} from "../_constants";

type RecordsMap = Record<string, Record<string, DistributionRecord>>;

interface UseDistributionDataReturn {
  loading: boolean;
  items: DistributionItem[];
  records: RecordsMap;
  students: StudentBasic[];
  stock: DistributionStock[];
  settings: DistributionSettings | null;
  loadData: () => Promise<void>;
  seedDefaults: (schoolId: string) => Promise<void>;
  toggleDelivery: (
    studentId: string,
    item: DistributionItem,
    currentStatus: DeliveryStatus
  ) => Promise<void>;
  bulkDeliver: (
    studentId: string,
    category: "uniform" | "book",
    status: 0 | 1
  ) => Promise<void>;
  updateRecord: (
    studentId: string,
    itemId: string,
    updates: Partial<DistributionRecord>
  ) => Promise<void>;
  updateStock: (
    itemId: string,
    size: string,
    variant: string,
    quantity: number
  ) => Promise<void>;
  saveItem: (
    item: Partial<DistributionItem> & { school_id: string }
  ) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  saveSettings: (settings: Partial<DistributionSettings>) => Promise<void>;
}

function buildRecordsMap(rows: DistributionRecord[]): RecordsMap {
  const map: RecordsMap = {};
  for (const row of rows) {
    if (!map[row.student_id]) {
      map[row.student_id] = {};
    }
    map[row.student_id][row.item_id] = row;
  }
  return map;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function useDistributionData(
  schoolId: string | null
): UseDistributionDataReturn {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DistributionItem[]>([]);
  const [records, setRecords] = useState<RecordsMap>({});
  const [students, setStudents] = useState<StudentBasic[]>([]);
  const [stock, setStock] = useState<DistributionStock[]>([]);
  const [settings, setSettings] = useState<DistributionSettings | null>(null);

  const loadData = useCallback(async () => {
    if (!schoolId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = getSupabase();

    try {
      const [itemsRes, recordsRes, studentsRes, stockRes, settingsRes] =
        await Promise.all([
          supabase
            .from("distribution_items")
            .select("*")
            .eq("school_id", schoolId)
            .eq("is_active", true)
            .order("sort_order", { ascending: true }),
          supabase
            .from("distribution_records")
            .select("*")
            .eq("school_id", schoolId),
          supabase
            .from("students")
            .select("id, full_name, class_name, section, gender")
            .eq("school_id", schoolId)
            .is("deleted_at", null)
            .order("full_name", { ascending: true }),
          supabase
            .from("distribution_stock")
            .select("*")
            .eq("school_id", schoolId),
          supabase
            .from("distribution_settings")
            .select("*")
            .eq("school_id", schoolId)
            .maybeSingle(),
        ]);

      if (itemsRes.error) throw itemsRes.error;
      if (recordsRes.error) throw recordsRes.error;
      if (studentsRes.error) throw studentsRes.error;
      if (stockRes.error) throw stockRes.error;
      if (settingsRes.error) throw settingsRes.error;

      setItems(itemsRes.data as DistributionItem[]);
      setRecords(buildRecordsMap(recordsRes.data as DistributionRecord[]));
      setStudents(studentsRes.data as StudentBasic[]);
      setStock(stockRes.data as DistributionStock[]);
      setSettings(settingsRes.data as DistributionSettings | null);
    } catch (err) {
      console.error("[useDistributionData] loadData failed:", err);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const seedDefaults = useCallback(
    async (targetSchoolId: string) => {
      const supabase = getSupabase();

      const { count, error: countErr } = await supabase
        .from("distribution_items")
        .select("id", { count: "exact", head: true })
        .eq("school_id", targetSchoolId);

      if (countErr) throw countErr;
      if (count && count > 0) return;

      const uniformRows = DEFAULT_UNIFORM_ITEMS.map((item, idx) => ({
        school_id: targetSchoolId,
        academic_year: ACADEMIC_YEAR,
        category: "uniform" as const,
        grade: null,
        name: item.name,
        size_scale: item.size_scale,
        variants: item.variants,
        sort_order: idx + 1,
        is_active: true,
      }));

      let sortCounter = uniformRows.length + 1;
      const bookRows: Array<{
        school_id: string;
        academic_year: string;
        category: "book";
        grade: string;
        name: string;
        size_scale: null;
        variants: string[];
        sort_order: number;
        is_active: boolean;
      }> = [];

      for (const [grade, bookNames] of Object.entries(DEFAULT_BOOKS)) {
        for (const bookName of bookNames) {
          bookRows.push({
            school_id: targetSchoolId,
            academic_year: ACADEMIC_YEAR,
            category: "book",
            grade,
            name: bookName,
            size_scale: null,
            variants: [],
            sort_order: sortCounter,
            is_active: true,
          });
          sortCounter += 1;
        }
      }

      const { error: insertErr } = await supabase
        .from("distribution_items")
        .insert([...uniformRows, ...bookRows]);

      if (insertErr) throw insertErr;

      const { error: settingsErr } = await supabase
        .from("distribution_settings")
        .upsert(
          {
            school_id: targetSchoolId,
            academic_year: ACADEMIC_YEAR,
            size_scales: DEFAULT_SIZE_SCALES,
          },
          { onConflict: "school_id" }
        );

      if (settingsErr) throw settingsErr;

      await loadData();
    },
    [loadData]
  );

  const toggleDelivery = useCallback(
    async (
      studentId: string,
      item: DistributionItem,
      currentStatus: DeliveryStatus
    ) => {
      if (!schoolId) return;

      const newStatus: 0 | 1 = currentStatus === 1 ? 0 : 1;
      const deliveredAt = newStatus === 1 ? todayISO() : null;

      const optimisticRecord: DistributionRecord = {
        id: records[studentId]?.[item.id]?.id ?? crypto.randomUUID(),
        school_id: schoolId,
        student_id: studentId,
        item_id: item.id,
        status: newStatus,
        size: records[studentId]?.[item.id]?.size ?? null,
        variant: records[studentId]?.[item.id]?.variant ?? null,
        note: records[studentId]?.[item.id]?.note ?? null,
        delivered_at: deliveredAt,
        created_by: records[studentId]?.[item.id]?.created_by ?? null,
        created_at:
          records[studentId]?.[item.id]?.created_at ??
          new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setRecords((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          [item.id]: optimisticRecord,
        },
      }));

      const supabase = getSupabase();
      const { error } = await supabase.from("distribution_records").upsert(
        {
          school_id: schoolId,
          student_id: studentId,
          item_id: item.id,
          status: newStatus,
          delivered_at: deliveredAt,
        },
        { onConflict: "student_id,item_id" }
      );

      if (error) {
        console.error("[useDistributionData] toggleDelivery failed:", error);
        await loadData();
      }
    },
    [schoolId, records, loadData]
  );

  const bulkDeliver = useCallback(
    async (
      studentId: string,
      category: "uniform" | "book",
      status: 0 | 1
    ) => {
      if (!schoolId) return;

      const student = students.find((s) => s.id === studentId);
      if (!student) return;

      const applicableItems = items.filter((item) => {
        if (item.category !== category) return false;
        if (category === "uniform") return item.grade === null;
        return item.grade === student.class_name;
      });

      if (applicableItems.length === 0) return;

      const deliveredAt = status === 1 ? todayISO() : null;

      const optimisticUpdates: Record<string, DistributionRecord> = {};
      for (const item of applicableItems) {
        optimisticUpdates[item.id] = {
          id: records[studentId]?.[item.id]?.id ?? crypto.randomUUID(),
          school_id: schoolId,
          student_id: studentId,
          item_id: item.id,
          status,
          size: records[studentId]?.[item.id]?.size ?? null,
          variant: records[studentId]?.[item.id]?.variant ?? null,
          note: records[studentId]?.[item.id]?.note ?? null,
          delivered_at: deliveredAt,
          created_by: records[studentId]?.[item.id]?.created_by ?? null,
          created_at:
            records[studentId]?.[item.id]?.created_at ??
            new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }

      setRecords((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          ...optimisticUpdates,
        },
      }));

      const upsertRows = applicableItems.map((item) => ({
        school_id: schoolId,
        student_id: studentId,
        item_id: item.id,
        status,
        delivered_at: deliveredAt,
      }));

      const supabase = getSupabase();
      const { error } = await supabase
        .from("distribution_records")
        .upsert(upsertRows, { onConflict: "student_id,item_id" });

      if (error) {
        console.error("[useDistributionData] bulkDeliver failed:", error);
        await loadData();
      }
    },
    [schoolId, items, students, records, loadData]
  );

  const updateRecord = useCallback(
    async (
      studentId: string,
      itemId: string,
      updates: Partial<DistributionRecord>
    ) => {
      if (!schoolId) return;

      const existing = records[studentId]?.[itemId];

      const optimisticRecord: DistributionRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status: existing?.status ?? 0,
        size: existing?.size ?? null,
        variant: existing?.variant ?? null,
        note: existing?.note ?? null,
        delivered_at: existing?.delivered_at ?? null,
        created_by: existing?.created_by ?? null,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...updates,
      };

      setRecords((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          [itemId]: optimisticRecord,
        },
      }));

      const supabase = getSupabase();
      const { id: _id, created_at: _ca, updated_at: _ua, ...dbPayload } =
        optimisticRecord;

      const { error } = await supabase
        .from("distribution_records")
        .upsert(dbPayload, { onConflict: "student_id,item_id" });

      if (error) {
        console.error("[useDistributionData] updateRecord failed:", error);
        await loadData();
      }
    },
    [schoolId, records, loadData]
  );

  const updateStock = useCallback(
    async (
      itemId: string,
      size: string,
      variant: string,
      quantity: number
    ) => {
      if (!schoolId) return;

      const existingIdx = stock.findIndex(
        (s) => s.item_id === itemId && s.size === size && s.variant === variant
      );

      const optimisticEntry: DistributionStock = {
        id: existingIdx >= 0 ? stock[existingIdx].id : crypto.randomUUID(),
        school_id: schoolId,
        item_id: itemId,
        size,
        variant,
        quantity,
        academic_year: ACADEMIC_YEAR,
      };

      setStock((prev) => {
        if (existingIdx >= 0) {
          return prev.map((s, i) => (i === existingIdx ? optimisticEntry : s));
        }
        return [...prev, optimisticEntry];
      });

      const supabase = getSupabase();
      const { error } = await supabase.from("distribution_stock").upsert(
        {
          school_id: schoolId,
          item_id: itemId,
          size,
          variant,
          quantity,
          academic_year: ACADEMIC_YEAR,
        },
        { onConflict: "item_id,size,variant" }
      );

      if (error) {
        console.error("[useDistributionData] updateStock failed:", error);
        await loadData();
      }
    },
    [schoolId, stock, loadData]
  );

  const saveItem = useCallback(
    async (item: Partial<DistributionItem> & { school_id: string }) => {
      const supabase = getSupabase();

      if (item.id) {
        const { id, created_at: _ca, updated_at: _ua, ...updateData } = item;
        const { error } = await supabase
          .from("distribution_items")
          .update(updateData)
          .eq("id", id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("distribution_items")
          .insert({
            school_id: item.school_id,
            academic_year: item.academic_year ?? ACADEMIC_YEAR,
            category: item.category ?? "uniform",
            grade: item.grade ?? null,
            name: item.name ?? "",
            size_scale: item.size_scale ?? null,
            variants: item.variants ?? [],
            sort_order: item.sort_order ?? items.length + 1,
            is_active: item.is_active ?? true,
          });

        if (error) throw error;
      }

      await loadData();
    },
    [items.length, loadData]
  );

  const deleteItem = useCallback(
    async (itemId: string) => {
      setItems((prev) => prev.filter((i) => i.id !== itemId));

      const supabase = getSupabase();
      const { error } = await supabase
        .from("distribution_items")
        .delete()
        .eq("id", itemId);

      if (error) {
        console.error("[useDistributionData] deleteItem failed:", error);
        await loadData();
      }
    },
    [loadData]
  );

  const saveSettings = useCallback(
    async (updates: Partial<DistributionSettings>) => {
      if (!schoolId) return;

      const supabase = getSupabase();
      const { error } = await supabase.from("distribution_settings").upsert(
        {
          school_id: schoolId,
          academic_year: updates.academic_year ?? ACADEMIC_YEAR,
          size_scales: updates.size_scales ?? DEFAULT_SIZE_SCALES,
        },
        { onConflict: "school_id" }
      );

      if (error) throw error;

      await loadData();
    },
    [schoolId, loadData]
  );

  return {
    loading,
    items,
    records,
    students,
    stock,
    settings,
    loadData,
    seedDefaults,
    toggleDelivery,
    bulkDeliver,
    updateRecord,
    updateStock,
    saveItem,
    deleteItem,
    saveSettings,
  };
}
