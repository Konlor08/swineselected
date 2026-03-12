// src/pages/AdminUsersPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function clean(v) {
  return String(v ?? "").trim();
}

function dash(v) {
  const s = clean(v);
  return s ? s : "-";
}

function lower(v) {
  return clean(v).toLowerCase();
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`${label} timeout after ${ms}ms`));
      }, ms);
    }),
  ]);
}

const ROLE_OPTIONS = ["admin", "user"];
const LOAD_TIMEOUT_MS = 15000;
const INITIAL_LIMIT = 1000;

export default function AdminUsersPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");

  const [profiles, setProfiles] = useState([]);
  const [draft, setDraft] = useState({});
  const [rowErr, setRowErr] = useState({});

  const [branches, setBranches] = useState([]);
  const [q, setQ] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async (aliveRef) => {
    setLoading(true);
    setErr("");
    setHint("");

    try {
      const branchesPromise = withTimeout(
        supabase
          .from("swine_branches")
          .select("id, branch_code, branch_name")
          .order("branch_code", { ascending: true }),
        LOAD_TIMEOUT_MS,
        "load swine_branches"
      );

      const profilesPromise = withTimeout(
        supabase
          .from("profiles")
          .select("user_id, display_name, role, team_name, is_active, branch_id")
          .order("display_name", { ascending: true })
          .limit(INITIAL_LIMIT),
        LOAD_TIMEOUT_MS,
        "load profiles"
      );

      const [branchesRes, profilesRes] = await Promise.allSettled([branchesPromise, profilesPromise]);
      if (!aliveRef.current) return;

      if (branchesRes.status === "fulfilled") {
        const { data: b, error: be } = branchesRes.value;
        if (be) {
          setHint((prev) => prev || `โหลดสาขาไม่สำเร็จ: ${be.message || String(be)}`);
        } else {
          setBranches(Array.isArray(b) ? b : []);
        }
      } else {
        setHint((prev) => prev || `โหลดสาขาไม่สำเร็จ: ${branchesRes.reason?.message || String(branchesRes.reason)}`);
      }

      if (profilesRes.status === "rejected") {
        throw profilesRes.reason;
      }

      const { data: p, error: pe } = profilesRes.value;
      if (pe) throw pe;

      const list = Array.isArray(p) ? p : [];
      setProfiles(list);

      const nextDraft = {};
      for (const it of list) {
        const uid = it.user_id;
        nextDraft[uid] = {
          role: lower(it.role || "user"),
          team_name: clean(it.team_name || ""),
          is_active: it.is_active !== false,
          branch_id: it.branch_id || "",
        };
      }

      setDraft(nextDraft);
      setRowErr({});

      if (!list.length) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const currentUid = session?.user?.id || null;

        if (currentUid) {
          const { data: myProfile, error: myProfileErr } = await supabase
            .from("profiles")
            .select("user_id, role, is_active")
            .eq("user_id", currentUid)
            .maybeSingle();

          if (!myProfileErr && myProfile) {
            const myRole = lower(myProfile.role);
            if (myRole === "admin") {
              setHint(
                "อ่านโปรไฟล์ตัวเองได้ แต่ list ผู้ใช้กลับเป็น 0 แถว — มีโอกาสสูงว่า RLS policy ยังไม่อนุญาตให้ admin อ่าน profiles ทั้งตาราง"
              );
            }
          }
        }
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(e?.message || String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const aliveRef = { current: true };
    void load(aliveRef);

    return () => {
      aliveRef.current = false;
    };
  }, [load, reloadTick]);

  const branchMap = useMemo(() => {
    const m = new Map();
    for (const b of branches) m.set(b.id, b);
    return m;
  }, [branches]);

  const filtered = useMemo(() => {
    const qq = lower(q);
    if (!qq) return profiles;

    return profiles.filter((p) => {
      const uid = lower(p.user_id);
      const dn = lower(p.display_name);
      const tn = lower(p.team_name);
      const role = lower(p.role);
      const branch = lower(branchMap.get((draft[p.user_id] || {}).branch_id || p.branch_id)?.branch_name);
      const branchCode = lower(branchMap.get((draft[p.user_id] || {}).branch_id || p.branch_id)?.branch_code);

      return (
        uid.includes(qq) ||
        dn.includes(qq) ||
        tn.includes(qq) ||
        role.includes(qq) ||
        branch.includes(qq) ||
        branchCode.includes(qq)
      );
    });
  }, [profiles, q, branchMap, draft]);

  function setDraftField(user_id, key, value) {
    setDraft((prev) => ({
      ...prev,
      [user_id]: { ...(prev[user_id] || {}), [key]: value },
    }));
    setRowErr((prev) => ({ ...prev, [user_id]: "" }));
  }

  function resetRow(user_id) {
    const p = profiles.find((x) => x.user_id === user_id);
    if (!p) return;

    setDraft((prev) => ({
      ...prev,
      [user_id]: {
        role: lower(p.role || "user"),
        team_name: clean(p.team_name || ""),
        is_active: p.is_active !== false,
        branch_id: p.branch_id || "",
      },
    }));

    setRowErr((prev) => ({ ...prev, [user_id]: "" }));
  }

  async function saveRow(user_id) {
    const d = draft[user_id];
    if (!d) return;

    const role = lower(d.role);
    if (!ROLE_OPTIONS.includes(role)) {
      setRowErr((prev) => ({ ...prev, [user_id]: "role ไม่ถูกต้อง" }));
      return;
    }

    setSaving((prev) => ({ ...prev, [user_id]: true }));
    setRowErr((prev) => ({ ...prev, [user_id]: "" }));

    try {
      const payload = {
        role,
        team_name: clean(d.team_name || "") || null,
        is_active: d.is_active === true,
        branch_id: clean(d.branch_id || "") || null,
      };

      const { error } = await supabase.from("profiles").update(payload).eq("user_id", user_id);
      if (error) throw error;

      setProfiles((prev) =>
        prev.map((p) =>
          p.user_id === user_id
            ? {
                ...p,
                role: payload.role,
                team_name: payload.team_name,
                is_active: payload.is_active,
                branch_id: payload.branch_id,
              }
            : p
        )
      );
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [user_id]: e?.message || String(e) }));
    } finally {
      setSaving((prev) => ({ ...prev, [user_id]: false }));
    }
  }

  async function quickDisable(user_id, nextActive) {
    setDraftField(user_id, "is_active", nextActive);
    await saveRow(user_id);
  }

  const thStyle = {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    fontSize: 13,
  };

  const tdStyle = {
    padding: 10,
    borderBottom: "1px solid #f1f1f1",
    verticalAlign: "top",
    fontSize: 14,
  };

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
          <div style={{ fontSize: 20, fontWeight: 900 }}>Users / Roles</div>
          <div className="small">จัดการผู้ใช้: role, team, branch, เปิด/ปิดการใช้งาน</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="linkbtn" type="button" onClick={() => setReloadTick((v) => v + 1)}>
            Refresh
          </button>
          <button className="linkbtn" type="button" onClick={() => nav("/admin")}>
            Back
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "14px auto 0", display: "grid", gap: 14 }}>
        <div className="card">
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหา: display_name / team_name / user_id / role / branch"
              style={{ flex: "1 1 320px", minWidth: 240 }}
            />
            <div className="small">
              ทั้งหมด: <b>{profiles.length}</b> | แสดง: <b>{filtered.length}</b>
            </div>
          </div>

          {err ? (
            <div className="err" style={{ marginTop: 10 }}>
              {err}
            </div>
          ) : null}

          {hint ? (
            <div className="small" style={{ marginTop: 10, color: "#92400e" }}>
              {hint}
            </div>
          ) : null}

          {loading ? (
            <div className="small" style={{ marginTop: 10 }}>
              Loading...
            </div>
          ) : null}
        </div>

        <div className="card">
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>รายชื่อผู้ใช้</div>

          {!loading && !filtered.length ? (
            <div className="small">ไม่พบข้อมูล</div>
          ) : filtered.length ? (
            <div
              style={{
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                border: "1px solid #f3f4f6",
                borderRadius: 12,
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>display_name</th>
                    <th style={thStyle}>user_id</th>
                    <th style={thStyle}>role</th>
                    <th style={thStyle}>team_name</th>
                    <th style={thStyle}>branch</th>
                    <th style={thStyle}>is_active</th>
                    <th style={thStyle}>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const uid = p.user_id;
                    const d = draft[uid] || {};
                    const b = d.branch_id ? branchMap.get(d.branch_id) : null;

                    return (
                      <tr key={uid}>
                        <td style={{ ...tdStyle, fontWeight: 800 }}>{dash(p.display_name)}</td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                          <span className="small">{dash(uid)}</span>
                        </td>
                        <td style={tdStyle}>
                          <select
                            className="input"
                            value={d.role || "user"}
                            onChange={(e) => setDraftField(uid, "role", e.target.value)}
                            style={{ width: 140 }}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            className="input"
                            value={d.team_name ?? ""}
                            onChange={(e) => setDraftField(uid, "team_name", e.target.value)}
                            placeholder="-"
                            style={{ width: 220 }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <select
                            className="input"
                            value={d.branch_id || ""}
                            onChange={(e) => setDraftField(uid, "branch_id", e.target.value)}
                            style={{ width: 260 }}
                          >
                            <option value="">- (none)</option>
                            {branches.map((x) => (
                              <option key={x.id} value={x.id}>
                                {dash(x.branch_code)} — {dash(x.branch_name)}
                              </option>
                            ))}
                          </select>
                          <div className="small" style={{ marginTop: 6 }}>
                            {b ? (
                              <>
                                เลือกแล้ว: <b>{dash(b.branch_code)}</b>
                              </>
                            ) : (
                              <>ยังไม่เลือกสาขา</>
                            )}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <input
                              type="checkbox"
                              checked={d.is_active === true}
                              onChange={(e) => setDraftField(uid, "is_active", e.target.checked)}
                            />
                            <span className="small">{d.is_active ? "active" : "disabled"}</span>
                          </label>

                          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                            <button
                              className="linkbtn"
                              type="button"
                              onClick={() => quickDisable(uid, true)}
                              disabled={saving[uid]}
                            >
                              Enable
                            </button>
                            <button
                              className="linkbtn"
                              type="button"
                              onClick={() => quickDisable(uid, false)}
                              disabled={saving[uid]}
                            >
                              Disable
                            </button>
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => saveRow(uid)}
                              disabled={saving[uid]}
                              style={{ width: 120 }}
                            >
                              {saving[uid] ? "Saving..." : "Save"}
                            </button>
                            <button
                              className="linkbtn"
                              type="button"
                              onClick={() => resetRow(uid)}
                              disabled={saving[uid]}
                            >
                              Reset
                            </button>
                          </div>
                          {rowErr[uid] ? (
                            <div className="err" style={{ marginTop: 8 }}>
                              {rowErr[uid]}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
