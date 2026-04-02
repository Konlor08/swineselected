// src/pages/SummaryPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import { formatDateDisplay } from "../lib/dateFormat";

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

function addDaysYmd(ymd, diffDays) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + diffDays);
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

function calcAgeDays(selectedDate, birthDate) {
  const s = clean(selectedDate);
  const b = clean(birthDate);
  if (!s || !b) return "";
  const a = new Date(`${s}T00:00:00`);
  const c = new Date(`${b}T00:00:00`);
  const diff = Math.floor((a - c) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : "";
}

function calcAgeDaysFromToday(birthDate) {
  const b = clean(birthDate);
  if (!b) return "";
  const now = new Date();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}T00:00:00`
  );
  const c = new Date(`${b}T00:00:00`);
  const diff = Math.floor((today - c) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : "";
}

function getLatestHeatDate(report) {
  const dates = [
    clean(report?.heat_1_date),
    clean(report?.heat_2_date),
    clean(report?.heat_3_date),
    clean(report?.heat_4_date),
  ].filter(Boolean);

  if (!dates.length) return "";
  return dates.sort().at(-1) || "";
}

function makeFarmHouseKey(farmCode, houseNo) {
  return `${clean(farmCode)}__${clean(houseNo)}`;
}

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
}

function formatSelectedDateRangeText(dates) {
  const arr = Array.from(new Set((dates || []).map(clean).filter(Boolean))).sort();
  if (!arr.length) return "-";
  if (arr.length === 1) return formatDateDisplay(arr[0]);
  return `${formatDateDisplay(arr[0])} ถึง ${formatDateDisplay(arr[arr.length - 1])}`;
}

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

const inputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
};

const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};

const tdStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  verticalAlign: "top",
};

const tdStyleNumber = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

export default function SummaryPage() {
  const nav = useNavigate();

  const today = todayYmdLocal();
  const defaultFrom = addDaysYmd(today, -6);

  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [myRole, setMyRole] = useState("");
  const [userId, setUserId] = useState("");
  const [allowedFarmCodes, setAllowedFarmCodes] = useState([]);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);

  const [summaryRows, setSummaryRows] = useState([]);
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const [selectedDay, setSelectedDay] = useState("");

  const [selectedDayRows, setSelectedDayRows] = useState([]);
  const [detailRows, setDetailRows] = useState([]);
  const [remainingRows, setRemainingRows] = useState([]);

  const dateRangeInvalid =
    !!clean(dateFrom) && !!clean(dateTo) && clean(dateFrom) > clean(dateTo);

  const selectedSummaryRow = useMemo(() => {
    return (
      summaryRows.find(
        (row) => makeFarmHouseKey(row.farm_code, row.house_no) === selectedRowKey
      ) || null
    );
  }, [summaryRows, selectedRowKey]);

  const visibleSummaryRows = useMemo(() => {
    if (!selectedSummaryRow) return summaryRows;
    return [selectedSummaryRow];
  }, [summaryRows, selectedSummaryRow]);

  const kpi = useMemo(() => {
    const rows = selectedSummaryRow ? [selectedSummaryRow] : summaryRows;
    return {
      totalInitial: sumBy(rows, "initial_count"),
      totalSelectedRange: sumBy(rows, "selected_range_count"),
      totalRemaining: sumBy(rows, "remaining_count"),
      farmCount: new Set(rows.map((r) => clean(r.farm_code)).filter(Boolean)).size,
      houseCount: rows.length,
    };
  }, [summaryRows, selectedSummaryRow]);

  const handleBack = useCallback(() => {
    try {
      if (window.history.length > 1) {
        nav(-1);
        return;
      }
    } catch {
      // ignore
    }
    nav("/user-home", { replace: true });
  }, [nav]);

  useEffect(() => {
    let alive = true;

    async function init() {
      setPageLoading(true);
      setMsg("");

      try {
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id || "";

        if (!uid) {
          if (!alive) return;
          setMyRole("");
          setUserId("");
          setAllowedFarmCodes([]);
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        const role = String(profile?.role || "user").toLowerCase();
        setMyRole(role);
        setUserId(uid);

        if (role === "admin") {
          setAllowedFarmCodes([]);
          return;
        }

        const { data: shipmentRows, error: shipmentError } = await supabase
          .from("swine_shipments")
          .select("from_farm_code")
          .eq("created_by", uid)
          .limit(5000);

        if (shipmentError) throw shipmentError;

        const farmCodes = Array.from(
          new Set(
            (shipmentRows || [])
              .map((row) => clean(row?.from_farm_code))
              .filter(Boolean)
          )
        );

        setAllowedFarmCodes(farmCodes);
      } catch (error) {
        console.error("SummaryPage init error:", error);
        if (alive) {
          setMsg(getRawErrorMessage(error) || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
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

  const loadSummary = useCallback(async () => {
    if (!userId || !myRole) return;
    if (dateRangeInvalid) return;

    setLoading(true);
    setMsg("");
    setSelectedRowKey("");
    setSelectedDay("");
    setSelectedDayRows([]);
    setDetailRows([]);
    setRemainingRows([]);

    try {
      const isAdmin = myRole === "admin";
      const farmFilterList = isAdmin ? [] : allowedFarmCodes;

      if (!isAdmin && farmFilterList.length === 0) {
        setSummaryRows([]);
        return;
      }

      let swinesQuery = supabase
        .from("swines")
        .select("farm_code, farm_name, house_no, swine_code, birth_date")
        .limit(50000);

      if (!isAdmin) {
        swinesQuery = swinesQuery.in("farm_code", farmFilterList);
      }

      const { data: swinesData, error: swinesError } = await swinesQuery;
      if (swinesError) throw swinesError;

      const swineMetaByCode = new Map();
      const initialMap = new Map();

      for (const row of swinesData || []) {
        const farmCode = clean(row?.farm_code);
        const farmName = clean(row?.farm_name);
        const houseNo = clean(row?.house_no);
        const swineCode = clean(row?.swine_code);
        const birthDate = clean(row?.birth_date);

        if (!farmCode || !houseNo || !swineCode) continue;

        swineMetaByCode.set(swineCode, {
          farm_code: farmCode,
          farm_name: farmName,
          house_no: houseNo,
          birth_date: birthDate,
        });

        const key = makeFarmHouseKey(farmCode, houseNo);
        if (!initialMap.has(key)) {
          initialMap.set(key, {
            farm_code: farmCode,
            farm_name: farmName,
            house_no: houseNo,
            initialCodeSet: new Set(),
            selectedRangeCodeSet: new Set(),
            cumulativeCodeSet: new Set(),
            selectedDateSet: new Set(),
          });
        }

        initialMap.get(key).initialCodeSet.add(swineCode);
      }

      let shipmentRangeQuery = supabase
        .from("swine_shipments")
        .select("id, from_farm_code, from_farm_name, selected_date, status")
        .gte("selected_date", clean(dateFrom))
        .lte("selected_date", clean(dateTo))
        .in("status", ["draft", "submitted"])
        .limit(5000);

      if (!isAdmin) {
        shipmentRangeQuery = shipmentRangeQuery.in("from_farm_code", farmFilterList);
      }

      const { data: shipmentRangeData, error: shipmentRangeError } =
        await shipmentRangeQuery;
      if (shipmentRangeError) throw shipmentRangeError;

      const shipmentRangeIds = (shipmentRangeData || []).map((row) => row.id).filter(Boolean);

      if (shipmentRangeIds.length > 0) {
        const { data: itemRangeData, error: itemRangeError } = await supabase
          .from("swine_shipment_items")
          .select("shipment_id, swine_code")
          .in("shipment_id", shipmentRangeIds)
          .limit(50000);

        if (itemRangeError) throw itemRangeError;

        const shipmentRangeById = new Map(
          (shipmentRangeData || []).map((row) => [String(row.id), row])
        );

        for (const item of itemRangeData || []) {
          const shipment = shipmentRangeById.get(String(item.shipment_id));
          if (!shipment) continue;

          const swineCode = clean(item?.swine_code);
          const swineMeta = swineMetaByCode.get(swineCode);
          if (!swineMeta) continue;

          const farmCode = clean(shipment?.from_farm_code) || clean(swineMeta?.farm_code);
          const farmName = clean(shipment?.from_farm_name) || clean(swineMeta?.farm_name);
          const houseNo = clean(swineMeta?.house_no);
          const selectedDate = clean(shipment?.selected_date);

          if (!farmCode || !houseNo || !swineCode) continue;

          const key = makeFarmHouseKey(farmCode, houseNo);
          if (!initialMap.has(key)) {
            initialMap.set(key, {
              farm_code: farmCode,
              farm_name: farmName,
              house_no: houseNo,
              initialCodeSet: new Set(),
              selectedRangeCodeSet: new Set(),
              cumulativeCodeSet: new Set(),
              selectedDateSet: new Set(),
            });
          }

          const current = initialMap.get(key);
          current.selectedRangeCodeSet.add(swineCode);
          if (selectedDate) current.selectedDateSet.add(selectedDate);
          if (!current.farm_name && farmName) current.farm_name = farmName;
        }
      }

      let shipmentCumulativeQuery = supabase
        .from("swine_shipments")
        .select("id, from_farm_code, from_farm_name, selected_date, status")
        .lte("selected_date", clean(dateTo))
        .in("status", ["draft", "submitted"])
        .limit(5000);

      if (!isAdmin) {
        shipmentCumulativeQuery = shipmentCumulativeQuery.in(
          "from_farm_code",
          farmFilterList
        );
      }

      const { data: shipmentCumulativeData, error: shipmentCumulativeError } =
        await shipmentCumulativeQuery;
      if (shipmentCumulativeError) throw shipmentCumulativeError;

      const shipmentCumulativeIds = (shipmentCumulativeData || [])
        .map((row) => row.id)
        .filter(Boolean);

      if (shipmentCumulativeIds.length > 0) {
        const { data: itemCumulativeData, error: itemCumulativeError } =
          await supabase
            .from("swine_shipment_items")
            .select("shipment_id, swine_code")
            .in("shipment_id", shipmentCumulativeIds)
            .limit(50000);

        if (itemCumulativeError) throw itemCumulativeError;

        const shipmentCumulativeById = new Map(
          (shipmentCumulativeData || []).map((row) => [String(row.id), row])
        );

        for (const item of itemCumulativeData || []) {
          const shipment = shipmentCumulativeById.get(String(item.shipment_id));
          if (!shipment) continue;

          const swineCode = clean(item?.swine_code);
          const swineMeta = swineMetaByCode.get(swineCode);
          if (!swineMeta) continue;

          const farmCode = clean(shipment?.from_farm_code) || clean(swineMeta?.farm_code);
          const farmName = clean(shipment?.from_farm_name) || clean(swineMeta?.farm_name);
          const houseNo = clean(swineMeta?.house_no);

          if (!farmCode || !houseNo || !swineCode) continue;

          const key = makeFarmHouseKey(farmCode, houseNo);
          if (!initialMap.has(key)) {
            initialMap.set(key, {
              farm_code: farmCode,
              farm_name: farmName,
              house_no: houseNo,
              initialCodeSet: new Set(),
              selectedRangeCodeSet: new Set(),
              cumulativeCodeSet: new Set(),
              selectedDateSet: new Set(),
            });
          }

          const current = initialMap.get(key);
          current.cumulativeCodeSet.add(swineCode);
          if (!current.farm_name && farmName) current.farm_name = farmName;
        }
      }

      const merged = Array.from(initialMap.values())
        .map((row) => {
          const initialCount = row.initialCodeSet.size;
          const selectedRange = row.selectedRangeCodeSet.size;
          const cumulative = row.cumulativeCodeSet.size;

          return {
            farm_code: row.farm_code,
            farm_name: row.farm_name,
            house_no: row.house_no,
            selected_dates: Array.from(row.selectedDateSet).sort(),
            selected_date_range_text: formatSelectedDateRangeText(
              Array.from(row.selectedDateSet)
            ),
            initial_count: initialCount,
            selected_range_count: selectedRange,
            cumulative_selected_count: cumulative,
            remaining_count: Math.max(initialCount - cumulative, 0),
          };
        })
        .sort((a, b) => {
          const farmCompare = String(a.farm_code).localeCompare(
            String(b.farm_code),
            "th"
          );
          if (farmCompare !== 0) return farmCompare;
          return String(a.house_no).localeCompare(String(b.house_no), "th");
        });

      setSummaryRows(merged);
    } catch (error) {
      console.error("loadSummary error:", error);
      setSummaryRows([]);
      setMsg(getRawErrorMessage(error) || "โหลด summary ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [userId, myRole, allowedFarmCodes, dateFrom, dateTo, dateRangeInvalid]);

  const loadSelectedDaysForRow = useCallback(
    async (row) => {
      if (!row || !userId || !myRole) return;

      setDayLoading(true);
      setDetailRows([]);
      setSelectedDay("");
      setMsg("");

      try {
        const farmCode = clean(row.farm_code);
        const houseNo = clean(row.house_no);

        if (!farmCode || !houseNo) {
          setSelectedDayRows([]);
          return;
        }

        const isAdmin = myRole === "admin";
        const farmFilterList = isAdmin ? [] : allowedFarmCodes;

        let shipmentRangeQuery = supabase
          .from("swine_shipments")
          .select("id, from_farm_code, selected_date, status")
          .eq("from_farm_code", farmCode)
          .gte("selected_date", clean(dateFrom))
          .lte("selected_date", clean(dateTo))
          .in("status", ["draft", "submitted"])
          .limit(5000);

        if (!isAdmin && farmFilterList.length > 0) {
          shipmentRangeQuery = shipmentRangeQuery.in("from_farm_code", farmFilterList);
        }

        const { data: shipmentRangeData, error: shipmentRangeError } =
          await shipmentRangeQuery;
        if (shipmentRangeError) throw shipmentRangeError;

        const shipmentIds = (shipmentRangeData || []).map((x) => x.id).filter(Boolean);

        if (!shipmentIds.length) {
          setSelectedDayRows([]);
          return;
        }

        const { data: itemRangeData, error: itemRangeError } = await supabase
          .from("swine_shipment_items")
          .select(`
            shipment_id,
            swine_code,
            swine:swines!swine_shipment_items_swine_id_fkey (
              house_no
            )
          `)
          .in("shipment_id", shipmentIds)
          .limit(50000);

        if (itemRangeError) throw itemRangeError;

        const shipmentMap = new Map(
          (shipmentRangeData || []).map((r) => [String(r.id), r])
        );

        const dayMap = new Map();

        for (const item of itemRangeData || []) {
          const shipment = shipmentMap.get(String(item.shipment_id));
          if (!shipment) continue;

          const day = clean(shipment?.selected_date);
          const itemHouse = clean(item?.swine?.house_no);
          const swineCode = clean(item?.swine_code);

          if (!day || !itemHouse || !swineCode) continue;
          if (itemHouse !== houseNo) continue;

          if (!dayMap.has(day)) {
            dayMap.set(day, {
              selected_date: day,
              codeSet: new Set(),
            });
          }

          dayMap.get(day).codeSet.add(swineCode);
        }

        const rows = Array.from(dayMap.values())
          .map((r) => ({
            selected_date: r.selected_date,
            total_selected_count: r.codeSet.size,
          }))
          .sort((a, b) =>
            String(a.selected_date).localeCompare(String(b.selected_date), "th")
          );

        setSelectedDayRows(rows);
      } catch (error) {
        console.error("loadSelectedDaysForRow error:", error);
        setSelectedDayRows([]);
        setMsg(getRawErrorMessage(error) || "โหลดยอดรวมรายวันไม่สำเร็จ");
      } finally {
        setDayLoading(false);
      }
    },
    [userId, myRole, allowedFarmCodes, dateFrom, dateTo]
  );

  const loadDetailForDay = useCallback(
    async (row, day) => {
      if (!row || !day || !userId || !myRole) return;

      setDetailLoading(true);
      setMsg("");

      try {
        const farmCode = clean(row.farm_code);
        const houseNo = clean(row.house_no);
        const selectedDate = clean(day);

        if (!farmCode || !houseNo || !selectedDate) {
          setDetailRows([]);
          return;
        }

        const isAdmin = myRole === "admin";
        const farmFilterList = isAdmin ? [] : allowedFarmCodes;

        let shipmentQuery = supabase
          .from("swine_shipments")
          .select("id, from_farm_code, selected_date, status")
          .eq("from_farm_code", farmCode)
          .eq("selected_date", selectedDate)
          .in("status", ["draft", "submitted"])
          .limit(5000);

        if (!isAdmin && farmFilterList.length > 0) {
          shipmentQuery = shipmentQuery.in("from_farm_code", farmFilterList);
        }

        const { data: shipmentData, error: shipmentError } = await shipmentQuery;
        if (shipmentError) throw shipmentError;

        const shipmentIds = (shipmentData || []).map((x) => x.id).filter(Boolean);

        if (!shipmentIds.length) {
          setDetailRows([]);
          return;
        }

        const { data: itemData, error: itemError } = await supabase
          .from("swine_shipment_items")
          .select(`
            shipment_id,
            swine_code,
            teats_left,
            teats_right,
            weight,
            backfat,
            swine:swines!swine_shipment_items_swine_id_fkey (
              birth_date,
              house_no
            )
          `)
          .in("shipment_id", shipmentIds)
          .limit(50000);

        if (itemError) throw itemError;

        const latestPerCode = new Map();

        for (const item of itemData || []) {
          const swineCode = clean(item?.swine_code);
          const itemHouse = clean(item?.swine?.house_no);

          if (!swineCode || itemHouse !== houseNo) continue;

          const currentRow = {
            selected_date: selectedDate,
            swine_code: swineCode,
            birth_date: clean(item?.swine?.birth_date),
            teats_left: item?.teats_left ?? "",
            teats_right: item?.teats_right ?? "",
            weight: item?.weight ?? "",
            backfat: item?.backfat ?? "",
          };

          if (!latestPerCode.has(swineCode)) {
            latestPerCode.set(swineCode, currentRow);
          }
        }

        const swineCodes = Array.from(latestPerCode.keys());

        let heatMap = new Map();
        if (swineCodes.length > 0) {
          const { data: heatData, error: heatError } = await supabase
            .from("swine_heat_report")
            .select(
              "swine_code, heat_1_date, heat_2_date, heat_3_date, heat_4_date, total_heat_count"
            )
            .in("swine_code", swineCodes)
            .limit(50000);

          if (heatError) throw heatError;

          heatMap = new Map(
            (heatData || []).map((r) => [clean(r?.swine_code), r])
          );
        }

        const rows = Array.from(latestPerCode.values())
          .map((item) => {
            const heat = heatMap.get(clean(item.swine_code));
            return {
              selected_date: clean(item.selected_date),
              swine_code: clean(item.swine_code),
              age_days: calcAgeDays(item.selected_date, item.birth_date),
              teats_left: item.teats_left,
              teats_right: item.teats_right,
              weight: item.weight,
              backfat: item.backfat,
              total_heat_count: Number(heat?.total_heat_count || 0),
              latest_heat_date: getLatestHeatDate(heat),
            };
          })
          .sort((a, b) =>
            String(a.swine_code).localeCompare(String(b.swine_code), "th")
          );

        setDetailRows(rows);
      } catch (error) {
        console.error("loadDetailForDay error:", error);
        setDetailRows([]);
        setMsg(getRawErrorMessage(error) || "โหลดรายละเอียดรายวันไม่สำเร็จ");
      } finally {
        setDetailLoading(false);
      }
    },
    [userId, myRole, allowedFarmCodes]
  );

  const loadRemainingForRow = useCallback(
    async (row) => {
      if (!row || !userId || !myRole) return;

      setRemainingLoading(true);
      setMsg("");

      try {
        const farmCode = clean(row.farm_code);
        const houseNo = clean(row.house_no);

        if (!farmCode || !houseNo) {
          setRemainingRows([]);
          return;
        }

        const isAdmin = myRole === "admin";
        const farmFilterList = isAdmin ? [] : allowedFarmCodes;

        const { data: masterAvailableData, error: masterAvailableError } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .limit(50000);

        if (masterAvailableError) throw masterAvailableError;

        const availableCodes = (masterAvailableData || [])
          .map((r) => clean(r?.swine_code))
          .filter(Boolean);

        if (!availableCodes.length) {
          setRemainingRows([]);
          return;
        }

        const chunkSize = 1000;
        const chunks = [];
        for (let i = 0; i < availableCodes.length; i += chunkSize) {
          chunks.push(availableCodes.slice(i, i + chunkSize));
        }

        let swineRows = [];
        for (const chunk of chunks) {
          let swineQuery = supabase
            .from("swines")
            .select("swine_code, farm_code, farm_name, house_no, birth_date")
            .eq("farm_code", farmCode)
            .eq("house_no", houseNo)
            .in("swine_code", chunk)
            .limit(50000);

          if (!isAdmin && farmFilterList.length > 0) {
            swineQuery = swineQuery.in("farm_code", farmFilterList);
          }

          const { data, error } = await swineQuery;
          if (error) throw error;
          swineRows = swineRows.concat(data || []);
        }

        const uniqueRemainingMap = new Map();
        for (const row of swineRows || []) {
          const swineCode = clean(row?.swine_code);
          if (!swineCode) continue;
          if (!uniqueRemainingMap.has(swineCode)) {
            uniqueRemainingMap.set(swineCode, row);
          }
        }

        const remainingCodes = Array.from(uniqueRemainingMap.keys());

        let remainingHeatMap = new Map();
        if (remainingCodes.length > 0) {
          const heatChunks = [];
          for (let i = 0; i < remainingCodes.length; i += chunkSize) {
            heatChunks.push(remainingCodes.slice(i, i + chunkSize));
          }

          const heatRowsAll = [];
          for (const chunk of heatChunks) {
            const { data: heatRows, error: heatError } = await supabase
              .from("swine_heat_report")
              .select(
                "swine_code, heat_1_date, heat_2_date, heat_3_date, heat_4_date, total_heat_count"
              )
              .in("swine_code", chunk)
              .limit(50000);

            if (heatError) throw heatError;
            heatRowsAll.push(...(heatRows || []));
          }

          remainingHeatMap = new Map(
            heatRowsAll.map((r) => [clean(r?.swine_code), r])
          );
        }

        const remaining = Array.from(uniqueRemainingMap.values())
          .map((row) => {
            const heat = remainingHeatMap.get(clean(row?.swine_code));
            return {
              swine_code: clean(row?.swine_code),
              birth_date: clean(row?.birth_date),
              age_days: calcAgeDaysFromToday(row?.birth_date),
              total_heat_count: Number(heat?.total_heat_count || 0),
              latest_heat_date: getLatestHeatDate(heat),
            };
          })
          .sort((a, b) =>
            String(a.swine_code).localeCompare(String(b.swine_code), "th")
          );

        setRemainingRows(remaining);
      } catch (error) {
        console.error("loadRemainingForRow error:", error);
        setRemainingRows([]);
        setMsg(getRawErrorMessage(error) || "โหลดรายการคงเหลือไม่สำเร็จ");
      } finally {
        setRemainingLoading(false);
      }
    },
    [userId, myRole, allowedFarmCodes]
  );

  useEffect(() => {
    if (pageLoading) return;
    if (!userId || !myRole) return;
    if (dateRangeInvalid) return;
    void loadSummary();
  }, [pageLoading, userId, myRole, loadSummary, dateRangeInvalid]);

  useEffect(() => {
    if (!selectedSummaryRow) return;
    void loadSelectedDaysForRow(selectedSummaryRow);
    void loadRemainingForRow(selectedSummaryRow);
  }, [selectedSummaryRow, loadSelectedDaysForRow, loadRemainingForRow]);

  useEffect(() => {
    if (!selectedSummaryRow || !selectedDay) return;
    void loadDetailForDay(selectedSummaryRow, selectedDay);
  }, [selectedSummaryRow, selectedDay, loadDetailForDay]);

  function goCreateForRow(row) {
    if (!row) return;
    const params = new URLSearchParams();
    params.set("fromFarmCode", clean(row.farm_code));
    params.set("houseNo", clean(row.house_no));
    nav(`/shipment-create?${params.toString()}`);
  }

  function goEditForRow(row) {
    if (!row) return;
    const params = new URLSearchParams();
    params.set("fromFarmCode", clean(row.farm_code));
    params.set("houseNo", clean(row.house_no));
    nav(`/edit-shipment?${params.toString()}`);
  }

  if (pageLoading) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 900, margin: "40px auto" }}>
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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          position: "relative",
          zIndex: 20,
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Monitoring</div>
          <div className="small" style={{ color: "#64748b", marginTop: 4, lineHeight: 1.7 }}>
            จำนวนหมูทั้งหมดที่มีตั้งต้น | จำนวนหมูที่คัดในช่วงนี้ | จำนวนคงเหลือที่ยังไม่คัดของช่วงวันที่เลือก
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
          maxWidth: 1200,
          margin: "0 auto",
          display: "grid",
          gap: 14,
          padding: "8px",
          boxSizing: "border-box",
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Filter</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่เริ่มต้น
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={inputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                {formatDateDisplay(dateFrom)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่สิ้นสุด
              </div>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={inputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                {formatDateDisplay(dateTo)}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
              <button
                className="linkbtn"
                type="button"
                onClick={() => void loadSummary()}
                disabled={loading || dateRangeInvalid}
              >
                {loading ? "กำลังโหลด..." : "Refresh"}
              </button>

              {selectedSummaryRow ? (
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => {
                    setSelectedRowKey("");
                    setSelectedDay("");
                    setSelectedDayRows([]);
                    setDetailRows([]);
                    setRemainingRows([]);
                  }}
                >
                  กลับไปดูทั้งหมด
                </button>
              ) : null}
            </div>
          </div>

          {dateRangeInvalid ? (
            <div
              className="small"
              style={{ marginTop: 10, color: "#b91c1c", fontWeight: 700 }}
            >
              วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด
            </div>
          ) : null}
        </div>

        {msg ? (
          <div style={cardStyle}>
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{msg}</div>
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนหมูทั้งหมดที่มีตั้งต้น</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalInitial}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนหมูที่คัดในช่วงนี้</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalSelectedRange}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนคงเหลือที่ยังไม่คัด</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalRemaining}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนฟาร์ม</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.farmCount}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนเล้า</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.houseCount}</div>
          </div>
        </div>

        <div style={cardStyle}>
          <div
            style={{
              fontWeight: 800,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>ตารางสรุปตามฟาร์ม / เล้า</div>

            {selectedSummaryRow ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => goCreateForRow(selectedSummaryRow)}
                >
                  ไปหน้า Create
                </button>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => goEditForRow(selectedSummaryRow)}
                >
                  ไปหน้า Edit
                </button>
              </div>
            ) : null}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 980,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>ฟาร์ม</th>
                  <th style={thStyle}>เล้า</th>
                  <th style={thStyle}>วันที่คัดในช่วงที่เลือก</th>
                  <th style={thStyle}>จำนวนหมูทั้งหมดที่มีตั้งต้น</th>
                  <th style={thStyle}>จำนวนหมูที่คัดในช่วงนี้</th>
                  <th style={thStyle}>จำนวนคงเหลือที่ยังไม่คัด</th>
                </tr>
              </thead>

              <tbody>
                {visibleSummaryRows.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={6}>
                      {loading ? "กำลังโหลด..." : "ไม่พบข้อมูล"}
                    </td>
                  </tr>
                ) : (
                  visibleSummaryRows.map((row) => {
                    const key = makeFarmHouseKey(row.farm_code, row.house_no);
                    const active = key === selectedRowKey;

                    return (
                      <tr
                        key={key}
                        onClick={() => {
                          if (active) return;
                          setSelectedRowKey(key);
                        }}
                        style={{
                          background: active ? "#fef9c3" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <td style={tdStyle}>
                          {row.farm_name
                            ? `${row.farm_code} - ${row.farm_name}`
                            : row.farm_code}
                        </td>
                        <td style={tdStyle}>{row.house_no}</td>
                        <td style={tdStyle}>{row.selected_date_range_text}</td>
                        <td style={tdStyleNumber}>{row.initial_count}</td>
                        <td style={tdStyleNumber}>{row.selected_range_count}</td>
                        <td style={tdStyleNumber}>{row.remaining_count}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedSummaryRow ? (
          <>
            <div style={cardStyle}>
              <div
                style={{
                  fontWeight: 800,
                  marginBottom: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  ยอดรวมวันที่คัดของฟาร์ม {selectedSummaryRow.farm_code} เล้า{" "}
                  {selectedSummaryRow.house_no}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={() => goCreateForRow(selectedSummaryRow)}
                  >
                    ไปหน้า Create
                  </button>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={() => goEditForRow(selectedSummaryRow)}
                  >
                    ไปหน้า Edit
                  </button>
                </div>
              </div>

              <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                กดเลือกวันที่ก่อน แล้วจึงแสดงเบอร์หมูแต่ละตัวของวันนั้น
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 520,
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>วันที่คัด</th>
                      <th style={thStyle}>จำนวนหมูที่คัดวันนั้น</th>
                    </tr>
                  </thead>

                  <tbody>
                    {dayLoading ? (
                      <tr>
                        <td style={tdStyle} colSpan={2}>
                          กำลังโหลดยอดรวมรายวัน...
                        </td>
                      </tr>
                    ) : selectedDayRows.length === 0 ? (
                      <tr>
                        <td style={tdStyle} colSpan={2}>
                          ไม่พบยอดรวมวันที่คัดในช่วงวันที่เลือก
                        </td>
                      </tr>
                    ) : (
                      selectedDayRows.map((row) => (
                        <tr
                          key={row.selected_date}
                          onClick={() => setSelectedDay(row.selected_date)}
                          style={{
                            background:
                              clean(selectedDay) === clean(row.selected_date)
                                ? "#fef9c3"
                                : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <td style={tdStyle}>{formatDateDisplay(row.selected_date)}</td>
                          <td style={tdStyleNumber}>{row.total_selected_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedDay ? (
              <div style={cardStyle}>
                <div
                  style={{
                    fontWeight: 800,
                    marginBottom: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div>
                    เบอร์ที่คัดของวันที่ {formatDateDisplay(selectedDay)} | ฟาร์ม{" "}
                    {selectedSummaryRow.farm_code} เล้า {selectedSummaryRow.house_no}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      className="linkbtn"
                      type="button"
                      onClick={() => goCreateForRow(selectedSummaryRow)}
                    >
                      ไปหน้า Create
                    </button>
                    <button
                      className="linkbtn"
                      type="button"
                      onClick={() => goEditForRow(selectedSummaryRow)}
                    >
                      ไปหน้า Edit
                    </button>
                  </div>
                </div>

                <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                  แสดงเฉพาะเบอร์ที่คัดในวันที่เลือก โดยนับ 1 เบอร์หมู = 1 แถว
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: 1100,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={thStyle}>วันที่คัด</th>
                        <th style={thStyle}>เบอร์หมู</th>
                        <th style={thStyle}>อายุหมู(วัน)</th>
                        <th style={thStyle}>เต้านมซ้าย</th>
                        <th style={thStyle}>เต้านมขวา</th>
                        <th style={thStyle}>น้ำหนัก</th>
                        <th style={thStyle}>backfat</th>
                        <th style={thStyle}>จำนวน heat</th>
                        <th style={thStyle}>heat ล่าสุด</th>
                      </tr>
                    </thead>

                    <tbody>
                      {detailLoading ? (
                        <tr>
                          <td style={tdStyle} colSpan={9}>
                            กำลังโหลดรายละเอียดรายตัว...
                          </td>
                        </tr>
                      ) : detailRows.length === 0 ? (
                        <tr>
                          <td style={tdStyle} colSpan={9}>
                            ไม่พบรายการเบอร์หมูของวันที่เลือก
                          </td>
                        </tr>
                      ) : (
                        detailRows.map((row, idx) => (
                          <tr key={`${row.selected_date}__${row.swine_code}__${idx}`}>
                            <td style={tdStyle}>{formatDateDisplay(row.selected_date)}</td>
                            <td style={tdStyle}>{row.swine_code}</td>
                            <td style={tdStyleNumber}>{row.age_days}</td>
                            <td style={tdStyleNumber}>{row.teats_left}</td>
                            <td style={tdStyleNumber}>{row.teats_right}</td>
                            <td style={tdStyleNumber}>{row.weight}</td>
                            <td style={tdStyleNumber}>{row.backfat}</td>
                            <td style={tdStyleNumber}>{row.total_heat_count}</td>
                            <td style={tdStyle}>
                              {row.latest_heat_date
                                ? formatDateDisplay(row.latest_heat_date)
                                : "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div style={cardStyle}>
              <div
                style={{
                  fontWeight: 800,
                  marginBottom: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  เบอร์ที่ยังไม่คัดของฟาร์ม {selectedSummaryRow.farm_code} เล้า{" "}
                  {selectedSummaryRow.house_no}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={() => goCreateForRow(selectedSummaryRow)}
                  >
                    ไปหน้า Create
                  </button>
                  <button
                    className="linkbtn"
                    type="button"
                    onClick={() => goEditForRow(selectedSummaryRow)}
                  >
                    ไปหน้า Edit
                  </button>
                </div>
              </div>

              <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                แสดงรายการหมูคงเหลือของฟาร์มและเล้าที่เลือกในหน้าเดียว
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 900,
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>เบอร์หมู</th>
                      <th style={thStyle}>วันเกิด</th>
                      <th style={thStyle}>อายุหมู(วัน)</th>
                      <th style={thStyle}>จำนวน heat</th>
                      <th style={thStyle}>heat ล่าสุด</th>
                    </tr>
                  </thead>

                  <tbody>
                    {remainingLoading ? (
                      <tr>
                        <td style={tdStyle} colSpan={5}>
                          กำลังโหลดรายการคงเหลือ...
                        </td>
                      </tr>
                    ) : remainingRows.length === 0 ? (
                      <tr>
                        <td style={tdStyle} colSpan={5}>
                          ไม่พบรายการหมูที่ยังไม่คัด
                        </td>
                      </tr>
                    ) : (
                      remainingRows.map((row, idx) => (
                        <tr key={`${row.swine_code}__${idx}`}>
                          <td style={tdStyle}>{row.swine_code}</td>
                          <td style={tdStyle}>
                            {row.birth_date ? formatDateDisplay(row.birth_date) : "-"}
                          </td>
                          <td style={tdStyleNumber}>{row.age_days}</td>
                          <td style={tdStyleNumber}>{row.total_heat_count}</td>
                          <td style={tdStyle}>
                            {row.latest_heat_date
                              ? formatDateDisplay(row.latest_heat_date)
                              : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}