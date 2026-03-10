// src/pages/UserHomePage.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

function clean(s) {
  return String(s ?? "").trim();
}

export default function UserHomePage() {
  const nav = useNavigate();

  const [msg, setMsg] = useState("");
  const [myRole, setMyRole] = useState("user");

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
        const { data, error } = await supabase
          .from("swines")
          .select("farm_code, farm_name, branch_id")
          .not("farm_code", "is", null)
          .order("farm_code", { ascending: true })
          .limit(2000);

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
        const { data, error } = await supabase
          .from("swines")
          .select("id, swine_code, farm_code")
          .eq("farm_code", fromFarm.farm_code)
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
    return !!fromFarm?.farm_code && !!toFarmId && selectedSwineIds.size > 0;
  }, [fromFarm, toFarmId, selectedSwineIds]);

  async function logout(e) {
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();

      await supabase.auth.signOut({ scope: "local" });

      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-")) localStorage.removeItem(k);
        }
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith("sb-")) sessionStorage.removeItem(k);
        }
      } catch {}
    } finally {
      window.location.href = `${window.location.origin}/login`;
    }
  }

  async function saveDraft() {
    if (!canSave) {
      setMsg("กรุณาเลือกฟาร์มต้นทาง + ฟาร์มปลายทาง + หมูอย่างน้อย 1 ตัว");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const header = {
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
        .select("id")
        .single();

      if (res1.error) throw res1.error;

      const sh = res1.data;

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

      const itemRows = Array.from(selectedSwineIds).map((swine_id) => {
        const f = swineForm[swine_id] || {};
        const swine_code = swineMap.get(swine_id) || null;

        return {
          shipment_id: sh.id,
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

      const res2 = await supabase.from("swine_shipment_items").insert(itemRows);
      if (res2.error) throw res2.error;

      setMsg(`Save Draft สำเร็จ ✅ (Shipment: ${sh.id}, หมู: ${selectedSwineIds.size} ตัว)`);

      setRemark("");
      setSelectedSwineIds(new Set());
      setSwineForm({});
    } catch (e) {
      console.error("saveDraft error:", e);
      setMsg(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
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
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>User</div>
          <div className="small">เลือกฟาร์มต้นทาง/ปลายทาง และเลือกหมู</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="linkbtn" type="button" onClick={() => nav(-1)}>
            Back
          </button>
          {myRole !== "admin" ? (
            <button className="linkbtn" type="button" onClick={logout}>
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
                          <div style={{ fontWeight: 800, wordBreak: "break-word" }}>{s.swine_code}</div>
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
                                style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                              />
                              <input
                                value={f.teats_right ?? ""}
                                onChange={(e) => setSwineField(s.id, "teats_right", e.target.value)}
                                placeholder="R (เต้านมขวา) เช่น 7"
                                inputMode="numeric"
                                style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
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
                                style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                              />
                              <input
                                value={f.weight ?? ""}
                                onChange={(e) => setSwineField(s.id, "weight", e.target.value)}
                                placeholder="Weight เช่น 115.3"
                                inputMode="decimal"
                                style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
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
          <button className="linkbtn" type="button" onClick={saveDraft} disabled={!canSave || saving}>
            {saving ? "Saving..." : "Save Draft"}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              setSaving(false);
              setMsg("");
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