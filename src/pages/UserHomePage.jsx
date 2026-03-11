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

const SELECTED_BG = "#fef9c3";
const SELECTED_BORDER = "#fde68a";

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
  const [swineOptions, setSwineOptions] = useState([]);
  const [selectedSwineIds, setSelectedSwineIds] = useState(new Set());

  const [swineForm, setSwineForm] = useState({});
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    let alive = true;

    async function loadSwinesOfFarm() {
      setSwineOptions([]);
      setSelectedHouse("");
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
          .select("id, swine_code, farm_code, house_no")
          .eq("farm_code", fromFarm.farm_code)
          .in("swine_code", availableCodes)
          .order("house_no", { ascending: true })
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

    return swineOptions
      .filter((s) => {
        const houseValue = clean(s.house_no);
        if (selectedHouse === "__BLANK__") {
          return !houseValue;
        }
        return houseValue === selectedHouse;
      })
      .filter((s) => {
        if (!q) return true;
        return String(s.swine_code || "").toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [swineOptions, selectedHouse, swineQ]);

  function handleSelectFromFarm(farm) {
    setFromFarm(farm);
    setSelectedHouse("");
    setSwineQ("");
    setSwineOptions([]);
    setSelectedSwineIds(new Set());
    setSwineForm({});
    setMsg("");
  }

  function handleHouseChange(value) {
    setSelectedHouse(value);
    setSwineQ("");
    setSelectedSwineIds(new Set());
    setSwineForm({});
    setMsg("");
  }

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
    return (
      !!selectedDate &&
      !!fromFarm?.farm_code &&
      !!selectedToFarmId &&
      !!selectedHouse &&
      selectedSwineIds.size > 0
    );
  }, [selectedDate, fromFarm, selectedToFarmId, selectedHouse, selectedSwineIds]);

  async function logout(e) {
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
    } catch {}

    window.location.replace(`/login?logout=1&ts=${Date.now()}`);
  }

  async function saveDraft() {
    if (!canSave) {
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง + House + หมูอย่างน้อย 1 ตัว");
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
        from_farm_code: fromFarm.farm_code,
        from_farm_name: fromFarm.farm_name || null,
        from_branch_id: fromFarm.branch_id || null,
        to_farm_id: selectedToFarmId || null,
        remark: remark || null,
        status: "draft",
      };

      setMsg("กำลังบันทึกหัวรายการ...");
      const res1 = await withTimeout(
        supabase.from("swine_shipments").insert([header]),
        15000,
        "insert swine_shipments"
      );
      if (res1.error) throw res1.error;

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
          shipment_id: shipmentId,
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

      setMsg("กำลังบันทึกรายการหมู...");
      const res2 = await withTimeout(
        supabase.from("swine_shipment_items").insert(itemRows),
        15000,
        "insert swine_shipment_items"
      );
      if (res2.error) throw res2.error;

      const pickedCodes = itemRows.map((x) => x.swine_code).filter(Boolean);

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
            .select("id, swine_code, farm_code, house_no")
            .eq("farm_code", fromFarm.farm_code)
            .in("swine_code", availableCodes)
            .order("house_no", { ascending: true })
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
          <button className="linkbtn" type="button" onClick={() => nav(-1)}>
            Back
          </button>
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
          <div style={{ fontWeight: 800 }}>House</div>

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
                          background: checked ? SELECTED_BG : "white",
                          boxShadow: checked ? `inset 0 0 0 1px ${SELECTED_BORDER}` : "none",
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
                            onChange={() => toggleSwine(s.id)}
                            style={{ marginTop: 3, flex: "0 0 auto" }}
                          />
                          <div style={{ fontWeight: 800, wordBreak: "break-word", minWidth: 0 }}>
                            {s.swine_code}
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
                                onChange={(e) => setSwineField(s.id, "teats_right", e.target.value)}
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

                {!swineLoading && selectedHouse && filteredSwines.length === 0 && (
                  <div style={{ padding: 12, color: "#666" }}>
                    ไม่พบหมูใน House นี้ หรือ RLS ไม่ให้เห็นข้อมูล
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
                    setSwineForm({});
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
            onClick={saveDraft}
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
              setSelectedSwineIds(new Set());
              setSwineForm({});
            }}
            style={{ flex: "1 1 140px", minWidth: 0 }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}