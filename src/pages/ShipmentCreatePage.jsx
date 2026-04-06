import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateDisplay } from "../lib/dateFormat";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

const ACTIVE_STATUSES = ["draft", "submitted", "issued"];
const PAGE_SIZE = 1000;
const CODE_CHUNK_SIZE = 500;
const ID_CHUNK_SIZE = 500;

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

function extractErrorMessage(error, fallback = "เกิดข้อผิดพลาด") {
  return (
    error?.message ||
    error?.details ||
    error?.hint ||
    error?.error_description ||
    error?.error ||
    fallback
  );
}

function qrImageUrl(text) {
  const s = clean(text);
  if (!s) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(s)}`;
}

function chunkArray(arr, size = 1000) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function fetchAllPages(fetcher, pageSize = PAGE_SIZE) {
  let from = 0;
  const rows = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetcher(from, to);
    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
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

function FarmSelectedCard({ title, farm, subtitle, onChange, changeLabel = "เปลี่ยนฟาร์ม" }) {
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
          {changeLabel}
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

  const [bootLoading, setBootLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingBlocking, setLoadingBlocking] = useState(false);
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
    const sourceFlock = clean(fromFarm?.flock);

    return (allAvailableSwines || [])
      .filter((x) => clean(x.house_no) === clean(selectedHouse))
      .filter((x) => !sourceFlock || clean(x.flock) === sourceFlock)
      .filter((x) => !pickedCodeSet.has(clean(x.swine_code)))
      .filter((x) => {
        if (!q) return true;
        return clean(x.swine_code).toLowerCase().includes(q);
      })
      .slice(0, 100);
  }, [allAvailableSwines, selectedHouse, fromFarm?.flock, pickedCodeSet, swineQ]);

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
      !!clean(fromFarm?.flock) &&
      !!clean(toFarmId) &&
      !!clean(selectedHouse) &&
      !!selectedCandidateSwine?.id &&
      !availableLoading &&
      !savingDraft &&
      !loadingBlocking
    );
  }, [
    fromFarm?.farm_code,
    fromFarm?.flock,
    toFarmId,
    selectedHouse,
    selectedCandidateSwine,
    availableLoading,
    savingDraft,
    loadingBlocking,
  ]);

  const canSaveDraft = useMemo(() => {
    return (
      !bootLoading &&
      !savingDraft &&
      !!clean(fromFarm?.farm_code) &&
      !!clean(fromFarm?.flock) &&
      !!clean(toFarmId) &&
      !!clean(selectedHouse) &&
      pickedRows.length > 0
    );
  }, [
    bootLoading,
    savingDraft,
    fromFarm?.farm_code,
    fromFarm?.flock,
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

  const findReusableDraftHeader = useCallback(async () => {
    if (!clean(currentUserId)) return null;
    if (!clean(fromFarm?.farm_code)) return null;
    if (!clean(fromFarm?.flock)) return null;
    if (!clean(toFarmId)) return null;
    if (!clean(selectedHouse)) return null;

    const { data, error } = await supabase
      .from("swine_shipments")
      .select("id")
      .eq("created_by", currentUserId)
      .eq("status", "draft")
      .eq("selected_date", selectedDate)
      .eq("from_farm_code", clean(fromFarm?.farm_code))
      .eq("from_flock", clean(fromFarm?.flock))
      .eq("to_farm_id", clean(toFarmId))
      .eq("source_house_no", clean(selectedHouse))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id || null;
  }, [currentUserId, selectedDate, fromFarm?.farm_code, fromFarm?.flock, toFarmId, selectedHouse]);

  const deleteEmptyDraftHeader = useCallback(async (shipmentId) => {
    const id = clean(shipmentId);
    if (!id) return;

    try {
      const { count, error: countError } = await supabase
        .from("swine_shipment_items")
        .select("id", { count: "exact", head: true })
        .eq("shipment_id", id);

      if (countError) throw countError;
      if ((count || 0) > 0) return;

      const { error } = await supabase
        .from("swine_shipments")
        .delete()
        .eq("id", id)
        .eq("status", "draft");

      if (error) throw error;
    } catch (cleanupError) {
      console.warn("deleteEmptyDraftHeader warning:", cleanupError);
    }
  }, []);

  const ensureDraftHeader = useCallback(async () => {
    if (!clean(fromFarm?.farm_code)) throw new Error("กรุณาเลือกฟาร์มต้นทาง");
    if (!clean(fromFarm?.flock)) throw new Error("กรุณาเลือก flock ต้นทาง");
    if (!clean(toFarmId)) throw new Error("กรุณาเลือกฟาร์มปลายทาง");
    if (!clean(selectedHouse)) throw new Error("กรุณาเลือกเล้า");
    if (!clean(currentUserId)) throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");

    const reusableId = await findReusableDraftHeader();
    if (clean(reusableId)) {
      return { shipmentId: reusableId, createdNewHeader: false };
    }

    const payload = {
      selected_date: selectedDate,
      from_farm_code: clean(fromFarm?.farm_code) || null,
      from_farm_name: clean(fromFarm?.farm_name) || null,
      from_flock: clean(fromFarm?.flock) || null,
      from_branch_id: fromFarm?.branch_id || null,
      to_farm_id: clean(toFarmId) || null,
      source_house_no: clean(selectedHouse) || null,
      remark: clean(remark) || null,
      status: "draft",
      reservation_status: "consumed",
      created_by: currentUserId,
    };

    const { data, error } = await supabase
      .from("swine_shipments")
      .insert([payload])
      .select("id")
      .single();

    if (error) throw error;
    if (!data?.id) throw new Error("สร้าง draft header ไม่สำเร็จ");

    return { shipmentId: data.id, createdNewHeader: true };
  }, [
    currentUserId,
    selectedDate,
    fromFarm,
    toFarmId,
    selectedHouse,
    remark,
    findReusableDraftHeader,
  ]);

  const findBlockingShipmentsBySwineCodes = useCallback(async (swineCodes, excludeShipmentId = "") => {
    const cleanCodes = Array.from(new Set((swineCodes || []).map(clean).filter(Boolean)));
    const blockingMap = new Map();

    for (const codeChunk of chunkArray(cleanCodes, CODE_CHUNK_SIZE)) {
      const itemRows = await fetchAllPages((from, to) =>
        supabase
          .from("swine_shipment_items")
          .select("shipment_id, swine_code")
          .in("swine_code", codeChunk)
          .order("shipment_id", { ascending: true })
          .range(from, to)
      );

      const shipmentIds = Array.from(
        new Set(
          (itemRows || [])
            .map((x) => clean(x?.shipment_id))
            .filter((id) => id && id !== clean(excludeShipmentId))
        )
      );

      const shipmentMap = new Map();

      for (const idChunk of chunkArray(shipmentIds, ID_CHUNK_SIZE)) {
        if (!idChunk.length) continue;

        const { data: shipmentRows, error: shipmentError } = await supabase
          .from("swine_shipments")
          .select("id, status, selected_date, created_by, from_farm_code, from_flock, source_house_no")
          .in("id", idChunk)
          .in("status", ACTIVE_STATUSES);

        if (shipmentError) throw shipmentError;

        for (const sh of shipmentRows || []) {
          shipmentMap.set(clean(sh?.id), sh);
        }
      }

      for (const item of itemRows || []) {
        const code = clean(item?.swine_code);
        const shipmentId = clean(item?.shipment_id);
        if (!code || !shipmentId || shipmentId === clean(excludeShipmentId)) continue;
        if (!shipmentMap.has(shipmentId)) continue;
        if (!blockingMap.has(code)) {
          blockingMap.set(code, shipmentMap.get(shipmentId));
        }
      }
    }

    return blockingMap;
  }, []);

  const loadSelectableSwinesOfFarm = useCallback(async (fromFarmCode, flock) => {
    const farmCode = clean(fromFarmCode);
    const sourceFlock = clean(flock);

    if (!farmCode) {
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      return;
    }

    setAvailableLoading(true);
    setMsg("");

    try {
      let swineRows = await fetchAllPages((from, to) => {
        let q = supabase
          .from("swines")
          .select("id, swine_code, farm_code, farm_name, house_no, flock, birth_date")
          .eq("farm_code", farmCode)
          .order("house_no", { ascending: true })
          .order("swine_code", { ascending: true })
          .range(from, to);

        if (sourceFlock) {
          q = q.eq("flock", sourceFlock);
        }

        return q;
      });

      swineRows = (swineRows || []).map((x) => ({
        ...x,
        swine_code: clean(x?.swine_code),
        farm_code: clean(x?.farm_code),
        farm_name: clean(x?.farm_name),
        house_no: clean(x?.house_no),
        flock: clean(x?.flock),
      })).filter((x) => clean(x?.swine_code));

      const blockingMap = await findBlockingShipmentsBySwineCodes(
        swineRows.map((x) => x.swine_code)
      );

      const selectableRows = swineRows.filter(
        (x) => !blockingMap.has(clean(x?.swine_code))
      );

      const houseMap = new Map();
      for (const row of selectableRows) {
        const house = clean(row.house_no);
        if (!house) continue;
        if (!houseMap.has(house)) {
          houseMap.set(house, { value: house, label: house });
        }
      }

      const houses = Array.from(houseMap.values()).sort((a, b) =>
        String(a.value).localeCompare(String(b.value), "th", { numeric: true })
      );

      setAllAvailableSwines(selectableRows);
      setHouseOptions(houses);
      setSelectedHouse((prev) => {
        if (prev && houses.some((x) => x.value === prev)) return prev;
        return houses[0]?.value || "";
      });
    } catch (e) {
      console.error("loadSelectableSwinesOfFarm error:", e);
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      setMsg(e?.message || "โหลดรายการหมูที่คัดได้ไม่สำเร็จ");
    } finally {
      setAvailableLoading(false);
    }
  }, [findBlockingShipmentsBySwineCodes]);

  useEffect(() => {
    if (!fromFarm?.farm_code) {
      setAllAvailableSwines([]);
      setHouseOptions([]);
      setSelectedHouse("");
      return;
    }
    void loadSelectableSwinesOfFarm(fromFarm.farm_code, fromFarm.flock);
  }, [fromFarm?.farm_code, fromFarm?.flock, loadSelectableSwinesOfFarm]);

  const handleSelectFromFarm = useCallback((farm) => {
    setMsg("");
    setPickedRows([]);
    resetCandidateForm();
    setFromFarm(farm || null);
    setFromPickerOpen(!farm);
    setSelectedHouse("");
  }, [resetCandidateForm]);

  const clearFromFarm = useCallback(() => {
    setMsg("");
    setPickedRows([]);
    resetCandidateForm();
    setFromFarm(null);
    setFromQ("");
    setFromPickerOpen(true);
    setAllAvailableSwines([]);
    setHouseOptions([]);
    setSelectedHouse("");
  }, [resetCandidateForm]);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || "");
    if (id) {
      setToPickerOpen(false);
    }
  }, []);

  const handleChangeHouse = useCallback((nextHouse) => {
    setMsg("");
    setPickedRows([]);
    resetCandidateForm();
    setSelectedHouse(nextHouse || "");
  }, [resetCandidateForm]);

  const addToPickedList = useCallback(async () => {
    if (!canAddToList) {
      setMsg("กรุณาเลือกฟาร์มต้นทาง ฟาร์มปลายทาง เล้า และเบอร์หมู");
      return;
    }

    try {
      setMsg("");
      setLoadingBlocking(true);

      const swineCode = clean(selectedCandidateSwine?.swine_code);
      const swineId = selectedCandidateSwine?.id || null;

      if (!swineCode || !swineId) {
        throw new Error("ไม่พบข้อมูลเบอร์หมู");
      }

      if (pickedCodeSet.has(swineCode)) {
        throw new Error("เบอร์หมูนี้อยู่ในรายการที่เลือกแล้ว");
      }

      const blockingMap = await findBlockingShipmentsBySwineCodes([swineCode]);
      const blocking = blockingMap.get(swineCode);

      if (blocking) {
        throw new Error(
          `เบอร์ ${swineCode} อยู่ใน shipment สถานะ ${clean(blocking.status) || "-"} แล้ว`
        );
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
      setMsg(extractErrorMessage(e, "บันทึกเข้า list ไม่สำเร็จ"));
      void loadSelectableSwinesOfFarm(clean(fromFarm?.farm_code), clean(fromFarm?.flock));
    } finally {
      setLoadingBlocking(false);
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
    findBlockingShipmentsBySwineCodes,
    loadSelectableSwinesOfFarm,
    fromFarm?.farm_code,
    fromFarm?.flock,
  ]);

  const removePickedRow = useCallback((tempId) => {
    setMsg("");
    setPickedRows((prev) => prev.filter((x) => x.temp_id !== tempId));
  }, []);

  const handleBackOrCancel = useCallback(() => {
    setMsg("");
    nav("/user-home", { replace: true });
  }, [nav]);

  const handleSaveDraft = useCallback(async () => {
    if (!canSaveDraft) {
      setMsg("กรุณาเลือกข้อมูลให้ครบ และต้องมีเบอร์หมูอย่างน้อย 1 ตัว");
      return;
    }

    setSavingDraft(true);
    setMsg("");

    let createdHeaderId = "";
    let createdNewHeader = false;

    try {
      const pickedCodes = pickedRows.map((row) => clean(row.swine_code)).filter(Boolean);

      const headerResult = await ensureDraftHeader();
      const shipmentId = clean(headerResult?.shipmentId);
      createdHeaderId = shipmentId;
      createdNewHeader = !!headerResult?.createdNewHeader;

      if (!shipmentId) throw new Error("ไม่พบ draft shipment");

      const blockingMap = await findBlockingShipmentsBySwineCodes(pickedCodes, shipmentId);
      if (blockingMap.size > 0) {
        const [firstCode, firstShipment] = blockingMap.entries().next().value;
        throw new Error(
          `เบอร์ ${firstCode} อยู่ใน shipment สถานะ ${clean(firstShipment?.status) || "-"} แล้ว`
        );
      }

      const { error: headerError } = await supabase
        .from("swine_shipments")
        .update({
          selected_date: selectedDate,
          from_farm_code: clean(fromFarm?.farm_code) || null,
          from_farm_name: clean(fromFarm?.farm_name) || null,
          from_flock: clean(fromFarm?.flock) || null,
          from_branch_id: fromFarm?.branch_id || null,
          to_farm_id: clean(toFarmId) || null,
          source_house_no: clean(selectedHouse) || null,
          remark: clean(remark) || null,
          status: "draft",
          reservation_status: "consumed",
        })
        .eq("id", shipmentId);

      if (headerError) throw headerError;

      const { error: deleteOldItemsError } = await supabase
        .from("swine_shipment_items")
        .delete()
        .eq("shipment_id", shipmentId);

      if (deleteOldItemsError) throw deleteOldItemsError;

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
        p_selected_date: selectedDate,
        p_from_farm_code: clean(fromFarm?.farm_code) || null,
        p_to_farm_id: clean(toFarmId) || null,
        p_priority_shipment_id: shipmentId,
      });

      if (resequenceRes.error) throw resequenceRes.error;

      nav("/user-home", {
        replace: true,
        state: {
          msg: `บันทึก Draft สำเร็จ ✅ (${shipmentId})`,
        },
      });
    } catch (e) {
      console.error("handleSaveDraft error:", {
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        raw: e,
      });

      if (createdNewHeader && clean(createdHeaderId)) {
        await deleteEmptyDraftHeader(createdHeaderId);
      }

      setMsg(e?.message || e?.details || e?.hint || "บันทึก draft ไม่สำเร็จ");
      void loadSelectableSwinesOfFarm(clean(fromFarm?.farm_code), clean(fromFarm?.flock));
    } finally {
      setSavingDraft(false);
    }
  }, [
    canSaveDraft,
    pickedRows,
    ensureDraftHeader,
    findBlockingShipmentsBySwineCodes,
    selectedDate,
    fromFarm,
    toFarmId,
    selectedHouse,
    remark,
    nav,
    deleteEmptyDraftHeader,
    loadSelectableSwinesOfFarm,
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
            mobile-first • status-based • เลือกเล้าก่อนค่อยเลือกเบอร์หมู
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
                  subtitle={fromFarm?.flock ? `Flock: ${fromFarm.flock}` : ""}
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

            <div style={{ display: "grid", gap: 10 }}>
              {toFarmId ? (
                <FarmSelectedCard
                  title="ฟาร์มปลายทางที่เลือกอยู่"
                  farm={toFarm}
                  subtitle="ตรวจสอบฟาร์มนี้ก่อน ถ้าถูกต้องค่อยไปขั้นต่อไป ถ้าไม่ถูกต้องค่อยเลือกฟาร์มปลายทางใหม่"
                  onChange={() => setToPickerOpen((prev) => !prev)}
                  changeLabel={toPickerOpen ? "ซ่อนรายการฟาร์ม" : "เลือกฟาร์มปลายทางใหม่"}
                />
              ) : null}

              {!toFarmId || toPickerOpen ? (
                <div style={{ ...cardStyle, padding: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>
                    {toFarmId ? "เลือกฟาร์มปลายทางใหม่" : "ฟาร์มปลายทาง"}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>
                    ฟาร์มที่เลือกอยู่จะแสดงด้านบนเสมอ เพื่อให้ตรวจสอบก่อนเปลี่ยน
                  </div>

                  <FarmPickerInlineAdd
                    label="ฟาร์มปลายทาง"
                    value={toFarmId}
                    excludeId={null}
                    onChange={onChangeToFarm}
                    requireBranch={false}
                  />
                </div>
              ) : (
                <div>
                  <button type="button" onClick={() => setToPickerOpen(true)}>
                    เลือกฟาร์มปลายทางใหม่
                  </button>
                </div>
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
                ระบบจะแสดงเฉพาะหมูที่ยังไม่อยู่ใน draft / submitted / issued
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
                  onChange={(e) => setSwineQ(e.target.value)}
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
                  <div style={{ color: "#6b7280", fontSize: 13 }}>ไม่พบเบอร์หมูที่คัดได้</div>
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
              {loadingBlocking ? "กำลังตรวจสอบ..." : "บันทึกเข้า list"}
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
                    disabled={savingDraft}
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
            disabled={savingDraft}
            style={{ width: "100%" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}