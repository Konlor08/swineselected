// src/pages/EditShipmentPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import { formatDateDisplay } from "../lib/dateFormat";

function clean(s) {
  return String(s ?? "").trim();
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

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

function toMillis(selectedDate, createdAt) {
  const tsCreated = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(tsCreated)) return tsCreated;

  const tsSelected = selectedDate ? Date.parse(selectedDate) : NaN;
  if (Number.isFinite(tsSelected)) return tsSelected;

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

function applySelectedDateRange(query, fromDate, toDate) {
  let q = query;
  const from = clean(fromDate);
  const to = clean(toDate);

  if (from) q = q.gte("selected_date", from);
  if (to) q = q.lte("selected_date", to);

  return q;
}

function readSavedStep1Selection() {
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
    const raw = window.sessionStorage.getItem("editShipmentStep1Selection");
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
      "editShipmentStep1Selection",
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
    // ignore storage errors
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
        shipment_count: 0,
        flock_map: new Map(),
      });
    }

    const farm = farmMap.get(farmCode);
    farm.shipment_count += 1;

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
        flock,
        latest_selected_date: selectedDate,
        latest_created_at: createdAt,
        shipment_count: 0,
      });
    }

    const flockEntry = farm.flock_map.get(flock);
    flockEntry.shipment_count += 1;

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

  const savedSelection = useMemo(() => readSavedStep1Selection(), []);
  const today = todayYmdLocal();

  const initialStepRaw = Number(searchParams.get("step") || 1);
  const initialStep =
    Number.isFinite(initialStepRaw) && initialStepRaw > 2
      ? 3
      : Number.isFinite(initialStepRaw) && initialStepRaw > 1
      ? 2
      : 1;

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
  const [step, setStep] = useState(initialStep);

  const [swineSearchQ, setSwineSearchQ] = useState(initialSwineSearchQ);
  const [swineSearchLoading, setSwineSearchLoading] = useState(false);
  const [swineSearchResults, setSwineSearchResults] = useState([]);
  const [selectedSwineResultKey, setSelectedSwineResultKey] = useState("");

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

  const selectedFlockMeta = useMemo(() => {
    return (
      flockOptions.find((x) => clean(x.value) === clean(selectedFlock)) || null
    );
  }, [flockOptions, selectedFlock]);

  const selectedSwineResult = useMemo(() => {
    return (
      swineSearchResults.find(
        (row) => clean(row?.key) === clean(selectedSwineResultKey)
      ) || null
    );
  }, [swineSearchResults, selectedSwineResultKey]);

  const canContinue =
    !!selectedFarmCode &&
    !!selectedFlock &&
    !!filterDateFrom &&
    !!filterDateTo &&
    !dateRangeInvalid;

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

    const preferredFromQueryOrSave =
      farmOptions.find((x) => clean(x.value) === clean(initialFarmCode)) || null;

    setSelectedFarmCode(
      clean(preferredFromQueryOrSave?.value) || clean(farmOptions[0]?.value)
    );
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

    const preferredFromQueryOrSave =
      flockOptions.find((x) => clean(x.value) === clean(initialFlock)) || null;

    setSelectedFlock(
      clean(preferredFromQueryOrSave?.value) || clean(flockOptions[0]?.value)
    );
  }, [selectedFarmCode, flockOptions, initialFlock, selectedFlock]);

  useEffect(() => {
    if (step > 1 && !canContinue) {
      setStep(1);
    }
  }, [step, canContinue]);

  useEffect(() => {
    if (step > 2 && !selectedSwineResult) {
      setStep(2);
    }
  }, [step, selectedSwineResult]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);

        next.set("step", String(step));

        if (clean(filterDateFrom)) {
          next.set("fromDate", clean(filterDateFrom));
        } else {
          next.delete("fromDate");
        }

        if (clean(filterDateTo)) {
          next.set("toDate", clean(filterDateTo));
        } else {
          next.delete("toDate");
        }

        if (clean(selectedFarmCode)) {
          next.set("fromFarmCode", clean(selectedFarmCode));
        } else {
          next.delete("fromFarmCode");
        }

        if (clean(selectedFlock)) {
          next.set("fromFlock", clean(selectedFlock));
        } else {
          next.delete("fromFlock");
        }

        if (clean(swineSearchQ)) {
          next.set("swineCode", clean(swineSearchQ));
        } else {
          next.delete("swineCode");
        }

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
    step,
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

  function resetStep2State({ keepSearchText = false } = {}) {
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
    setStep((prev) => (prev > 1 ? 2 : prev));
    if (!keepSearchText) {
      setSwineSearchQ("");
    }
  }

  function handleDateFromChange(value) {
    setFilterDateFrom(value);
    setSelectedFarmCode("");
    setSelectedFlock("");
    setStep(1);
    setMsg("");
    setSwineSearchQ("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
  }

  function handleDateToChange(value) {
    setFilterDateTo(value);
    setSelectedFarmCode("");
    setSelectedFlock("");
    setStep(1);
    setMsg("");
    setSwineSearchQ("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
  }

  function handleFarmChange(value) {
    setSelectedFarmCode(clean(value));
    setSelectedFlock("");
    setMsg("");
    setStep(1);
    setSwineSearchQ("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
  }

  function handleFlockChange(value) {
    setSelectedFlock(clean(value));
    setMsg("");
    setStep(1);
    setSwineSearchQ("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");
  }

  function handleGoNext() {
    if (!filterDateFrom || !filterDateTo) {
      setMsg("กรุณาเลือกช่วงวันที่");
      return;
    }

    if (dateRangeInvalid) {
      setMsg("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
      return;
    }

    if (!selectedFarmCode) {
      setMsg("กรุณาเลือกฟาร์ม");
      return;
    }

    if (!selectedFlock) {
      setMsg("กรุณาเลือก flock");
      return;
    }

    setMsg("");
    setStep(2);
  }

  function handleBackToStep1() {
    setStep(1);
    setMsg("");
  }

  async function handleSearchSwine() {
    if (isOffline) {
      setMsg(
        "ค้นหาเบอร์หมูไม่ได้: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
      );
      return;
    }

    if (!filterDateFrom || !filterDateTo) {
      setMsg("กรุณาเลือกช่วงวันที่ก่อน");
      return;
    }

    if (dateRangeInvalid) {
      setMsg("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
      return;
    }

    if (!selectedFarmCode || !selectedFlock) {
      setMsg("กรุณาเลือกฟาร์มและ flock ก่อน");
      return;
    }

    const q = clean(swineSearchQ);
    if (!q) {
      setMsg("กรุณาพิมพ์เบอร์หมูที่ต้องการค้นหา");
      return;
    }

    setSwineSearchLoading(true);
    setMsg("");
    setSwineSearchResults([]);
    setSelectedSwineResultKey("");

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

      const shipmentList = shipmentRows || [];
      const shipmentMap = new Map(
        shipmentList.map((row) => [clean(row.id), row])
      );

      const shipmentIds = shipmentList.map((row) => row.id).filter(Boolean);

      if (shipmentIds.length > 0) {
        const { data: itemRows, error: itemError } = await supabase
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

        const resultMap = new Map();

        for (const row of itemRows || []) {
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
          setMsg(`พบเบอร์หมูใน draft จำนวน ${draftResults.length} รายการ`);
          return;
        }
      }

      const { data: swineRows, error: swineError } = await supabase
        .from("swines")
        .select("id, swine_code, house_no, farm_code, flock")
        .eq("farm_code", selectedFarmCode)
        .eq("flock", selectedFlock)
        .ilike("swine_code", `%${q}%`)
        .order("swine_code", { ascending: true })
        .limit(200);

      if (swineError) throw swineError;

      const candidateRows = swineRows || [];
      const candidateCodes = candidateRows.map((row) => clean(row?.swine_code)).filter(Boolean);

      if (candidateCodes.length > 0) {
        const { data: masterRows, error: masterError } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .in("swine_code", candidateCodes);

        if (masterError) throw masterError;

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
            draft_matches: [],
            draft_match_count: 0,
          }))
          .sort((a, b) =>
            String(a.swine_code).localeCompare(String(b.swine_code), "th")
          );

        if (availableResults.length > 0) {
          setSwineSearchResults(availableResults);
          setMsg(
            `ไม่พบใน draft แต่พบเบอร์หมูที่ยัง available จำนวน ${availableResults.length} รายการ`
          );
          return;
        }
      }

      setSwineSearchResults([]);
      setMsg("ไม่พบเบอร์หมูตามเงื่อนไขที่เลือก");
    } catch (e) {
      console.error("handleSearchSwine error:", e);
      setSwineSearchResults([]);
      setSelectedSwineResultKey("");
      setMsg(
        formatActionError(
          "ค้นหาเบอร์หมูไม่สำเร็จ",
          e,
          "ค้นหาเบอร์หมูไม่สำเร็จ"
        )
      );
    } finally {
      setSwineSearchLoading(false);
    }
  }

  function handleSelectSwineResult(row) {
    setSelectedSwineResultKey(clean(row?.key));

    if (row?.source_type === "draft") {
      setMsg(`เลือกเบอร์หมู ${clean(row?.swine_code)} แล้ว`);
      return;
    }

    if (row?.source_type === "available") {
      setMsg(
        `เลือกเบอร์หมู ${clean(
          row?.swine_code
        )} แล้ว | ไม่พบใน draft แต่เบอร์นี้ยัง available`
      );
      return;
    }

    setMsg(`เลือกเบอร์หมู ${clean(row?.swine_code)} แล้ว`);
  }

  function handleGoToStep3() {
    if (!selectedSwineResult) {
      setMsg("กรุณาเลือกเบอร์หมูก่อน");
      return;
    }

    setStep(3);
    setMsg("");
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            Edit Shipment
          </div>
          <div className="small" style={{ wordBreak: "break-word" }}>
            Step 1 เลือกช่วงวันที่ ฟาร์ม และ flock | Step 2 ค้นหาและเลือกเบอร์หมู
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
                color: msg.includes("✅") ? "#166534" : "#b91c1c",
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 800 }}>Step 1: เลือกฟาร์มและ flock</div>
            <div className="small" style={{ color: "#666" }}>
              Step ปัจจุบัน: <b>{step}</b>
            </div>
          </div>

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
                disabled={isOffline}
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
                disabled={isOffline}
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
                  dateRangeInvalid
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
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                ระบบจะ default เป็นฟาร์มล่าสุดที่ยังมี draft ในช่วงวันที่ที่เลือก
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                Flock ที่ยังไม่ submitted
              </div>

              {flockOptions.length === 1 ? (
                <>
                  <input
                    readOnly
                    value={flockOptions[0]?.label || "-"}
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                  <div className="small" style={{ marginTop: 6, color: "#166534" }}>
                    ฟาร์มนี้มี flock ที่ยัง draft อยู่เพียง 1 flock ระบบเลือกให้อัตโนมัติ
                  </div>
                </>
              ) : (
                <>
                  <select
                    value={selectedFlock}
                    onChange={(e) => handleFlockChange(e.target.value)}
                    disabled={
                      isOffline ||
                      loadingDraftOptions ||
                      !selectedFarmCode ||
                      !flockOptions.length ||
                      dateRangeInvalid
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
                  <div className="small" style={{ marginTop: 6, color: "#666" }}>
                    ระบบจะ default เป็น flock ล่าสุดของฟาร์มนี้ที่ยังมี draft
                  </div>
                </>
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

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="linkbtn"
              type="button"
              onClick={handleGoNext}
              disabled={!canContinue || isOffline}
            >
              ไป Step 2
            </button>
          </div>
        </div>

        {step >= 2 ? (
          <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 800 }}>Step 2: ค้นหาและเลือกเบอร์หมู</div>
              <div className="small" style={{ color: "#666" }}>
                เลือกเบอร์หมูก่อนทุกครั้ง แม้จะเจอเพียง 1 รายการ
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                  ช่วงวันที่
                </div>
                <input
                  readOnly
                  value={`${formatDateDisplay(filterDateFrom)} ถึง ${formatDateDisplay(
                    filterDateTo
                  )}`}
                  style={{ ...fullInputStyle, background: "#f8fafc" }}
                />
              </div>

              <div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                  ฟาร์ม
                </div>
                <input
                  readOnly
                  value={selectedFarm?.label || "-"}
                  style={{ ...fullInputStyle, background: "#f8fafc" }}
                />
              </div>

              <div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                  Flock
                </div>
                <input
                  readOnly
                  value={selectedFlockMeta?.label || "-"}
                  style={{ ...fullInputStyle, background: "#f8fafc" }}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(240px, 1fr) auto auto",
                gap: 10,
                alignItems: "end",
              }}
            >
              <div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                  ค้นหาเบอร์หมู
                </div>
                <input
                  value={swineSearchQ}
                  onChange={(e) => {
                    setSwineSearchQ(e.target.value);
                    setSelectedSwineResultKey("");
                  }}
                  placeholder="พิมพ์บางส่วนของเบอร์หมู..."
                  style={fullInputStyle}
                  disabled={isOffline}
                />
              </div>

              <button
                className="linkbtn"
                type="button"
                onClick={handleSearchSwine}
                disabled={isOffline || swineSearchLoading || !clean(swineSearchQ)}
              >
                {swineSearchLoading ? "กำลังค้นหา..." : "ค้นหา"}
              </button>

              <button
                className="linkbtn"
                type="button"
                onClick={() => {
                  setSwineSearchQ("");
                  setSwineSearchResults([]);
                  setSelectedSwineResultKey("");
                  setMsg("");
                }}
                disabled={isOffline || swineSearchLoading}
              >
                ล้าง
              </button>
            </div>

            {swineSearchResults.length === 0 ? (
              <div className="small" style={{ color: "#666" }}>
                {clean(swineSearchQ)
                  ? "ยังไม่มีรายการให้เลือก"
                  : "พิมพ์บางส่วนของเบอร์หมู แล้วกดค้นหา"}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  รายการเบอร์หมูที่พบ ({swineSearchResults.length})
                </div>

                {swineSearchResults.map((row) => {
                  const active = clean(selectedSwineResultKey) === clean(row?.key);

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
                            {row.swine_code}
                          </div>
                          <div
                            className="small"
                            style={{ marginTop: 6, color: "#666" }}
                          >
                            House: <b>{row.house_no || "-"}</b>
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
                          {row.source_type === "draft"
                            ? "พบใน draft"
                            : "available"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSwineResult ? (
              <div
                style={{
                  border: "1px solid #dbeafe",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f8fbff",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 800 }}>เบอร์หมูที่เลือก</div>
                <div>
                  <b>{selectedSwineResult.swine_code}</b> | House:{" "}
                  <b>{selectedSwineResult.house_no || "-"}</b>
                </div>

                <div className="small" style={{ color: "#555", lineHeight: 1.7 }}>
                  {selectedSwineResult.source_type === "draft"
                    ? selectedSwineResult.draft_match_count > 1
                      ? `เบอร์นี้พบใน draft จำนวน ${selectedSwineResult.draft_match_count} รายการ`
                      : "เบอร์นี้พบใน draft จำนวน 1 รายการ"
                    : "ไม่พบใน draft แต่เบอร์นี้ยัง available"}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={handleGoToStep3}
                  >
                    ไป Step ถัดไป
                  </button>

                  <button
                    className="linkbtn"
                    type="button"
                    onClick={handleBackToStep1}
                  >
                    กลับไป Step 1
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={handleBackToStep1}
                >
                  กลับไป Step 1
                </button>
              </div>
            )}
          </div>
        ) : null}

        {step >= 3 && selectedSwineResult ? (
          <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
            <div style={{ fontWeight: 800 }}>Step 3 (เตรียมโครงไว้แล้ว)</div>

            <div
              className="small"
              style={{
                lineHeight: 1.8,
                color: "#334155",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: 12,
              }}
            >
              ตอนนี้ระบบมีข้อมูลครบสำหรับทำขั้นถัดไปแล้ว
              <br />
              เบอร์หมูที่เลือก: <b>{selectedSwineResult.swine_code}</b> | House:{" "}
              <b>{selectedSwineResult.house_no || "-"}</b>
              <br />
              สถานะผลค้นหา:{" "}
              <b>
                {selectedSwineResult.source_type === "draft"
                  ? "พบใน draft"
                  : "available"}
              </b>
            </div>

            {selectedSwineResult.source_type === "draft" ? (
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fff",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 800 }}>
                  Draft ที่เกี่ยวข้อง ({selectedSwineResult.draft_match_count})
                </div>

                {selectedSwineResult.draft_matches.map((m) => (
                  <div
                    key={m.shipment_id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {m.shipment_no || m.shipment_id}
                    </div>
                    <div className="small" style={{ marginTop: 6, color: "#666" }}>
                      วันคัด: {formatDateDisplay(m.selected_date)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #fde68a",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fffbeb",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 800 }}>
                  เบอร์นี้ไม่พบใน draft แต่ยัง available
                </div>
                <div className="small" style={{ color: "#555", lineHeight: 1.7 }}>
                  รอบถัดไปจะต่อส่วนเลือกฟาร์มปลายทางจาก master_farms
                  และสร้าง shipment ใหม่ให้จากเบอร์หมูตัวนี้
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="linkbtn"
                type="button"
                onClick={() => setStep(2)}
              >
                กลับไป Step 2
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}