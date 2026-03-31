// src/pages/EditShipmentPage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
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

function withTimeout(promise, ms = 20000, label = "request") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms)
    ),
  ]);
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

function countAffectedRows(data) {
  if (Array.isArray(data)) return data.length;
  if (data) return 1;
  return 0;
}

function ensureAffectedRows(data, label, expectedMin = 1) {
  const affected = countAffectedRows(data);
  if (affected < expectedMin) {
    throw new Error(`NO_ROWS_AFFECTED: ${label}`);
  }
  return affected;
}

function getRawErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return clean(error);
  return clean(
    error?.message ||
      error?.details ||
      error?.hint ||
      error?.error_description ||
      error?.description ||
      ""
  );
}

function isLikelyNetworkError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const raw = getRawErrorMessage(error).toLowerCase();

  return (
    raw.includes("failed to fetch") ||
    raw.includes("fetch failed") ||
    raw.includes("networkerror") ||
    raw.includes("network request failed") ||
    raw.includes("load failed") ||
    raw.includes("err_network") ||
    raw.includes("err_internet_disconnected") ||
    raw.includes("internet disconnected") ||
    raw.includes("connection refused") ||
    raw.includes("connection reset") ||
    raw.includes("dns") ||
    raw.includes("offline")
  );
}

function isLikelyTimeoutError(error) {
  const raw = getRawErrorMessage(error).toLowerCase();
  return raw.includes("timeout") || raw.includes("timed out");
}

function getFriendlyErrorMessage(error, fallback = "เกิดข้อผิดพลาด") {
  if (isLikelyNetworkError(error)) {
    return "เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  }
  if (isLikelyTimeoutError(error)) {
    return "เซิร์ฟเวอร์ตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง";
  }
  return getRawErrorMessage(error) || fallback;
}

function formatActionError(actionLabel, error, fallback = "เกิดข้อผิดพลาด") {
  const detail = getFriendlyErrorMessage(error, fallback);
  return actionLabel ? `${actionLabel}: ${detail}` : detail;
}

function applySelectedDateRange(query, fromDate, toDate) {
  let q = query;
  const from = clean(fromDate);
  const to = clean(toDate);
  if (from) q = q.gte("selected_date", from);
  if (to) q = q.lte("selected_date", to);
  return q;
}

function toMillis(selectedDate, createdAt) {
  const a = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(a)) return a;
  const b = selectedDate ? Date.parse(selectedDate) : NaN;
  if (Number.isFinite(b)) return b;
  return 0;
}

function compareLatestDesc(a, b) {
  const diff =
    toMillis(b?.latest_selected_date, b?.latest_created_at) -
    toMillis(a?.latest_selected_date, a?.latest_created_at);

  if (diff !== 0) return diff;

  return String(a?.label || a?.value || "").localeCompare(
    String(b?.label || b?.value || ""),
    "th"
  );
}

function readSavedStepSelection() {
  if (typeof window === "undefined") {
    return {
      fromFarmCode: "",
      fromFlock: "",
      filterDateFrom: "",
      filterDateTo: "",
      swineSearchQ: "",
    };
  }

  try {
    const raw = window.sessionStorage.getItem("editShipmentStepSelection");
    if (!raw) {
      return {
        fromFarmCode: "",
        fromFlock: "",
        filterDateFrom: "",
        filterDateTo: "",
        swineSearchQ: "",
      };
    }

    const parsed = JSON.parse(raw);
    return {
      fromFarmCode: clean(parsed?.fromFarmCode),
      fromFlock: clean(parsed?.fromFlock),
      filterDateFrom: clean(parsed?.filterDateFrom),
      filterDateTo: clean(parsed?.filterDateTo),
      swineSearchQ: clean(parsed?.swineSearchQ),
    };
  } catch {
    return {
      fromFarmCode: "",
      fromFlock: "",
      filterDateFrom: "",
      filterDateTo: "",
      swineSearchQ: "",
    };
  }
}

function saveStepSelection(selection) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      "editShipmentStepSelection",
      JSON.stringify({
        fromFarmCode: clean(selection?.fromFarmCode),
        fromFlock: clean(selection?.fromFlock),
        filterDateFrom: clean(selection?.filterDateFrom),
        filterDateTo: clean(selection?.filterDateTo),
        swineSearchQ: clean(selection?.swineSearchQ),
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore
  }
}

function buildDraftFarmData(rows) {
  const farmMap = new Map();

  for (const row of rows || []) {
    const farmCode = clean(row?.from_farm_code);
    const farmName = clean(row?.from_farm_name);
    const flock = clean(row?.from_flock);
    const selectedDate = clean(row?.selected_date);
    const createdAt = clean(row?.created_at);

    if (!farmCode || !flock) continue;

    if (!farmMap.has(farmCode)) {
      farmMap.set(farmCode, {
        farm_code: farmCode,
        farm_name: farmName,
        value: farmCode,
        label: farmName ? `${farmCode} - ${farmName}` : farmCode,
        latest_selected_date: selectedDate,
        latest_created_at: createdAt,
        flock_map: new Map(),
      });
    }

    const farm = farmMap.get(farmCode);

    if (!farm.farm_name && farmName) {
      farm.farm_name = farmName;
      farm.label = `${farmCode} - ${farmName}`;
    }

    if (
      toMillis(selectedDate, createdAt) >
      toMillis(farm.latest_selected_date, farm.latest_created_at)
    ) {
      farm.latest_selected_date = selectedDate;
      farm.latest_created_at = createdAt;
    }

    if (!farm.flock_map.has(flock)) {
      farm.flock_map.set(flock, {
        value: flock,
        label: flock,
        latest_selected_date: selectedDate,
        latest_created_at: createdAt,
      });
    }

    const flockEntry = farm.flock_map.get(flock);

    if (
      toMillis(selectedDate, createdAt) >
      toMillis(flockEntry.latest_selected_date, flockEntry.latest_created_at)
    ) {
      flockEntry.latest_selected_date = selectedDate;
      flockEntry.latest_created_at = createdAt;
    }
  }

  const farmOptions = Array.from(farmMap.values())
    .map((farm) => ({
      ...farm,
      flocks: Array.from(farm.flock_map.values()).sort(compareLatestDesc),
    }))
    .sort(compareLatestDesc);

  return { farmOptions };
}

function getDiscardConfirmMessage(actionText = "ดำเนินการต่อ") {
  return `มีการแก้ไข/กรอกข้อมูลค้างไว้ ต้องการยกเลิกข้อมูลที่ยังไม่บันทึกแล้ว${actionText}ใช่หรือไม่`;
}

const OFFLINE_BANNER_TEXT =
  "ขณะนี้อุปกรณ์ออฟไลน์ ระบบจะยังไม่สามารถโหลดข้อมูลฟาร์มและ flock จากเซิร์ฟเวอร์ได้";

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

const selectedCardStyle = {
  background: "#fef9c3",
  boxShadow: "inset 0 0 0 1px #fde68a",
};

