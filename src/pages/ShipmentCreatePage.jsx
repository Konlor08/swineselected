// src/pages/ShipmentCreatePage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th", {
    numeric: true,
  });
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toIntOrNull(v) {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNumOrNull(v) {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user?.id || null;
}

function qrImageUrl(text) {
  const s = clean(text);
  if (!s) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(s)}`;
}

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 14,
  background: "#fff",
};

const labelStyle = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
  color: "#374151",
};

const inputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
  minWidth: 0,
  background: "#fff",
};

function FarmSelectedCard({ title, farm, subtitle, onChange }) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 900 }}>{title}</div>
      {farm ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.35 }}>
            {clean(farm.farm_code) || "-"} - {clean(farm.farm_name) || "-"}
          </div>
          {subtitle ? (
            <div style={{ color: "#6b7280", fontSize: 13 }}>{subtitle}</div>
          ) : null}
        </>
      ) : (
        <div style={{ color: "#6b7280", fontSize: 13 }}>ยังไม่ได้เลือกฟาร์ม</div>
      )}

      <div>
        <button type="button" onClick={onChange}>
          เปลี่ยนฟาร์ม
        </button>
      </div>
    </div>
  );
}

function QrPreviewBox({ value }) {
  const qrUrl = qrImageUrl(value);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 100,
        border: "4px solid #f2df00",
        borderRadius: 4,
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          justifyItems: "center",
          width: "100%",
        }}
      >
        <img
          src={qrUrl}
          alt={`QR ${value}`}
          style={{
            width: "100%",
            maxWidth: 220,
            aspectRatio: "1 / 1",
            objectFit: "contain",
            display: "block",
            background: "#fff",
          }}
        />
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: "#374151",
            wordBreak: "break-all",
            textAlign: "center",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export default function ShipmentCreatePage() {
  const nav = useNavigate();
  const isLeavingAfterSaveRef = useRef(false);

  const [bootLoading, setBootLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [busyRelease, setBusyRelease] = useState(false);
  const [msg, setMsg] = useState("");

  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());

  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);
  const [fromPickerOpen, setFromPickerOpen] = useState(true);

  const [toFarmId, setToFarmId] = useState("");
  const [toFarm, setToFarm] = useState(null);
  const [toPickerOpen, setToPickerOpen] = useState(true);

  const [availableLoading, setAvailableLoading] = useState(false);
  const [allAvailableSwines, setAllAvailableSwines] = useState([]);
  const [houseOptions, setHouseOptions] = useState([]);
  const [selectedHouse, setSelectedHouse] = useState("");

  const [swineQ, setSwineQ] = useState("");
  const [selectedCandidateSwineId, setSelectedCandidateSwineId] = useState("");

  const [teatsLeft, setTeatsLeft] = useState("");
  const [teatsRight, setTeatsRight] = useState("");
  const [weight, setWeight] = useState("");
  const [backfat, setBackfat] = useState("");

  const [pickedRows, setPickedRows] = useState([]);
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
          label: `${clean(r.farm_code)} - ${clean(r.farm_name) || clean(r.farm_code)}`,
        }))
        .filter((x) => x.farm_code);

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

  const pickedCodeSet = useMemo(() => {
    return new Set(pickedRows.map((x) => clean(x.swine_code)).filter(Boolean));
  }, [pickedRows]);

  const filteredAvailableSwines = useMemo(() => {
    if (!selectedHouse) return [];
    const q = clean(swineQ).toLowerCase();

    return (allAvailableSwines || [])
      .filter((x) => clean(x.house_no) === clean(selectedHouse))
      .filter((x) => !pickedCodeSet.has(clean(x.swine_code)))
      .filter((x) => {
        if (!q) return true;
        return clean(x.swine_code).toLowerCase().includes(q);
      })
      .slice(0, 100);
  }, [allAvailableSwines, selectedHouse, pickedCodeSet, swineQ]);

  useEffect(() => {
    if (!selectedHouse) {
      setSelectedCandidateSwineId("");
      return;
    }

    if (!filteredAvailableSwines.length) {
      setSelectedCandidateSwineId("");
      return;
    }

    const exists = filteredAvailableSwines.some(
      (x) => String(x.id) === String(selectedCandidateSwineId)
    );

    if (!exists) {
      setSelectedCandidateSwineId(String(filteredAvailableSwines[0].id));
    }
  }, [selectedHouse, filteredAvailableSwines, selectedCandidateSwineId]);

  const selectedCandidateSwine = useMemo(() => {
    return (
      filteredAvailableSwines.find(
        (x) => String(x.id) === String(selectedCandidateSwineId)
      ) || null
    );
  }, [filteredAvailableSwines, selectedCandidateSwineId]);

  const canAddToList = useMemo(() => {
    return (
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarmId) &&
      !!clean(selectedHouse) &&
      !!selectedCandidateSwine?.id &&
      !availableLoading &&
      !savingDraft &&
      !busyRelease
    );
  }, [
    fromFarm?.farm_code,
    toFarmId,
    selectedHouse,
    selectedCandidateSwine,
    availableLoading,
    savingDraft,
    busyRelease,
  ]);

  const canSaveDraft = useMemo(() => {
    return (
      !bootLoading &&
      !savingDraft &&
      !busyRelease &&
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarmId) &&
      !!clean(selectedHouse) &&
      pickedRows.length > 0
    );
  }, [
    bootLoading,
    savingDraft,
    busyRelease,
    fromFarm?.farm_code,
    toFarmId,
    selectedHouse,
    pickedRows.length,
  ]);

  const resetCandidateForm = useCallback(() => {
    setSwineQ("");
    setSelectedCandidateSwineId("");
    setTeatsLeft("");
    setTeatsRight("");
    setWeight("");
    setBackfat("");
  }, []);

  const releaseRows = useCallback(async (rows) => {
    const codes = Array.from(
      new Set((rows || []).map((x) => clean(x.swine_code)).filter(Boolean))
    );

    if (!codes.length) return;

    const chunks = chunkArray(codes, 500);

    for (const chunk of chunks) {
      const { error } = await supabase
        .from("swine_master")
        .update({
          delivery_state: "available",
        })
        .in("swine_code", chunk);

      if (error) throw error;
    }
  }, []);

  const clearPickedRowsAndRelease = useCallback(async () => {
    if (!pickedRows.length) {
      setPickedRows([]);
      resetCandidateForm();
      return;
    }

    setBusyRelease(true);
    try {
      await releaseRows(pickedRows);
      setPickedRows([]);
      resetCandidateForm();
    } finally {
      setBusyRelease(false);
    }
  }, [pickedRows, releaseRows, resetCandidateForm]);

  const loadAvailableSwinesOfFarm = useCallback(async (fromFarmCode) => {
    if (!fromFarmCode) {
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      return;
    }

    setAvailableLoading(true);
    setMsg("");

    try {
      const { data: farmSwines, error: e1 } = await supabase
        .from("swines")
        .select("id, swine_code, farm_code, farm_name, house_no, flock, birth_date")
        .eq("farm_code", fromFarmCode)
        .order("house_no", { ascending: true })
        .order("swine_code", { ascending: true })
        .limit(5000);

      if (e1) throw e1;

      const swines = (farmSwines || []).map((x) => ({
        ...x,
        swine_code: clean(x.swine_code),
        farm_code: clean(x.farm_code),
        farm_name: clean(x.farm_name),
        house_no: clean(x.house_no),
        flock: clean(x.flock),
      }));

      const codes = swines.map((x) => clean(x.swine_code)).filter(Boolean);

      if (!codes.length) {
        setAllAvailableSwines([]);
        setHouseOptions([]);
        setSelectedHouse("");
        return;
      }

      const codeChunks = chunkArray(codes, 500);
      const availableCodeSet = new Set();

      for (const chunk of codeChunks) {
        const { data: availableRows, error: e2 } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .in("swine_code", chunk);

        if (e2) throw e2;

        for (const row of availableRows || []) {
          const code = clean(row?.swine_code);
          if (code) availableCodeSet.add(code);
        }
      }

      const availableOnly = swines.filter((x) =>
        availableCodeSet.has(clean(x.swine_code))
      );

      const houseMap = new Map();
      for (const row of availableOnly) {
        const house = clean(row.house_no);
        if (!house) continue;
        if (!houseMap.has(house)) {
          houseMap.set(house, { value: house, label: house });
        }
      }

      const houses = Array.from(houseMap.values()).sort((a, b) =>
        String(a.value).localeCompare(String(b.value), "th", { numeric: true })
      );

      setAllAvailableSwines(availableOnly);
      setHouseOptions(houses);
      setSelectedHouse((prev) => {
        if (prev && houses.some((x) => x.value === prev)) return prev;
        return houses[0]?.value || "";
      });
    } catch (e) {
      console.error("loadAvailableSwinesOfFarm error:", e);
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      setMsg(e?.message || "โหลดรายการหมู available ไม่สำเร็จ");
    } finally {
      setAvailableLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fromFarm?.farm_code) {
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      return;
    }
    void loadAvailableSwinesOfFarm(fromFarm.farm_code);
  }, [fromFarm?.farm_code, loadAvailableSwinesOfFarm]);

  const handleSelectFromFarm = useCallback(
    async (farm) => {
      try {
        setMsg("");
        await clearPickedRowsAndRelease();
        setFromFarm(farm || null);
        setFromPickerOpen(!farm);
        setSelectedHouse("");
      } catch (e) {
        console.error("handleSelectFromFarm error:", e);
        setMsg(e?.message || "เปลี่ยนฟาร์มต้นทางไม่สำเร็จ");
      }
    },
    [clearPickedRowsAndRelease]
  );

  const clearFromFarm = useCallback(async () => {
    try {
      setMsg("");
      await clearPickedRowsAndRelease();
      setFromFarm(null);
      setFromQ("");
      setFromPickerOpen(true);
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
    } catch (e) {
      console.error("clearFromFarm error:", e);
      setMsg(e?.message || "ล้างฟาร์มต้นทางไม่สำเร็จ");
    }
  }, [clearPickedRowsAndRelease]);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || "");
    if (id) setToPickerOpen(false);
  }, []);

  const handleChangeHouse = useCallback(
    async (nextHouse) => {
      try {
        setMsg("");
        await clearPickedRowsAndRelease();
        setSelectedHouse(nextHouse || "");
      } catch (e) {
        console.error("handleChangeHouse error:", e);
        setMsg(e?.message || "เปลี่ยนเล้าไม่สำเร็จ");
      }
    },
    [clearPickedRowsAndRelease]
  );

  const addToPickedList = useCallback(async () => {
    if (!canAddToList) {
      setMsg("กรุณาเลือกฟาร์มต้นทาง ฟาร์มปลายทาง เล้า และเบอร์หมู");
      return;
    }

    try {
      setMsg("");

      const swineCode = clean(selectedCandidateSwine?.swine_code);
      const swineId = selectedCandidateSwine?.id || null;

      if (!swineCode || !swineId) {
        throw new Error("ไม่พบข้อมูลเบอร์หมู");
      }

      if (pickedCodeSet.has(swineCode)) {
        throw new Error("เบอร์หมูนี้อยู่ในรายการที่เลือกแล้ว");
      }

      const reserveRes = await supabase
        .from("swine_master")
        .update({
          delivery_state: "reserved",
        })
        .eq("swine_code", swineCode)
        .eq("delivery_state", "available")
        .select("swine_code");

      if (reserveRes.error) throw reserveRes.error;
      if (!Array.isArray(reserveRes.data) || reserveRes.data.length !== 1) {
        throw new Error(`เบอร์ ${swineCode} ไม่ available แล้ว`);
      }

      setPickedRows((prev) => [
        ...prev,
        {
          temp_id: `picked-${swineId}-${Date.now()}`,
          swine_id: swineId,
          swine_code: swineCode,
          house_no: clean(selectedCandidateSwine?.house_no),
          teats_left: clean(teatsLeft),
          teats_right: clean(teatsRight),
          weight: clean(weight),
          backfat: clean(backfat),
        },
      ]);

      resetCandidateForm();
    } catch (e) {
      console.error("addToPickedList error:", e);
      setMsg(e?.message || "บันทึกเข้า list ไม่สำเร็จ");
      void loadAvailableSwinesOfFarm(clean(fromFarm?.farm_code));
    }
  }, [
    canAddToList,
    selectedCandidateSwine,
    pickedCodeSet,
    teatsLeft,
    teatsRight,
    weight,
    backfat,
    resetCandidateForm,
    loadAvailableSwinesOfFarm,
    fromFarm?.farm_code,
  ]);

  const removePickedRow = useCallback(
    async (tempId) => {
      const row = pickedRows.find((x) => x.temp_id === tempId);
      if (!row) return;

      try {
        setMsg("");
        const swineCode = clean(row.swine_code);

        if (swineCode) {
          const { error } = await supabase
            .from("swine_master")
            .update({
              delivery_state: "available",
            })
            .eq("swine_code", swineCode);

          if (error) throw error;
        }

        setPickedRows((prev) => prev.filter((x) => x.temp_id !== tempId));
      } catch (e) {
        console.error("removePickedRow error:", e);
        setMsg(e?.message || "ลบรายการไม่สำเร็จ");
      }
    },
    [pickedRows]
  );

  const handleBackOrCancel = useCallback(async () => {
    try {
      setMsg("");
      isLeavingAfterSaveRef.current = false;
      await clearPickedRowsAndRelease();
      nav(-1);
    } catch (e) {
      console.error("handleBackOrCancel error:", e);
      setMsg(e?.message || "ยกเลิกไม่สำเร็จ");
    }
  }, [clearPickedRowsAndRelease, nav]);

  const handleSaveDraft = useCallback(async () => {
    if (!canSaveDraft) {
      setMsg("กรุณาเลือกข้อมูลให้ครบ และต้องมีเบอร์หมูอย่างน้อย 1 ตัว");
      return;
    }

    setSavingDraft(true);
    setMsg("");

    try {
      const uid = currentUserId || (await getCurrentUserId());
      if (!uid) throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");

      const headerPayload = {
        selected_date: selectedDate,
        from_farm_code: clean(fromFarm?.farm_code) || null,
        from_farm_name: clean(fromFarm?.farm_name) || null,
        from_flock: clean(fromFarm?.flock) || null,
        from_branch_id: fromFarm?.branch_id || null,
        to_farm_id: clean(toFarmId) || null,
        remark: clean(remark) || null,
        status: "draft",
        created_by: uid,
      };

      const headerRes = await supabase
        .from("swine_shipments")
        .insert([headerPayload])
        .select("id")
        .single();

      if (headerRes.error) throw headerRes.error;
      if (!headerRes.data?.id) throw new Error("สร้าง draft ไม่สำเร็จ");

      const shipmentId = headerRes.data.id;

      const itemPayload = pickedRows.map((row, idx) => ({
        shipment_id: shipmentId,
        swine_id: row.swine_id,
        swine_code: clean(row.swine_code),
        selection_no: idx + 1,
        teats_left: toIntOrNull(row.teats_left),
        teats_right: toIntOrNull(row.teats_right),
        weight: toNumOrNull(row.weight),
        backfat: toNumOrNull(row.backfat),
      }));

      const itemRes = await supabase
        .from("swine_shipment_items")
        .insert(itemPayload)
        .select("id, swine_code");

      if (itemRes.error) throw itemRes.error;
      if (!Array.isArray(itemRes.data) || itemRes.data.length !== itemPayload.length) {
        throw new Error(
          `INSERT_MISMATCH: swine_shipment_items inserted ${
            Array.isArray(itemRes.data) ? itemRes.data.length : 0
          }/${itemPayload.length}`
        );
      }

      const resequenceRes = await supabase.rpc("resequence_shipment_group_append_end", {
        p_selected_date: headerPayload.selected_date,
        p_from_farm_code: headerPayload.from_farm_code,
        p_to_farm_id: headerPayload.to_farm_id,
        p_priority_shipment_id: shipmentId,
      });

      if (resequenceRes.error) throw resequenceRes.error;

      isLeavingAfterSaveRef.current = true;
      nav(`/edit-shipment?id=${encodeURIComponent(shipmentId)}`);
    } catch (e) {
      console.error("handleSaveDraft error:", e);
      setMsg(e?.message || "บันทึก draft ไม่สำเร็จ");
    } finally {
      setSavingDraft(false);
    }
  }, [
    canSaveDraft,
    currentUserId,
    selectedDate,
    fromFarm,
    toFarmId,
    remark,
    pickedRows,
    nav,
  ]);

  if (bootLoading) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 720, margin: "40px auto" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ overflowX: "hidden" }}>
      <div
        className="topbar"
        style={{
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-start",
          position: "relative",
          zIndex: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Create Shipment</div>
          <div style={{ wordBreak: "break-word", color: "#6b7280", fontSize: 13 }}>
            mobile-first • เลือกเล้าก่อนค่อยเลือกเบอร์หมู • เข้า list แล้ว reserve ทันที
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void handleBackOrCancel()}>
            Back / Cancel
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 980,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px 24px",
          minWidth: 0,
        }}
      >
        {msg ? (
          <div style={{ ...cardStyle, padding: 12 }}>
            <div
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
                fontSize: 13,
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>ข้อมูลต้นทาง</div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={labelStyle}>วันคัด</div>
              <input
                type="date"
                value={selectedDate}
                max={todayYmdLocal()}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={inputStyle}
              />
              <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
                แสดงผล: {formatDateDisplay(selectedDate)}
              </div>
            </div>

            <div>
              {fromFarm && !fromPickerOpen ? (
                <FarmSelectedCard
                  title="ฟาร์มต้นทาง"
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
                <div style={{ ...cardStyle, padding: 12, display: "grid", gap: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>ฟาร์มต้นทาง</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" onClick={loadFromFarms} disabled={fromLoading}>
                        {fromLoading ? "กำลังโหลด..." : "รีเฟรช"}
                      </button>
                      <button type="button" onClick={() => void clearFromFarm()} disabled={fromLoading}>
                        ล้างค่า
                      </button>
                    </div>
                  </div>

                  <input
                    value={fromQ}
                    onChange={(e) => setFromQ(e.target.value)}
                    placeholder="พิมพ์ค้นหา farm code / farm name / flock…"
                    style={inputStyle}
                  />

                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      overflow: "hidden",
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {fromLoading ? (
                      <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>
                    ) : filteredFromOptions.length > 0 ? (
                      filteredFromOptions.map((f) => (
                        <button
                          key={`${f.farm_code}__${f.flock || "-"}__${f.farm_name}`}
                          type="button"
                          onClick={() => void handleSelectFromFarm(f)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: 0,
                            borderBottom: "1px solid #eee",
                            background: "white",
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
                      ))
                    ) : (
                      <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มต้นทาง</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              {toFarmId && !toPickerOpen ? (
                <FarmSelectedCard
                  title="ฟาร์มปลายทาง"
                  farm={toFarm}
                  onChange={() => setToPickerOpen(true)}
                />
              ) : (
                <FarmPickerInlineAdd
                  label="ฟาร์มปลายทาง"
                  value={toFarmId}
                  excludeId={null}
                  onChange={onChangeToFarm}
                  requireBranch={false}
                />
              )}
            </div>

            <div>
              <div style={labelStyle}>เล้าต้นทาง</div>
              <select
                value={selectedHouse}
                onChange={(e) => void handleChangeHouse(e.target.value)}
                disabled={!fromFarm?.farm_code || availableLoading || houseOptions.length === 0}
                style={inputStyle}
              >
                <option value="">
                  {!fromFarm?.farm_code
                    ? "เลือกฟาร์มต้นทางก่อน"
                    : availableLoading
                    ? "กำลังโหลด..."
                    : "เลือกเล้า"}
                </option>
                {houseOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
                ระบบจะเลือกเล้าแรกให้อัตโนมัติถ้ามีข้อมูล
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>เลือกเบอร์หมู</div>

          {!selectedHouse ? (
            <div
              style={{
                border: "1px dashed #d1d5db",
                borderRadius: 12,
                padding: 12,
                color: "#6b7280",
                fontSize: 13,
              }}
            >
              กรุณาเลือกเล้าก่อน แล้วค่อยเลือกเบอร์หมู
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: selectedCandidateSwine
                ? "minmax(0, 1fr) clamp(140px, 28vw, 320px)"
                : "minmax(0, 1fr)",
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 12,
                minWidth: 0,
              }}
            >
              <div>
                <div style={labelStyle}>ค้นหาเบอร์หมู</div>
                <input
                  value={swineQ}
                  onChange={(e) => {
                    setSwineQ(e.target.value);
                  }}
                  placeholder={!selectedHouse ? "เลือกเล้าก่อน" : "พิมพ์ swine code..."}
                  disabled={!selectedHouse || availableLoading}
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={labelStyle}>เลือกเบอร์หมู</div>

                {!selectedHouse ? (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>เลือกเล้าก่อน</div>
                ) : availableLoading ? (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>กำลังโหลด...</div>
                ) : filteredAvailableSwines.length === 0 ? (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>ไม่พบเบอร์หมู</div>
                ) : (
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      overflow: "hidden",
                      maxHeight: 220,
                      overflowY: "auto",
                      background: "#fff",
                    }}
                  >
                    {filteredAvailableSwines.map((swine) => {
                      const active = String(selectedCandidateSwineId) === String(swine.id);

                      return (
                        <button
                          key={swine.id}
                          type="button"
                          onClick={() => setSelectedCandidateSwineId(String(swine.id))}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: 0,
                            borderBottom: "1px solid #f3f4f6",
                            background: active ? "#eff6ff" : "#fff",
                            cursor: "pointer",
                            fontWeight: active ? 800 : 500,
                          }}
                        >
                          {swine.swine_code}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedCandidateSwine ? (
                <div
                  style={{
                    border: "1px solid #dbeafe",
                    borderRadius: 12,
                    padding: 10,
                    background: "#f8fbff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{selectedCandidateSwine.swine_code}</div>
                  <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12, lineHeight: 1.6 }}>
                    Flock: {clean(selectedCandidateSwine.flock) || "-"} | วันเกิด:{" "}
                    {formatDateDisplay(selectedCandidateSwine.birth_date)}
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 1fr)",
                }}
              >
                <div>
                  <div style={labelStyle}>เต้านมซ้าย</div>
                  <input
                    value={teatsLeft}
                    onChange={(e) => setTeatsLeft(e.target.value)}
                    placeholder="เต้านมซ้าย"
                    inputMode="numeric"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>เต้านมขวา</div>
                  <input
                    value={teatsRight}
                    onChange={(e) => setTeatsRight(e.target.value)}
                    placeholder="เต้านมขวา"
                    inputMode="numeric"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>น้ำหนัก</div>
                  <input
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="น้ำหนัก"
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Backfat</div>
                  <input
                    value={backfat}
                    onChange={(e) => setBackfat(e.target.value)}
                    placeholder="Backfat"
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            {selectedCandidateSwine ? (
              <div
                style={{
                  minWidth: 0,
                  width: "100%",
                  alignSelf: "stretch",
                  display: "flex",
                }}
              >
                <QrPreviewBox value={selectedCandidateSwine.swine_code} />
              </div>
            ) : null}
          </div>

          <div>
            <button
              type="button"
              onClick={() => void addToPickedList()}
              disabled={!canAddToList}
              style={{ width: "100%" }}
            >
              บันทึกเข้า list
            </button>
          </div>
        </div>

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>เบอร์ที่เลือกแล้ว ({pickedRows.length})</div>

          {pickedRows.length === 0 ? (
            <div style={{ color: "#6b7280", fontSize: 13 }}>ยังไม่มีรายการ</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {pickedRows.map((row, idx) => (
                <div
                  key={row.temp_id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    background: "#fafafa",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>
                    #{idx + 1} — {row.swine_code}
                  </div>

                  <button
                    type="button"
                    onClick={() => void removePickedRow(row.temp_id)}
                    disabled={savingDraft || busyRelease}
                  >
                    ลบออก
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>หมายเหตุ</div>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="ใส่หมายเหตุ (ถ้ามี)"
          />
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "1fr",
          }}
        >
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={!canSaveDraft}
            style={{ width: "100%" }}
          >
            {savingDraft ? "Saving..." : "Save Draft"}
          </button>

          <button
            type="button"
            onClick={() => void handleBackOrCancel()}
            disabled={savingDraft || busyRelease}
            style={{ width: "100%" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}