// src/pages/ShipmentCreatePage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateDisplay } from "../lib/dateFormat";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

function clean(v) {
  return String(v ?? "").trim();
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sortByLabel(a, b) {
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th");
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = clean(v);
    if (s) return s;
  }
  return "";
}

function isMissingColumnOrRelationError(err) {
  const msg = String(err?.message || err?.details || err?.hint || "").toLowerCase();
  return (
    msg.includes("column") ||
    msg.includes("relation") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("not found")
  );
}

function normalizeSwineRow(row, fallbackFarm) {
  const swineId = firstNonEmpty(
    row?.swine_id,
    row?.id,
    row?.uuid,
    row?.record_id,
    row?.item_id
  );

  const swineNo = firstNonEmpty(
    row?.swine_no,
    row?.swine_number,
    row?.pig_no,
    row?.ear_no,
    row?.tag_no,
    row?.animal_no,
    row?.code
  );

  const farmCode = firstNonEmpty(
    row?.farm_code,
    row?.from_farm_code,
    row?.current_farm_code,
    fallbackFarm?.farm_code
  );

  const farmName = firstNonEmpty(
    row?.farm_name,
    row?.from_farm_name,
    fallbackFarm?.farm_name
  );

  const flock = firstNonEmpty(
    row?.flock,
    row?.from_flock,
    fallbackFarm?.flock
  );

  const selectedDate = firstNonEmpty(
    row?.selected_date,
    row?.cutoff_date,
    row?.saved_date,
    row?.created_date
  );

  const isSelectable =
    row?.is_selectable === false || row?.is_available === false ? false : true;

  const label = swineNo
    ? `${swineNo}${farmCode ? ` • ${farmCode}` : ""}${flock ? ` • Flock ${flock}` : ""}`
    : `${farmCode || "-"}${flock ? ` • Flock ${flock}` : ""}`;

  return {
    raw: row,
    swine_id: swineId || null,
    swine_no: swineNo || null,
    farm_code: farmCode || null,
    farm_name: farmName || null,
    flock: flock || null,
    selected_date: selectedDate || null,
    is_selectable: isSelectable,
    label,
  };
}

function matchesFarm(row, farm) {
  const farmCode = clean(farm?.farm_code);
  const flock = clean(farm?.flock);

  if (!farmCode) return true;

  const rowFarmCode = clean(
    row?.farm_code || row?.from_farm_code || row?.current_farm_code
  );
  const rowFlock = clean(row?.flock || row?.from_flock);

  if (rowFarmCode && rowFarmCode !== farmCode) return false;
  if (flock && rowFlock && rowFlock !== flock) return false;

  return true;
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user?.id || null;
}

function FarmSelectedCard({ title, farm, subtitle, onChange }) {
  return (
    <div
      style={{
        border: "1px solid #dbe4ea",
        borderRadius: 14,
        padding: 12,
        background: "#f8fafc",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 900 }}>{title}</div>

      {farm ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {clean(farm.farm_code) || "-"} - {clean(farm.farm_name) || "-"}
          </div>

          {subtitle ? (
            <div style={{ color: "#64748b", fontSize: 13 }}>{subtitle}</div>
          ) : null}
        </>
      ) : (
        <div style={{ color: "#64748b", fontSize: 13 }}>ยังไม่ได้เลือกฟาร์ม</div>
      )}

      <div>
        <button type="button" onClick={onChange}>
          เปลี่ยนฟาร์ม
        </button>
      </div>
    </div>
  );
}

function SwineSelectedCard({ swine, onChange }) {
  return (
    <div
      style={{
        border: "1px solid #dbe4ea",
        borderRadius: 14,
        padding: 12,
        background: "#f8fafc",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 900 }}>เบอร์หมู — เลือกจากฟาร์มต้นทาง</div>

      {swine ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {clean(swine.swine_no) || "-"}
          </div>

          <div style={{ color: "#64748b", fontSize: 13 }}>
            {clean(swine.farm_code) || "-"}
            {clean(swine.farm_name) ? ` - ${clean(swine.farm_name)}` : ""}
            {clean(swine.flock) ? ` | Flock: ${clean(swine.flock)}` : ""}
            {clean(swine.selected_date)
              ? ` | วันที่คัด: ${formatDateDisplay(swine.selected_date)}`
              : ""}
          </div>
        </>
      ) : (
        <div style={{ color: "#64748b", fontSize: 13 }}>ยังไม่ได้เลือกเบอร์หมู</div>
      )}

      <div>
        <button type="button" onClick={onChange}>
          เปลี่ยนเบอร์หมู
        </button>
      </div>
    </div>
  );
}

