// src/pages/SelectionHistoryPage.jsx

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

export default function SelectionHistoryPage() {
  const nav = useNavigate();

  const today = todayYmdLocal();
  const defaultFrom = addDaysYmd(today, -6);

  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [myRole, setMyRole] = useState("");
  const [userId, setUserId] = useState("");
  const [allowedFarmCodes, setAllowedFarmCodes] = useState([]);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);

  const [allRows, setAllRows] = useState([]);

  const [farmFilter, setFarmFilter] = useState("");
  const [houseFilter, setHouseFilter] = useState("");
  const [swineSearch, setSwineSearch] = useState("");

  const [selectedGroupKey, setSelectedGroupKey] = useState("");

  const dateRangeInvalid =
    !!clean(dateFrom) && !!clean(dateTo) && clean(dateFrom) > clean(dateTo);

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
        console.error("SelectionHistoryPage init error:", error);
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

  const loadHistory = useCallback(async () => {
    if (!userId || !myRole) return;
    if (dateRangeInvalid) return;

    setLoading(true);
    setMsg("");
    setSelectedGroupKey("");

    try {
      const isAdmin = myRole === "admin";
      const farmFilterList = isAdmin ? [] : allowedFarmCodes;

      if (!isAdmin && farmFilterList.length === 0) {
        setAllRows([]);
        setLoading(false);
        return;
      }

      let shipmentQuery = supabase
        .from("swine_shipments")
        .select("id, from_farm_code, from_farm_name, selected_date, status")
        .gte("selected_date", clean(dateFrom))
        .lte("selected_date", clean(dateTo))
        .in("status", ["draft", "submitted"])
        .limit(5000);

      if (!isAdmin) {
        shipmentQuery = shipmentQuery.in("from_farm_code", farmFilterList);
      }

      const { data: shipmentRows, error: shipmentError } = await shipmentQuery;
      if (shipmentError) throw shipmentError;

      const shipmentIds = (shipmentRows || []).map((row) => row.id).filter(Boolean);

      if (!shipmentIds.length) {
        setAllRows([]);
        setLoading(false);
        return;
      }

      const { data: itemRows, error: itemError } = await supabase
        .from("swine_shipment_items")
        .select(`
          shipment_id,
          swine_code,
          teats_left,
          teats_right,
          weight,
          backfat,
          swine:swines!swine_shipment_items_swine_id_fkey (
            farm_code,
            farm_name,
            house_no,
            birth_date
          )
        `)
        .in("shipment_id", shipmentIds)
        .limit(50000);

      if (itemError) throw itemError;

      const swineCodes = Array.from(
        new Set((itemRows || []).map((row) => clean(row?.swine_code)).filter(Boolean))
      );

      let heatMap = new Map();
      if (swineCodes.length > 0) {
        const chunkSize = 1000;
        const chunks = [];
        for (let i = 0; i < swineCodes.length; i += chunkSize) {
          chunks.push(swineCodes.slice(i, i + chunkSize));
        }

        const heatRowsAll = [];
        for (const chunk of chunks) {
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

        heatMap = new Map(
          heatRowsAll.map((row) => [clean(row?.swine_code), row])
        );
      }

      const shipmentMap = new Map(
        (shipmentRows || []).map((row) => [String(row.id), row])
      );

      const mergedRows = (itemRows || [])
        .map((item) => {
          const shipment = shipmentMap.get(String(item.shipment_id));
          if (!shipment) return null;

          const swineCode = clean(item?.swine_code);
          const heat = heatMap.get(swineCode);

          const farmCode =
            clean(shipment?.from_farm_code) || clean(item?.swine?.farm_code);
          const farmName =
            clean(shipment?.from_farm_name) || clean(item?.swine?.farm_name);

          return {
            selected_date: clean(shipment?.selected_date),
            farm_code: farmCode,
            farm_name: farmName,
            house_no: clean(item?.swine?.house_no),
            swine_code: swineCode,
            birth_date: clean(item?.swine?.birth_date),
            age_days: calcAgeDays(
              clean(shipment?.selected_date),
              clean(item?.swine?.birth_date)
            ),
            teats_left: item?.teats_left ?? "",
            teats_right: item?.teats_right ?? "",
            weight: item?.weight ?? "",
            backfat: item?.backfat ?? "",
            total_heat_count: Number(heat?.total_heat_count || 0),
            latest_heat_date: getLatestHeatDate(heat),
          };
        })
        .filter((row) => row && clean(row.farm_code) && clean(row.house_no))
        .sort((a, b) => {
          const dateCompare = String(a.selected_date).localeCompare(
            String(b.selected_date),
            "th"
          );
          if (dateCompare !== 0) return dateCompare * -1;

          const farmCompare = String(a.farm_code).localeCompare(
            String(b.farm_code),
            "th"
          );
          if (farmCompare !== 0) return farmCompare;

          const houseCompare = String(a.house_no).localeCompare(
            String(b.house_no),
            "th"
          );
          if (houseCompare !== 0) return houseCompare;

          return String(a.swine_code).localeCompare(String(b.swine_code), "th");
        });

      setAllRows(mergedRows);
    } catch (error) {
      console.error("loadHistory error:", error);
      setAllRows([]);
      setMsg(getRawErrorMessage(error) || "โหลดประวัติการคัดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [userId, myRole, allowedFarmCodes, dateFrom, dateTo, dateRangeInvalid]);

  useEffect(() => {
    if (pageLoading) return;
    if (!userId || !myRole) return;
    if (dateRangeInvalid) return;
    void loadHistory();
  }, [pageLoading, userId, myRole, loadHistory, dateRangeInvalid]);

  const farmOptions = useMemo(() => {
    return Array.from(
      new Map(
        allRows.map((row) => [
          clean(row.farm_code),
          {
            value: clean(row.farm_code),
            label: row.farm_name
              ? `${clean(row.farm_code)} - ${clean(row.farm_name)}`
              : clean(row.farm_code),
          },
        ])
      ).values()
    ).sort((a, b) => String(a.label).localeCompare(String(b.label), "th"));
  }, [allRows]);

  const houseOptions = useMemo(() => {
    const rows = farmFilter
      ? allRows.filter((row) => clean(row.farm_code) === clean(farmFilter))
      : allRows;

    return Array.from(
      new Set(rows.map((row) => clean(row.house_no)).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b), "th"));
  }, [allRows, farmFilter]);

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (farmFilter && clean(row.farm_code) !== clean(farmFilter)) return false;
      if (houseFilter && clean(row.house_no) !== clean(houseFilter)) return false;

      const q = clean(swineSearch).toLowerCase();
      if (q) {
        const haystack = [
          clean(row.swine_code),
          clean(row.farm_code),
          clean(row.farm_name),
          clean(row.house_no),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [allRows, farmFilter, houseFilter, swineSearch]);

  const groupedSummaryRows = useMemo(() => {
    const map = new Map();

    for (const row of filteredRows) {
      const key = makeFarmHouseKey(row.farm_code, row.house_no);
      if (!map.has(key)) {
        map.set(key, {
          farm_code: clean(row.farm_code),
          farm_name: clean(row.farm_name),
          house_no: clean(row.house_no),
          selected_count: 0,
        });
      }
      map.get(key).selected_count += 1;
    }

    return Array.from(map.values()).sort((a, b) => {
      const farmCompare = String(a.farm_code).localeCompare(
        String(b.farm_code),
        "th"
      );
      if (farmCompare !== 0) return farmCompare;
      return String(a.house_no).localeCompare(String(b.house_no), "th");
    });
  }, [filteredRows]);

  const selectedGroupRow = useMemo(() => {
    return (
      groupedSummaryRows.find(
        (row) => makeFarmHouseKey(row.farm_code, row.house_no) === selectedGroupKey
      ) || null
    );
  }, [groupedSummaryRows, selectedGroupKey]);

  const visibleSummaryRows = useMemo(() => {
    if (!selectedGroupRow) return groupedSummaryRows;
    return [selectedGroupRow];
  }, [groupedSummaryRows, selectedGroupRow]);

  const visibleDetailRows = useMemo(() => {
    if (!selectedGroupRow) return filteredRows;
    return filteredRows.filter(
      (row) =>
        clean(row.farm_code) === clean(selectedGroupRow.farm_code) &&
        clean(row.house_no) === clean(selectedGroupRow.house_no)
    );
  }, [filteredRows, selectedGroupRow]);

  const kpiRows = selectedGroupRow ? visibleDetailRows : filteredRows;

  const kpi = useMemo(() => {
    const farmSet = new Set(kpiRows.map((row) => clean(row.farm_code)).filter(Boolean));
    const houseSet = new Set(
      kpiRows.map((row) => makeFarmHouseKey(row.farm_code, row.house_no))
    );

    return {
      totalSelected: kpiRows.length,
      farmCount: farmSet.size,
      houseCount: houseSet.size,
      avgWeight:
        kpiRows.length > 0
          ? (
              kpiRows.reduce((sum, row) => sum + Number(row.weight || 0), 0) /
              kpiRows.filter((row) => Number(row.weight || 0) > 0).length || 0
            ).toFixed(1)
          : "0.0",
    };
  }, [kpiRows]);

  function openCreateForGroup(row) {
    if (!row) return;
    const params = new URLSearchParams();
    params.set("fromFarmCode", clean(row.farm_code));
    params.set("houseNo", clean(row.house_no));
    nav(`/create-shipment?${params.toString()}`);
  }

  function openEditForGroup(row) {
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
          <div style={{ fontSize: 20, fontWeight: 800 }}>ประวัติการคัด</div>
          <div className="small" style={{ color: "#666", marginTop: 6 }}>
            แสดงประวัติหมูที่คัดแล้วในช่วงวันที่เลือก พร้อมอายุ น้ำหนัก backfat และ heat
          </div>
        </div>

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
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setSelectedGroupKey("");
                }}
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
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setSelectedGroupKey("");
                }}
                style={inputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                {formatDateDisplay(dateTo)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์ม
              </div>
              <select
                value={farmFilter}
                onChange={(e) => {
                  setFarmFilter(e.target.value);
                  setHouseFilter("");
                  setSelectedGroupKey("");
                }}
                style={inputStyle}
              >
                <option value="">ทั้งหมด</option>
                {farmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                เล้า
              </div>
              <select
                value={houseFilter}
                onChange={(e) => {
                  setHouseFilter(e.target.value);
                  setSelectedGroupKey("");
                }}
                style={inputStyle}
              >
                <option value="">ทั้งหมด</option>
                {houseOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ค้นหา
              </div>
              <input
                value={swineSearch}
                onChange={(e) => {
                  setSwineSearch(e.target.value);
                  setSelectedGroupKey("");
                }}
                placeholder="ค้นหาเบอร์หมู / ฟาร์ม / เล้า"
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
              <button
                className="linkbtn"
                type="button"
                onClick={() => void loadHistory()}
                disabled={loading || dateRangeInvalid}
              >
                {loading ? "กำลังโหลด..." : "Refresh"}
              </button>

              <button
                className="linkbtn"
                type="button"
                onClick={() => {
                  setFarmFilter("");
                  setHouseFilter("");
                  setSwineSearch("");
                  setSelectedGroupKey("");
                  setDateFrom(defaultFrom);
                  setDateTo(today);
                }}
              >
                ล้าง filter
              </button>

              {selectedGroupRow ? (
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => setSelectedGroupKey("")}
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
            <div className="small" style={{ color: "#666" }}>คัดแล้วทั้งหมด</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.totalSelected}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนฟาร์ม</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.farmCount}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>จำนวนเล้า</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.houseCount}</div>
          </div>

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>น้ำหนักเฉลี่ย</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.avgWeight}</div>
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
            <div>สรุปตามฟาร์ม / เล้า</div>

            {selectedGroupRow ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => openCreateForGroup(selectedGroupRow)}
                >
                  ไปหน้า Create
                </button>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => openEditForGroup(selectedGroupRow)}
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
                minWidth: 680,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>ฟาร์ม</th>
                  <th style={thStyle}>เล้า</th>
                  <th style={thStyle}>จำนวนที่คัด</th>
                </tr>
              </thead>

              <tbody>
                {visibleSummaryRows.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={3}>
                      {loading ? "กำลังโหลด..." : "ไม่พบข้อมูล"}
                    </td>
                  </tr>
                ) : (
                  visibleSummaryRows.map((row) => {
                    const key = makeFarmHouseKey(row.farm_code, row.house_no);
                    const active = key === selectedGroupKey;

                    return (
                      <tr
                        key={key}
                        onClick={() => {
                          if (active) return;
                          setSelectedGroupKey(key);
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
                        <td style={tdStyleNumber}>{row.selected_count}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
            <div>
              {selectedGroupRow
                ? `รายการที่คัดแล้วของฟาร์ม ${selectedGroupRow.farm_code} เล้า ${selectedGroupRow.house_no}`
                : "รายการที่คัดแล้ว"}
            </div>

            {selectedGroupRow ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => openCreateForGroup(selectedGroupRow)}
                >
                  ไปหน้า Create
                </button>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={() => openEditForGroup(selectedGroupRow)}
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
                minWidth: 1300,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>วันที่คัด</th>
                  <th style={thStyle}>ฟาร์ม</th>
                  <th style={thStyle}>เล้า</th>
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
                {visibleDetailRows.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={11}>
                      {loading ? "กำลังโหลด..." : "ไม่พบข้อมูล"}
                    </td>
                  </tr>
                ) : (
                  visibleDetailRows.map((row, idx) => (
                    <tr key={`${row.selected_date}__${row.swine_code}__${idx}`}>
                      <td style={tdStyle}>{formatDateDisplay(row.selected_date)}</td>
                      <td style={tdStyle}>
                        {row.farm_name
                          ? `${row.farm_code} - ${row.farm_name}`
                          : row.farm_code}
                      </td>
                      <td style={tdStyle}>{row.house_no}</td>
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
      </div>
    </div>
  );
}