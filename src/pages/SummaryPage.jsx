// src/pages/SummaryPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateDisplay } from "../lib/dateFormat";

const ACTIVE_STATUSES = ["draft", "submitted", "issued"];
const PAGE_SIZE = 1000;
const SHIPMENT_ID_CHUNK_SIZE = 500;
const SWINE_CODE_CHUNK_SIZE = 1000;

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

function makeScopeKey(farmCode, flock, houseNo) {
  return `${clean(farmCode)}__${clean(flock)}__${clean(houseNo)}`;
}

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
}

function normalizeBooleanRpcResult(data) {
  if (typeof data === "boolean") return data;

  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    if (typeof row === "boolean") return row;
    if (row && typeof row === "object") {
      const firstKey = Object.keys(row)[0];
      return Boolean(row?.[firstKey]);
    }
  }

  if (data && typeof data === "object") {
    const firstKey = Object.keys(data)[0];
    return Boolean(data?.[firstKey]);
  }

  return false;
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

async function fetchHeatSummaryMapByCodes(swineCodes = []) {
  const codes = Array.from(new Set((swineCodes || []).map(clean).filter(Boolean)));
  const heatMap = new Map();

  for (const swineCodeChunk of chunkArray(codes, SWINE_CODE_CHUNK_SIZE)) {
    if (!swineCodeChunk.length) continue;

    const { data: heatEvents, error: heatError } = await supabase
      .from("swine_heat_events")
      .select("swine_code, heat_no, corrected_heat_date")
      .in("swine_code", swineCodeChunk)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("swine_code", { ascending: true })
      .order("heat_no", { ascending: true })
      .order("corrected_heat_date", { ascending: true });

    if (heatError) throw heatError;

    for (const ev of heatEvents || []) {
      const swineCode = clean(ev?.swine_code);
      const heatDate = clean(ev?.corrected_heat_date);
      const heatNo = Number(ev?.heat_no || 0);

      if (!swineCode) continue;

      if (!heatMap.has(swineCode)) {
        heatMap.set(swineCode, {
          swine_code: swineCode,
          total_heat_count: 0,
          latest_heat_date: "",
          heat_1_date: "",
          heat_2_date: "",
          heat_3_date: "",
          heat_4_date: "",
        });
      }

      const row = heatMap.get(swineCode);
      row.total_heat_count += 1;

      if (heatDate && (!row.latest_heat_date || heatDate > row.latest_heat_date)) {
        row.latest_heat_date = heatDate;
      }

      if (heatNo === 1) row.heat_1_date = heatDate;
      else if (heatNo === 2) row.heat_2_date = heatDate;
      else if (heatNo === 3) row.heat_3_date = heatDate;
      else if (heatNo === 4) row.heat_4_date = heatDate;
    }
  }

  return heatMap;
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

  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowedScopes, setAllowedScopes] = useState([]);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [selectedFlock, setSelectedFlock] = useState("");

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
        (row) => makeScopeKey(row.farm_code, row.flock, row.house_no) === selectedRowKey
      ) || null
    );
  }, [summaryRows, selectedRowKey]);

  const visibleSummaryRows = useMemo(() => {
    if (!selectedSummaryRow) return summaryRows;
    return [selectedSummaryRow];
  }, [summaryRows, selectedSummaryRow]);

  const flockOptions = useMemo(() => {
    const all = new Set();

    for (const row of summaryRows) {
      const flock = clean(row?.flock);
      if (flock) all.add(flock);
    }

    for (const scope of allowedScopes) {
      const flock = clean(scope?.flock);
      if (flock) all.add(flock);
    }

    return Array.from(all).sort((a, b) =>
      String(a).localeCompare(String(b), "th", { numeric: true })
    );
  }, [summaryRows, allowedScopes]);

  const kpi = useMemo(() => {
    const rows = selectedSummaryRow ? [selectedSummaryRow] : summaryRows;

    return {
      totalInitial: sumBy(rows, "initial_count"),
      totalSelectedRange: sumBy(rows, "selected_range_count"),
      totalSelectedCumulative: sumBy(rows, "cumulative_selected_count"),
      totalRemaining: sumBy(rows, "remaining_count"),
      farmCount: new Set(rows.map((r) => clean(r.farm_code)).filter(Boolean)).size,
      flockCount: new Set(rows.map((r) => clean(r.flock)).filter(Boolean)).size,
      scopeCount: rows.length,
    };
  }, [selectedSummaryRow, summaryRows]);

  const emptyStateText = useMemo(() => {
    if (loading) return "";
    if (summaryRows.length > 0) return "";

    if (!isAdmin && allowedScopes.length === 0) {
      return "ยังไม่พบ scope ที่คุณเคยคัดเองในสถานะ draft, submitted หรือ issued";
    }

    return "ไม่พบข้อมูลในช่วงวันที่เลือก";
  }, [loading, summaryRows.length, isAdmin, allowedScopes.length]);

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
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const uid = sessionData?.session?.user?.id || "";
        if (!uid) {
          if (!alive) return;
          setUserId("");
          setIsAdmin(false);
          setAllowedScopes([]);
          setMsg("กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
          return;
        }

        const [
          { data: adminData, error: adminError },
          { data: scopeData, error: scopeError },
        ] = await Promise.all([
          supabase.rpc("app_is_swine_admin"),
          supabase.rpc("app_get_my_swine_allowed_scopes"),
        ]);

        if (adminError) throw adminError;
        if (scopeError) throw scopeError;
        if (!alive) return;

        setUserId(uid);
        setIsAdmin(normalizeBooleanRpcResult(adminData));
        setAllowedScopes(Array.isArray(scopeData) ? scopeData : []);
      } catch (error) {
        console.error("SummaryPage init error:", error);
        if (!alive) return;
        setMsg(getRawErrorMessage(error) || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
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
    if (!userId) return;
    if (dateRangeInvalid) return;

    setLoading(true);
    setMsg("");
    setSelectedRowKey("");
    setSelectedDay("");
    setSelectedDayRows([]);
    setDetailRows([]);
    setRemainingRows([]);

    try {
      const { data: summaryData, error: summaryError } = await supabase.rpc(
        "app_get_swine_summary_rows",
        {
          p_date_from: clean(dateFrom),
          p_date_to: clean(dateTo),
          p_flock: clean(selectedFlock) || null,
        }
      );

      if (summaryError) throw summaryError;

      const summary = (Array.isArray(summaryData) ? summaryData : []).map((row) => {
        const initialCount = Number(row?.initial_count || 0);
        const cumulativeSelectedCount = Number(row?.cumulative_selected_count || 0);

        return {
          ...row,
          initial_count: initialCount,
          selected_range_count: Number(row?.selected_range_count || 0),
          cumulative_selected_count: cumulativeSelectedCount,
          remaining_count: Math.max(initialCount - cumulativeSelectedCount, 0),
        };
      });

      setSummaryRows(summary);
    } catch (error) {
      console.error("loadSummary error:", error);
      setSummaryRows([]);
      setMsg(getRawErrorMessage(error) || "โหลด summary ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [userId, dateFrom, dateTo, dateRangeInvalid, selectedFlock]);

  const loadSelectedDaysForRow = useCallback(
    async (row) => {
      if (!row || !userId) return;

      setDayLoading(true);
      setDetailRows([]);
      setSelectedDay("");
      setMsg("");

      try {
        const farmCode = clean(row?.farm_code);
        const flock = clean(row?.flock);
        const houseNo = clean(row?.house_no);

        if (!farmCode || !flock || !houseNo) {
          setSelectedDayRows([]);
          return;
        }

        const { data, error } = await supabase.rpc("app_get_swine_selected_days", {
          p_farm_code: farmCode,
          p_flock: flock,
          p_house_no: houseNo,
          p_date_from: clean(dateFrom),
          p_date_to: clean(dateTo),
        });

        if (error) throw error;

        const rows = (Array.isArray(data) ? data : []).sort((a, b) =>
          String(a?.selected_date).localeCompare(String(b?.selected_date), "th")
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
    [userId, dateFrom, dateTo]
  );

  const loadDetailForDay = useCallback(
    async (row, day) => {
      if (!row || !day || !userId) return;

      setDetailLoading(true);
      setMsg("");

      try {
        const farmCode = clean(row?.farm_code);
        const flock = clean(row?.flock);
        const houseNo = clean(row?.house_no);
        const selectedDate = clean(day);

        if (!farmCode || !flock || !houseNo || !selectedDate) {
          setDetailRows([]);
          return;
        }

        const { data, error } = await supabase.rpc(
          "app_get_swine_selected_detail_by_day",
          {
            p_farm_code: farmCode,
            p_flock: flock,
            p_house_no: houseNo,
            p_selected_date: selectedDate,
          }
        );

        if (error) throw error;

        const rows = (Array.isArray(data) ? data : []).sort((a, b) =>
          String(a?.swine_code).localeCompare(String(b?.swine_code), "th")
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
    [userId]
  );

  const loadRemainingForRow = useCallback(
    async (row) => {
      if (!row || !userId) return;

      setRemainingLoading(true);
      setMsg("");

      try {
        const farmCode = clean(row?.farm_code);
        const flock = clean(row?.flock);
        const houseNo = clean(row?.house_no);

        if (!farmCode || !flock || !houseNo) {
          setRemainingRows([]);
          return;
        }

        const swineRows = await fetchAllPages((from, to) =>
          supabase
            .from("swines")
            .select("swine_code, birth_date")
            .eq("farm_code", farmCode)
            .eq("flock", flock)
            .eq("house_no", houseNo)
            .order("swine_code", { ascending: true })
            .range(from, to)
        );

        const swineMap = new Map();
        for (const sw of swineRows || []) {
          const swineCode = clean(sw?.swine_code);
          if (!swineCode) continue;
          if (!swineMap.has(swineCode)) {
            swineMap.set(swineCode, {
              swine_code: swineCode,
              birth_date: sw?.birth_date || "",
            });
          }
        }

        const shipmentRows = await fetchAllPages((from, to) =>
          supabase
            .from("swine_shipments")
            .select("id")
            .eq("from_farm_code", farmCode)
            .eq("from_flock", flock)
            .eq("source_house_no", houseNo)
            .lte("selected_date", clean(dateTo))
            .in("status", ACTIVE_STATUSES)
            .order("id", { ascending: true })
            .range(from, to)
        );

        const shipmentIds = (shipmentRows || []).map((x) => x.id).filter(Boolean);
        const cumulativeSelectedCodeSet = new Set();

        for (const shipmentIdChunk of chunkArray(shipmentIds, SHIPMENT_ID_CHUNK_SIZE)) {
          const itemRows = await fetchAllPages((from, to) =>
            supabase
              .from("swine_shipment_items")
              .select("id, swine_code")
              .in("shipment_id", shipmentIdChunk)
              .order("id", { ascending: true })
              .range(from, to)
          );

          for (const item of itemRows || []) {
            const swineCode = clean(item?.swine_code);
            if (swineCode) cumulativeSelectedCodeSet.add(swineCode);
          }
        }

        const remainingBaseRows = Array.from(swineMap.values()).filter(
          (sw) => !cumulativeSelectedCodeSet.has(clean(sw?.swine_code))
        );

        const remainingCodes = remainingBaseRows
          .map((x) => clean(x?.swine_code))
          .filter(Boolean);

        const heatMap = await fetchHeatSummaryMapByCodes(remainingCodes);

        const rows = remainingBaseRows
          .map((sw) => {
            const heat = heatMap.get(clean(sw?.swine_code));
            const birthDate = clean(sw?.birth_date);
            const ageDays = birthDate
              ? Math.floor(
                  (new Date(`${today}T00:00:00`) - new Date(`${birthDate}T00:00:00`)) /
                    (1000 * 60 * 60 * 24)
                )
              : "";

            return {
              swine_code: clean(sw?.swine_code),
              birth_date: birthDate,
              age_days: Number.isFinite(ageDays) ? ageDays : "",
              total_heat_count: Number(heat?.total_heat_count || 0),
              latest_heat_date: clean(heat?.latest_heat_date),
            };
          })
          .sort((a, b) => String(a?.swine_code).localeCompare(String(b?.swine_code), "th"));

        setRemainingRows(rows);
      } catch (error) {
        console.error("loadRemainingForRow error:", error);
        setRemainingRows([]);
        setMsg(getRawErrorMessage(error) || "โหลดรายการคงเหลือไม่สำเร็จ");
      } finally {
        setRemainingLoading(false);
      }
    },
    [userId, dateTo, today]
  );

  useEffect(() => {
    if (pageLoading) return;
    if (!userId) return;
    if (dateRangeInvalid) return;
    void loadSummary();
  }, [pageLoading, userId, loadSummary, dateRangeInvalid]);

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
    params.set("fromFlock", clean(row.flock));
    params.set("houseNo", clean(row.house_no));
    nav(`/shipment-create?${params.toString()}`);
  }

  function goEditForRow(row) {
    if (!row) return;
    const params = new URLSearchParams();
    params.set("fromFarmCode", clean(row.farm_code));
    params.set("fromFlock", clean(row.flock));
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
            จำนวนหมูทั้งหมดใน swines ของ farm+flock+เล้า | จำนวนหมูที่คัดในช่วงนี้ |
            จำนวนคงเหลือที่ยังไม่คัด = จำนวนหมูทั้งหมด - จำนวนหมูคัดสะสมถึงวันสิ้นสุด
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
          maxWidth: 1280,
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

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ประเภทหมู / Flock
              </div>
              <select
                value={selectedFlock}
                onChange={(e) => {
                  setSelectedFlock(e.target.value);
                  setSelectedRowKey("");
                  setSelectedDay("");
                  setSelectedDayRows([]);
                  setDetailRows([]);
                  setRemainingRows([]);
                }}
                style={inputStyle}
              >
                <option value="">ทุก Flock ที่มีสิทธิ์</option>
                {flockOptions.map((flock) => (
                  <option key={flock} value={flock}>
                    {flock}
                  </option>
                ))}
              </select>
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
            <div className="small" style={{ marginTop: 10, color: "#b91c1c", fontWeight: 700 }}>
              วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด
            </div>
          ) : null}
        </div>

        {msg ? (
          <div style={cardStyle}>
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{msg}</div>
          </div>
        ) : null}

        {!msg && emptyStateText ? (
          <div style={cardStyle}>
            <div style={{ color: "#475569", fontWeight: 700 }}>{emptyStateText}</div>
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
            <div className="small" style={{ color: "#666" }}>
              จำนวนหมูทั้งหมดที่มีตั้งต้น
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalInitial}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>
              จำนวนหมูที่คัดในช่วงนี้
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalSelectedRange}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>
              จำนวนหมูคัดสะสมถึงวันสิ้นสุด
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalSelectedCumulative}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>
              จำนวนคงเหลือที่ยังไม่คัด
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalRemaining}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>
              จำนวนฟาร์ม
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.farmCount}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>
              จำนวน Flock
            </div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.flockCount}</div>
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
            <div>ตารางสรุปตามฟาร์ม / Flock / เล้า</div>

            {selectedSummaryRow ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="linkbtn" type="button" onClick={() => goCreateForRow(selectedSummaryRow)}>
                  ไปหน้า Create
                </button>
                <button className="linkbtn" type="button" onClick={() => goEditForRow(selectedSummaryRow)}>
                  ไปหน้า Edit
                </button>
              </div>
            ) : null}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1320, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>ฟาร์ม</th>
                  <th style={thStyle}>Flock</th>
                  <th style={thStyle}>เล้า</th>
                  <th style={thStyle}>วันที่คัดในช่วงที่เลือก</th>
                  <th style={thStyle}>จำนวนหมูทั้งหมดที่มีตั้งต้น</th>
                  <th style={thStyle}>จำนวนหมูที่คัดในช่วงนี้</th>
                  <th style={thStyle}>จำนวนหมูคัดสะสมถึงวันสิ้นสุด</th>
                  <th style={thStyle}>จำนวนคงเหลือที่ยังไม่คัด</th>
                </tr>
              </thead>
              <tbody>
                {visibleSummaryRows.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={8}>
                      {loading ? "กำลังโหลด..." : emptyStateText || "ไม่พบข้อมูล"}
                    </td>
                  </tr>
                ) : (
                  visibleSummaryRows.map((row) => {
                    const key = makeScopeKey(row.farm_code, row.flock, row.house_no);
                    const active = key === selectedRowKey;

                    return (
                      <tr
                        key={key}
                        onClick={() => {
                          if (active) return;
                          setSelectedRowKey(key);
                        }}
                        style={{ background: active ? "#fef9c3" : "#fff", cursor: "pointer" }}
                      >
                        <td style={tdStyle}>
                          {clean(row.farm_name)
                            ? `${row.farm_code} - ${row.farm_name}`
                            : row.farm_code}
                        </td>
                        <td style={tdStyle}>{row.flock}</td>
                        <td style={tdStyle}>{row.house_no}</td>
                        <td style={tdStyle}>{row.selected_date_range_text || "-"}</td>
                        <td style={tdStyleNumber}>{Number(row.initial_count || 0)}</td>
                        <td style={tdStyleNumber}>{Number(row.selected_range_count || 0)}</td>
                        <td style={tdStyleNumber}>{Number(row.cumulative_selected_count || 0)}</td>
                        <td style={tdStyleNumber}>{Number(row.remaining_count || 0)}</td>
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
                  ยอดรวมวันที่คัดของฟาร์ม {selectedSummaryRow.farm_code} | Flock{" "}
                  {selectedSummaryRow.flock} | เล้า {selectedSummaryRow.house_no}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="linkbtn" type="button" onClick={() => goCreateForRow(selectedSummaryRow)}>
                    ไปหน้า Create
                  </button>
                  <button className="linkbtn" type="button" onClick={() => goEditForRow(selectedSummaryRow)}>
                    ไปหน้า Edit
                  </button>
                </div>
              </div>

              <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                กดเลือกวันที่ก่อน แล้วจึงแสดงเบอร์หมูแต่ละตัวของวันนั้น
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
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
                          key={String(row.selected_date)}
                          onClick={() => setSelectedDay(String(row.selected_date))}
                          style={{
                            background:
                              clean(selectedDay) === clean(row.selected_date)
                                ? "#fef9c3"
                                : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <td style={tdStyle}>{formatDateDisplay(row.selected_date)}</td>
                          <td style={tdStyleNumber}>{Number(row.total_selected_count || 0)}</td>
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
                    {selectedSummaryRow.farm_code} | Flock {selectedSummaryRow.flock} | เล้า{" "}
                    {selectedSummaryRow.house_no}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="linkbtn" type="button" onClick={() => goCreateForRow(selectedSummaryRow)}>
                      ไปหน้า Create
                    </button>
                    <button className="linkbtn" type="button" onClick={() => goEditForRow(selectedSummaryRow)}>
                      ไปหน้า Edit
                    </button>
                  </div>
                </div>

                <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                  แสดงเฉพาะเบอร์ที่คัดในวันที่เลือก โดยนับ 1 เบอร์หมู = 1 แถว
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse" }}>
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
                            <td style={tdStyleNumber}>{row.age_days ?? ""}</td>
                            <td style={tdStyleNumber}>{row.teats_left ?? ""}</td>
                            <td style={tdStyleNumber}>{row.teats_right ?? ""}</td>
                            <td style={tdStyleNumber}>{row.weight ?? ""}</td>
                            <td style={tdStyleNumber}>{row.backfat ?? ""}</td>
                            <td style={tdStyleNumber}>{Number(row.total_heat_count || 0)}</td>
                            <td style={tdStyle}>
                              {row.latest_heat_date ? formatDateDisplay(row.latest_heat_date) : "-"}
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
                  เบอร์ที่ยังไม่คัดของฟาร์ม {selectedSummaryRow.farm_code} | Flock{" "}
                  {selectedSummaryRow.flock} | เล้า {selectedSummaryRow.house_no}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="linkbtn" type="button" onClick={() => goCreateForRow(selectedSummaryRow)}>
                    ไปหน้า Create
                  </button>
                  <button className="linkbtn" type="button" onClick={() => goEditForRow(selectedSummaryRow)}>
                    ไปหน้า Edit
                  </button>
                </div>
              </div>

              <div className="small" style={{ color: "#666", marginBottom: 10 }}>
                แสดงรายการหมูคงเหลือจากหลัก จำนวนหมูทั้งหมด - จำนวนหมูคัดสะสมถึงวันสิ้นสุด
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
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
                          <td style={tdStyleNumber}>{row.age_days ?? ""}</td>
                          <td style={tdStyleNumber}>{Number(row.total_heat_count || 0)}</td>
                          <td style={tdStyle}>
                            {row.latest_heat_date ? formatDateDisplay(row.latest_heat_date) : "-"}
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