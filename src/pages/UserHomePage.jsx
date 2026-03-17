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

const DEBUG = true;

function dlog(label, payload) {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[UserHomePage][${ts}] ${label}`);
  } else {
    console.log(`[UserHomePage][${ts}] ${label}`, payload);
  }
}

function derr(label, error, extra) {
  const ts = new Date().toISOString();
  console.error(`[UserHomePage][${ts}] ${label}`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    raw: error,
    ...(extra || {}),
  });
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
    dlog("component mounted");
    return () => {
      dlog("component unmounted");
    };
  }, []);

  useEffect(() => {
    dlog("state:selectedDate changed", { selectedDate });
  }, [selectedDate]);

  useEffect(() => {
    dlog("state:current shipment changed", {
      currentShipmentId,
      currentStatus,
    });
  }, [currentShipmentId, currentStatus]);

  useEffect(() => {
    dlog("state:fromFarm changed", { fromFarm });
  }, [fromFarm]);

  useEffect(() => {
    dlog("state:selectedHouse changed", { selectedHouse });
  }, [selectedHouse]);

  useEffect(() => {
    dlog("state:toFarm changed", { toFarmId, selectedToFarmId });
  }, [toFarmId, selectedToFarmId]);

  useEffect(() => {
    dlog("state:selected swines changed", {
      selectedCount: selectedSwineIds.size,
      selectedIds: Array.from(selectedSwineIds),
    });
  }, [selectedSwineIds]);

  useEffect(() => {
    dlog("state:swineForm changed", swineForm);
  }, [swineForm]);

  useEffect(() => {
    let alive = true;

    async function loadMyRole() {
      dlog("loadMyRole:start");
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const uid = data?.session?.user?.id;
        dlog("loadMyRole:session", {
          hasSession: !!data?.session,
          uid,
        });

        if (!uid) return;

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        dlog("loadMyRole:profile", profile);
        setMyRole(String(profile?.role || "user").toLowerCase());
      } catch (e) {
        derr("loadMyRole error", e);
      }
    }

    loadMyRole();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    dlog("role check", { myRole });
    if (myRole === "admin") {
      dlog("redirect to /admin");
      nav("/admin", { replace: true });
    }
  }, [myRole, nav]);

  useEffect(() => {
    let alive = true;

    async function loadFromFarms() {
      dlog("loadFromFarms:start");
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

        dlog("loadFromFarms:raw rows", {
          count: data?.length || 0,
          sample: (data || []).slice(0, 5),
        });

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

        dlog("loadFromFarms:deduped result", {
          count: arr.length,
          sample: arr.slice(0, 10),
        });

        if (alive) setFromOptions(arr);
      } catch (e) {
        derr("loadFromFarms error", e);
        if (alive) {
          setFromOptions([]);
          setMsg(e?.message || "โหลดฟาร์มต้นทางจาก swines ไม่สำเร็จ");
        }
      } finally {
        if (alive) setFromLoading(false);
        dlog("loadFromFarms:finish");
      }
    }

    loadFromFarms();
    return () => {
      alive = false;
    };
  }, []);

  const filteredFromOptions = useMemo(() => {
    const q = clean(fromQ).toLowerCase();
    const result = !q
      ? fromOptions.slice(0, 12)
      : fromOptions
          .filter((x) =>
            `${x.farm_code} ${x.farm_name}`.toLowerCase().includes(q)
          )
          .slice(0, 12);

    return result;
  }, [fromOptions, fromQ]);

  useEffect(() => {
    dlog("filteredFromOptions recalculated", {
      fromQ,
      totalFromOptions: fromOptions.length,
      filteredCount: filteredFromOptions.length,
      sample: filteredFromOptions.slice(0, 5),
    });
  }, [fromQ, fromOptions, filteredFromOptions]);

  async function fetchAvailableCodes(codes) {
    const availableSet = new Set();
    const normalizedCodes = (codes || []).map(clean).filter(Boolean);

    dlog("fetchAvailableCodes:start", {
      inputCount: codes?.length || 0,
      normalizedCount: normalizedCodes.length,
      sample: normalizedCodes.slice(0, 20),
    });

    if (!normalizedCodes.length) {
      dlog("fetchAvailableCodes:empty input");
      return availableSet;
    }

    const codeChunks = chunkArray(normalizedCodes, 500);

    dlog("fetchAvailableCodes:chunked", {
      chunkCount: codeChunks.length,
      chunkSizes: codeChunks.map((x) => x.length),
    });

    for (let i = 0; i < codeChunks.length; i += 1) {
      const chunk = codeChunks[i];
      dlog("fetchAvailableCodes:query chunk", {
        chunkIndex: i,
        size: chunk.length,
        sample: chunk.slice(0, 10),
      });

      const { data: availableRows, error } = await supabase
        .from("swine_master")
        .select("swine_code")
        .eq("delivery_state", "available")
        .in("swine_code", chunk);

      if (error) throw error;

      dlog("fetchAvailableCodes:query result", {
        chunkIndex: i,
        returnedCount: availableRows?.length || 0,
        sample: (availableRows || []).slice(0, 10),
      });

      for (const row of availableRows || []) {
        const code = clean(row?.swine_code);
        if (code) {
          availableSet.add(code);
        }
      }
    }

    dlog("fetchAvailableCodes:done", {
      availableCount: availableSet.size,
      sample: Array.from(availableSet).slice(0, 20),
    });

    return availableSet;
  }

  async function fetchFarmSwinesWithAvailability(farmCode) {
    const farmCodeClean = clean(farmCode);

    dlog("fetchFarmSwinesWithAvailability:start", { farmCode: farmCodeClean });

    const { data: farmSwines, error: e1 } = await supabase
      .from("swines")
      .select("id, swine_code, farm_code, house_no")
      .eq("farm_code", farmCodeClean)
      .order("house_no", { ascending: true })
      .order("swine_code", { ascending: true })
      .limit(5000);

    if (e1) throw e1;

    dlog("fetchFarmSwinesWithAvailability:swines raw", {
      farmCode: farmCodeClean,
      count: farmSwines?.length || 0,
      sample: (farmSwines || []).slice(0, 20),
    });

    const swines = (farmSwines || []).map(normalizeSwineRow);
    const codes = swines.map((x) => x.swine_code).filter(Boolean);
    const availableSet = await fetchAvailableCodes(codes);

    dlog("fetchFarmSwinesWithAvailability:done", {
      farmCode: farmCodeClean,
      swinesCount: swines.length,
      codesCount: codes.length,
      availableCount: availableSet.size,
      swinesSample: swines.slice(0, 20),
      availableSample: Array.from(availableSet).slice(0, 20),
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

    dlog("reloadSwinesOfFarm:start", {
      farmCode,
      opts,
      currentSelectedHouse: selectedHouse,
      currentSelectedCount: selectedSwineIds.size,
    });

    if (clearMessage) setMsg("");

    if (!farmCode) {
      dlog("reloadSwinesOfFarm:no farmCode -> reset state");
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

      dlog("reloadSwinesOfFarm:fetched", {
        farmCode,
        swinesCount: swines.length,
        availableCount: availableSet.size,
      });

      setSwineOptions(swines);
      setAvailableSwineCodeSet(availableSet);
      setDirectSearchResults([]);

      if (!preserveHouse) {
        dlog("reloadSwinesOfFarm:clear selectedHouse because preserveHouse=false");
        setSelectedHouse("");
      } else {
        const houseValueSet = new Set(
          (swines || []).map((s) => clean(s.house_no) || "__BLANK__")
        );

        setSelectedHouse((prev) => {
          const next = !prev ? prev : houseValueSet.has(prev) ? prev : "";
          dlog("reloadSwinesOfFarm:preserve house decision", {
            previousHouse: prev,
            houseExists: houseValueSet.has(prev),
            nextHouse: next,
          });
          return next;
        });
      }

      if (clearPicked) {
        dlog("reloadSwinesOfFarm:clear picked selection");
        setSelectedSwineIds(new Set());
        setSelectedSwineMap({});
        setSwineForm({});
        setInvalidSwineIds(new Set());
      }

      if (clearSearch) {
        dlog("reloadSwinesOfFarm:clear search text");
        setSwineQ("");
      }
    } catch (e) {
      derr("reloadSwinesOfFarm error", e, { farmCode, opts });
      setSwineOptions([]);
      setAvailableSwineCodeSet(new Set());
      setDirectSearchResults([]);
      setMsg(e?.message || "โหลดรายการหมูไม่สำเร็จ");
    } finally {
      setSwineLoading(false);
      dlog("reloadSwinesOfFarm:finish", { farmCode });
    }
  }

  useEffect(() => {
    dlog("effect fromFarm.farm_code changed", {
      farmCode: fromFarm?.farm_code || null,
    });

    if (!fromFarm?.farm_code) {
      dlog("effect fromFarm empty -> reset swine-related state");
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

      dlog("runDirectSearch:trigger", {
        farmCode,
        house,
        q,
      });

      if (!farmCode || !house || !q) {
        dlog("runDirectSearch:skip because missing farmCode/house/q", {
          farmCode,
          house,
          q,
        });
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

        dlog("runDirectSearch:query prepared", {
          farmCode,
          house,
          q,
        });

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map(normalizeSwineRow);
        const codes = rows.map((x) => x.swine_code).filter(Boolean);
        const availableSet = await fetchAvailableCodes(codes);
        const availableRows = rows.filter((r) => availableSet.has(clean(r.swine_code)));

        dlog("runDirectSearch:result", {
          farmCode,
          house,
          q,
          rawCount: rows.length,
          availableCount: availableRows.length,
          rawSample: rows.slice(0, 20),
          availableSample: availableRows.slice(0, 20),
        });

        if (alive) {
          setDirectSearchResults(availableRows);
        }
      } catch (e) {
        derr("runDirectSearch error", e, {
          farmCode,
          house,
          q,
        });
        if (alive) {
          setDirectSearchResults([]);
        }
      } finally {
        if (alive) {
          setSwineSearchLoading(false);
        }
        dlog("runDirectSearch:finish", {
          farmCode,
          house,
          q,
        });
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

  useEffect(() => {
    dlog("houseOptions recalculated", {
      swineOptionsCount: swineOptions.length,
      houseCount: houseOptions.length,
      houseOptions,
    });
  }, [swineOptions, houseOptions]);

  const filteredSwines = useMemo(() => {
    if (!selectedHouse) return [];

    const q = clean(swineQ).toLowerCase();

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

  useEffect(() => {
    dlog("filteredSwines recalculated", {
      selectedHouse,
      swineQ,
      swineOptionsCount: swineOptions.length,
      availableCount: availableSwineCodeSet.size,
      directSearchCount: directSearchResults.length,
      filteredCount: filteredSwines.length,
      filteredSample: filteredSwines.slice(0, 20),
    });
  }, [
    selectedHouse,
    swineQ,
    swineOptions,
    availableSwineCodeSet,
    directSearchResults,
    filteredSwines,
  ]);

  const swineSourceMap = useMemo(() => {
    const map = new Map();
    for (const s of [...(swineOptions || []), ...(directSearchResults || [])]) {
      if (s?.id) map.set(s.id, s);
    }
    return map;
  }, [swineOptions, directSearchResults]);

  useEffect(() => {
    dlog("swineSourceMap recalculated", {
      size: swineSourceMap.size,
    });
  }, [swineSourceMap]);

  const handleSelectFromFarm = useCallback((farm) => {
    dlog("handleSelectFromFarm", { farm });
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
    dlog("handleHouseChange", {
      previousHouse: selectedHouse,
      nextHouse: value,
    });
    setSelectedHouse(value);
    setSwineQ("");
    setDirectSearchResults([]);
    setSelectedSwineIds(new Set());
    setSelectedSwineMap({});
    setSwineForm({});
    setInvalidSwineIds(new Set());
    setMsg("");
  }, [selectedHouse]);

  const toggleSwine = useCallback((swineRow) => {
    const id = swineRow?.id;
    if (!id) {
      dlog("toggleSwine:skip because no id", { swineRow });
      return;
    }

    dlog("toggleSwine:clicked", {
      swineRow,
    });

    setSelectedSwineIds((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(id);

      if (wasSelected) {
        next.delete(id);
      } else {
        next.add(id);
        setSwineForm((pf) => {
          const nextForm = pf[id] ? pf : { ...pf, [id]: pf[id] || {} };
          dlog("toggleSwine:init swineForm if needed", {
            swineId: id,
            existing: !!pf[id],
            nextFormForSwine: nextForm[id] || {},
          });
          return nextForm;
        });
      }

      dlog("toggleSwine:selectedSwineIds updated", {
        swineId: id,
        wasSelected,
        nextSelectedIds: Array.from(next),
      });

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

      dlog("toggleSwine:selectedSwineMap updated", {
        swineId: id,
        nextSelectedSwine: next[id] || null,
        nextMapSize: Object.keys(next).length,
      });

      return next;
    });

    setInvalidSwineIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      dlog("toggleSwine:remove invalid mark", {
        swineId: id,
      });
      return next;
    });
  }, []);

  const setSwineField = useCallback((swine_id, field, value) => {
    dlog("setSwineField", {
      swine_id,
      field,
      value,
      intPreview: toIntOrNull(value),
      numPreview: toNumOrNull(value),
    });

    setSwineForm((prev) => {
      const cur = prev[swine_id] || {};
      const next = { ...prev, [swine_id]: { ...cur, [field]: value } };

      dlog("setSwineField:next row form", {
        swine_id,
        nextRow: next[swine_id],
      });

      return next;
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

  useEffect(() => {
    dlog("canSave recalculated", {
      canSave,
      selectedDate,
      fromFarmCode: fromFarm?.farm_code || null,
      selectedToFarmId,
      selectedHouse,
      selectedCount: selectedSwineIds.size,
    });
  }, [canSave, selectedDate, fromFarm, selectedToFarmId, selectedHouse, selectedSwineIds]);

  const buildSavePreviewRows = useCallback(() => {
    const selectedIds = Array.from(selectedSwineIds);

    const rows = selectedIds.map((swine_id, index) => {
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

    dlog("buildSavePreviewRows", {
      selectedIds,
      rows,
    });

    return rows;
  }, [selectedSwineIds, selectedSwineMap, swineSourceMap]);

  const previewSummary = useMemo(() => {
    const total = savePreviewRows.length;
    const valid = savePreviewRows.filter((x) => x.ok).length;
    const invalid = total - valid;
    return { total, valid, invalid };
  }, [savePreviewRows]);

  useEffect(() => {
    dlog("previewSummary recalculated", {
      previewSummary,
      savePreviewRows,
    });
  }, [previewSummary, savePreviewRows]);

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
    dlog("openSavePreview:start", {
      canSave,
      selectedDate,
      fromFarm,
      selectedToFarmId,
      selectedHouse,
      selectedCount: selectedSwineIds.size,
      selectedIds: Array.from(selectedSwineIds),
      selectedSwineMap,
      swineForm,
    });

    if (!canSave) {
      dlog("openSavePreview:block because canSave=false");
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + House + หมูอย่างน้อย 1 ตัว");
      return;
    }

    const rows = buildSavePreviewRows();
    const invalidSet = new Set(rows.filter((x) => !x.ok).map((x) => x.swine_id));

    dlog("openSavePreview:rows built", {
      rows,
      invalidIds: Array.from(invalidSet),
    });

    setSavePreviewRows(rows);
    setInvalidSwineIds(invalidSet);
    setShowSavePreview(true);
    setMsg("");
  }, [
    canSave,
    selectedDate,
    fromFarm,
    selectedToFarmId,
    selectedHouse,
    selectedSwineIds,
    selectedSwineMap,
    swineForm,
    buildSavePreviewRows,
  ]);

  const logout = useCallback(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setMsg("");

    dlog("logout:start");

    try {
      await supabase.auth.signOut();
      dlog("logout:signed out from supabase");
    } catch (err) {
      derr("logout error", err);
    }

    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
      }
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      }
      dlog("logout:cleared local/session storage");
    } catch (e2) {
      derr("logout storage clear error", e2);
    }

    dlog("logout:redirect to login");
    window.location.replace(`/login?logout=1&ts=${Date.now()}`);
  }, []);

  async function saveDraft() {
    dlog("saveDraft:start", {
      canSave,
      selectedDate,
      fromFarm,
      selectedToFarmId,
      selectedHouse,
      remark,
      selectedCount: selectedSwineIds.size,
      selectedIds: Array.from(selectedSwineIds),
      selectedSwineMap,
      swineForm,
    });

    if (!canSave) {
      dlog("saveDraft:block because canSave=false");
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + House + หมูอย่างน้อย 1 ตัว");
      return;
    }

    const previewRowsNow = buildSavePreviewRows();
    const invalidNow = previewRowsNow.filter((x) => !x.ok);

    dlog("saveDraft:previewRowsNow", {
      previewRowsNow,
      invalidNow,
    });

    setSavePreviewRows(previewRowsNow);
    setInvalidSwineIds(new Set(invalidNow.map((x) => x.swine_id)));

    if (invalidNow.length > 0) {
      dlog("saveDraft:block because preview invalid", {
        invalidCount: invalidNow.length,
        invalidLabels: invalidNow.map((x) => x.label),
      });

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

      dlog("saveDraft:getUser result", {
        hasUser: !!user,
        userId: user?.id || null,
        authError: authError || null,
      });

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

      dlog("saveDraft:header payload", header);

      setMsg("กำลังบันทึกหัวรายการ...");
      const res1 = await withTimeout(
        supabase.from("swine_shipments").insert([header]),
        15000,
        "insert swine_shipments"
      );

      dlog("saveDraft:insert header result", res1);

      if (res1.error) throw res1.error;

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

      dlog("saveDraft:itemRows before insert", itemRows);

      const missingCodeRows = itemRows
        .filter((r) => !r.swine_code)
        .map((r, i) => {
          const found = previewRowsNow.find((x) => x.swine_id === r.swine_id);
          return found?.label || `รายการ ${i + 1}`;
        });

      if (missingCodeRows.length > 0) {
        dlog("saveDraft:missing swine_code found", {
          missingCodeRows,
        });
        throw new Error(
          `MISSING_SWINE_CODE: บางตัวไม่มี swine_code (${missingCodeRows.join(", ")})`
        );
      }

      if (itemRows.some((r) => !r.swine_id)) {
        dlog("saveDraft:missing swine_id found", {
          itemRows,
        });
        throw new Error("MISSING_SWINE_ID: บางตัวไม่มี swine_id");
      }

      setMsg("กำลังบันทึกรายการหมู...");
      const res2 = await withTimeout(
        supabase.from("swine_shipment_items").insert(itemRows),
        15000,
        "insert swine_shipment_items"
      );

      dlog("saveDraft:insert itemRows result", res2);

      if (res2.error) throw res2.error;

      const pickedCodes = itemRows.map((x) => clean(x.swine_code)).filter(Boolean);

      dlog("saveDraft:pickedCodes", {
        count: pickedCodes.length,
        pickedCodes,
      });

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

        dlog("saveDraft:update swine_master result", res3);

        if (res3.error) throw res3.error;
      }

      setCurrentShipmentId(shipmentId);
      setCurrentStatus("draft");
      setMsg(`Save Draft สำเร็จ ✅ (Shipment: ${shipmentId}, หมู: ${selectedCount} ตัว)`);

      dlog("saveDraft:success", {
        shipmentId,
        selectedCount,
      });

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

      dlog("saveDraft:finish success");
    } catch (e) {
      derr("saveDraft error", e, {
        selectedDate,
        fromFarm,
        selectedToFarmId,
        selectedHouse,
        selectedIds: Array.from(selectedSwineIds),
        swineForm,
      });

      setMsg(
        `${e?.message || "บันทึกไม่สำเร็จ"}${
          e?.details ? ` | details: ${e.details}` : ""
        }${e?.hint ? ` | hint: ${e.hint}` : ""}`
      );
    } finally {
      setSaving(false);
      dlog("saveDraft:finally -> saving=false");
    }
  }

  async function submitShipment() {
    dlog("submitShipment:start", {
      currentShipmentId,
      currentStatus,
    });

    if (!currentShipmentId) {
      dlog("submitShipment:block because no currentShipmentId");
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

      dlog("submitShipment:shipment query result", {
        shipment,
        error: e1 || null,
      });

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

      dlog("submitShipment:items query result", {
        items,
        error: e2 || null,
      });

      if (e2) throw e2;
      if (!items || items.length === 0) {
        throw new Error("ไม่มีรายการหมูใน shipment นี้");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      dlog("submitShipment:getUser", {
        userId: user?.id || null,
      });

      const payload = {
        status: "submitted",
        submitted_at: new Date().toISOString(),
      };

      if (user?.id) {
        payload.submitted_by = user.id;
      }

      dlog("submitShipment:update payload", payload);

      const { error: e3 } = await supabase
        .from("swine_shipments")
        .update(payload)
        .eq("id", currentShipmentId)
        .eq("status", "draft");

      dlog("submitShipment:update result", {
        error: e3 || null,
      });

      if (e3) throw e3;

      setCurrentStatus("submitted");
      setMsg("Submit สำเร็จ ✅ และเปลี่ยนสถานะเป็น submitted แล้ว");

      dlog("submitShipment:success", {
        currentShipmentId,
      });
    } catch (e) {
      derr("submitShipment error", e, {
        currentShipmentId,
        currentStatus,
      });

      setMsg(
        `${e?.message || "Submit ไม่สำเร็จ"}${
          e?.details ? ` | details: ${e.details}` : ""
        }${e?.hint ? ` | hint: ${e.hint}` : ""}`
      );
    } finally {
      setSubmitting(false);
      dlog("submitShipment:finally -> submitting=false");
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
            onClick={() => {
              dlog("navigate:/edit-shipment");
              nav("/edit-shipment");
            }}
          >
            จอแก้ไข
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              dlog("navigate:/export-csv");
              nav("/export-csv");
            }}
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
            onChange={(e) => {
              dlog("selectedDate:onChange", { value: e.target.value });
              setSelectedDate(e.target.value);
            }}
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
            onChange={(e) => {
              dlog("fromQ:onChange", { value: e.target.value });
              setFromQ(e.target.value);
            }}
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
            onChange={(value) => {
              dlog("FarmPickerInlineAdd:onChange", { value });
              setToFarmId(value);
            }}
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
                onChange={(e) => {
                  dlog("swineQ:onChange", { value: e.target.value });
                  setSwineQ(e.target.value);
                }}
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
                    dlog("clear selected swines button clicked", {
                      selectedIds: Array.from(selectedSwineIds),
                    });
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
            onChange={(e) => {
              dlog("remark:onChange", { value: e.target.value });
              setRemark(e.target.value);
            }}
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
              dlog("clear all button clicked", {
                selectedDate,
                currentShipmentId,
                currentStatus,
                fromFarm,
                toFarmId,
                selectedHouse,
                remark,
                fromQ,
                swineQ,
                selectedIds: Array.from(selectedSwineIds),
                swineForm,
              });

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
          onClick={() => {
            dlog("save preview backdrop clicked", { saving });
            if (!saving) setShowSavePreview(false);
          }}
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
                  onClick={() => {
                    dlog("save preview: back button clicked");
                    setShowSavePreview(false);
                  }}
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