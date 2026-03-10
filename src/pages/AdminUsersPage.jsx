// src/pages/AdminUsersPage.jsx

import React, { useEffect, useMemo, useState } from "react";
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

const ROLE_OPTIONS = ["admin", "user"];

export default function AdminUsersPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [err, setErr] = useState("");

  const [profiles, setProfiles] = useState([]);
  const [draft, setDraft] = useState({});
  const [rowErr, setRowErr] = useState({});

  const [branches, setBranches] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        const { data: b, error: be } = await supabase
          .from("swine_branches")
          .select("id, branch_code, branch_name")
          .order("branch_code", { ascending: true });

        if (!be && Array.isArray(b)) {
          if (alive) setBranches(b);
        }

        const { data: p, error: pe } = await supabase
          .from("profiles")
          .select("user_id, display_name, role, team_name, is_active, branch_id")
          .order("display_name", { ascending: true });

        if (pe) throw pe;

        const list = Array.isArray(p) ? p : [];
        if (!alive) return;

        setProfiles(list);

        const d = {};
        for (const it of list) {
          const uid = it.user_id;
          d[uid] = {
            role: lower(it.role || "user"),
            team_name: clean(it.team_name || ""),
            is_active: it.is_active !== false,
            branch_id: it.branch_id || "",
          };
        }

        setDraft(d);
        setRowErr({});
      } catch (e) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

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

      return uid.includes(qq) || dn.includes(qq) || tn.includes(qq) || role.includes(qq);
    });
  }, [profiles, q]);

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
              placeholder="ค้นหา: display_name / team_name / user_id / role"
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

          {loading ? (
            <div className="small" style={{ marginTop: 10 }}>
              Loading...
            </div>
          ) : null}
        </div>

        <div className="card">
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>รายชื่อผู้ใช้</div>

          {!filtered.length ? (
            <div className="small">ไม่พบข้อมูล</div>
          ) : (
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
          )}
        </div>

        <div>
          <div className="small" style={{ marginTop: 4, opacity: 0.8 }}>
            * มือถือ: ถ้าตารางเลื่อนไม่สะดวก ให้ใช้การ์ดด้านล่าง
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {filtered.slice(0, 1000).map((p) => {
              const uid = p.user_id;
              const d = draft[uid] || {};
              const b = d.branch_id ? branchMap.get(d.branch_id) : null;

              return (
                <div key={`card-${uid}`} className="card" style={{ padding: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, wordBreak: "break-word" }}>
                        {dash(p.display_name)}
                      </div>
                      <div className="small" style={{ wordBreak: "break-all" }}>
                        {dash(uid)}
                      </div>
                    </div>

                    <div className="small" style={{ textAlign: "right" }}>
                      {d.is_active ? "✅ active" : "⛔ disabled"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    <div>
                      <div className="small">role</div>
                      <select
                        className="input"
                        value={d.role || "user"}
                        onChange={(e) => setDraftField(uid, "role", e.target.value)}
                        style={{ width: "100%" }}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="small">team_name</div>
                      <input
                        className="input"
                        value={d.team_name ?? ""}
                        onChange={(e) => setDraftField(uid, "team_name", e.target.value)}
                        placeholder="-"
                        style={{ width: "100%" }}
                      />
                    </div>

                    <div>
                      <div className="small">branch</div>
                      <select
                        className="input"
                        value={d.branch_id || ""}
                        onChange={(e) => setDraftField(uid, "branch_id", e.target.value)}
                        style={{ width: "100%" }}
                      >
                        <option value="">- (none)</option>
                        {branches.map((x) => (
                          <option key={x.id} value={x.id}>
                            {dash(x.branch_code)} — {dash(x.branch_name)}
                          </option>
                        ))}
                      </select>
                      <div className="small" style={{ marginTop: 6, wordBreak: "break-word" }}>
                        {b ? (
                          <>
                            เลือกแล้ว: <b>{dash(b.branch_code)}</b> — {dash(b.branch_name)}
                          </>
                        ) : (
                          <>ยังไม่เลือกสาขา</>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          checked={d.is_active === true}
                          onChange={(e) => setDraftField(uid, "is_active", e.target.checked)}
                        />
                        <span className="small">is_active</span>
                      </label>

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

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => saveRow(uid)}
                        disabled={saving[uid]}
                        style={{ width: "min(160px, 100%)" }}
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

                    {rowErr[uid] ? <div className="err">{rowErr[uid]}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="small" style={{ marginTop: 10, opacity: 0.7 }}>
            * จำกัดการ์ดแสดงตาม filter (ไม่มี limit ฝั่ง UI นอกจากแสดง 1000 แรกเพื่อกันช้า)
          </div>
        </div>
      </div>
    </div>
  );
}