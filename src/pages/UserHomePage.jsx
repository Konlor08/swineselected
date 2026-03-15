// src/pages/UserHomePage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

function clean(s) {
  return String(s ?? "").trim();
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function withTimeout(promise, ms = 15000, label = "request") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms)
    ),
  ]);
}

function qrUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
    text || ""
  )}`;
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function normalizeSwineRow(r) {
  return {
    ...r,
    id: r?.id,
    swine_code: clean(r?.swine_code),
    farm_code: clean(r?.farm_code),
    house_no: clean(r?.house_no),
  };
}

const SELECTED_BG = "#fef9c3";
const SELECTED_BORDER = "#fde68a";
const INVALID_BG = "#fef2f2";
const INVALID_BORDER = "#fecaca";

const fullInputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "1px solid #ddd",
  boxSizing: "border-box",
  minWidth: 0,
};

const smallInputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
  minWidth: 0,
};

const cardStyle = {
  width: "100%",
  boxSizing: "border-box",
  minWidth: 0,
};

export default function UserHomePage() {
  const nav = useNavigate();

  const [msg, setMsg] = useState("");
  const [myRole, setMyRole] = useState("user");

  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [currentShipmentId, setCurrentShipmentId] = useState(null);
  const [currentStatus, setCurrentStatus] = useState("draft");
  const [submitting, setSubmitting] = useState(false);

  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);

  const [toFarmId, setToFarmId] = useState(null);

  const [selectedHouse, setSelectedHouse] = useState("");
  const [swineQ, setSwineQ] = useState("");
  const [swineLoading, setSwineLoading] = useState(false);
  const [swineSearchLoading, setSwineSearchLoading] = useState(false);

  const [swineOptions, setSwineOptions] = useState([]);
  const [availableSwineCodeSet, setAvailableSwineCodeSet] = useState(new Set());
  const [directSearchResults, setDirectSearchResults] = useState([]);

  const [selectedSwineIds, setSelectedSwineIds] = useState(new Set());
  const [selectedSwineMap, setSelectedSwineMap] = useState({});

  const [swineForm, setSwineForm] = useState({});
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

  const [showSavePreview, setShowSavePreview] = useState(false);
  const [savePreviewRows, setSavePreviewRows] = useState([]);
  const [invalidSwineIds, setInvalidSwineIds] = useState(new Set());

  const selectedToFarmId = useMemo(() => {
    if (!toFarmId) return "";
    if (typeof toFarmId === "string") return clean(toFarmId);
    if (typeof toFarmId === "object") return clean(toFarmId?.id);
    return "";
  }, [toFarmId]);

  useEffect(() => {
    let alive = true;

    async function loadMyRole() {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id;
        if (!uid) return;

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        setMyRole(String(profile?.role || "user").toLowerCase());
      } catch (e) {
        console.error("loadMyRole error:", e);
      }
    }

    loadMyRole();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (myRole === "admin") {
      nav("/admin", { replace: true });
    }
  }, [myRole, nav]);

  useEffect(() => {
    let alive = true;

    async function loadFromFarms() {
      setFromLoading(true);
      setMsg("");

      try {
        const { data, error } = await supabase
          .from("swines")
          .select("farm_code, farm_name, branch_id")
          .not("farm_code", "is", null)
          .order("farm_code", { ascending: true })
          .limit(5000);

        if (error) throw error;

        const map = new Map();
        for (const r of data || []) {
          const fc = clean(r.farm_code);
          if (!fc) continue;
          const fn = clean(r.farm_name);
          const key = `${fc}__${fn}`;
          if (!map.has(key)) {
            map.set(key, {
              farm_code: fc,
              farm_name: fn || fc,
              branch_id: r.branch_id || null,
            });
          }
        }

        const arr = Array.from(map.values()).sort((a, b) =>
          String(a.farm_code).localeCompare(String(b.farm_code))
        );

        if (alive) setFromOptions(arr);
      } catch (e) {
        console.error("loadFromFarms error:", e);
        if (alive) {
          setFromOptions([]);
          setMsg(e?.message || "โหลดฟาร์มต้นทางจาก swines ไม่สำเร็จ");
        }
      } finally {
        if (alive) setFromLoading(false);
      }
    }

    loadFromFarms();
    return () => {
      alive = false;
    };
  }, []);

  const filteredFromOptions = useMemo(() => {
    const q = clean(fromQ).toLowerCase();
    if (!q) return fromOptions.slice(0, 12);
    return fromOptions
      .filter((x) => `${x.farm_code} ${x.farm_name}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [fromOptions, fromQ]);

  async function fetchAvailableCodes(codes) {
    const availableSet = new Set();
    const normalizedCodes = (codes || []).map(clean).filter(Boolean);

    if (!normalizedCodes.length) {
      return availableSet;
    }

    const codeChunks = chunkArray(normalizedCodes, 500);

    for (const chunk of codeChunks) {
      const { data: availableRows, error } = await supabase
        .from("swine_master")
        .select("swine_code")
        .eq("delivery_state", "available")
        .in("swine_code", chunk);

      if (error) throw error;

      for (const row of availableRows || []) {
        const code = clean(row?.swine_code);
        if (code) {
          availableSet.add(code);
        }
      }
    }

    return availableSet;
  }

  async function fetchFarmSwinesWithAvailability(farmCode) {
    const farmCodeClean = clean(farmCode);

    const { data: farmSwines, error: e1 } = await supabase
      .from("swines")
      .select("id, swine_code, farm_code, house_no")
      .eq("farm_code", farmCodeClean)
      .order("house_no", { ascending: true })
      .order("swine_code", { ascending: true })
      .limit(5000);

    if (e1) throw e1;

    const swines = (farmSwines || []).map(normalizeSwineRow);
    const codes = swines.map((x) => x.swine_code).filter(Boolean);
    const availableSet = await fetchAvailableCodes(codes);

    console.log("fetchFarmSwinesWithAvailability", {
      farmCode: farmCodeClean,
      swinesCount: swines.length,
      availableCount: availableSet.size,
      targetInSwines: swines.find((s) => s.swine_code === "2609545521") || null,
      targetAvailable: availableSet.has("2609545521"),
    });

    return { swines, availableSet };
  }

  async function reloadSwinesOfFarm(farmCode, opts = {}) {
    const {
      preserveHouse = true,
      clearPicked = true,
      clearSearch = false,
      clearMessage = true,
    } = opts;

    if (clearMessage) setMsg("");

    if (!farmCode) {
      setSwineOptions([]);
      setAvailableSwineCodeSet(new Set());
      setDirectSearchResults([]);
      setSelectedHouse("");
      setSelectedSwineIds(new Set());
      setSelectedSwineMap({});
      setSwineForm({});
      setSwineQ("");
      setInvalidSwineIds(new Set());
      return;
    }

    setSwineLoading(true);

    try {
      const { swines, availableSet } = await fetchFarmSwinesWithAvailability(farmCode);

      setSwineOptions(swines);
      setAvailableSwineCodeSet(availableSet);
      setDirectSearchResults([]);

      if (!preserveHouse) {
        setSelectedHouse("");
      } else {
        const houseValueSet = new Set(
          (swines || []).map((s) => clean(s.house_no) || "__BLANK__")
        );

        setSelectedHouse((prev) => {
          if (!prev) return prev;
          return houseValueSet.has(prev) ? prev : "";
        });
      }

      if (clearPicked) {
        setSelectedSwineIds(new Set());
        setSelectedSwineMap({});
        setSwineForm({});
        setInvalidSwineIds(new Set());
      }

      if (clearSearch) {
        setSwineQ("");
      }
    } catch (e) {
      console.error("reloadSwinesOfFarm error:", e);
      setSwineOptions([]);
      setAvailableSwineCodeSet(new Set());
      setDirectSearchResults([]);
      setMsg(e?.message || "โหลดรายการหมูไม่สำเร็จ");
    } finally {
      setSwineLoading(false);
    }
  }

  useEffect(() => {
    if (!fromFarm?.farm_code) {
      setSwineOptions([]);
      setAvailableSwineCodeSet(new Set());
      setDirectSearchResults([]);
      setSelectedHouse("");
      setSelectedSwineIds(new Set());
      setSelectedSwineMap({});
      setSwineForm({});
      setSwineQ("");
      setInvalidSwineIds(new Set());
      return;
    }

    reloadSwinesOfFarm(fromFarm.farm_code, {
      preserveHouse: false,
      clearPicked: true,
      clearSearch: true,
      clearMessage: true,
    });
  }, [fromFarm?.farm_code]);

  useEffect(() => {
    let alive = true;

    async function runDirectSearch() {
      const farmCode = clean(fromFarm?.farm_code);
      const house = clean(selectedHouse);
      const q = clean(swineQ);

      if (!farmCode || !house || !q) {
        setDirectSearchResults([]);
        setSwineSearchLoading(false);
        return;
      }

      setSwineSearchLoading(true);

      try {
        let query = supabase
          .from("swines")
          .select("id, swine_code, farm_code, house_no")
          .eq("farm_code", farmCode);

        if (house === "__BLANK__") {
          query = query.or("house_no.is.null,house_no.eq.");
        } else {
          query = query.eq("house_no", house);
        }

        query = query.ilike("swine_code", `%${q}%`).limit(50);

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map(normalizeSwineRow);
        const codes = rows.map((x) => x.swine_code).filter(Boolean);
        const availableSet = await fetchAvailableCodes(codes);
        const availableRows = rows.filter((r) => availableSet.has(clean(r.swine_code)));

        console.log("runDirectSearch", {
          farmCode,
          house,
          q,
          rowsCount: rows.length,
          availableRowsCount: availableRows.length,
          target: availableRows.find((s) => s.swine_code === "2609545521") || null,
        });

        if (alive) {
          setDirectSearchResults(availableRows);
        }
      } catch (e) {
        console.error("runDirectSearch error:", e);
        if (alive) {
          setDirectSearchResults([]);
        }
      } finally {
        if (alive) {
          setSwineSearchLoading(false);
        }
      }
    }

    runDirectSearch();

    return () => {
      alive = false;
    };
  }, [fromFarm?.farm_code, selectedHouse, swineQ]);

  const houseOptions = useMemo(() => {
    const map = new Map();

    for (const s of swineOptions || []) {
      const raw = clean(s.house_no);
      const value = raw || "__BLANK__";
      const label = raw || "(ไม่ระบุ House)";
      if (!map.has(value)) {
        map.set(value, { value, label });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      String(a.label).localeCompare(String(b.label), "th")
    );
  }, [swineOptions]);

  const filteredSwines = useMemo(() => {
    if (!selectedHouse) return [];

    const q = clean(swineQ).toLowerCase();

    console.log("filteredSwines state", {
      selectedHouse,
      q,
      swineOptionsCount: swineOptions.length,
      availableCount: availableSwineCodeSet.size,
      targetInOptions:
        (swineOptions || []).find((s) => clean(s.swine_code) === "2609545521") || null,
      targetAvailable: availableSwineCodeSet.has("2609545521"),
    });

    if (q) {
      return directSearchResults.slice(0, 50);
    }

    return swineOptions
      .filter((s) => {
        const houseValue = clean(s.house_no);
        if (selectedHouse === "__BLANK__") {
          if (houseValue) return false;
        } else if (houseValue !== selectedHouse) {
          return false;
        }

        return availableSwineCodeSet.has(clean(s.swine_code));
      })
      .slice(0, 50);
  }, [
    swineOptions,
    selectedHouse,
    swineQ,
    availableSwineCodeSet,
    directSearchResults,
  ]);

  const swineSourceMap = useMemo(() => {
    const map = new Map();
    for (const s of [...(swineOptions || []), ...(directSearchResults || [])]) {
      if (s?.id) map.set(s.id, s);
    }
    return map;
  }, [swineOptions, directSearchResults]);

  const handleSelectFromFarm = useCallback((farm) => {
    setFromFarm(farm);
    setSelectedHouse("");
    setSwineQ("");
    setSwineOptions([]);
    setAvailableSwineCodeSet(new Set());
    setDirectSearchResults([]);
    setSelectedSwineIds(new Set());
    setSelectedSwineMap({});
    setSwineForm({});
    setInvalidSwineIds(new Set());
    setMsg("");
  }, []);

  const handleHouseChange = useCallback((value) => {
    setSelectedHouse(value);
    setSwineQ("");
    setDirectSearchResults([]);
    setSelectedSwineIds(new Set());
    setSelectedSwineMap({});
    setSwineForm({});
    setInvalidSwineIds(new Set());
    setMsg("");
  }, []);

  const toggleSwine = useCallback((swineRow) => {
    const id = swineRow?.id;
    if (!id) return;

    setSelectedSwineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setSwineForm((pf) => (pf[id] ? pf : { ...pf, [id]: pf[id] || {} }));
      }
      return next;
    });

    setSelectedSwineMap((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = {
          id,
          swine_code: clean(swineRow?.swine_code),
          farm_code: clean(swineRow?.farm_code),
          house_no: clean(swineRow?.house_no),
        };
      }
      return next;
    });

    setInvalidSwineIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const setSwineField = useCallback((swine_id, field, value) => {
    setSwineForm((prev) => {
      const cur = prev[swine_id] || {};
      return { ...prev, [swine_id]: { ...cur, [field]: value } };
    });
  }, []);

  const canSave = useMemo(() => {
    return (
      !!selectedDate &&
      !!fromFarm?.farm_code &&
      !!selectedToFarmId &&
      !!selectedHouse &&
      selectedSwineIds.size > 0
    );
  }, [selectedDate, fromFarm, selectedToFarmId, selectedHouse, selectedSwineIds]);

  const buildSavePreviewRows = useCallback(() => {
    const selectedIds = Array.from(selectedSwineIds);

    return selectedIds.map((swine_id, index) => {
      const picked = selectedSwineMap[swine_id] || null;
      const fallback = swineSourceMap.get(swine_id) || null;

      const swineCode =
        clean(picked?.swine_code) || clean(fallback?.swine_code) || "";
      const label = swineCode || `รายการ ${index + 1}`;

      const issues = [];
      if (!swine_id) issues.push("ไม่มี swine_id");
      if (!swineCode) issues.push("ไม่มี swine_code");

      return {
        index: index + 1,
        swine_id,
        swine_code: swineCode,
        label,
        ok: issues.length === 0,
        reason: issues.join(", ") || "พร้อมบันทึก",
      };
    });
  }, [selectedSwineIds, selectedSwineMap, swineSourceMap]);

  const previewSummary = useMemo(() => {
    const total = savePreviewRows.length;
    const valid = savePreviewRows.filter((x) => x.ok).length;
    const invalid = total - valid;
    return { total, valid, invalid };
  }, [savePreviewRows]);

  const okRows = useMemo(
    () => savePreviewRows.filter((x) => x.ok),
    [savePreviewRows]
  );

  const badRows = useMemo(
    () => savePreviewRows.filter((x) => !x.ok),
    [savePreviewRows]
  );

  const hasPreviewError = badRows.length > 0;

  const openSavePreview = useCallback(() => {
    if (!canSave) {
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + House + หมูอย่างน้อย 1 ตัว");
      return;
    }

    const rows = buildSavePreviewRows();
    setSavePreviewRows(rows);
    setInvalidSwineIds(new Set(rows.filter((x) => !x.ok).map((x) => x.swine_id)));
    setShowSavePreview(true);
    setMsg("");
  }, [canSave, buildSavePreviewRows]);

  const logout = useCallback(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setMsg("");

    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("logout error:", err);
    }

    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
      }
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      }
    } catch {
      // ignore
    }

    window.location.replace(`/login?logout=1&ts=${Date.now()}`);
  }, []);

  async function saveDraft() {
    if (!canSave) {
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + House + หมูอย่างน้อย 1 ตัว");
      return;
    }

    const previewRowsNow = buildSavePreviewRows();
    const invalidNow = previewRowsNow.filter((x) => !x.ok);

    setSavePreviewRows(previewRowsNow);
    setInvalidSwineIds(new Set(invalidNow.map((x) => x.swine_id)));

    if (invalidNow.length > 0) {
      setShowSavePreview(true);
      setMsg(
        `ยังบันทึกไม่ได้ กรุณากลับไปแก้ไขรายการที่มีปัญหาก่อน: ${invalidNow
          .map((x) => x.label)
          .join(", ")}`
      );
      return;
    }

    setSaving(true);
    setMsg("กำลังเตรียมบันทึก...");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;
      if (!user?.id) throw new Error("ไม่พบผู้ใช้งาน กรุณา login ใหม่");

      const selectedIds = Array.from(selectedSwineIds);
      const selectedCount = selectedIds.length;
      const shipmentId = crypto.randomUUID();

      const header = {
        id: shipmentId,
        created_by: user.id,
        selected_date: selectedDate || null,
        from_farm_code: clean(fromFarm.farm_code),
        from_farm_name: clean(fromFarm.farm_name) || null,
        from_branch_id: fromFarm.branch_id || null,
        to_farm_id: selectedToFarmId || null,
        remark: clean(remark) || null,
        status: "draft",
      };

      setMsg("กำลังบันทึกหัวรายการ...");
      const res1 = await withTimeout(
        supabase.from("swine_shipments").insert([header]),
        15000,
        "insert swine_shipments"
      );
      if (res1.error) throw res1.error;

      const toIntOrNull = (v) => {
        const s = clean(v);
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      };

      const toNumOrNull = (v) => {
        const s = clean(v);
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };

      const itemRows = selectedIds.map((swine_id) => {
        const f = swineForm[swine_id] || {};
        const picked = selectedSwineMap[swine_id] || null;
        const fallback = swineSourceMap.get(swine_id) || null;
        const swine_code =
          clean(picked?.swine_code) || clean(fallback?.swine_code) || null;

        return {
          shipment_id: shipmentId,
          swine_id,
          swine_code,
          teats_left: toIntOrNull(f.teats_left),
          teats_right: toIntOrNull(f.teats_right),
          backfat: toNumOrNull(f.backfat),
          weight: toNumOrNull(f.weight),
        };
      });

      const missingCodeRows = itemRows
        .filter((r) => !r.swine_code)
        .map((r, i) => {
          const found = previewRowsNow.find((x) => x.swine_id === r.swine_id);
          return found?.label || `รายการ ${i + 1}`;
        });

      if (missingCodeRows.length > 0) {
        throw new Error(
          `MISSING_SWINE_CODE: บางตัวไม่มี swine_code (${missingCodeRows.join(", ")})`
        );
      }

      if (itemRows.some((r) => !r.swine_id)) {
        throw new Error("MISSING_SWINE_ID: บางตัวไม่มี swine_id");
      }

      setMsg("กำลังบันทึกรายการหมู...");
      const res2 = await withTimeout(
        supabase.from("swine_shipment_items").insert(itemRows),
        15000,
        "insert swine_shipment_items"
      );
      if (res2.error) throw res2.error;

      const pickedCodes = itemRows.map((x) => clean(x.swine_code)).filter(Boolean);

      if (pickedCodes.length) {
        setMsg("กำลังอัปเดตสถานะหมู...");
        const res3 = await withTimeout(
          supabase
            .from("swine_master")
            .update({ delivery_state: "reserved" })
            .in("swine_code", pickedCodes),
          15000,
          "update swine_master"
        );
        if (res3.error) throw res3.error;
      }

      setCurrentShipmentId(shipmentId);
      setCurrentStatus("draft");
      setMsg(`Save Draft สำเร็จ ✅ (Shipment: ${shipmentId}, หมู: ${selectedCount} ตัว)`);

      setRemark("");
      setSelectedSwineIds(new Set());
      setSelectedSwineMap({});
      setSwineForm({});
      setInvalidSwineIds(new Set());
      setShowSavePreview(false);
      setSavePreviewRows([]);

      await reloadSwinesOfFarm(fromFarm.farm_code, {
        preserveHouse: true,
        clearPicked: true,
        clearSearch: false,
        clearMessage: false,
      });
    } catch (e) {
      console.error("saveDraft error:", {
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        raw: e,
      });

      setMsg(
        `${e?.message || "บันทึกไม่สำเร็จ"}${
          e?.details ? ` | details: ${e.details}` : ""
        }${e?.hint ? ` | hint: ${e.hint}` : ""}`
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitShipment() {
    if (!currentShipmentId) {
      setMsg("กรุณา Save Draft ก่อน แล้วจึง Submit");
      return;
    }

    setSubmitting(true);
    setMsg("");

    try {
      const { data: shipment, error: e1 } = await supabase
        .from("swine_shipments")
        .select("id, status")
        .eq("id", currentShipmentId)
        .single();

      if (e1) throw e1;
      if (!shipment) throw new Error("ไม่พบข้อมูล shipment");
      if (shipment.status !== "draft") {
        throw new Error("รายการนี้ไม่ใช่ draft หรือถูก submit ไปแล้ว");
      }

      const { data: items, error: e2 } = await supabase
        .from("swine_shipment_items")
        .select("id")
        .eq("shipment_id", currentShipmentId)
        .limit(1);

      if (e2) throw e2;
      if (!items || items.length === 0) {
        throw new Error("ไม่มีรายการหมูใน shipment นี้");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const payload = {
        status: "submitted",
        submitted_at: new Date().toISOString(),
      };

      if (user?.id) {
        payload.submitted_by = user.id;
      }

      const { error: e3 } = await supabase
        .from("swine_shipments")
        .update(payload)
        .eq("id", currentShipmentId)
        .eq("status", "draft");

      if (e3) throw e3;

      setCurrentStatus("submitted");
      setMsg("Submit สำเร็จ ✅ และเปลี่ยนสถานะเป็น submitted แล้ว");
    } catch (e) {
      console.error("submitShipment error:", e);
      setMsg(
        `${e?.message || "Submit ไม่สำเร็จ"}${
          e?.details ? ` | details: ${e.details}` : ""
        }${e?.hint ? ` | hint: ${e.hint}` : ""}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (myRole === "admin") {
    return (
      <div className="page" style={{ overflowX: "hidden" }}>
        <div
          className="card"
          style={{
            maxWidth: 520,
            margin: "60px auto",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900 }}>Admin</div>
          <div className="small" style={{ marginTop: 8 }}>
            กำลังพาไปหน้า Admin...
          </div>
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>User</div>
          <div className="small" style={{ wordBreak: "break-word" }}>
            เลือกวันคัด ฟาร์มต้นทาง/ปลายทาง House และเลือกหมู
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            position: "relative",
            zIndex: 21,
          }}
        >
          <button
            className="linkbtn"
            type="button"
            onClick={() => nav("/edit-shipment")}
          >
            จอแก้ไข
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => nav("/export-csv")}
          >
            Export CSV
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={logout}
            style={{ position: "relative", zIndex: 22 }}
          >
            Logout
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        {msg ? (
          <div className="card" style={{ padding: 12, ...cardStyle }}>
            <div
              className="small"
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ display: "grid", gap: 8, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>วันคัด</div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={fullInputStyle}
          />

          <div className="small" style={{ color: "#444", wordBreak: "break-word" }}>
            Shipment ปัจจุบัน: <b>{currentShipmentId || "-"}</b> | สถานะ:{" "}
            <b>{currentStatus}</b>
          </div>
        </div>

        <div className="card" style={{ display: "grid", gap: 8, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>ฟาร์มต้นทาง (จากข้อมูลหมูใน swines)</div>

          <input
            value={fromQ}
            onChange={(e) => setFromQ(e.target.value)}
            placeholder="พิมพ์ค้นหา farm code / farm name…"
            style={fullInputStyle}
          />

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              overflow: "hidden",
              maxHeight: 260,
              overflowY: "auto",
              minWidth: 0,
            }}
          >
            {fromLoading && <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>}

            {!fromLoading &&
              filteredFromOptions.map((f) => {
                const active =
                  fromFarm?.farm_code === f.farm_code && fromFarm?.farm_name === f.farm_name;
                return (
                  <button
                    key={`${f.farm_code}__${f.farm_name}`}
                    type="button"
                    onClick={() => handleSelectFromFarm(f)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid #eee",
                      background: active ? SELECTED_BG : "white",
                      boxShadow: active ? `inset 0 0 0 1px ${SELECTED_BORDER}` : "none",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                      {f.farm_code} - {f.farm_name}
                    </div>
                  </button>
                );
              })}

            {!fromLoading && filteredFromOptions.length === 0 && (
              <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มต้นทาง</div>
            )}
          </div>

          <div
            className="small"
            style={{
              color: "#444",
              wordBreak: "break-word",
              background: fromFarm ? SELECTED_BG : "transparent",
              border: fromFarm ? `1px solid ${SELECTED_BORDER}` : "none",
              borderRadius: 10,
              padding: fromFarm ? "8px 10px" : 0,
            }}
          >
            เลือกอยู่: <b>{fromFarm ? `${fromFarm.farm_code} - ${fromFarm.farm_name}` : "-"}</b>
          </div>
        </div>

        <div className="card" style={cardStyle}>
          <FarmPickerInlineAdd
            label="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
            value={toFarmId}
            onChange={setToFarmId}
            requireBranch={false}
          />
        </div>

        <div className="card" style={{ display: "grid", gap: 8, ...cardStyle }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 800 }}>House</div>

            <button
              type="button"
              className="linkbtn"
              onClick={() =>
                reloadSwinesOfFarm(fromFarm?.farm_code, {
                  preserveHouse: true,
                  clearPicked: true,
                  clearSearch: false,
                  clearMessage: true,
                })
              }
              disabled={!fromFarm?.farm_code || swineLoading || saving || submitting}
            >
              {swineLoading ? "กำลังโหลด..." : "Reload หมู"}
            </button>
          </div>

          {!fromFarm?.farm_code ? (
            <div className="small" style={{ color: "#666" }}>
              * กรุณาเลือกฟาร์มต้นทางก่อน
            </div>
          ) : swineLoading ? (
            <div className="small" style={{ color: "#666" }}>กำลังโหลด House...</div>
          ) : (
            <>
              <select
                value={selectedHouse}
                onChange={(e) => handleHouseChange(e.target.value)}
                style={fullInputStyle}
              >
                <option value="">เลือก House</option>
                {houseOptions.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>

              <div className="small" style={{ color: "#444" }}>
                House ที่มีหมูให้เลือก: <b>{houseOptions.length}</b> รายการ
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ display: "grid", gap: 8, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>เลือกหมู (จาก swines ของฟาร์มต้นทาง)</div>

          {!fromFarm?.farm_code ? (
            <div className="small" style={{ color: "#666" }}>
              * กรุณาเลือกฟาร์มต้นทางก่อน
            </div>
          ) : !selectedHouse ? (
            <div className="small" style={{ color: "#666" }}>
              * กรุณาเลือก House ก่อน เพื่อแสดงเบอร์หมู
            </div>
          ) : (
            <>
              <input
                value={swineQ}
                onChange={(e) => setSwineQ(e.target.value)}
                placeholder="พิมพ์ค้นหา swine code…"
                style={fullInputStyle}
              />

              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  overflow: "hidden",
                  maxHeight: 500,
                  overflowY: "auto",
                  minWidth: 0,
                }}
              >
                {(swineLoading || swineSearchLoading) && (
                  <div style={{ padding: 12, color: "#666" }}>
                    {swineLoading ? "กำลังโหลดรายการหมู..." : "กำลังค้นหาเลขหมู..."}
                  </div>
                )}

                {!swineLoading &&
                  !swineSearchLoading &&
                  filteredSwines.map((s) => {
                    const checked = selectedSwineIds.has(s.id);
                    const f = swineForm[s.id] || {};
                    const isInvalid = invalidSwineIds.has(s.id);

                    return (
                      <div
                        key={s.id}
                        style={{
                          padding: "10px 12px",
                          borderBottom: "1px solid #eee",
                          background: isInvalid
                            ? INVALID_BG
                            : checked
                            ? SELECTED_BG
                            : "white",
                          boxShadow: isInvalid
                            ? `inset 0 0 0 1px ${INVALID_BORDER}`
                            : checked
                            ? `inset 0 0 0 1px ${SELECTED_BORDER}`
                            : "none",
                          boxSizing: "border-box",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            cursor: "pointer",
                            minWidth: 0,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSwine(s)}
                            style={{ marginTop: 3, flex: "0 0 auto" }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                              {s.swine_code}
                            </div>
                            {isInvalid && (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#b91c1c",
                                }}
                              >
                                รายการนี้มีปัญหา กรุณาตรวจสอบก่อนบันทึก
                              </div>
                            )}
                          </div>
                        </label>

                        {checked && (
                          <div style={{ marginTop: 10, display: "grid", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              <input
                                value={f.teats_left ?? ""}
                                onChange={(e) => setSwineField(s.id, "teats_left", e.target.value)}
                                placeholder="L (เต้านมซ้าย) เช่น 7"
                                inputMode="numeric"
                                style={smallInputStyle}
                              />
                              <input
                                value={f.teats_right ?? ""}
                                onChange={(e) =>
                                  setSwineField(s.id, "teats_right", e.target.value)
                                }
                                placeholder="R (เต้านมขวา) เช่น 7"
                                inputMode="numeric"
                                style={smallInputStyle}
                              />
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              <input
                                value={f.backfat ?? ""}
                                onChange={(e) => setSwineField(s.id, "backfat", e.target.value)}
                                placeholder="Backfat เช่น 12.5"
                                inputMode="decimal"
                                style={smallInputStyle}
                              />
                              <input
                                value={f.weight ?? ""}
                                onChange={(e) => setSwineField(s.id, "weight", e.target.value)}
                                placeholder="Weight เช่น 115.3"
                                inputMode="decimal"
                                style={smallInputStyle}
                              />
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 180px))",
                                gap: 12,
                                alignItems: "start",
                              }}
                            >
                              <div
                                style={{
                                  background: "#fff",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: 12,
                                  padding: 10,
                                  width: "fit-content",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: "#555",
                                    marginBottom: 8,
                                  }}
                                >
                                  QR Code
                                </div>
                                <img
                                  src={qrUrl(s.swine_code)}
                                  alt={`QR ${s.swine_code}`}
                                  loading="lazy"
                                  style={{
                                    width: 140,
                                    height: 140,
                                    display: "block",
                                    borderRadius: 8,
                                    background: "#fff",
                                  }}
                                />
                                <div
                                  style={{
                                    marginTop: 8,
                                    fontSize: 12,
                                    color: "#555",
                                    wordBreak: "break-word",
                                    textAlign: "center",
                                  }}
                                >
                                  {s.swine_code}
                                </div>
                              </div>
                            </div>

                            <div style={{ fontSize: 12, color: "#666", wordBreak: "break-word" }}>
                              เว้นว่างได้ — ถ้าว่างจะแสดงเป็น <b>-</b>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                {!swineLoading &&
                  !swineSearchLoading &&
                  selectedHouse &&
                  filteredSwines.length === 0 && (
                    <div style={{ padding: 12, color: "#666" }}>
                      {clean(swineQ)
                        ? "ไม่พบเลขหมู available ตามที่ค้นหา"
                        : "ไม่พบหมู available ใน House นี้"}
                    </div>
                  )}
              </div>

              <div
                className="small"
                style={{
                  color: "#444",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span>
                  เลือกแล้ว: <b>{selectedSwineIds.size}</b> ตัว
                </span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    setSelectedSwineIds(new Set());
                    setSelectedSwineMap({});
                    setSwineForm({});
                    setInvalidSwineIds(new Set());
                  }}
                >
                  ล้างรายการหมู
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ display: "grid", gap: 6, ...cardStyle }}>
          <div style={{ fontWeight: 700 }}>หมายเหตุ</div>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            placeholder="ใส่หมายเหตุ (ถ้ามี)"
            style={{
              ...fullInputStyle,
              resize: "vertical",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <button
            className="linkbtn"
            type="button"
            onClick={openSavePreview}
            disabled={!canSave || saving || submitting}
            style={{ flex: "1 1 140px", minWidth: 0 }}
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={submitShipment}
            disabled={!currentShipmentId || currentStatus !== "draft" || submitting || saving}
            style={{ flex: "1 1 140px", minWidth: 0 }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              setSaving(false);
              setSubmitting(false);
              setMsg("");
              setSelectedDate(todayYmd());
              setCurrentShipmentId(null);
              setCurrentStatus("draft");
              setFromFarm(null);
              setToFarmId(null);
              setSelectedHouse("");
              setRemark("");
              setFromQ("");
              setSwineQ("");
              setSwineOptions([]);
              setAvailableSwineCodeSet(new Set());
              setDirectSearchResults([]);
              setSelectedSwineIds(new Set());
              setSelectedSwineMap({});
              setSwineForm({});
              setShowSavePreview(false);
              setSavePreviewRows([]);
              setInvalidSwineIds(new Set());
            }}
            style={{ flex: "1 1 140px", minWidth: 0 }}
          >
            Clear
          </button>
        </div>
      </div>

      {showSavePreview && (
        <div
          onClick={() => !saving && setShowSavePreview(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "85vh",
              overflow: "hidden",
              background: "#fff",
              borderRadius: 18,
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
              display: "grid",
              gridTemplateRows: "auto auto 1fr auto",
            }}
          >
            <div style={{ padding: "16px 18px 8px", borderBottom: "1px solid #eee" }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>ตรวจรายการก่อนบันทึก</div>
              <div style={{ color: "#555", marginTop: 6 }}>
                ตรวจสอบจำนวนที่คัด และดูว่าตัวไหนพร้อมบันทึก / มีปัญหา
              </div>
            </div>

            <div
              style={{
                padding: "14px 18px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
                borderBottom: "1px solid #eee",
              }}
            >
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fafafa",
                }}
              >
                <div style={{ fontSize: 12, color: "#666" }}>คัดทั้งหมด</div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>{previewSummary.total}</div>
              </div>

              <div
                style={{
                  border: "1px solid #dcfce7",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f0fdf4",
                }}
              >
                <div style={{ fontSize: 12, color: "#166534" }}>พร้อมบันทึก</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#166534" }}>
                  {previewSummary.valid}
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #fecaca",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fef2f2",
                }}
              >
                <div style={{ fontSize: 12, color: "#b91c1c" }}>มีปัญหา</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#b91c1c" }}>
                  {previewSummary.invalid}
                </div>
              </div>
            </div>

            <div
              style={{
                overflowY: "auto",
                padding: 18,
                display: "grid",
                gap: 18,
                background: "#fff",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#166534" }}>
                  พร้อมบันทึก ({okRows.length})
                </div>

                {okRows.length > 0 ? (
                  okRows.map((row) => (
                    <div
                      key={row.swine_id || `ok-${row.index}`}
                      style={{
                        border: "1px solid #bbf7d0",
                        background: "#f0fdf4",
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, wordBreak: "break-word" }}>{row.label}</div>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 13,
                            color: "#166534",
                            wordBreak: "break-word",
                          }}
                        >
                          {row.reason}
                        </div>
                      </div>

                      <div
                        style={{
                          flex: "0 0 auto",
                          fontWeight: 800,
                          color: "#166534",
                          whiteSpace: "nowrap",
                        }}
                      >
                        พร้อมบันทึก
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      border: "1px dashed #d1d5db",
                      borderRadius: 12,
                      padding: 12,
                      color: "#666",
                    }}
                  >
                    ไม่มีรายการในกลุ่มนี้
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#b91c1c" }}>
                  มีปัญหา ({badRows.length})
                </div>

                {badRows.length > 0 ? (
                  badRows.map((row) => (
                    <div
                      key={row.swine_id || `bad-${row.index}`}
                      style={{
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, wordBreak: "break-word" }}>{row.label}</div>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 13,
                            color: "#b91c1c",
                            wordBreak: "break-word",
                          }}
                        >
                          {row.reason}
                        </div>
                      </div>

                      <div
                        style={{
                          flex: "0 0 auto",
                          fontWeight: 800,
                          color: "#b91c1c",
                          whiteSpace: "nowrap",
                        }}
                      >
                        มีปัญหา
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      border: "1px dashed #d1d5db",
                      borderRadius: 12,
                      padding: 12,
                      color: "#666",
                    }}
                  >
                    ไม่มีรายการในกลุ่มนี้
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderTop: "1px solid #eee",
                display: "grid",
                gap: 10,
              }}
            >
              {hasPreviewError && (
                <div
                  style={{
                    color: "#b91c1c",
                    fontWeight: 800,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  ยังบันทึกไม่ได้ กรุณากลับไปแก้ไขรายการที่มีปัญหาก่อน
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => setShowSavePreview(false)}
                  disabled={saving}
                >
                  กลับไปแก้ไข
                </button>

                <button
                  type="button"
                  className="linkbtn"
                  onClick={saveDraft}
                  disabled={saving || hasPreviewError}
                  style={{
                    opacity: saving || hasPreviewError ? 0.6 : 1,
                    cursor: saving || hasPreviewError ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "Saving..." : "ยืนยันบันทึก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
