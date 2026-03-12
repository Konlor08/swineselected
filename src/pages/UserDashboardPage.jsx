// src/pages/UserDashboardPage.jsx

import React, { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

function onlyDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function isValid10Digits(s) {
  return /^\d{10}$/.test(s);
}

function dash(v) {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

export default function UserDashboardPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState(null);

  const normalized = useMemo(() => onlyDigits(input), [input]);
  const valid = useMemo(() => isValid10Digits(normalized), [normalized]);

  const doSearch = useCallback(async () => {
    if (busy) return;

    setMsg("");
    setResult(null);

    const code = onlyDigits(input);

    if (!isValid10Digits(code)) {
      setMsg("กรุณาใส่ Swine Code เป็นตัวเลข 10 หลักเท่านั้น (มี 0 นำหน้าได้)");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("swines")
        .select(
          `
          id,
          swine_code,
          farm_code,
          farm_name,
          house_no,
          flock,
          birth_date,
          created_at
        `
        )
        .eq("swine_code", code)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setMsg(`ไม่พบ Swine Code: ${code}`);
        return;
      }

      setResult(data);
      setMsg("พบข้อมูล ✅");
    } catch (e) {
      setMsg(`ค้นหาไม่สำเร็จ: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, input]);

  const logout = useCallback(async (e) => {
    try {
      e?.preventDefault?.();
      void supabase.auth.signOut({ scope: "local" });
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
        for (const k of Object.keys(sessionStorage)) if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      } catch {
        // ignore cleanup errors
      }
    } finally {
      window.location.href = `${window.location.origin}/login`;
    }
  }, []);

  return (
    <div className="page">
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>User Dashboard</div>
          <div className="small">ค้นหา / สแกน Swine Code</div>
        </div>

        <button className="linkbtn" type="button" onClick={logout}>
          Logout
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "14px auto 0" }}>
        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>ค้นหา Swine Code</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="ใส่เลข 10 หลัก เช่น 0810000127"
              style={{
                flex: 1,
                minWidth: 260,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
              }}
            />

            <button
              className="btn"
              type="button"
              onClick={doSearch}
              disabled={busy || !valid}
              style={{ width: 180 }}
            >
              {busy ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="small" style={{ marginTop: 8 }}>
            เงื่อนไข: ตัวเลข 10 หลักเท่านั้น (มี 0 นำหน้าได้) • ตอนนี้: <b>{normalized || "-"}</b>
          </div>

          {msg ? <div className="small" style={{ marginTop: 10 }}>{msg}</div> : null}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>ผลการค้นหา</div>

          {!result ? (
            <div className="small">ยังไม่มีผลลัพธ์ — ค้นหาก่อน</div>
          ) : (
            <div className="small" style={{ lineHeight: 1.8 }}>
              <div><b>swine_code:</b> {dash(result.swine_code)}</div>
              <div><b>farm_code:</b> {dash(result.farm_code)}</div>
              <div><b>farm_name:</b> {dash(result.farm_name)}</div>
              <div><b>house_no:</b> {dash(result.house_no)}</div>
              <div><b>flock:</b> {dash(result.flock)}</div>
              <div><b>birth_date:</b> {dash(result.birth_date)}</div>
              <div><b>created_at:</b> {dash(result.created_at)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
