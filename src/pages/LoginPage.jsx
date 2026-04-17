// src/pages/LoginPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const LOGO_SRC = "/logo.png";

function clean(v) {
  return String(v ?? "").trim();
}

function isInvalidProfileText(v) {
  const s = clean(v).toLowerCase();
  return !s || s === "-" || s === "null" || s === "undefined";
}

function normalizeProfileText(v) {
  const s = clean(v);
  return isInvalidProfileText(s) ? null : s;
}

function emailPrefix(email) {
  const s = clean(email);
  if (!s.includes("@")) return null;
  return normalizeProfileText(s.split("@")[0]);
}

function buildSafeUsername({ username, email, userId }) {
  return (
    normalizeProfileText(username) ||
    emailPrefix(email) ||
    (userId ? `user_${String(userId).slice(0, 8)}` : null)
  );
}

function buildSafeDisplayName({ displayName, username, email, userId }) {
  return (
    normalizeProfileText(displayName) ||
    normalizeProfileText(username) ||
    emailPrefix(email) ||
    (userId ? `user-${String(userId).slice(0, 8)}` : null)
  );
}

async function ensureProfileAfterLogin({ userId, email, username, displayName }) {
  if (!userId) return;

  const safeUsername = buildSafeUsername({ username, email, userId });
  const safeDisplayName = buildSafeDisplayName({
    displayName,
    username: safeUsername,
    email,
    userId,
  });

  try {
    const { data: existing, error: readError } = await supabase
      .from("profiles")
      .select("user_id, display_name, username, role, team_name, branch_id, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      console.error("ensureProfileAfterLogin read error:", readError);
      return;
    }

    if (!existing) {
      const payload = {
        user_id: userId,
        display_name: safeDisplayName,
        username: safeUsername,
        role: "user",
        team_name: null,
        branch_id: null,
        is_active: true,
      };

      console.log("ensureProfileAfterLogin insert payload:", payload);

      const { error: insertError } = await supabase.from("profiles").insert([payload]);

      if (insertError) {
        console.error("ensureProfileAfterLogin insert error:", insertError);
      }
      return;
    }

    const patch = {};

    if (isInvalidProfileText(existing.display_name) && safeDisplayName) {
      patch.display_name = safeDisplayName;
    }

    if (isInvalidProfileText(existing.username) && safeUsername) {
      patch.username = safeUsername;
    }

    if (isInvalidProfileText(existing.role)) {
      patch.role = "user";
    }

    if (typeof existing.is_active !== "boolean") {
      patch.is_active = true;
    }

    if (Object.keys(patch).length > 0) {
      console.log("ensureProfileAfterLogin update payload:", {
        user_id: userId,
        ...patch,
      });

      const { error: updateError } = await supabase
        .from("profiles")
        .update(patch)
        .eq("user_id", userId);

      if (updateError) {
        console.error("ensureProfileAfterLogin update error:", updateError);
      }
    }
  } catch (e) {
    console.error("ensureProfileAfterLogin unexpected error:", e);
  }
}