export default function ShipmentCreatePage() {
  const nav = useNavigate();

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [currentUserId, setCurrentUserId] = useState("");
  const [lastDraftId, setLastDraftId] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());

  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);
  const [fromPickerOpen, setFromPickerOpen] = useState(true);

  const [swineQ, setSwineQ] = useState("");
  const [swineLoading, setSwineLoading] = useState(false);
  const [swineOptions, setSwineOptions] = useState([]);
  const [selectedSwine, setSelectedSwine] = useState(null);
  const [swinePickerOpen, setSwinePickerOpen] = useState(true);
  const [swineLoadHint, setSwineLoadHint] = useState("");

  const [toFarmId, setToFarmId] = useState(null);
  const [toFarm, setToFarm] = useState(null);
  const [toPickerOpen, setToPickerOpen] = useState(true);

  const [remark, setRemark] = useState("");

  useEffect(() => {
    let alive = true;

    async function init() {
      setBootLoading(true);
      try {
        const uid = await getCurrentUserId();
        if (!alive) return;
        setCurrentUserId(uid || "");
      } catch (e) {
        console.error("ShipmentCreatePage init error:", e);
        if (alive) setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
      } finally {
        if (alive) setBootLoading(false);
      }
    }

    void init();
    return () => {
      alive = false;
    };
  }, []);

  const loadFromFarms = useCallback(async () => {
    setFromLoading(true);
    setMsg("");

    try {
      const { data, error } = await supabase
        .from("v_swine_source_farms")
        .select(
          "farm_code, farm_name, flock, swine_count, first_saved_date, cutoff_date, is_selectable"
        )
        .eq("is_selectable", true)
        .order("farm_code", { ascending: true });

      if (error) throw error;

      const arr = (data || [])
        .map((r) => ({
          farm_code: clean(r.farm_code),
          farm_name: clean(r.farm_name) || clean(r.farm_code),
          flock: clean(r.flock),
          branch_id: null,
          swine_count: Number(r.swine_count || 0),
          first_saved_date: r.first_saved_date || null,
          cutoff_date: r.cutoff_date || null,
          is_selectable: r.is_selectable !== false,
          label: `${clean(r.farm_code)} - ${clean(r.farm_name) || clean(r.farm_code)}`,
        }))
        .filter((x) => x.farm_code && x.is_selectable);

      setFromOptions(arr);
    } catch (e) {
      console.error("loadFromFarms error:", e);
      setFromOptions([]);
      setMsg(e?.message || "โหลดฟาร์มต้นทางไม่สำเร็จ");
    } finally {
      setFromLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFromFarms();
  }, [loadFromFarms]);

  useEffect(() => {
    let alive = true;

    async function loadToFarm() {
      if (!toFarmId) {
        setToFarm(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("master_farms")
          .select("id, farm_code, farm_name")
          .eq("id", toFarmId)
          .single();

        if (!alive) return;
        if (error) throw error;

        setToFarm(data || null);
      } catch (e) {
        console.error("loadToFarm error:", e);
        if (alive) {
          setToFarm(null);
          setMsg(e?.message || "โหลดฟาร์มปลายทางไม่สำเร็จ");
        }
      }
    }

    void loadToFarm();
    return () => {
      alive = false;
    };
  }, [toFarmId]);

  const filteredFromOptions = useMemo(() => {
    const q = clean(fromQ).toLowerCase();
    const result = !q
      ? fromOptions.slice(0, 30)
      : fromOptions
          .filter((x) =>
            `${x.farm_code} ${x.farm_name} ${x.flock}`.toLowerCase().includes(q)
          )
          .slice(0, 30);

    return result.sort(sortByLabel);
  }, [fromOptions, fromQ]);

  const filteredSwineOptions = useMemo(() => {
    const q = clean(swineQ).toLowerCase();
    const result = !q
      ? swineOptions.slice(0, 50)
      : swineOptions
          .filter((x) =>
            `${x.swine_no || ""} ${x.farm_code || ""} ${x.farm_name || ""} ${x.flock || ""}`
              .toLowerCase()
              .includes(q)
          )
          .slice(0, 50);

    return result.sort(sortByLabel);
  }, [swineOptions, swineQ]);

  const isSameFarm = useMemo(() => {
    return (
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarm?.farm_code) &&
      clean(fromFarm?.farm_code) === clean(toFarm?.farm_code)
    );
  }, [fromFarm?.farm_code, toFarm?.farm_code]);

  useEffect(() => {
    setSelectedSwine(null);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
  }, [fromFarm?.farm_code, fromFarm?.flock, selectedDate]);

  const loadSwines = useCallback(async () => {
    const farmCode = clean(fromFarm?.farm_code);
    const flock = clean(fromFarm?.flock);

    if (!farmCode) {
      setSwineOptions([]);
      setSwineLoadHint("");
      return;
    }

    setSwineLoading(true);
    setSwineLoadHint("");

    const SOURCE_CANDIDATES = [
      "v_swine_source_swines",
      "v_swine_source_numbers",
      "v_swine_numbers_available",
      "v_swine_available",
      "swines",
    ];

    let foundRows = [];
    let lastError = null;
    let loadedFrom = "";

    try {
      outer: for (const sourceName of SOURCE_CANDIDATES) {
        const attempts = [];

        if (farmCode && flock) {
          attempts.push(() =>
            supabase
              .from(sourceName)
              .select("*")
              .eq("farm_code", farmCode)
              .eq("flock", flock)
              .limit(300)
          );
        }

        if (farmCode) {
          attempts.push(() =>
            supabase.from(sourceName).select("*").eq("farm_code", farmCode).limit(300)
          );
          attempts.push(() =>
            supabase
              .from(sourceName)
              .select("*")
              .eq("from_farm_code", farmCode)
              .limit(300)
          );
          attempts.push(() =>
            supabase
              .from(sourceName)
              .select("*")
              .eq("current_farm_code", farmCode)
              .limit(300)
          );
        }

        attempts.push(() => supabase.from(sourceName).select("*").limit(500));

        for (const makeQuery of attempts) {
          const { data, error } = await makeQuery();

          if (error) {
            lastError = error;
            continue;
          }

          const normalized = (data || [])
            .filter((row) => matchesFarm(row, fromFarm))
            .map((row) => normalizeSwineRow(row, fromFarm))
            .filter((x) => x.is_selectable !== false)
            .filter((x) => clean(x.swine_no));

          const dedupMap = new Map();
          for (const item of normalized) {
            const key = clean(item.swine_id) || clean(item.swine_no);
            if (!key) continue;
            if (!dedupMap.has(key)) dedupMap.set(key, item);
          }

          const arr = Array.from(dedupMap.values()).sort(sortByLabel);

          if (arr.length > 0) {
            foundRows = arr;
            loadedFrom = sourceName;
            break outer;
          }
        }
      }

      setSwineOptions(foundRows);

      if (foundRows.length > 0) {
        setSwineLoadHint(`โหลดจาก ${loadedFrom}`);
      } else if (lastError && !isMissingColumnOrRelationError(lastError)) {
        setSwineLoadHint(lastError?.message || "โหลดเบอร์หมูไม่สำเร็จ");
      } else {
        setSwineLoadHint("ไม่พบเบอร์หมูของฟาร์มนี้");
      }
    } catch (e) {
      console.error("loadSwines error:", e);
      setSwineOptions([]);
      setSwineLoadHint(e?.message || "โหลดเบอร์หมูไม่สำเร็จ");
    } finally {
      setSwineLoading(false);
    }
  }, [fromFarm, selectedDate]);

  useEffect(() => {
    if (!fromFarm?.farm_code) return;
    void loadSwines();
  }, [fromFarm?.farm_code, fromFarm?.flock, selectedDate, loadSwines]);

  const hardErrors = useMemo(() => {
    const errors = [];

    if (!clean(selectedDate)) {
      errors.push("กรุณาเลือกวันคัด");
    }

    if (!fromFarm?.farm_code) {
      errors.push("กรุณาเลือกฟาร์มต้นทางจากรายการที่คัดได้");
    }

    if (!clean(selectedSwine?.swine_no)) {
      errors.push("กรุณาเลือกเบอร์หมู");
    }

    if (!clean(toFarmId)) {
      errors.push("กรุณาเลือกฟาร์มปลายทาง");
    }

    if (isSameFarm) {
      errors.push("ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน");
    }

    if (fromFarm && !clean(fromFarm?.farm_code)) {
      errors.push("ฟาร์มต้นทางไม่มี farm_code");
    }

    if (toFarmId && !clean(toFarm?.id)) {
      errors.push("ฟาร์มปลายทางไม่มี id");
    }

    return errors;
  }, [selectedDate, fromFarm, selectedSwine, toFarmId, toFarm?.id, isSameFarm]);

  const canSave = useMemo(() => {
    return !bootLoading && !saving && hardErrors.length === 0;
  }, [bootLoading, saving, hardErrors.length]);

  const handleSelectFromFarm = useCallback((farm) => {
    setMsg("");
    setFromFarm(farm || null);
    setSelectedSwine(null);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
    if (farm) setFromPickerOpen(false);
  }, []);

  const clearFromFarm = useCallback(() => {
    setFromFarm(null);
    setFromQ("");
    setFromPickerOpen(true);
    setSelectedSwine(null);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
  }, []);

  const handleSelectSwine = useCallback((swine) => {
    setMsg("");
    setSelectedSwine(swine || null);
    setLastDraftId("");
    if (swine) setSwinePickerOpen(false);
  }, []);

  const clearSwine = useCallback(() => {
    setSelectedSwine(null);
    setSwineQ("");
    setSwinePickerOpen(true);
    setLastDraftId("");
  }, []);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || null);
    if (id) setToPickerOpen(false);
    setLastDraftId("");
  }, []);

  const saveDraft = useCallback(async () => {
    if (hardErrors.length > 0) {
      setMsg(hardErrors.join(" | "));
      return;
    }

    setSaving(true);
    setMsg("");
    setLastDraftId("");

    try {
      const uid = currentUserId || (await getCurrentUserId());
      if (!uid) {
        throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");
      }

      const fromFarmCode = clean(fromFarm?.farm_code);
      const swineNo = clean(selectedSwine?.swine_no);
      const swineId = clean(selectedSwine?.swine_id);

      if (!fromFarmCode) {
        throw new Error("ฟาร์มต้นทางไม่มี farm_code");
      }

      if (!swineNo) {
        throw new Error("ยังไม่ได้เลือกเบอร์หมู");
      }

      let existingDraft = null;
      let duplicateErr = null;

      if (swineId) {
        const { data, error } = await supabase
          .from("swine_shipments")
          .select("id")
          .eq("selected_date", selectedDate)
          .eq("from_farm_code", fromFarmCode)
          .eq("to_farm_id", toFarmId)
          .eq("swine_id", swineId)
          .eq("status", "draft")
          .eq("created_by", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error) {
          existingDraft = data || null;
        } else {
          duplicateErr = error;
        }
      }

      if (!existingDraft && swineNo) {
        const { data, error } = await supabase
          .from("swine_shipments")
          .select("id")
          .eq("selected_date", selectedDate)
          .eq("from_farm_code", fromFarmCode)
          .eq("to_farm_id", toFarmId)
          .eq("swine_no", swineNo)
          .eq("status", "draft")
          .eq("created_by", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error) {
          existingDraft = data || null;
        } else if (!duplicateErr) {
          duplicateErr = error;
        }
      }

      if (!existingDraft) {
        const { data, error } = await supabase
          .from("swine_shipments")
          .select("id")
          .eq("selected_date", selectedDate)
          .eq("from_farm_code", fromFarmCode)
          .eq("to_farm_id", toFarmId)
          .eq("status", "draft")
          .eq("created_by", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          if (!duplicateErr || !isMissingColumnOrRelationError(duplicateErr)) {
            throw error;
          }
        } else {
          existingDraft = data || null;
        }
      }

      if (existingDraft?.id) {
        setLastDraftId(existingDraft.id);
        setMsg(
          "พบ Draft เดิมของชุดนี้แล้ว ระบบยังไม่พาไปหน้า Edit อัตโนมัติ กรุณากดปุ่มไปหน้า Edit Draft เอง"
        );
        return;
      }

      const basePayload = {
        selected_date: selectedDate,
        from_farm_code: fromFarmCode || null,
        from_farm_name: clean(fromFarm?.farm_name) || null,
        from_flock: clean(fromFarm?.flock) || null,
        from_branch_id: fromFarm?.branch_id || null,
        to_farm_id: toFarmId,
        remark: clean(remark) || null,
        status: "draft",
        created_by: uid,
      };

      const payloadWithSwine = {
        ...basePayload,
        swine_id: swineId || null,
        swine_no: swineNo || null,
      };

      let inserted = null;

      {
        const { data, error } = await supabase
          .from("swine_shipments")
          .insert([payloadWithSwine])
          .select("id")
          .single();

        if (!error && data?.id) {
          inserted = data;
        } else if (error && isMissingColumnOrRelationError(error)) {
          const retry = await supabase
            .from("swine_shipments")
            .insert([basePayload])
            .select("id")
            .single();

          if (retry.error) throw retry.error;
          if (!retry.data?.id) throw new Error("สร้าง draft ไม่สำเร็จ");
          inserted = retry.data;
        } else if (error) {
          throw error;
        }
      }

      if (!inserted?.id) throw new Error("สร้าง draft ไม่สำเร็จ");

      setLastDraftId(inserted.id);
      setMsg(
        `บันทึก Draft สำเร็จ ✅ เบอร์หมู: ${swineNo} | ระบบยังไม่พาไปหน้า Edit อัตโนมัติ กรุณากดปุ่มไปหน้า Edit Draft เอง`
      );
    } catch (e) {
      console.error("saveDraft error:", e);
      setMsg(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }, [
    currentUserId,
    fromFarm,
    hardErrors,
    remark,
    selectedDate,
    selectedSwine,
    toFarmId,
  ]);

  if (bootLoading) {
    return (
      <div style={{ padding: 16 }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Create Shipment</h2>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid #dbe4ea",
          background: "#f8fafc",
          color: "#334155",
          lineHeight: 1.7,
        }}
      >
        หน้านี้ใช้สำหรับสร้าง Draft เริ่มต้นของ Shipment ก่อน
        <br />
        เมื่อกด <b>Save Draft</b> แล้ว ระบบจะยังคงอยู่หน้านี้ และให้ผู้ใช้กดปุ่มไปหน้า <b>Edit Draft</b> เอง
      </div>

      {msg ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: msg.includes("สำเร็จ")
              ? "1px solid #bbf7d0"
              : "1px solid #fecaca",
            background: msg.includes("สำเร็จ") ? "#f0fdf4" : "#fef2f2",
            color: msg.includes("สำเร็จ") ? "#166534" : "#991b1b",
            fontWeight: 700,
            lineHeight: 1.7,
          }}
        >
          {msg}
        </div>
      ) : null}

      <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
        วันคัด
        <input
          type="date"
          value={selectedDate}
          max={todayYmdLocal()}
          onChange={(e) => {
            setMsg("");
            setLastDraftId("");
            setSelectedDate(e.target.value);
          }}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
        <div style={{ color: "#64748b", fontSize: 12 }}>
          แสดงผล: {formatDateDisplay(selectedDate)}
        </div>
      </label>

      {fromFarm && !fromPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มต้นทาง (คัด/ดัด/จับออก)"
          farm={fromFarm}
          subtitle={
            fromFarm?.flock
              ? `Flock: ${fromFarm.flock}${
                  Number.isFinite(fromFarm?.swine_count)
                    ? ` | คัดได้ ${fromFarm.swine_count} ตัว`
                    : ""
                }`
              : Number.isFinite(fromFarm?.swine_count)
              ? `คัดได้ ${fromFarm.swine_count} ตัว`
              : ""
          }
          onChange={() => setFromPickerOpen(true)}
        />
      ) : (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 900 }}>
              ฟาร์มต้นทาง (คัด/ดัด/จับออก) — เลือกจากรายการที่คัดได้
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={loadFromFarms} disabled={fromLoading}>
                {fromLoading ? "กำลังโหลด..." : "รีเฟรช"}
              </button>

              <button type="button" onClick={clearFromFarm} disabled={fromLoading}>
                ล้างค่า
              </button>
            </div>
          </div>

          <input
            value={fromQ}
            onChange={(e) => setFromQ(e.target.value)}
            placeholder="พิมพ์ค้นหา farm code / farm name / flock…"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              overflow: "hidden",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {fromLoading ? (
              <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>
            ) : filteredFromOptions.length > 0 ? (
              filteredFromOptions.map((f) => {
                const active =
                  clean(fromFarm?.farm_code) === clean(f.farm_code) &&
                  clean(fromFarm?.flock) === clean(f.flock);

                return (
                  <button
                    key={`${f.farm_code}__${f.flock || "-"}__${f.farm_name}`}
                    type="button"
                    onClick={() => handleSelectFromFarm(f)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid #eee",
                      background: active ? "#fef9c3" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                      {f.farm_code} - {f.farm_name}
                    </div>

                    <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                      Flock: <b>{f.flock || "-"}</b>
                      {Number.isFinite(f.swine_count) ? (
                        <>
                          {" "}
                          | คัดได้ <b>{f.swine_count}</b> ตัว
                        </>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มต้นทาง</div>
            )}
          </div>
        </div>
      )}

      {fromFarm ? (
        selectedSwine && !swinePickerOpen ? (
          <SwineSelectedCard
            swine={selectedSwine}
            onChange={() => setSwinePickerOpen(true)}
          />
        ) : (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 900 }}>เบอร์หมู — เลือกจากฟาร์มต้นทาง</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={loadSwines} disabled={swineLoading}>
                  {swineLoading ? "กำลังโหลด..." : "รีเฟรช"}
                </button>

                <button type="button" onClick={clearSwine} disabled={swineLoading}>
                  ล้างค่า
                </button>
              </div>
            </div>

            <input
              value={swineQ}
              onChange={(e) => setSwineQ(e.target.value)}
              placeholder="พิมพ์ค้นหาเบอร์หมู / farm code / flock…"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />

            {swineLoadHint ? (
              <div style={{ color: "#64748b", fontSize: 12 }}>{swineLoadHint}</div>
            ) : null}

            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                overflow: "hidden",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {swineLoading ? (
                <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>
              ) : filteredSwineOptions.length > 0 ? (
                filteredSwineOptions.map((s) => {
                  const active =
                    clean(selectedSwine?.swine_id) === clean(s.swine_id) &&
                    clean(selectedSwine?.swine_no) === clean(s.swine_no);

                  return (
                    <button
                      key={`${s.swine_id || "noid"}__${s.swine_no || "-"}`}
                      type="button"
                      onClick={() => handleSelectSwine(s)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: 0,
                        borderBottom: "1px solid #eee",
                        background: active ? "#dcfce7" : "white",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                        {s.swine_no || "-"}
                      </div>

                      <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                        {s.farm_code || "-"}
                        {s.farm_name ? ` - ${s.farm_name}` : ""}
                        {s.flock ? ` | Flock: ${s.flock}` : ""}
                        {s.selected_date
                          ? ` | วันที่คัด: ${formatDateDisplay(s.selected_date)}`
                          : ""}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div style={{ padding: 12, color: "#666" }}>ไม่พบเบอร์หมู</div>
              )}
            </div>
          </div>
        )
      ) : null}

      {toFarmId && !toPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
          farm={toFarm}
          onChange={() => setToPickerOpen(true)}
        />
      ) : (
        <FarmPickerInlineAdd
          label="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
          value={toFarmId}
          excludeId={null}
          onChange={onChangeToFarm}
          requireBranch={false}
        />
      )}

      {isSameFarm ? (
        <div style={{ color: "crimson", fontWeight: 700 }}>
          ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน
        </div>
      ) : null}

      <label style={{ display: "grid", gap: 6 }}>
        หมายเหตุ
        <textarea
          value={remark}
          onChange={(e) => {
            setMsg("");
            setRemark(e.target.value);
          }}
          rows={3}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </label>

      {hardErrors.length > 0 ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "#fff7ed",
            border: "1px solid #fdba74",
            color: "#9a3412",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>ยัง Save Draft ไม่ได้</div>
          <div style={{ display: "grid", gap: 4 }}>
            {hardErrors.map((x, i) => (
              <div key={i}>- {x}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={saveDraft} disabled={!canSave}>
          {saving ? "กำลังบันทึก..." : "Save Draft"}
        </button>

        <button
          type="button"
          onClick={() => {
            if (lastDraftId) {
              nav(`/edit-shipment?id=${encodeURIComponent(lastDraftId)}`);
            } else {
              nav("/edit-shipment");
            }
          }}
        >
          {lastDraftId ? "เปิด Draft ที่เพิ่งบันทึก" : "ไปหน้า Edit Draft"}
        </button>
      </div>

      <div style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>
        ฟาร์มต้นทางจะเลือกจาก <b>v_swine_source_farms</b>
        <br />
        เบอร์หมูจะพยายามโหลดจาก view/table หลายชื่อ เช่น{" "}
        <b>v_swine_source_swines</b>, <b>v_swine_source_numbers</b>, <b>swines</b>
        <br />
        ถ้ามี Draft เดิมของ user คนเดิมในวันคัด + ต้นทาง + ปลายทาง เดียวกัน ระบบจะไม่สร้างซ้ำ และให้กดปุ่มไปหน้า Edit เอง
      </div>
    </div>
  );
}