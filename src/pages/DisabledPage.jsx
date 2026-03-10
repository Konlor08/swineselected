export default function DisabledPage() {
  return (
    <div className="page">
      <div
        style={{
          maxWidth: 520,
          margin: "60px auto",
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 24,
          textAlign: "center",
          boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900, color: "#b91c1c" }}>
          Account disabled
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ
        </div>
      </div>
    </div>
  );
}