export default function LoginPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState("login");
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
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("checkSession getSession error:", error);
          return;
        }

        const session = data?.session;
        if (!alive) return;

        if (session?.user?.id) {
          nav("/", { replace: true });
        }
      } catch (err) {
        console.error("checkSession unexpected error:", err);
      }
    }

    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;

      if (event === "SIGNED_IN" && session?.user?.id) {
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

  const validateUsername = useCallback((u) => {
    if (u.length < 3 || u.length > 20) {
      return "Username ต้องยาว 3-20 ตัวอักษร";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(u)) {
      return "Username ใช้ได้เฉพาะ a-z A-Z 0-9 _";
    }
    return "";
  }, []);

  const validatePassword = useCallback((p) => {
    if (p.length < 6) {
      return "Password อย่างน้อย 6 ตัวอักษร";
    }
    return "";
  }, []);

  const onLogin = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (busy) return;

      setMsg("");

      const u = clean(username);
      const p = String(password ?? "");

      const userError = validateUsername(u);
      if (userError) {
        setMsg(userError);
        return;
      }

      const passwordError = validatePassword(p);
      if (passwordError) {
        setMsg(passwordError);
        return;
      }

      setBusy(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password: p,
        });
        if (error) throw error;

        console.log("onLogin signIn result:", data);

        const loggedInUser = data?.user;
        if (loggedInUser?.id) {
          await ensureProfileAfterLogin({
            userId: loggedInUser.id,
            email: loggedInUser.email,
            username: u,
            displayName:
              loggedInUser?.user_metadata?.display_name ||
              loggedInUser?.user_metadata?.full_name ||
              loggedInUser?.user_metadata?.name ||
              null,
          });
        }

        nav("/", { replace: true });
      } catch (err) {
        console.error("onLogin error:", err);
        setMsg(err?.message || "Login ไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [busy, email, nav, password, username, validatePassword, validateUsername]
  );

  const onRegister = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (busy) return;

      setMsg("");

      const u = clean(username);
      const p = String(password ?? "");

      const userError = validateUsername(u);
      if (userError) {
        setMsg(userError);
        return;
      }

      const passwordError = validatePassword(p);
      if (passwordError) {
        setMsg(passwordError);
        return;
      }

      const safeUsername = buildSafeUsername({ username: u, email });
      const safeDisplayName = buildSafeDisplayName({
        displayName: u,
        username: safeUsername,
        email,
      });

      setBusy(true);
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: p,
          options: {
            data: {
              display_name: safeDisplayName,
              username: safeUsername,
              full_name: safeDisplayName,
              name: safeDisplayName,
            },
          },
        });

        if (error) throw error;

        console.log("signUp result:", data);

        const newUser = data?.user || null;
        const newUserId = newUser?.id || null;

        if (newUserId) {
          await ensureProfileAfterLogin({
            userId: newUserId,
            email: newUser.email || email,
            username: safeUsername,
            displayName: safeDisplayName,
          });
        }

        setMsg("✅ Register สำเร็จ");
      } catch (err) {
        console.error("onRegister error:", err);
        setMsg(err?.message || "Register ไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [busy, email, password, username, validatePassword, validateUsername]
  );

  const activeBtnStyle = (active) => ({
    flex: 1,
    height: 48,
    borderRadius: 14,
    border: active ? "2px solid #86efac" : "1px solid #dbe4ea",
    background: active ? "#f0fdf4" : "#fff",
    fontWeight: 800,
    cursor: "pointer",
    color: active ? "#166534" : "#0f172a",
    boxShadow: active ? "0 0 0 3px rgba(187,247,208,0.35)" : "none",
  });

  const fieldLabelStyle = {
    marginBottom: 8,
    fontWeight: 800,
    color: "#334155",
    fontSize: 13,
  };

  const helperTextStyle = {
    marginTop: 6,
    color: "#64748b",
    fontSize: 12,
    lineHeight: 1.45,
  };

  const inputStyle = {
    width: "100%",
    height: 48,
    padding: "0 14px",
    borderRadius: 14,
    border: "1px solid #dbe4ea",
    outline: "none",
    background: "#fff",
    color: "#0f172a",
    fontSize: 15,
    boxSizing: "border-box",
  };

  const inputWrapStyle = {
    display: "flex",
    alignItems: "stretch",
    width: "100%",
    height: 48,
    borderRadius: 14,
    border: "1px solid #dbe4ea",
    background: "#fff",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  const inputInnerStyle = {
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: "none",
    padding: "0 14px",
    background: "transparent",
    color: "#0f172a",
    fontSize: 15,
  };

  const eyeButtonStyle = {
    width: 48,
    border: 0,
    borderLeft: "1px solid #dbe4ea",
    background: "#f8fafc",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    color: "#475569",
    fontSize: 16,
    flexShrink: 0,
  };

  const submitButtonStyle = {
    width: "100%",
    height: 48,
    marginTop: 8,
    borderRadius: 14,
    border: "none",
    background: "#4ade80",
    color: "#064e3b",
    fontWeight: 900,
    cursor: "pointer",
    opacity: busy ? 0.75 : 1,
    fontSize: 15,
  };

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
              <div className="small">Login ด้วย Username</div>
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

          <div style={{ display: "flex", gap: 10, marginTop: 12, marginBottom: 16 }}>
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
            <div style={{ marginBottom: 12 }}>
              <div className="small" style={fieldLabelStyle}>
                Username
              </div>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="เช่น chenk_01"
                autoComplete="username"
                disabled={busy}
                style={inputStyle}
              />
              <div className="small" style={helperTextStyle}>
                เงื่อนไข: 3-20 ตัว (a-z A-Z 0-9 _)
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div className="small" style={fieldLabelStyle}>
                Password
              </div>
              <div style={inputWrapStyle}>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  type={showPw ? "text" : "password"}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  disabled={busy}
                  style={inputInnerStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  disabled={busy}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  style={eyeButtonStyle}
                  title={showPw ? "ซ่อนรหัสผ่าน" : "ดูรหัสผ่าน"}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
              <div className="small" style={helperTextStyle}>
                อย่างน้อย 6 ตัวอักษร
              </div>
            </div>

            <button className="btn" type="submit" disabled={busy} style={submitButtonStyle}>
              {busy ? "Working..." : tab === "login" ? "Sign in" : "Create account"}
            </button>

            
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
