// src/pages/RemainingSwinePage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import { formatDateDisplay } from "../lib/dateFormat";

function clean(v) {
  return String(v ?? "").trim();
}

function calcAgeDaysFromToday(birthDate) {
  const b = clean(birthDate);
  if (!b) return "";
  const today = new Date();
  const a = new Date(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}T00:00:00`
  );
  const c = new Date(`${b}T00:00:00`);
  const diff = Math.floor((a - c) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : "";
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

export default function RemainingSwinePage() {
  const nav = useNavigate();

  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [myRole, setMyRole] = useState("");
  const [userId, setUserId] = useState("");
  const [allowedFarmCodes, setAllowedFarmCodes] = useState([]);

  const [allRows, setAllRows] = useState([]);

  const [farmFilter, setFarmFilter] = useState("");
  const [houseFilter, setHouseFilter] = useState("");
  const [swineSearch, setSwineSearch] = useState("");

  const [selectedGroupKey, setSelectedGroupKey] = useState("");

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
        console.error("RemainingSwinePage init error:", error);
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

  const loadRemainingSwines = useCallback(async () => {
    if (!userId || !myRole) return;

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

      const { data: masterRows, error: masterError } = await supabase
        .from("swine_master")
        .select("swine_code, delivery_state")
        .eq("delivery_state", "available")
        .limit(50000);

      if (masterError) throw masterError;

      const availableCodes = (masterRows || [])
        .map((row) => clean(row?.swine_code))
        .filter(Boolean);

      if (!availableCodes.length) {
        setAllRows([]);
        setLoading(false);
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
          .in("swine_code", chunk)
          .limit(50000);

        if (!isAdmin) {
          swineQuery = swineQuery.in("farm_code", farmFilterList);
        }

        const { data, error } = await swineQuery;
        if (error) throw error;
        swineRows = swineRows.concat(data || []);
      }

      const swineCodes = swineRows.map((row) => clean(row?.swine_code)).filter(Boolean);

      let heatMap = new Map();
      if (swineCodes.length > 0) {
        const heatChunks = [];
        for (let i = 0; i < swineCodes.length; i += chunkSize) {
          heatChunks.push(swineCodes.slice(i, i + chunkSize));
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

        heatMap = new Map(heatRowsAll.map((row) => [clean(row?.swine_code), row]));
      }

      const mergedRows = (swineRows || [])
        .map((row) => {
          const swineCode = clean(row?.swine_code);
          const heat = heatMap.get(swineCode);

          return {
            swine_code: swineCode,
            farm_code: clean(row?.farm_code),
            farm_name: clean(row?.farm_name),
            house_no: clean(row?.house_no),
            birth_date: clean(row?.birth_date),
            age_days: calcAgeDaysFromToday(row?.birth_date),
            total_heat_count: Number(heat?.total_heat_count || 0),
            latest_heat_date: getLatestHeatDate(heat),
          };
        })
        .filter((row) => clean(row.farm_code) && clean(row.house_no))
        .sort((a, b) => {
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
      console.error("loadRemainingSwines error:", error);
      setAllRows([]);
      setMsg(getRawErrorMessage(error) || "โหลดรายการหมูที่ยังไม่คัดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [userId, myRole, allowedFarmCodes]);

  useEffect(() => {
    if (pageLoading) return;
    if (!userId || !myRole) return;
    void loadRemainingSwines();
  }, [pageLoading, userId, myRole, loadRemainingSwines]);

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
          remaining_count: 0,
        });
      }
      map.get(key).remaining_count += 1;
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
      totalRemaining: kpiRows.length,
      farmCount: farmSet.size,
      houseCount: houseSet.size,
      avgHeat:
        kpiRows.length > 0
          ? (
              kpiRows.reduce(
                (sum, row) => sum + Number(row.total_heat_count || 0),
                0
              ) / kpiRows.length
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
          <div style={{ fontSize: 20, fontWeight: 800 }}>หมูที่ยังไม่คัด</div>
          <div className="small" style={{ color: "#666", marginTop: 6 }}>
            แสดงเฉพาะหมูที่ยังอยู่สถานะ available พร้อมข้อมูล heat และอายุ
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
                onClick={() => void loadRemainingSwines()}
                disabled={loading}
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
            <div className="small" style={{ color: "#666" }}>คงเหลือทั้งหมด</div>
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

          <div style={cardStyle}>
            <div className="small" style={{ color: "#666" }}>ค่าเฉลี่ยจำนวน heat</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{kpi.avgHeat}</div>
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
            <div>สรุปคงเหลือตามฟาร์ม / เล้า</div>

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
                  <th style={thStyle}>จำนวนคงเหลือ</th>
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
                        <td style={tdStyleNumber}>{row.remaining_count}</td>
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
                ? `รายการหมูที่ยังไม่คัดของฟาร์ม ${selectedGroupRow.farm_code} เล้า ${selectedGroupRow.house_no}`
                : "รายการหมูที่ยังไม่คัด"}
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
                minWidth: 1200,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>ฟาร์ม</th>
                  <th style={thStyle}>เล้า</th>
                  <th style={thStyle}>เบอร์หมู</th>
                  <th style={thStyle}>วันเกิด</th>
                  <th style={thStyle}>อายุหมู(วัน)</th>
                  <th style={thStyle}>จำนวน heat</th>
                  <th style={thStyle}>heat ล่าสุด</th>
                </tr>
              </thead>

              <tbody>
                {visibleDetailRows.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={7}>
                      {loading ? "กำลังโหลด..." : "ไม่พบข้อมูล"}
                    </td>
                  </tr>
                ) : (
                  visibleDetailRows.map((row) => (
                    <tr key={row.swine_code}>
                      <td style={tdStyle}>
                        {row.farm_name
                          ? `${row.farm_code} - ${row.farm_name}`
                          : row.farm_code}
                      </td>
                      <td style={tdStyle}>{row.house_no}</td>
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
      </div>
    </div>
  );
}