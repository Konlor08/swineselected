// src/pages/LoginPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// วางไฟล์ไว้ที่ /public/logo.png
const LOGO_SRC = "/logo.png";

function clean(v) {
  return String(v ?? "").trim();
}

export default function LoginPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState("login"); // "login" | "register"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    let alive = true;

    async function checkSession() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!alive) return;

        if (session?.user?.id) {
          nav("/", { replace: true });
        }
      } catch (err) {
        console.error("checkSession error:", err);
      }
    }

    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        nav("/", { replace: true });
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [nav]);

  const email = useMemo(() => {
    const u = clean(username);
    if (!u) return "";
    return `${u}@swine.local`;
  }, [username]);

  const onLogin = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (busy) return;

      setMsg("");
      const u = clean(username);
      const p = String(password ?? "");

      if (u.length < 3 || u.length > 20) {
        setMsg("Username ต้องยาว 3-20 ตัวอักษร");
        return;
      }
      if (p.length < 6) {
        setMsg("Password อย่างน้อย 6 ตัวอักษร");
        return;
      }

      setBusy(true);
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: p,
        });
        if (error) throw error;

        nav("/", { replace: true });
      } catch (err) {
        setMsg(err?.message || "Login ไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [busy, email, nav, password, username]
  );

  const onRegister = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (busy) return;

      setMsg("");
      const u = clean(username);
      const p = String(password ?? "");

      if (u.length < 3 || u.length > 20) {
        setMsg("Username ต้องยาว 3-20 ตัวอักษร");
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(u)) {
        setMsg("Username ใช้ได้เฉพาะ a-z A-Z 0-9 _");
        return;
      }
      if (p.length < 6) {
        setMsg("Password อย่างน้อย 6 ตัวอักษร");
        return;
      }

      setBusy(true);
      try {
        const { error } = await supabase.auth.signUp({
          email,
          password: p,
        });
        if (error) throw error;

        setMsg("✅ Register สำเร็จ (ถ้าเปิด confirm email ไว้ อาจต้องยืนยันก่อน)");
      } catch (err) {
        setMsg(err?.message || "Register ไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [busy, email, password, username]
  );

  const activeBtnStyle = (active) => ({
    flex: 1,
    padding: 12,
    borderRadius: 14,
    border: active ? "2px solid #86efac" : "1px solid #e5e7eb",
    background: active ? "#f0fdf4" : "#fff",
    fontWeight: 800,
    cursor: "pointer",
  });

  return (
    <div className="page">
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "30px 16px 60px" }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: "#f1f5f9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flex: "0 0 auto",
                position: "relative",
              }}
              title="SwineSelected"
            >
              {!logoBroken ? (
                <img
                  src={LOGO_SRC}
                  alt="logo"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={() => setLogoBroken(true)}
                />
              ) : (
                <div style={{ fontWeight: 900, fontSize: 12, color: "#0f172a" }}>SS</div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>SwineSelected</div>
              <div className="small">Login ด้วย Username • เวลาก่อน + เขียงกลาง</div>
            </div>

            <span
              className="pill"
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: "#ecfdf5",
                border: "1px solid #bbf7d0",
                color: "#166534",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              {tab === "login" ? "Login" : "Register"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setTab("login")}
              style={activeBtnStyle(tab === "login")}
              disabled={busy}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setTab("register")}
              style={activeBtnStyle(tab === "register")}
              disabled={busy}
            >
              Register
            </button>
          </div>

          <form onSubmit={tab === "login" ? onLogin : onRegister}>
            <div style={{ marginBottom: 10 }}>
              <div className="small" style={{ marginBottom: 6, fontWeight: 800 }}>
                Username
              </div>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="เช่น chenk_01"
                autoComplete="username"
                disabled={busy}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  outline: "none",
                }}
              />
              <div className="small" style={{ marginTop: 6, color: "#64748b" }}>
                เงื่อนไข: 3-20 ตัว (a-z A-Z 0-9 _)
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div className="small" style={{ marginBottom: 6, fontWeight: 800 }}>
                Password
              </div>

              <div style={{ position: "relative" }}>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  type={showPw ? "text" : "password"}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  disabled={busy}
                  style={{
                    width: "100%",
                    padding: "12px 44px 12px 14px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    outline: "none",
                  }}
                />

                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  disabled={busy}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                  title={showPw ? "ซ่อนรหัสผ่าน" : "ดูรหัสผ่าน"}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <button
              className="btn"
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                marginTop: 6,
                padding: "12px 14px",
                borderRadius: 12,
                border: "none",
                background: "#4ade80",
                color: "#064e3b",
                fontWeight: 900,
                cursor: "pointer",
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy ? "Working..." : tab === "login" ? "Sign in" : "Create account"}
            </button>

            <div className="small" style={{ marginTop: 10, color: "#64748b" }}>
              * ใช้ <b>username@swine.local</b> เป็นอีเมลจำลอง
            </div>

            {msg ? (
              <div
                className="small"
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  background: msg.startsWith("✅") ? "#ecfdf5" : "#fef2f2",
                  border: msg.startsWith("✅") ? "1px solid #bbf7d0" : "1px solid #fecaca",
                  color: msg.startsWith("✅") ? "#166534" : "#991b1b",
                  fontWeight: 800,
                }}
              >
                {msg}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
