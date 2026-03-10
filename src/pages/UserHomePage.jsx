// src/pages/UserHomePage.jsx

import React, { useEffect, useMemo, useState } from "react";
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

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function calcAgeDay(selectedDateValue, birthDateValue) {
  if (!selectedDateValue || !birthDateValue) return "";

  const d1 = new Date(`${selectedDateValue}T00:00:00`);
  const d2 = new Date(`${birthDateValue}T00:00:00`);
  const diffMs = d1.getTime() - d2.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) return "";
  return Math.floor(diffMs / 86400000);
}

export default function UserHomePage() {
  const nav = useNavigate();

  const [msg, setMsg] = useState("");
  const [myRole, setMyRole] = useState("user");

  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [currentShipmentId, setCurrentShipmentId] = useState(null);
  const [currentStatus, setCurrentStatus] = useState("draft");
  const [exporting, setExporting] = useState(false);

  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);

  const [toFarmId, setToFarmId] = useState(null);

  const [swineQ, setSwineQ] = useState("");
  const [swineLoading, setSwineLoading] = useState(false);
  const [swineOptions, setSwineOptions] = useState([]);
  const [selectedSwineIds, setSelectedSwineIds] = useState(new Set());

  const [swineForm, setSwineForm] = useState({});
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

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
    let alive = true;

    async function loadFromFarms() {
      setFromLoading(true);
      setMsg("");

      try {
        const { data: availableRows, error: e1 } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .limit(5000);

        if (e1) throw e1;

        const availableCodes = (availableRows || [])
          .map((x) => x.swine_code)
          .filter(Boolean);

        if (!availableCodes.length) {
          if (alive) setFromOptions([]);
          return;
        }

        const { data, error } = await supabase
          .from("swines")
          .select("farm_code, farm_name, branch_id, swine_code")
          .not("farm_code", "is", null)
          .in("swine_code", availableCodes)
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

  useEffect(() => {
    let alive = true;

    async function loadSwinesOfFarm() {
      setSwineOptions([]);
      setSelectedSwineIds(new Set());
      setSwineForm({});
      setSwineQ("");
      setMsg("");

      if (!fromFarm?.farm_code) return;

      setSwineLoading(true);

      try {
        const { data: availableRows, error: e1 } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .limit(5000);

        if (e1) throw e1;

        const availableCodes = (availableRows || [])
          .map((x) => x.swine_code)
          .filter(Boolean);

        if (!availableCodes.length) {
          if (alive) setSwineOptions([]);
          return;
        }

        const { data, error } = await supabase
          .from("swines")
          .select("id, swine_code, farm_code")
          .eq("farm_code", fromFarm.farm_code)
          .in("swine_code", availableCodes)
          .order("swine_code", { ascending: true })
          .limit(2000);

        if (error) throw error;

        if (alive) setSwineOptions(data || []);
      } catch (e) {
        console.error("loadSwinesOfFarm error:", e);
        if (alive) {
          setSwineOptions([]);
          setMsg(e?.message || "โหลดรายการหมูไม่สำเร็จ");
        }
      } finally {
        if (alive) setSwineLoading(false);
      }
    }

    loadSwinesOfFarm();
    return () => {
      alive = false;
    };
  }, [fromFarm?.farm_code]);

  const filteredSwines = useMemo(() => {
    const q = clean(swineQ);
    if (!q) return swineOptions.slice(0, 50);
    const qq = q.toLowerCase();
    return swineOptions
      .filter((s) => String(s.swine_code || "").toLowerCase().includes(qq))
      .slice(0, 50);
  }, [swineOptions, swineQ]);

  function toggleSwine(id) {
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
  }

  function setSwineField(swine_id, field, value) {
    setSwineForm((prev) => {
      const cur = prev[swine_id] || {};
      return { ...prev, [swine_id]: { ...cur, [field]: value } };
    });
  }

  const canSave = useMemo(() => {
    return !!selectedDate && !!fromFarm?.farm_code && !!toFarmId && selectedSwineIds.size > 0;
  }, [selectedDate, fromFarm, toFarmId, selectedSwineIds]);

  async function logout(e) {
    console.log("logout clicked");
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setMsg("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-")) localStorage.removeItem(k);
        }
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith("sb-")) sessionStorage.removeItem(k);
        }
      } catch {}

      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.auth.getSession();
        if (!data?.session) {
          window.location.replace("/");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      console.warn("session still exists after signOut");
      window.location.replace("/");
    } catch (err) {
      console.error("logout error:", err);
      setMsg(err?.message || "Logout ไม่สำเร็จ");
    }
  }

  async function saveDraft() {
    if (!canSave) {
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + หมูอย่างน้อย 1 ตัว");
      return;
    }

    setSaving(true);
    setMsg("");

    try {
      const selectedIds = Array.from(selectedSwineIds);
      const selectedCount = selectedIds.length;

      const header = {
        selected_date: selectedDate || null,
        from_farm_code: fromFarm.farm_code,
        from_farm_name: fromFarm.farm_name || null,
        from_branch_id: fromFarm.branch_id || null,
        to_farm_id: toFarmId,
        remark: remark || null,
        status: "draft",
      };

      const res1 = await supabase
        .from("swine_shipments")
        .insert([header])
        .select("id, status")
        .single();

      if (res1.error) throw res1.error;

      const sh = res1.data;
      setCurrentShipmentId(sh.id);
      setCurrentStatus(sh.status || "draft");

      const swineMap = new Map((swineOptions || []).map((s) => [s.id, s.swine_code]));

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
        const swine_code = swineMap.get(swine_id) || null;

        return {
          shipment_id: sh.id,
          swine_id,
          swine_code,
          teats_left: toIntOrNull(f.teats_left),
          teats_right: toIntOrNull(f.teats_right),
          backfat: toNumOrNull(f.backfat),
          weight: toNumOrNull(f.weight),
        };
      });

      if (itemRows.some((r) => !r.swine_code)) {
        throw new Error("MISSING_SWINE_CODE: บางตัวไม่มี swine_code");
      }

      if (itemRows.some((r) => !r.swine_id)) {
        throw new Error("MISSING_SWINE_ID: บางตัวไม่มี swine_id");
      }

      const res2 = await supabase
        .from("swine_shipment_items")
        .insert(itemRows)
        .select("id, swine_code");

      if (res2.error) throw res2.error;

      const pickedCodes = (res2.data || [])
        .map((x) => x.swine_code)
        .filter(Boolean);

      if (pickedCodes.length) {
        const { error: e3 } = await supabase
          .from("swine_master")
          .update({ delivery_state: "reserved" })
          .in("swine_code", pickedCodes);

        if (e3) throw e3;
      }

      setMsg(`Save Draft สำเร็จ ✅ (Shipment: ${sh.id}, หมู: ${selectedCount} ตัว)`);

      setRemark("");
      setSelectedSwineIds(new Set());
      setSwineForm({});

      setSwineLoading(true);
      try {
        const { data: availableRows, error: e1 } = await supabase
          .from("swine_master")
          .select("swine_code")
          .eq("delivery_state", "available")
          .limit(5000);

        if (e1) throw e1;

        const availableCodes = (availableRows || [])
          .map((x) => x.swine_code)
          .filter(Boolean);

        if (!availableCodes.length) {
          setSwineOptions([]);
        } else {
          const { data, error } = await supabase
            .from("swines")
            .select("id, swine_code, farm_code")
            .eq("farm_code", fromFarm.farm_code)
            .in("swine_code", availableCodes)
            .order("swine_code", { ascending: true })
            .limit(2000);

          if (error) throw error;
          setSwineOptions(data || []);
        }
      } catch (e) {
        console.error("reload swines after save error:", e);
      } finally {
        setSwineLoading(false);
      }
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

  async function exportCsvAndSubmit() {
    if (!currentShipmentId) {
      setMsg("กรุณา Save Draft ก่อน แล้วจึง Export CSV");
      return;
    }

    setExporting(true);
    setMsg("");

    try {
      const { data: shipment, error: e1 } = await supabase
        .from("swine_shipments")
        .select(`
          id,
          shipment_no,
          status,
          selected_date,
          from_farm_code,
          from_farm_name,
          to_farm_id,
          remark
        `)
        .eq("id", currentShipmentId)
        .single();

      if (e1) throw e1;
      if (!shipment) throw new Error("ไม่พบข้อมูล shipment");
      if (shipment.status !== "draft") {
        throw new Error("รายการนี้ไม่ใช่ draft หรือถูก export ไปแล้ว");
      }

      const { data: toFarm, error: e2 } = await supabase
        .from("swine_farms")
        .select("id, farm_code, farm_name")
        .eq("id", shipment.to_farm_id)
        .single();

      if (e2) throw e2;

      const { data: items, error: e3 } = await supabase
        .from("swine_shipment_items")
        .select(`
          id,
          swine_id,
          swine_code,
          teats_left,
          teats_right,
          backfat,
          weight
        `)
        .eq("shipment_id", currentShipmentId)
        .order("created_at", { ascending: true });

      if (e3) throw e3;
      if (!items || items.length === 0) {
        throw new Error("ไม่มีรายการหมูใน shipment นี้");
      }

      const swineIds = items.map((x) => x.swine_id).filter(Boolean);

      let birthMap = new Map();
      if (swineIds.length) {
        const { data: swineRows, error: e4 } = await supabase
          .from("swines")
          .select("id, birth_date")
          .in("id", swineIds);

        if (e4) throw e4;

        birthMap = new Map((swineRows || []).map((x) => [x.id, x.birth_date]));
      }

      const headers = [
        "shipment_id",
        "shipment_no",
        "status",
        "selected_date",
        "from_farm_code",
        "from_farm_name",
        "to_farm_id",
        "to_farm_code",
        "to_farm_name",
        "swine_id",
        "swine_code",
        "birth_date",
        "age_day",
        "teats_left",
        "teats_right",
        "backfat",
        "weight",
        "remark",
      ];

      const rows = items.map((it) => {
        const birthDate = birthMap.get(it.swine_id) || "";
        const ageDay = calcAgeDay(shipment.selected_date, birthDate);

        return [
          shipment.id,
          shipment.shipment_no || "",
          "submitted",
          shipment.selected_date || "",
          shipment.from_farm_code || "",
          shipment.from_farm_name || "",
          shipment.to_farm_id || "",
          toFarm?.farm_code || "",
          toFarm?.farm_name || "",
          it.swine_id || "",
          it.swine_code || "",
          birthDate || "",
          ageDay,
          it.teats_left ?? "",
          it.teats_right ?? "",
          it.backfat ?? "",
          it.weight ?? "",
          shipment.remark || "",
        ];
      });

      const csvText = [
        headers.map(escapeCsv).join(","),
        ...rows.map((r) => r.map(escapeCsv).join(",")),
      ].join("\n");

      const filename = `shipment_${shipment.id}_${shipment.selected_date || "no-date"}.csv`;
      const blob = new Blob(["\uFEFF" + csvText], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const { error: e5 } = await supabase
        .from("swine_shipments")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
        })
        .eq("id", currentShipmentId)
        .eq("status", "draft");

      if (e5) throw e5;

      setCurrentStatus("submitted");
      setMsg("Export CSV สำเร็จ ✅ และเปลี่ยนสถานะเป็น submitted แล้ว");
    } catch (e) {
      console.error("exportCsvAndSubmit error:", e);
      setMsg(
        `${e?.message || "Export CSV ไม่สำเร็จ"}${
          e?.details ? ` | details: ${e.details}` : ""
        }${e?.hint ? ` | hint: ${e.hint}` : ""}`
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page">
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
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>User</div>
          <div className="small">เลือกวันคัด ฟาร์มต้นทาง/ปลายทาง และเลือกหมู</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", position: "relative", zIndex: 21 }}>
          <button className="linkbtn" type="button" onClick={() => nav(-1)}>
            Back
          </button>
          {myRole !== "admin" ? (
            <button
              className="linkbtn"
              type="button"
              onClick={logout}
              style={{ position: "relative", zIndex: 22 }}
            >
              Logout
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          maxWidth: 1100,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
        }}
      >
        {msg ? (
          <div className="card" style={{ padding: 12 }}>
            <div
              className="small"
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800 }}>วันคัด</div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 12,
              border: "1px solid #ddd",
            }}
          />

          <div className="small" style={{ color: "#444" }}>
            Shipment ปัจจุบัน: <b>{currentShipmentId || "-"}</b> | สถานะ: <b>{currentStatus}</b>
          </div>
        </div>

        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800 }}>ฟาร์มต้นทาง (จากข้อมูลหมูใน swines)</div>

          <input
            value={fromQ}
            onChange={(e) => setFromQ(e.target.value)}
            placeholder="พิมพ์ค้นหา farm code / farm name…"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 12,
              border: "1px solid #ddd",
            }}
          />

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              overflow: "hidden",
              maxHeight: 260,
              overflowY: "auto",
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
                    onClick={() => setFromFarm(f)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid #eee",
                      background: active ? "#f3f4f6" : "white",
                      cursor: "pointer",
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

          <div className="small" style={{ color: "#444", wordBreak: "break-word" }}>
            เลือกอยู่: <b>{fromFarm ? `${fromFarm.farm_code} - ${fromFarm.farm_name}` : "-"}</b>
          </div>
        </div>

        <div className="card">
          <FarmPickerInlineAdd
            label="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
            value={toFarmId}
            onChange={setToFarmId}
            requireBranch={false}
          />
        </div>

        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800 }}>เลือกหมู (จาก swines ของฟาร์มต้นทาง)</div>

          {!fromFarm?.farm_code ? (
            <div className="small" style={{ color: "#666" }}>
              * กรุณาเลือกฟาร์มต้นทางก่อน
            </div>
          ) : (
            <>
              <input
                value={swineQ}
                onChange={(e) => setSwineQ(e.target.value)}
                placeholder="พิมพ์ค้นหา swine code…"
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                }}
              />

              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  overflow: "hidden",
                  maxHeight: 500,
                  overflowY: "auto",
                }}
              >
                {swineLoading && (
                  <div style={{ padding: 12, color: "#666" }}>กำลังโหลดรายการหมู...</div>
                )}

                {!swineLoading &&
                  filteredSwines.map((s) => {
                    const checked = selectedSwineIds.has(s.id);
                    const f = swineForm[s.id] || {};

                    return (
                      <div
                        key={s.id}
                        style={{
                          padding: "10px 12px",
                          borderBottom: "1px solid #eee",
                          background: checked ? "#f3f4f6" : "white",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSwine(s.id)}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                            {s.swine_code}
                          </div>
                        </label>

                        {checked && (
                          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                gap: 8,
                              }}
                            >
                              <input
                                value={f.teats_left ?? ""}
                                onChange={(e) => setSwineField(s.id, "teats_left", e.target.value)}
                                placeholder="L (เต้านมซ้าย) เช่น 7"
                                inputMode="numeric"
                                style={{
                                  padding: 10,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  width: "100%",
                                }}
                              />
                              <input
                                value={f.teats_right ?? ""}
                                onChange={(e) => setSwineField(s.id, "teats_right", e.target.value)}
                                placeholder="R (เต้านมขวา) เช่น 7"
                                inputMode="numeric"
                                style={{
                                  padding: 10,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  width: "100%",
                                }}
                              />
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                gap: 8,
                              }}
                            >
                              <input
                                value={f.backfat ?? ""}
                                onChange={(e) => setSwineField(s.id, "backfat", e.target.value)}
                                placeholder="Backfat เช่น 12.5"
                                inputMode="decimal"
                                style={{
                                  padding: 10,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  width: "100%",
                                }}
                              />
                              <input
                                value={f.weight ?? ""}
                                onChange={(e) => setSwineField(s.id, "weight", e.target.value)}
                                placeholder="Weight เช่น 115.3"
                                inputMode="decimal"
                                style={{
                                  padding: 10,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  width: "100%",
                                }}
                              />
                            </div>

                            <div style={{ fontSize: 12, color: "#666" }}>
                              เว้นว่างได้ — ถ้าว่างจะแสดงเป็น <b>-</b>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                {!swineLoading && swineOptions.length === 0 && (
                  <div style={{ padding: 12, color: "#666" }}>
                    ไม่พบหมูในฟาร์มนี้ หรือ RLS ไม่ให้เห็นข้อมูล
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
                    setSwineForm({});
                  }}
                >
                  ล้างรายการหมู
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>หมายเหตุ</div>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            placeholder="ใส่หมายเหตุ (ถ้ามี)"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 12,
              border: "1px solid #ddd",
              resize: "vertical",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button className="linkbtn" type="button" onClick={saveDraft} disabled={!canSave || saving || exporting}>
            {saving ? "Saving..." : "Save Draft"}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={exportCsvAndSubmit}
            disabled={!currentShipmentId || currentStatus !== "draft" || exporting || saving}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              setSaving(false);
              setExporting(false);
              setMsg("");
              setSelectedDate(todayYmd());
              setCurrentShipmentId(null);
              setCurrentStatus("draft");
              setFromFarm(null);
              setToFarmId(null);
              setRemark("");
              setFromQ("");
              setSwineQ("");
              setSwineOptions([]);
              setSelectedSwineIds(new Set());
              setSwineForm({});
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}