export default function EditShipmentPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const savedSelection = useMemo(() => readSavedStepSelection(), []);
  const today = todayYmdLocal();

  const initialFarmCode =
    clean(searchParams.get("fromFarmCode")) || clean(savedSelection.fromFarmCode);
  const initialFlock =
    clean(searchParams.get("fromFlock")) || clean(savedSelection.fromFlock);
  const initialDateFrom =
    clean(searchParams.get("fromDate")) ||
    clean(savedSelection.filterDateFrom) ||
    today;
  const initialDateTo =
    clean(searchParams.get("toDate")) ||
    clean(savedSelection.filterDateTo) ||
    today;
  const initialSwineSearchQ =
    clean(searchParams.get("swineCode")) || clean(savedSelection.swineSearchQ);

  const [pageLoading, setPageLoading] = useState(true);
  const [myRole, setMyRole] = useState("");
  const [userId, setUserId] = useState("");
  const [msg, setMsg] = useState("");
  const [bootError, setBootError] = useState("");
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionMap, setPermissionMap] = useState({});

  const [loadingDraftOptions, setLoadingDraftOptions] = useState(false);
  const [farmOptions, setFarmOptions] = useState([]);
  const [draftFarmMap, setDraftFarmMap] = useState(new Map());

  const [filterDateFrom, setFilterDateFrom] = useState(initialDateFrom);
  const [filterDateTo, setFilterDateTo] = useState(initialDateTo);
  const [selectedFarmCode, setSelectedFarmCode] = useState(initialFarmCode);
  const [selectedFlock, setSelectedFlock] = useState(initialFlock);

  const [swineSearchQ, setSwineSearchQ] = useState(initialSwineSearchQ);
  const [swineSearchLoading, setSwineSearchLoading] = useState(false);
  const [swineSearchResults, setSwineSearchResults] = useState([]);
  const [selectedSwineResultKey, setSelectedSwineResultKey] = useState("");
  const [swineSearchMode, setSwineSearchMode] = useState("idle");

  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [shipmentHeader, setShipmentHeader] = useState(null);
  const [selectedDraftItem, setSelectedDraftItem] = useState(null);
  const [draftOriginalSnapshot, setDraftOriginalSnapshot] = useState(null);

  const [editRemark, setEditRemark] = useState("");
  const [editToFarmId, setEditToFarmId] = useState("");
  const [editToFarmMeta, setEditToFarmMeta] = useState(null);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");

  const [savingDraftItem, setSavingDraftItem] = useState(false);
  const [deletingDraftItem, setDeletingDraftItem] = useState(false);

  const [createToFarmId, setCreateToFarmId] = useState("");
  const [createTeatsLeft, setCreateTeatsLeft] = useState("");
  const [createTeatsRight, setCreateTeatsRight] = useState("");
  const [createBackfat, setCreateBackfat] = useState("");
  const [createWeight, setCreateWeight] = useState("");
  const [creatingQuickShipment, setCreatingQuickShipment] = useState(false);

  const searchRequestRef = useRef(0);

  const canUsePage = myRole === "admin" || myRole === "user";
  const isAdmin = myRole === "admin";
  const permissionsReady = isAdmin || permissionsLoaded;

  const dateRangeInvalid =
    !!filterDateFrom && !!filterDateTo && filterDateFrom > filterDateTo;

  const selectedFarm = useMemo(() => {
    return (
      farmOptions.find((x) => clean(x.value) === clean(selectedFarmCode)) || null
    );
  }, [farmOptions, selectedFarmCode]);

  const flockOptions = useMemo(() => {
    if (!selectedFarmCode) return [];
    const farm = draftFarmMap.get(clean(selectedFarmCode));
    return Array.isArray(farm?.flocks) ? farm.flocks : [];
  }, [draftFarmMap, selectedFarmCode]);

  const selectedSwineResult = useMemo(() => {
    return (
      swineSearchResults.find(
        (row) => clean(row?.key) === clean(selectedSwineResultKey)
      ) || null
    );
  }, [swineSearchResults, selectedSwineResultKey]);

  const isEditingSelectedSwine = useMemo(() => {
    return !!selectedSwineResult;
  }, [selectedSwineResult]);

  const editIsSameFarm = useMemo(() => {
    return (
      !!clean(shipmentHeader?.from_farm_code) &&
      !!clean(editToFarmMeta?.farm_code) &&
      clean(shipmentHeader?.from_farm_code) === clean(editToFarmMeta?.farm_code)
    );
  }, [shipmentHeader?.from_farm_code, editToFarmMeta?.farm_code]);

  const hasDirtyDraftChanges = useMemo(() => {
    if (!selectedSwineResult || selectedSwineResult.source_type !== "draft") {
      return false;
    }
    if (!draftOriginalSnapshot) return false;

    return (
      clean(selectedDraftItem?.teats_left) !==
        clean(draftOriginalSnapshot?.teats_left) ||
      clean(selectedDraftItem?.teats_right) !==
        clean(draftOriginalSnapshot?.teats_right) ||
      clean(selectedDraftItem?.backfat) !== clean(draftOriginalSnapshot?.backfat) ||
      clean(selectedDraftItem?.weight) !== clean(draftOriginalSnapshot?.weight) ||
      clean(editRemark) !== clean(draftOriginalSnapshot?.remark) ||
      clean(editToFarmId) !== clean(draftOriginalSnapshot?.to_farm_id) ||
      clean(editDeliveryDate) !== clean(draftOriginalSnapshot?.delivery_date)
    );
  }, [
    selectedSwineResult,
    draftOriginalSnapshot,
    selectedDraftItem,
    editRemark,
    editToFarmId,
    editDeliveryDate,
  ]);

  const hasDirtyCreateChanges = useMemo(() => {
    if (!selectedSwineResult || selectedSwineResult.source_type !== "available") {
      return false;
    }

    return (
      !!clean(createToFarmId) ||
      !!clean(createTeatsLeft) ||
      !!clean(createTeatsRight) ||
      !!clean(createBackfat) ||
      !!clean(createWeight)
    );
  }, [
    selectedSwineResult,
    createToFarmId,
    createTeatsLeft,
    createTeatsRight,
    createBackfat,
    createWeight,
  ]);

  const hasUnsavedEditorChanges = hasDirtyDraftChanges || hasDirtyCreateChanges;

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
    }
    function handleOffline() {
      setIsOffline(true);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.history.length > 1) {
        nav(-1);
        return;
      }
    } catch (e) {
      console.error("handleBack error:", e);
    }

    nav("/", { replace: true });
  }, [nav]);

  const clearQuickCreateForm = useCallback(() => {
    setCreateToFarmId("");
    setCreateTeatsLeft("");
    setCreateTeatsRight("");
    setCreateBackfat("");
    setCreateWeight("");
  }, []);

  const clearDraftEditor = useCallback(() => {
    setSelectedShipmentId("");
    setShipmentHeader(null);
    setSelectedDraftItem(null);
    setDraftOriginalSnapshot(null);
    setEditRemark("");
    setEditToFarmId("");
    setEditToFarmMeta(null);
    setEditDeliveryDate("");
  }, []);

  const clearCurrentSelectionAndEditor = useCallback(() => {
    setSelectedSwineResultKey("");
    clearQuickCreateForm();
    clearDraftEditor();
  }, [clearQuickCreateForm, clearDraftEditor]);

  const confirmDiscardPendingChanges = useCallback(
    (actionText = "ดำเนินการต่อ") => {
      if (!hasUnsavedEditorChanges) return true;
      return window.confirm(getDiscardConfirmMessage(actionText));
    },
    [hasUnsavedEditorChanges]
  );

  useEffect(() => {
    let alive = true;

    async function init() {
      setPageLoading(true);
      setBootError("");
      setMsg("");

      try {
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id;

        if (!uid) {
          if (alive) {
            setMyRole("");
            setUserId("");
            setPermissionsLoaded(false);
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        const role = String(profile?.role || "user").toLowerCase();
        setMyRole(role);
        setUserId(uid);
        setPermissionsLoaded(role === "admin");
      } catch (e) {
        console.error("EditShipmentPage init error:", e);
        if (alive) {
          const friendly = formatActionError(
            "โหลดข้อมูลเริ่มต้นไม่สำเร็จ",
            e,
            "โหลดข้อมูลเริ่มต้นไม่สำเร็จ"
          );
          setBootError(friendly);
          setMsg(friendly);
        }
      } finally {
        if (alive) setPageLoading(false);
      }
    }

    void init();
    return () => {
      alive = false;
    };
  }, []);

  const loadUserFarmPermissions = useCallback(async () => {
    if (!userId || isAdmin) {
      setPermissionMap({});
      setPermissionsLoaded(true);
      return;
    }

    setPermissionsLoading(true);
    setPermissionsLoaded(false);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name, from_flock, created_at")
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const map = {};
      for (const row of data || []) {
        const farmCode = clean(row?.from_farm_code);
        const farmName = clean(row?.from_farm_name);
        const flock = clean(row?.from_flock);
        if (!farmCode || !flock) continue;

        if (!map[farmCode]) {
          map[farmCode] = {
            farm_code: farmCode,
            farm_name: farmName,
            flocks: [],
          };
        }

        if (!map[farmCode].flocks.includes(flock)) {
          map[farmCode].flocks.push(flock);
        }

        if (!map[farmCode].farm_name && farmName) {
          map[farmCode].farm_name = farmName;
        }
      }

      setPermissionMap(map);
    } catch (e) {
      console.error("loadUserFarmPermissions error:", e);
      setPermissionMap({});
      setMsg(
        formatActionError(
          "โหลดสิทธิ์ฟาร์มของผู้ใช้ไม่สำเร็จ",
          e,
          "โหลดสิทธิ์ฟาร์มของผู้ใช้ไม่สำเร็จ"
        )
      );
    } finally {
      setPermissionsLoading(false);
      setPermissionsLoaded(true);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    if (!userId) return;
    if (isOffline) return;

    if (isAdmin) {
      setPermissionsLoaded(true);
      return;
    }

    void loadUserFarmPermissions();
  }, [userId, isAdmin, loadUserFarmPermissions, isOffline]);

  const loadDraftFarmOptions = useCallback(async () => {
    if (!permissionsReady || isOffline || dateRangeInvalid) {
      setFarmOptions([]);
      setDraftFarmMap(new Map());
      return;
    }

    setLoadingDraftOptions(true);

    try {
      let query = supabase
        .from("swine_shipments")
        .select(
          "from_farm_code, from_farm_name, from_flock, selected_date, created_at, status"
        )
        .eq("status", "draft")
        .order("selected_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000);

      query = applySelectedDateRange(query, filterDateFrom, filterDateTo);

      const { data, error } = await query;
      if (error) throw error;

      let rows = data || [];

      if (!isAdmin) {
        rows = rows.filter((row) => {
          const farmCode = clean(row?.from_farm_code);
          const flock = clean(row?.from_flock);
          const allowedFlocks = Array.isArray(permissionMap[farmCode]?.flocks)
            ? permissionMap[farmCode].flocks
            : [];
          return !!farmCode && !!flock && allowedFlocks.includes(flock);
        });
      }

      const built = buildDraftFarmData(rows);
      const mapForState = new Map();
      for (const farm of built.farmOptions) {
        mapForState.set(clean(farm.farm_code), farm);
      }

      setFarmOptions(built.farmOptions);
      setDraftFarmMap(mapForState);
    } catch (e) {
      console.error("loadDraftFarmOptions error:", e);
      setFarmOptions([]);
      setDraftFarmMap(new Map());
      setMsg(
        formatActionError(
          "โหลดรายการฟาร์มและ flock ที่ยัง draft ไม่สำเร็จ",
          e,
          "โหลดรายการฟาร์มและ flock ที่ยัง draft ไม่สำเร็จ"
        )
      );
    } finally {
      setLoadingDraftOptions(false);
    }
  }, [
    permissionsReady,
    isOffline,
    isAdmin,
    permissionMap,
    filterDateFrom,
    filterDateTo,
    dateRangeInvalid,
  ]);

  useEffect(() => {
    if (!canUsePage) return;
    if (!permissionsReady) return;
    if (isOffline) return;
    if (!filterDateFrom || !filterDateTo) return;
    void loadDraftFarmOptions();
  }, [
    canUsePage,
    permissionsReady,
    isOffline,
    filterDateFrom,
    filterDateTo,
    loadDraftFarmOptions,
  ]);

  useEffect(() => {
    if (!farmOptions.length) {
      if (selectedFarmCode) setSelectedFarmCode("");
      return;
    }

    const currentExists = farmOptions.some(
      (x) => clean(x.value) === clean(selectedFarmCode)
    );
    if (currentExists) return;

    const preferred =
      farmOptions.find((x) => clean(x.value) === clean(initialFarmCode)) || null;

    setSelectedFarmCode(clean(preferred?.value) || clean(farmOptions[0]?.value));
  }, [farmOptions, initialFarmCode, selectedFarmCode]);

  useEffect(() => {
    if (!selectedFarmCode) {
      if (selectedFlock) setSelectedFlock("");
      return;
    }

    if (!flockOptions.length) {
      if (selectedFlock) setSelectedFlock("");
      return;
    }

    const currentExists = flockOptions.some(
      (x) => clean(x.value) === clean(selectedFlock)
    );
    if (currentExists) return;

    const preferred =
      flockOptions.find((x) => clean(x.value) === clean(initialFlock)) || null;

    setSelectedFlock(clean(preferred?.value) || clean(flockOptions[0]?.value));
  }, [selectedFarmCode, flockOptions, initialFlock, selectedFlock]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);

        if (clean(filterDateFrom)) next.set("fromDate", clean(filterDateFrom));
        else next.delete("fromDate");

        if (clean(filterDateTo)) next.set("toDate", clean(filterDateTo));
        else next.delete("toDate");

        if (clean(selectedFarmCode)) next.set("fromFarmCode", clean(selectedFarmCode));
        else next.delete("fromFarmCode");

        if (clean(selectedFlock)) next.set("fromFlock", clean(selectedFlock));
        else next.delete("fromFlock");

        if (clean(swineSearchQ)) next.set("swineCode", clean(swineSearchQ));
        else next.delete("swineCode");

        return next;
      },
      { replace: true }
    );
  }, [
    filterDateFrom,
    filterDateTo,
    selectedFarmCode,
    selectedFlock,
    swineSearchQ,
    setSearchParams,
  ]);

  useEffect(() => {
    saveStepSelection({
      fromFarmCode: selectedFarmCode,
      fromFlock: selectedFlock,
      filterDateFrom,
      filterDateTo,
      swineSearchQ,
    });
  }, [filterDateFrom, filterDateTo, selectedFarmCode, selectedFlock, swineSearchQ]);

  const userCanAccessShipment = useCallback(
    (shipment) => {
      if (isAdmin) return true;
      const farmCode = clean(shipment?.from_farm_code);
      const flock = clean(shipment?.from_flock);
      if (!farmCode || !flock) return false;

      const allowedFlocks = Array.isArray(permissionMap[farmCode]?.flocks)
        ? permissionMap[farmCode].flocks
        : [];
      return allowedFlocks.includes(flock);
    },
    [isAdmin, permissionMap]
  );

  const openDraftShipmentForSwine = useCallback(
    async (shipmentId, swineCode, opts = {}) => {
      const { silent = false } = opts;
      if (!shipmentId || !swineCode) return;

      if (isOffline) {
        if (!silent) {
          setMsg(
            "เปิด shipment ไม่ได้: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
          );
        }
        return;
      }

      setSelectedShipmentId(shipmentId);
      if (!silent) setMsg("");

      try {
        const { data, error } = await supabase
          .from("swine_shipments")
          .select(`
            id,
            shipment_no,
            selected_date,
            delivery_date,
            from_farm_code,
            from_farm_name,
            from_flock,
            to_farm_id,
            remark,
            status,
            created_at,
            updated_at,
            to_farm:master_farms!swine_shipments_to_farm_id_fkey (
              id,
              farm_code,
              farm_name
            ),
            items:swine_shipment_items (
              id,
              selection_no,
              swine_id,
              swine_code,
              teats_left,
              teats_right,
              backfat,
              weight,
              swine:swines!swine_shipment_items_swine_id_fkey (
                id,
                house_no,
                flock,
                birth_date
              )
            )
          `)
          .eq("id", shipmentId)
          .eq("status", "draft")
          .single();

        if (error) throw error;
        if (!data) throw new Error("ไม่พบ shipment");
        if (!userCanAccessShipment(data)) {
          throw new Error("คุณไม่มีสิทธิ์เข้าถึง shipment นี้");
        }

        const item = (data.items || []).find(
          (x) => clean(x.swine_code) === clean(swineCode)
        );
        if (!item) throw new Error("ไม่พบรายการหมูใน shipment นี้");

        setShipmentHeader(data);
        setEditRemark(data.remark || "");
        setEditToFarmId(clean(data.to_farm_id));
        setEditToFarmMeta(data.to_farm || null);
        setEditDeliveryDate(clean(data.delivery_date));

        const draftItemState = {
          id: item.id,
          swine_id: item.swine_id,
          swine_code: clean(item.swine_code),
          selection_no: item.selection_no ?? null,
          house_no: clean(item.swine?.house_no),
          flock: clean(item.swine?.flock),
          birth_date: item.swine?.birth_date || "",
          teats_left: item.teats_left ?? "",
          teats_right: item.teats_right ?? "",
          backfat: item.backfat ?? "",
          weight: item.weight ?? "",
        };

        setSelectedDraftItem(draftItemState);
        setDraftOriginalSnapshot({
          teats_left: draftItemState.teats_left,
          teats_right: draftItemState.teats_right,
          backfat: draftItemState.backfat,
          weight: draftItemState.weight,
          remark: data.remark || "",
          to_farm_id: clean(data.to_farm_id),
          delivery_date: clean(data.delivery_date),
        });
      } catch (e) {
        console.error("openDraftShipmentForSwine error:", e);
        clearDraftEditor();
        if (!silent) {
          setMsg(
            formatActionError(
              "เปิดรายการคัดไม่สำเร็จ",
              e,
              "เปิดรายการคัดไม่สำเร็จ"
            )
          );
        }
      }
    },
    [isOffline, userCanAccessShipment, clearDraftEditor]
  );

  useEffect(() => {
    let alive = true;

    async function loadEditToFarmMeta() {
      if (!editToFarmId) {
        setEditToFarmMeta(null);
        return;
      }

      if (isOffline) {
        if (
          clean(shipmentHeader?.to_farm_id) === clean(editToFarmId) &&
          shipmentHeader?.to_farm
        ) {
          setEditToFarmMeta(shipmentHeader.to_farm);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from("master_farms")
          .select("id, farm_code, farm_name")
          .eq("id", editToFarmId)
          .single();

        if (!alive) return;
        if (error) throw error;
        setEditToFarmMeta(data || null);
      } catch (e) {
        console.error("loadEditToFarmMeta error:", e);
        if (alive) {
          setEditToFarmMeta(null);
          setMsg(
            formatActionError(
              "โหลดข้อมูลฟาร์มปลายทางไม่สำเร็จ",
              e,
              "โหลดข้อมูลฟาร์มปลายทางไม่สำเร็จ"
            )
          );
        }
      }
    }

    void loadEditToFarmMeta();
    return () => {
      alive = false;
    };
  }, [editToFarmId, isOffline, shipmentHeader]);

  const runSwineSearch = useCallback(
    async (queryText) => {
      const q = clean(queryText);

      if (
        !q ||
        isOffline ||
        !selectedFarmCode ||
        !selectedFlock ||
        !filterDateFrom ||
        !filterDateTo ||
        dateRangeInvalid
      ) {
        setSwineSearchLoading(false);
        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("idle");
        return;
      }

      const requestId = ++searchRequestRef.current;
      setSwineSearchLoading(true);

      try {
        let shipmentQuery = supabase
          .from("swine_shipments")
          .select(
            "id, shipment_no, selected_date, created_at, from_farm_code, from_farm_name, from_flock, status"
          )
          .eq("status", "draft")
          .eq("from_farm_code", selectedFarmCode)
          .eq("from_flock", selectedFlock)
          .order("selected_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5000);

        shipmentQuery = applySelectedDateRange(
          shipmentQuery,
          filterDateFrom,
          filterDateTo
        );

        const { data: shipmentRows, error: shipmentError } = await shipmentQuery;
        if (shipmentError) throw shipmentError;
        if (requestId !== searchRequestRef.current) return;

        const shipmentList = shipmentRows || [];
        const shipmentMap = new Map(
          shipmentList.map((row) => [clean(row.id), row])
        );
        const shipmentIds = shipmentList.map((row) => row.id).filter(Boolean);

        if (shipmentIds.length > 0) {
          const { data: itemRowsResult, error: itemError } = await supabase
            .from("swine_shipment_items")
            .select(`
              id,
              swine_id,
              swine_code,
              shipment_id,
              swine:swines!swine_shipment_items_swine_id_fkey (
                id,
                house_no
              )
            `)
            .in("shipment_id", shipmentIds)
            .ilike("swine_code", `%${q}%`)
            .order("swine_code", { ascending: true })
            .limit(200);

          if (itemError) throw itemError;
          if (requestId !== searchRequestRef.current) return;

          const resultMap = new Map();

          for (const row of itemRowsResult || []) {
            const swineCode = clean(row?.swine_code);
            const shipmentId = clean(row?.shipment_id);
            const shipment = shipmentMap.get(shipmentId);
            if (!swineCode || !shipment) continue;

            if (!resultMap.has(swineCode)) {
              resultMap.set(swineCode, {
                key: `draft:${swineCode}`,
                source_type: "draft",
                swine_id: row?.swine_id || "",
                swine_code: swineCode,
                house_no: clean(row?.swine?.house_no),
                draft_matches: [],
              });
            }

            const entry = resultMap.get(swineCode);
            const exists = entry.draft_matches.some(
              (x) => clean(x.shipment_id) === shipmentId
            );

            if (!exists) {
              entry.draft_matches.push({
                shipment_id: shipmentId,
                shipment_no: clean(shipment?.shipment_no),
                selected_date: clean(shipment?.selected_date),
                created_at: clean(shipment?.created_at),
              });
            }
          }

          const draftResults = Array.from(resultMap.values())
            .map((row) => ({
              ...row,
              draft_match_count: row.draft_matches.length,
            }))
            .sort((a, b) =>
              String(a.swine_code).localeCompare(String(b.swine_code), "th")
            );

          if (draftResults.length > 0) {
            setSwineSearchResults(draftResults);
            setSelectedSwineResultKey((prev) => {
              const exists = draftResults.some(
                (row) => clean(row?.key) === clean(prev)
              );
              return exists ? prev : "";
            });
            setSwineSearchMode("draft");
            return;
          }
        }

        const { data: swineRows, error: swineError } = await supabase
          .from("swines")
          .select("id, swine_code, house_no, farm_code, flock, birth_date")
          .eq("farm_code", selectedFarmCode)
          .eq("flock", selectedFlock)
          .ilike("swine_code", `%${q}%`)
          .order("swine_code", { ascending: true })
          .limit(200);

        if (swineError) throw swineError;
        if (requestId !== searchRequestRef.current) return;

        const candidateRows = swineRows || [];
        const candidateCodes = candidateRows
          .map((row) => clean(row?.swine_code))
          .filter(Boolean);

        if (candidateCodes.length > 0) {
          const { data: masterRows, error: masterError } = await supabase
            .from("swine_master")
            .select("swine_code")
            .eq("delivery_state", "available")
            .in("swine_code", candidateCodes);

          if (masterError) throw masterError;
          if (requestId !== searchRequestRef.current) return;

          const availableCodeSet = new Set(
            (masterRows || []).map((row) => clean(row?.swine_code)).filter(Boolean)
          );

          const availableResults = candidateRows
            .filter((row) => availableCodeSet.has(clean(row?.swine_code)))
            .map((row) => ({
              key: `available:${clean(row?.id) || clean(row?.swine_code)}`,
              source_type: "available",
              swine_id: row?.id || "",
              swine_code: clean(row?.swine_code),
              house_no: clean(row?.house_no),
              flock: clean(row?.flock),
              birth_date: row?.birth_date || "",
              draft_matches: [],
              draft_match_count: 0,
            }))
            .sort((a, b) =>
              String(a.swine_code).localeCompare(String(b.swine_code), "th")
            );

          if (availableResults.length > 0) {
            setSwineSearchResults(availableResults);
            setSelectedSwineResultKey((prev) => {
              const exists = availableResults.some(
                (row) => clean(row?.key) === clean(prev)
              );
              return exists ? prev : "";
            });
            setSwineSearchMode("available");
            return;
          }
        }

        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("none");
      } catch (e) {
        if (requestId !== searchRequestRef.current) return;
        console.error("runSwineSearch error:", e);
        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("none");
        setMsg(
          formatActionError(
            "ค้นหาเบอร์หมูไม่สำเร็จ",
            e,
            "ค้นหาเบอร์หมูไม่สำเร็จ"
          )
        );
      } finally {
        if (requestId === searchRequestRef.current) {
          setSwineSearchLoading(false);
        }
      }
    },
    [
      dateRangeInvalid,
      filterDateFrom,
      filterDateTo,
      isOffline,
      selectedFarmCode,
      selectedFlock,
    ]
  );

  useEffect(() => {
    const q = clean(swineSearchQ);

    if (!q || !selectedFarmCode || !selectedFlock || dateRangeInvalid) {
      searchRequestRef.current += 1;
      setSwineSearchLoading(false);
      setSwineSearchResults([]);
      setSelectedSwineResultKey("");
      setSwineSearchMode("idle");
      return;
    }

    const timer = setTimeout(() => {
      void runSwineSearch(q);
    }, 250);

    return () => clearTimeout(timer);
  }, [swineSearchQ, runSwineSearch, selectedFarmCode, selectedFlock, dateRangeInvalid]);

  useEffect(() => {
    async function autoOpenSingleDraft() {
      if (!selectedSwineResult) return;
      if (selectedSwineResult.source_type !== "draft") return;
      if ((selectedSwineResult.draft_match_count || 0) !== 1) return;

      const match = selectedSwineResult.draft_matches?.[0];
      if (!match?.shipment_id) return;
      if (
        clean(selectedShipmentId) === clean(match.shipment_id) &&
        clean(selectedDraftItem?.swine_code) === clean(selectedSwineResult.swine_code)
      ) {
        return;
      }

      await openDraftShipmentForSwine(
        match.shipment_id,
        selectedSwineResult.swine_code,
        { silent: true }
      );
    }

    void autoOpenSingleDraft();
  }, [
    selectedSwineResult,
    selectedShipmentId,
    selectedDraftItem?.swine_code,
    openDraftShipmentForSwine,
  ]);

  function resetAfterFilterChange() {
    setSwineSearchQ("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
    setSwineSearchMode("idle");
    clearCurrentSelectionAndEditor();
  }

  function handleDateFromChange(value) {
    setFilterDateFrom(value);
    setSelectedFarmCode("");
    setSelectedFlock("");
    setMsg("");
    resetAfterFilterChange();
  }

  function handleDateToChange(value) {
    setFilterDateTo(value);
    setSelectedFarmCode("");
    setSelectedFlock("");
    setMsg("");
    resetAfterFilterChange();
  }

  function handleFarmChange(value) {
    setSelectedFarmCode(clean(value));
    setSelectedFlock("");
    setMsg("");
    resetAfterFilterChange();
  }

  function handleFlockChange(value) {
    setSelectedFlock(clean(value));
    setMsg("");
    resetAfterFilterChange();
  }

  function handleSearchInputChange(nextValue) {
    const next = nextValue;
    const changed = clean(next) !== clean(swineSearchQ);

    if (changed && !confirmDiscardPendingChanges("ค้นหาใหม่")) {
      return;
    }

    if (changed) {
      clearCurrentSelectionAndEditor();
      setSwineSearchResults([]);
      setSwineSearchMode("idle");
    }

    setSwineSearchQ(next);
    setMsg("");
  }

  function handleSelectSwineResult(row) {
    const nextKey = clean(row?.key);
    if (!nextKey) return;

    const isSwitching = nextKey !== clean(selectedSwineResultKey);
    if (isSwitching && !confirmDiscardPendingChanges("เปิดรายการใหม่")) {
      return;
    }

    clearDraftEditor();
    clearQuickCreateForm();
    setSelectedSwineResultKey(nextKey);
    setMsg("");
  }

  async function handleOpenDraftMatch(shipmentId, swineCode) {
    if (!confirmDiscardPendingChanges("เปิด shipment เดิม")) {
      return;
    }
    await openDraftShipmentForSwine(shipmentId, swineCode);
  }

  async function handleSaveDraftSelectedSwine() {
    if (isOffline) {
      setMsg(
        "บันทึกไม่สำเร็จ: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
      );
      return;
    }

    if (!shipmentHeader?.id || !selectedDraftItem?.id) {
      setMsg("ไม่พบรายการหมูที่ต้องการแก้ไข");
      return;
    }

    if (!clean(editToFarmId)) {
      setMsg("กรุณาเลือกฟาร์มปลายทาง");
      return;
    }

    if (editIsSameFarm) {
      setMsg("ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน");
      return;
    }

    setSavingDraftItem(true);
    setMsg("");

    try {
      const nowIso = new Date().toISOString();

      const headerRes = await withTimeout(
        supabase
          .from("swine_shipments")
          .update({
            to_farm_id: clean(editToFarmId) || null,
            delivery_date: clean(editDeliveryDate) || null,
            remark: clean(editRemark) || null,
            updated_at: nowIso,
          })
          .eq("id", shipmentHeader.id)
          .eq("status", "draft")
          .select("id"),
        15000,
        "update shipment header"
      );

      if (headerRes.error) throw headerRes.error;
      ensureAffectedRows(headerRes.data, "update shipment header");

      const itemRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .update({
            teats_left: toIntOrNull(selectedDraftItem.teats_left),
            teats_right: toIntOrNull(selectedDraftItem.teats_right),
            backfat: toNumOrNull(selectedDraftItem.backfat),
            weight: toNumOrNull(selectedDraftItem.weight),
            updated_at: nowIso,
          })
          .eq("id", selectedDraftItem.id)
          .select("id"),
        15000,
        "update selected swine item"
      );

      if (itemRes.error) throw itemRes.error;
      ensureAffectedRows(itemRes.data, "update selected swine item");

      setMsg("บันทึกข้อมูลสำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      console.error("handleSaveDraftSelectedSwine error:", e);
      setMsg(
        formatActionError(
          "บันทึกรายการหมูไม่สำเร็จ",
          e,
          "บันทึกรายการหมูไม่สำเร็จ"
        )
      );
    } finally {
      setSavingDraftItem(false);
    }
  }

  async function handleDeleteDraftSelectedSwine() {
    if (!shipmentHeader?.id || !selectedDraftItem?.id) {
      setMsg("ไม่พบรายการหมูที่ต้องการลบ");
      return;
    }

    if (
      !window.confirm(`ลบหมู ${selectedDraftItem.swine_code} ออกจาก shipment นี้ใช่หรือไม่`)
    ) {
      return;
    }

    setDeletingDraftItem(true);
    setMsg("");

    try {
      const deleteRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .delete()
          .eq("id", selectedDraftItem.id)
          .select("id"),
        15000,
        "delete selected swine item"
      );

      if (deleteRes.error) throw deleteRes.error;
      ensureAffectedRows(deleteRes.data, "delete selected swine item");

      const releaseRes = await withTimeout(
        supabase
          .from("swine_master")
          .update({
            delivery_state: "available",
            reserved_shipment_id: null,
            reserved_at: null,
            reserved_by: null,
          })
          .eq("swine_code", clean(selectedDraftItem.swine_code))
          .select("swine_code"),
        15000,
        "release swine"
      );

      if (releaseRes.error) throw releaseRes.error;
      ensureAffectedRows(releaseRes.data, "release swine");

      setMsg("ลบหมูออกจาก shipment สำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      console.error("handleDeleteDraftSelectedSwine error:", e);
      setMsg(
        formatActionError(
          "ลบหมูออกจาก shipment ไม่สำเร็จ",
          e,
          "ลบหมูออกจาก shipment ไม่สำเร็จ"
        )
      );
    } finally {
      setDeletingDraftItem(false);
    }
  }

  async function handleCreateQuickShipment() {
    if (isOffline) {
      setMsg(
        "บันทึกไม่สำเร็จ: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
      );
      return;
    }

    if (!selectedSwineResult || selectedSwineResult.source_type !== "available") {
      setMsg("กรุณาเลือกเบอร์หมูที่ยังไม่ได้คัดก่อน");
      return;
    }

    if (!clean(createToFarmId)) {
      setMsg("กรุณาเลือกฟาร์มที่จะส่ง");
      return;
    }

    setCreatingQuickShipment(true);
    setMsg("");

    try {
      const nowIso = new Date().toISOString();

      const headerRes = await withTimeout(
        supabase
          .from("swine_shipments")
          .insert({
            created_by: userId || null,
            created_at: nowIso,
            updated_at: nowIso,
            status: "draft",
            selected_date: today,
            from_farm_code: clean(selectedFarmCode),
            from_farm_name: clean(selectedFarm?.farm_name || selectedFarm?.label),
            from_flock: clean(selectedFlock),
            to_farm_id: clean(createToFarmId),
            source_house_no: clean(selectedSwineResult.house_no) || null,
            remark: null,
            delivery_date: null,
          })
          .select("id")
          .single(),
        15000,
        "create quick shipment header"
      );

      if (headerRes.error) throw headerRes.error;
      const shipmentId = clean(headerRes.data?.id);
      if (!shipmentId) throw new Error("สร้าง shipment ใหม่ไม่สำเร็จ");

      const itemRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .insert({
            shipment_id: shipmentId,
            swine_id: selectedSwineResult.swine_id || null,
            swine_code: clean(selectedSwineResult.swine_code),
            selection_no: 1,
            teats_left: toIntOrNull(createTeatsLeft),
            teats_right: toIntOrNull(createTeatsRight),
            backfat: toNumOrNull(createBackfat),
            weight: toNumOrNull(createWeight),
            updated_at: nowIso,
          })
          .select("id"),
        15000,
        "create quick shipment item"
      );

      if (itemRes.error) throw itemRes.error;
      ensureAffectedRows(itemRes.data, "create quick shipment item");

      const reserveRes = await withTimeout(
        supabase
          .from("swine_master")
          .update({
            delivery_state: "reserved",
            reserved_shipment_id: shipmentId,
            reserved_at: nowIso,
            reserved_by: userId || null,
          })
          .eq("swine_code", clean(selectedSwineResult.swine_code))
          .select("swine_code"),
        15000,
        "reserve swine"
      );

      if (reserveRes.error) throw reserveRes.error;
      ensureAffectedRows(reserveRes.data, "reserve swine");

      setMsg("บันทึกการคัดสำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      console.error("handleCreateQuickShipment error:", e);
      setMsg(
        formatActionError(
          "บันทึกการคัดไม่สำเร็จ",
          e,
          "บันทึกการคัดไม่สำเร็จ"
        )
      );
    } finally {
      setCreatingQuickShipment(false);
    }
  }

  if (pageLoading) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 720, margin: "40px auto" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (bootError && !canUsePage) {
    return (
      <div className="page">
        <div
          className="card"
          style={{
            maxWidth: 720,
            margin: "40px auto",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: "#b91c1c" }}>
            {bootError}
          </div>
          <div className="small" style={{ color: "#666", lineHeight: 1.7 }}>
            เมื่อเชื่อมต่ออินเทอร์เน็ตได้แล้ว ให้ลองโหลดหน้าใหม่อีกครั้ง
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="linkbtn"
              type="button"
              onClick={() => window.location.reload()}
            >
              ลองใหม่
            </button>
            <button className="linkbtn" type="button" onClick={handleBack}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 720, margin: "40px auto" }}>
          ไม่มีสิทธิ์เข้าใช้งาน
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>Edit Shipment</div>
          <div className="small" style={{ wordBreak: "break-word" }}>
            เลือกช่วงวันที่ ฟาร์ม และ flock แล้วค้นหาเบอร์หมูได้เลย
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="linkbtn" type="button" onClick={handleBack}>
            Back
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1000,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        {isOffline ? (
          <div className="card" style={{ padding: 12, ...cardStyle }}>
            <div
              className="small"
              style={{
                color: "#92400e",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
              }}
            >
              {OFFLINE_BANNER_TEXT}
            </div>
          </div>
        ) : null}

        {msg ? (
          <div className="card" style={{ padding: 12, ...cardStyle }}>
            <div
              className="small"
              style={{
                color:
                  msg.includes("สำเร็จ") || msg.includes("✅")
                    ? "#166534"
                    : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>Step 1: เลือกฟาร์มและ flock</div>

          <div
            className="small"
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              padding: 10,
              borderRadius: 10,
              color: "#334155",
              lineHeight: 1.7,
            }}
          >
            {isAdmin
              ? "แสดงเฉพาะฟาร์มที่ยังมี draft ค้างอยู่จริงเท่านั้น"
              : "แสดงเฉพาะฟาร์มที่คุณเกี่ยวข้อง และยังมี draft ค้างอยู่จริงเท่านั้น"}{" "}
            ถ้าฟาร์มใดมีแต่ submitted แล้ว จะไม่แสดงในรายการนี้
          </div>

          {permissionsLoading && !isAdmin ? (
            <div className="small" style={{ color: "#666" }}>
              กำลังโหลดสิทธิ์ฟาร์มของผู้ใช้...
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่เริ่มต้น
              </div>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                style={fullInputStyle}
                disabled={isOffline || isEditingSelectedSwine}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                แสดงผล: {formatDateDisplay(filterDateFrom)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่สิ้นสุด
              </div>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
                style={fullInputStyle}
                disabled={isOffline || isEditingSelectedSwine}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                แสดงผล: {formatDateDisplay(filterDateTo)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์มต้นทาง
              </div>
              <select
                value={selectedFarmCode}
                onChange={(e) => handleFarmChange(e.target.value)}
                disabled={
                  isOffline ||
                  loadingDraftOptions ||
                  !permissionsReady ||
                  !farmOptions.length ||
                  dateRangeInvalid ||
                  isEditingSelectedSwine
                }
                style={fullInputStyle}
              >
                <option value="">
                  {!permissionsReady
                    ? "กำลังโหลดสิทธิ์..."
                    : loadingDraftOptions
                    ? "กำลังโหลด..."
                    : isOffline
                    ? "ออฟไลน์อยู่"
                    : dateRangeInvalid
                    ? "ช่วงวันที่ไม่ถูกต้อง"
                    : farmOptions.length === 0
                    ? "ไม่พบฟาร์มที่ยัง draft"
                    : "เลือกฟาร์มต้นทาง"}
                </option>
                {farmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                Flock ที่ยังไม่ submitted
              </div>

              {flockOptions.length === 1 ? (
                <input
                  readOnly
                  value={flockOptions[0]?.label || "-"}
                  style={{ ...fullInputStyle, background: "#f8fafc" }}
                />
              ) : (
                <select
                  value={selectedFlock}
                  onChange={(e) => handleFlockChange(e.target.value)}
                  disabled={
                    isOffline ||
                    loadingDraftOptions ||
                    !selectedFarmCode ||
                    !flockOptions.length ||
                    dateRangeInvalid ||
                    isEditingSelectedSwine
                  }
                  style={fullInputStyle}
                >
                  <option value="">
                    {!selectedFarmCode
                      ? "เลือกฟาร์มก่อน"
                      : loadingDraftOptions
                      ? "กำลังโหลด..."
                      : flockOptions.length === 0
                      ? "ไม่พบ flock ที่ยัง draft"
                      : "เลือก flock"}
                  </option>
                  {flockOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {dateRangeInvalid ? (
            <div className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
              วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด
            </div>
          ) : null}

          {!loadingDraftOptions &&
          !dateRangeInvalid &&
          filterDateFrom &&
          filterDateTo &&
          farmOptions.length === 0 ? (
            <div className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
              ไม่พบฟาร์มที่ยังมี draft ค้างอยู่ในช่วงวันที่ที่เลือก
            </div>
          ) : null}

          <div
            style={{
              marginTop: 4,
              paddingTop: 12,
              borderTop: "1px solid #e5e7eb",
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 800 }}>Step 2: ค้นหาและเลือกเบอร์หมู</div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ค้นหาเบอร์หมู
              </div>
              <input
                value={swineSearchQ}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder={
                  !selectedFarmCode || !selectedFlock
                    ? "เลือกฟาร์มและ flock ก่อน"
                    : "พิมพ์บางส่วนของเบอร์หมู..."
                }
                style={fullInputStyle}
                disabled={isOffline || !selectedFarmCode || !selectedFlock}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                ค้นหาได้ตลอด หากมีข้อมูลค้างอยู่ ระบบจะถามยืนยันก่อนเปลี่ยนผลค้นหา
              </div>
            </div>

            {swineSearchLoading ? (
              <div className="small" style={{ color: "#666" }}>
                กำลังค้นหา...
              </div>
            ) : clean(swineSearchQ) ? (
              swineSearchMode === "draft" ? (
                <div className="small" style={{ color: "#166534", fontWeight: 700 }}>
                  พบเบอร์หมูที่คัดแล้ว ({swineSearchResults.length}) — ใช้ shipment เดิมเพื่อแก้ไข/ลบออก
                </div>
              ) : swineSearchMode === "available" ? (
                <div className="small" style={{ color: "#92400e", fontWeight: 700 }}>
                  พบเบอร์หมูที่ยังไม่ได้คัด ({swineSearchResults.length}) — จะสร้าง shipment ใหม่เมื่อบันทึก
                </div>
              ) : swineSearchMode === "none" ? (
                <div className="small" style={{ color: "#666" }}>
                  ไม่พบเบอร์หมูตามเงื่อนไขที่เลือก
                </div>
              ) : null
            ) : (
              <div className="small" style={{ color: "#666" }}>
                พิมพ์บางส่วนของเบอร์หมูเพื่อให้รายการแสดงอัตโนมัติ
              </div>
            )}

            {swineSearchResults.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  รายการเบอร์หมูที่พบ ({swineSearchResults.length})
                </div>

                {swineSearchResults.map((row) => {
                  const active = clean(selectedSwineResultKey) === clean(row?.key);
                  const houseText = clean(row?.house_no)
                    ? `โรงเรือน ${clean(row.house_no)}`
                    : "โรงเรือนไม่ระบุ";

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => handleSelectSwineResult(row)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: 12,
                        background: "#fff",
                        cursor: "pointer",
                        ...(active ? selectedCardStyle : null),
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
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                            {row.swine_code} {houseText}
                          </div>
                        </div>

                        <div
                          className="small"
                          style={{
                            color:
                              row.source_type === "draft" ? "#166534" : "#92400e",
                            fontWeight: 700,
                          }}
                        >
                          {row.source_type === "draft" ? "คัดแล้ว" : "ยังไม่ได้คัด"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {selectedSwineResult ? (
          <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
            <div style={{ fontWeight: 800 }}>
              {selectedSwineResult.source_type === "draft"
                ? "แก้ไขรายการที่คัดแล้ว"
                : "สร้าง shipment ใหม่สำหรับหมูที่ยังไม่คัด"}
            </div>

            {selectedSwineResult.source_type === "draft" ? (
              selectedSwineResult.draft_match_count > 1 && !selectedDraftItem ? (
                <>
                  <div className="small" style={{ color: "#666" }}>
                    เบอร์นี้อยู่ในหลาย shipment กรุณาเลือก shipment เดิมที่ต้องการแก้ไขก่อน
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedSwineResult.draft_matches.map((m) => (
                      <div
                        key={m.shipment_id}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          padding: 12,
                          background: "#fff",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          {m.shipment_no || m.shipment_id}
                        </div>
                        <div className="small" style={{ color: "#666" }}>
                          วันคัด: {formatDateDisplay(m.selected_date)}
                        </div>

                        <div>
                          <button
                            className="linkbtn"
                            type="button"
                            onClick={() =>
                              handleOpenDraftMatch(
                                m.shipment_id,
                                selectedSwineResult.swine_code
                              )
                            }
                          >
                            เปิดแก้ไข
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : selectedDraftItem ? (
                <>
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      background: "#fff",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      #{selectedDraftItem.selection_no || "-"} — {selectedDraftItem.swine_code}
                    </div>

                    <div className="small" style={{ color: "#666" }}>
                      House: {selectedDraftItem.house_no || "-"} | Flock:{" "}
                      {selectedDraftItem.flock || "-"} | วันเกิด:{" "}
                      {formatDateDisplay(selectedDraftItem.birth_date)}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 8,
                      }}
                    >
                      <input
                        value={selectedDraftItem.teats_left}
                        onChange={(e) =>
                          setSelectedDraftItem((prev) =>
                            prev ? { ...prev, teats_left: e.target.value } : prev
                          )
                        }
                        placeholder="เต้านมซ้าย"
                        inputMode="numeric"
                        style={smallInputStyle}
                      />
                      <input
                        value={selectedDraftItem.teats_right}
                        onChange={(e) =>
                          setSelectedDraftItem((prev) =>
                            prev ? { ...prev, teats_right: e.target.value } : prev
                          )
                        }
                        placeholder="เต้านมขวา"
                        inputMode="numeric"
                        style={smallInputStyle}
                      />
                      <input
                        value={selectedDraftItem.backfat}
                        onChange={(e) =>
                          setSelectedDraftItem((prev) =>
                            prev ? { ...prev, backfat: e.target.value } : prev
                          )
                        }
                        placeholder="Backfat"
                        inputMode="decimal"
                        style={smallInputStyle}
                      />
                      <input
                        value={selectedDraftItem.weight}
                        onChange={(e) =>
                          setSelectedDraftItem((prev) =>
                            prev ? { ...prev, weight: e.target.value } : prev
                          )
                        }
                        placeholder="น้ำหนัก"
                        inputMode="decimal"
                        style={smallInputStyle}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="linkbtn"
                        type="button"
                        onClick={handleSaveDraftSelectedSwine}
                        disabled={savingDraftItem || deletingDraftItem}
                      >
                        {savingDraftItem ? "กำลังบันทึก..." : "บันทึก"}
                      </button>

                      <button
                        className="linkbtn"
                        type="button"
                        onClick={handleDeleteDraftSelectedSwine}
                        disabled={savingDraftItem || deletingDraftItem}
                      >
                        {deletingDraftItem ? "กำลังลบ..." : "ลบออกจาก shipment"}
                      </button>
                    </div>
                  </div>

                  {shipmentHeader ? (
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: 12,
                        background: "#fff",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>ข้อมูล Shipment เดิม</div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 10,
                        }}
                      >
                        <div>
                          <div
                            className="small"
                            style={{ marginBottom: 6, fontWeight: 700 }}
                          >
                            Shipment
                          </div>
                          <input
                            value={shipmentHeader.shipment_no || shipmentHeader.id || ""}
                            readOnly
                            style={{ ...fullInputStyle, background: "#f8fafc" }}
                          />
                        </div>

                        <div>
                          <div
                            className="small"
                            style={{ marginBottom: 6, fontWeight: 700 }}
                          >
                            วันคัด
                          </div>
                          <input
                            value={formatDateDisplay(shipmentHeader.selected_date)}
                            readOnly
                            style={{ ...fullInputStyle, background: "#f8fafc" }}
                          />
                        </div>

                        <div>
                          <div
                            className="small"
                            style={{ marginBottom: 6, fontWeight: 700 }}
                          >
                            ฟาร์มต้นทาง
                          </div>
                          <input
                            value={
                              shipmentHeader.from_farm_name ||
                              shipmentHeader.from_farm_code ||
                              ""
                            }
                            readOnly
                            style={{ ...fullInputStyle, background: "#f8fafc" }}
                          />
                        </div>

                        <div>
                          <div
                            className="small"
                            style={{ marginBottom: 6, fontWeight: 700 }}
                          >
                            Flock ต้นทาง
                          </div>
                          <input
                            value={shipmentHeader.from_flock || ""}
                            readOnly
                            style={{ ...fullInputStyle, background: "#f8fafc" }}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <FarmPickerInlineAdd
                            label="ฟาร์มปลายทาง"
                            value={editToFarmId}
                            excludeId={null}
                            onChange={(id) => {
                              setMsg("");
                              setEditToFarmId(id || "");
                            }}
                            requireBranch={false}
                          />
                        </div>

                        <div>
                          <div
                            className="small"
                            style={{ marginBottom: 6, fontWeight: 700 }}
                          >
                            วันส่งปลายทาง
                          </div>
                          <input
                            type="date"
                            value={editDeliveryDate}
                            onChange={(e) => setEditDeliveryDate(e.target.value)}
                            style={fullInputStyle}
                          />
                          <div className="small" style={{ marginTop: 6, color: "#666" }}>
                            แสดงผล: {formatDateDisplay(editDeliveryDate)}
                          </div>
                        </div>
                      </div>

                      {editIsSameFarm ? (
                        <div style={{ color: "crimson", fontWeight: 700 }}>
                          ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน
                        </div>
                      ) : null}

                      <div>
                        <div
                          className="small"
                          style={{ marginBottom: 6, fontWeight: 700 }}
                        >
                          หมายเหตุ
                        </div>
                        <textarea
                          value={editRemark}
                          onChange={(e) => setEditRemark(e.target.value)}
                          rows={3}
                          style={{ ...fullInputStyle, resize: "vertical" }}
                          placeholder="ใส่หมายเหตุ (ถ้ามี)"
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="small" style={{ color: "#666" }}>
                  กำลังเปิดข้อมูลที่ต้องแก้ไข...
                </div>
              )
            ) : (
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 800 }}>หัวข้อการคัด</div>

                <div style={{ fontWeight: 800 }}>
                  {selectedSwineResult.swine_code}
                </div>

                <div className="small" style={{ color: "#666" }}>
                  House: {clean(selectedSwineResult.house_no) || "-"} | Flock:{" "}
                  {clean(selectedSwineResult.flock) || clean(selectedFlock) || "-"} |
                  วันเกิด: {formatDateDisplay(selectedSwineResult.birth_date)}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <FarmPickerInlineAdd
                      label="ฟาร์มที่จะส่ง"
                      value={createToFarmId}
                      excludeId={null}
                      onChange={(id) => {
                        setMsg("");
                        setCreateToFarmId(id || "");
                      }}
                      requireBranch={false}
                    />
                  </div>

                  <div>
                    <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                      Shipment date
                    </div>
                    <input
                      readOnly
                      value={today}
                      style={{ ...fullInputStyle, background: "#f8fafc" }}
                    />
                    <div className="small" style={{ marginTop: 6, color: "#666" }}>
                      แสดงผล: {formatDateDisplay(today)}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 8,
                  }}
                >
                  <input
                    value={createTeatsLeft}
                    onChange={(e) => setCreateTeatsLeft(e.target.value)}
                    placeholder="เต้านมซ้าย"
                    inputMode="numeric"
                    style={smallInputStyle}
                  />
                  <input
                    value={createTeatsRight}
                    onChange={(e) => setCreateTeatsRight(e.target.value)}
                    placeholder="เต้านมขวา"
                    inputMode="numeric"
                    style={smallInputStyle}
                  />
                  <input
                    value={createBackfat}
                    onChange={(e) => setCreateBackfat(e.target.value)}
                    placeholder="Backfat"
                    inputMode="decimal"
                    style={smallInputStyle}
                  />
                  <input
                    value={createWeight}
                    onChange={(e) => setCreateWeight(e.target.value)}
                    placeholder="น้ำหนัก"
                    inputMode="decimal"
                    style={smallInputStyle}
                  />
                </div>

                <div>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={handleCreateQuickShipment}
                    disabled={!clean(createToFarmId) || creatingQuickShipment || isOffline}
                  >
                    {creatingQuickShipment ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}