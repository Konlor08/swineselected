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

function isConflictError(error) {
  return (
    error?.status === 409 ||
    error?.code === "409" ||
    error?.code === 409 ||
    /409|conflict/i.test(String(error?.message || ""))
  );
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
  const leavingRef = useRef(false);

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

  const [draftShipmentId, setDraftShipmentId] = useState("");
  const [draftCreating, setDraftCreating] = useState(false);

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
      !busyRelease &&
      !draftCreating
    );
  }, [
    fromFarm?.farm_code,
    toFarmId,
    selectedHouse,
    selectedCandidateSwine,
    availableLoading,
    savingDraft,
    busyRelease,
    draftCreating,
  ]);

  const canSaveDraft = useMemo(() => {
    return (
      !bootLoading &&
      !savingDraft &&
      !busyRelease &&
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarmId) &&
      !!clean(selectedHouse) &&
      pickedRows.length > 0 &&
      !!clean(draftShipmentId)
    );
  }, [
    bootLoading,
    savingDraft,
    busyRelease,
    fromFarm?.farm_code,
    toFarmId,
    selectedHouse,
    pickedRows.length,
    draftShipmentId,
  ]);

  const resetCandidateForm = useCallback(() => {
    setSwineQ("");
    setSelectedCandidateSwineId("");
    setTeatsLeft("");
    setTeatsRight("");
    setWeight("");
    setBackfat("");
  }, []);

  const updateDraftReservationStatus = useCallback(async (shipmentId, reservationStatus) => {
    if (!clean(shipmentId)) return;

    const { error } = await supabase
      .from("swine_shipments")
      .update({ reservation_status: reservationStatus })
      .eq("id", shipmentId);

    if (error) throw error;
  }, []);

  const releaseCurrentDraftReservations = useCallback(
    async (reason = "release_current_draft") => {
      if (!clean(draftShipmentId) || !clean(currentUserId)) {
        setPickedRows([]);
        resetCandidateForm();
        setDraftShipmentId("");
        return;
      }

      setBusyRelease(true);
      try {
        const { data, error } = await supabase.rpc("release_shipment_reservations", {
          p_shipment_id: draftShipmentId,
          p_reserved_by: currentUserId,
          p_reason: reason,
        });

        if (error) throw error;
        await updateDraftReservationStatus(draftShipmentId, "released");

        setPickedRows([]);
        resetCandidateForm();
        setDraftShipmentId("");

        return data ?? 0;
      } finally {
        setBusyRelease(false);
      }
    },
    [draftShipmentId, currentUserId, resetCandidateForm, updateDraftReservationStatus]
  );

  const findReusableDraftHeader = useCallback(async () => {
    if (!clean(currentUserId)) return null;
    if (!clean(fromFarm?.farm_code)) return null;
    if (!clean(toFarmId)) return null;
    if (!clean(selectedHouse)) return null;

    const query = supabase
      .from("swine_shipments")
      .select("id")
      .eq("created_by", currentUserId)
      .eq("status", "draft")
      .eq("selected_date", selectedDate)
      .eq("from_farm_code", clean(fromFarm?.farm_code))
      .eq("to_farm_id", clean(toFarmId))
      .eq("source_house_no", clean(selectedHouse))
      .order("created_at", { ascending: false })
      .limit(1);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data?.id || null;
  }, [currentUserId, selectedDate, fromFarm?.farm_code, toFarmId, selectedHouse]);

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

  const findMyActiveReservation = useCallback(async (swineId, swineCode) => {
    if (!clean(currentUserId)) return null;

    const q = supabase
      .from("swine_reservations")
      .select("id, shipment_id, swine_id, swine_code, status, created_at")
      .eq("reserved_by", currentUserId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    const { data, error } = await q.or(
      `swine_id.eq.${swineId},swine_code.eq.${clean(swineCode)}`
    );

    if (error) throw error;
    return data?.[0] || null;
  }, [currentUserId]);

  const ensureDraftHeader = useCallback(async () => {
    if (clean(draftShipmentId)) return draftShipmentId;
    if (draftCreating) throw new Error("กำลังสร้าง draft header");
    if (!clean(fromFarm?.farm_code)) throw new Error("กรุณาเลือกฟาร์มต้นทาง");
    if (!clean(toFarmId)) throw new Error("กรุณาเลือกฟาร์มปลายทาง");
    if (!clean(selectedHouse)) throw new Error("กรุณาเลือกเล้า");
    if (!clean(currentUserId)) throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");

    setDraftCreating(true);
    try {
      const reusableId = await findReusableDraftHeader();
      if (clean(reusableId)) {
        setDraftShipmentId(reusableId);
        return reusableId;
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
        reservation_status: "open",
        created_by: currentUserId,
      };

      const { data, error } = await supabase
        .from("swine_shipments")
        .insert([payload])
        .select("id")
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error("สร้าง draft header ไม่สำเร็จ");

      setDraftShipmentId(data.id);
      return data.id;
    } finally {
      setDraftCreating(false);
    }
  }, [
    draftShipmentId,
    draftCreating,
    fromFarm,
    toFarmId,
    selectedHouse,
    currentUserId,
    selectedDate,
    remark,
    findReusableDraftHeader,
  ]);

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
      const { data, error } = await supabase
        .from("v_swines_available_for_selection")
        .select("id, swine_code, farm_code, farm_name, house_no, flock, birth_date")
        .eq("farm_code", fromFarmCode)
        .order("house_no", { ascending: true })
        .order("swine_code", { ascending: true })
        .limit(5000);

      if (error) throw error;

      const availableOnly = (data || []).map((x) => ({
        ...x,
        swine_code: clean(x.swine_code),
        farm_code: clean(x.farm_code),
        farm_name: clean(x.farm_name),
        house_no: clean(x.house_no),
        flock: clean(x.flock),
      }));

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
        if (clean(draftShipmentId)) {
          await releaseCurrentDraftReservations("change_from_farm");
          try {
            await updateDraftReservationStatus(draftShipmentId, "cancelled");
          } catch {}
        } else {
          setPickedRows([]);
          resetCandidateForm();
        }

        setFromFarm(farm || null);
        setFromPickerOpen(!farm);
        setSelectedHouse("");
      } catch (e) {
        console.error("handleSelectFromFarm error:", e);
        setMsg(e?.message || "เปลี่ยนฟาร์มต้นทางไม่สำเร็จ");
      }
    },
    [draftShipmentId, releaseCurrentDraftReservations, resetCandidateForm, updateDraftReservationStatus]
  );

  const clearFromFarm = useCallback(async () => {
    try {
      setMsg("");
      if (clean(draftShipmentId)) {
        await releaseCurrentDraftReservations("clear_from_farm");
        try {
          await updateDraftReservationStatus(draftShipmentId, "cancelled");
        } catch {}
      } else {
        setPickedRows([]);
        resetCandidateForm();
      }

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
  }, [draftShipmentId, releaseCurrentDraftReservations, resetCandidateForm, updateDraftReservationStatus]);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || "");
    if (id) setToPickerOpen(false);
  }, []);

  const handleChangeHouse = useCallback(
    async (nextHouse) => {
      try {
        setMsg("");
        if (clean(draftShipmentId)) {
          await releaseCurrentDraftReservations("change_house");
          try {
            await updateDraftReservationStatus(draftShipmentId, "released");
          } catch {}
        } else {
          setPickedRows([]);
          resetCandidateForm();
        }

        setSelectedHouse(nextHouse || "");
      } catch (e) {
        console.error("handleChangeHouse error:", e);
        setMsg(e?.message || "เปลี่ยนเล้าไม่สำเร็จ");
      }
    },
    [draftShipmentId, releaseCurrentDraftReservations, resetCandidateForm, updateDraftReservationStatus]
  );

  const addToPickedList = useCallback(async () => {
    if (!canAddToList) {
      setMsg("กรุณาเลือกฟาร์มต้นทาง ฟาร์มปลายทาง เล้า และเบอร์หมู");
      return;
    }

    let shipmentId = "";
    let createdNewHeader = false;

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

      createdNewHeader = !clean(draftShipmentId);
      shipmentId = await ensureDraftHeader();

      const { error } = await supabase.rpc("reserve_swine_for_shipment", {
        p_swine_code: swineCode,
        p_swine_id: swineId,
        p_shipment_id: shipmentId,
        p_reserved_by: currentUserId,
        p_source_page: "create",
        p_minutes: 30,
      });

      if (error) {
        if (isConflictError(error)) {
          const myActiveReservation = await findMyActiveReservation(swineId, swineCode);

          if (
            myActiveReservation?.shipment_id &&
            clean(myActiveReservation.shipment_id) === clean(shipmentId)
          ) {
            setPickedRows((prev) => {
              if (prev.some((x) => clean(x.swine_code) === swineCode)) return prev;
              return [
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
              ];
            });

            setDraftShipmentId(shipmentId);
            resetCandidateForm();
            await loadAvailableSwinesOfFarm(clean(fromFarm?.farm_code));
            setMsg(`เบอร์ ${swineCode} ถูกจองอยู่แล้วใน draft นี้ จึงดึงกลับเข้า list ให้แล้ว`);
            return;
          }

          if (myActiveReservation?.shipment_id) {
            if (createdNewHeader && clean(shipmentId)) {
              await deleteEmptyDraftHeader(shipmentId);
            }
            setDraftShipmentId(clean(myActiveReservation.shipment_id));
            throw new Error(
              `เบอร์ ${swineCode} ถูกจองอยู่ใน draft เดิมของคุณแล้ว กรุณากลับไปเปิด draft เดิม`
            );
          }

          if (createdNewHeader && clean(shipmentId)) {
            await deleteEmptyDraftHeader(shipmentId);
          }
          throw new Error(`เบอร์ ${swineCode} ถูกจองโดยรายการอื่นแล้ว กรุณาเลือกตัวอื่น`);
        }

        throw error;
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
      await loadAvailableSwinesOfFarm(clean(fromFarm?.farm_code));
    } catch (e) {
      console.error("addToPickedList error:", {
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        status: e?.status,
        raw: e,
      });
      setMsg(extractErrorMessage(e, "บันทึกเข้า list ไม่สำเร็จ"));
      void loadAvailableSwinesOfFarm(clean(fromFarm?.farm_code));
    }
  }, [
    canAddToList,
    selectedCandidateSwine,
    pickedCodeSet,
    draftShipmentId,
    ensureDraftHeader,
    currentUserId,
    teatsLeft,
    teatsRight,
    weight,
    backfat,
    resetCandidateForm,
    loadAvailableSwinesOfFarm,
    fromFarm?.farm_code,
    findMyActiveReservation,
    deleteEmptyDraftHeader,
  ]);

  const removePickedRow = useCallback(
    async (tempId) => {
      const row = pickedRows.find((x) => x.temp_id === tempId);
      if (!row) return;

      try {
        setMsg("");

        const { error } = await supabase.rpc("release_swine_reservation", {
          p_swine_code: clean(row.swine_code),
          p_reserved_by: currentUserId,
          p_reason: "remove_from_create_list",
        });

        if (error) throw error;

        setPickedRows((prev) => prev.filter((x) => x.temp_id !== tempId));
        await loadAvailableSwinesOfFarm(clean(fromFarm?.farm_code));
      } catch (e) {
        console.error("removePickedRow error:", e);
        setMsg(e?.message || "ลบรายการไม่สำเร็จ");
      }
    },
    [pickedRows, currentUserId, loadAvailableSwinesOfFarm, fromFarm?.farm_code]
  );

  const handleBackOrCancel = useCallback(async () => {
    try {
      setMsg("");
      leavingRef.current = true;

      if (clean(draftShipmentId)) {
        await releaseCurrentDraftReservations("cancel_create_page");
        try {
          await updateDraftReservationStatus(draftShipmentId, "cancelled");
        } catch {}
      }

      nav("/user-home", { replace: true });
    } catch (e) {
      console.error("handleBackOrCancel error:", e);
      setMsg(e?.message || "ยกเลิกไม่สำเร็จ");
    }
  }, [draftShipmentId, releaseCurrentDraftReservations, updateDraftReservationStatus, nav]);

  const handleSaveDraft = useCallback(async () => {
    if (!canSaveDraft) {
      setMsg("กรุณาเลือกข้อมูลให้ครบ และต้องมีเบอร์หมูอย่างน้อย 1 ตัว");
      return;
    }

    setSavingDraft(true);
    setMsg("");

    try {
      const shipmentId = clean(draftShipmentId);
      if (!shipmentId) throw new Error("ไม่พบ draft shipment");

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
          reservation_status: "open",
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

      const { error: consumeError } = await supabase.rpc("consume_shipment_reservations", {
        p_shipment_id: shipmentId,
        p_reserved_by: currentUserId,
      });

      if (consumeError) throw consumeError;

      const { error: statusError } = await supabase
        .from("swine_shipments")
        .update({ reservation_status: "consumed" })
        .eq("id", shipmentId);

      if (statusError) throw statusError;

      const resequenceRes = await supabase.rpc("resequence_shipment_group_append_end", {
        p_selected_date: selectedDate,
        p_from_farm_code: clean(fromFarm?.farm_code) || null,
        p_to_farm_id: clean(toFarmId) || null,
        p_priority_shipment_id: shipmentId,
      });

      if (resequenceRes.error) throw resequenceRes.error;

      leavingRef.current = true;
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
      setMsg(e?.message || e?.details || e?.hint || "บันทึก draft ไม่สำเร็จ");
    } finally {
      setSavingDraft(false);
    }
  }, [
    canSaveDraft,
    draftShipmentId,
    selectedDate,
    fromFarm,
    toFarmId,
    selectedHouse,
    remark,
    pickedRows,
    currentUserId,
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
            mobile-first • reservation-based • เลือกเล้าก่อนค่อยเลือกเบอร์หมู
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
              {draftCreating ? "กำลังสร้าง draft..." : "บันทึกเข้า list"}
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