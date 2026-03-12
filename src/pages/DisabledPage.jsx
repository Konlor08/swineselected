const pageStyle = { display: "flex", justifyContent: "center", padding: "60px 16px" };
const cardStyle = {
  width: "100%",
  maxWidth: 520,
  margin: "0 auto",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 24,
  textAlign: "center",
  boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
};
const titleStyle = { fontSize: 24, fontWeight: 900, color: "#b91c1c" };
const descStyle = { marginTop: 10 };

export default function DisabledPage() {
  return (
    <div className="page" style={pageStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>Account disabled</div>
        <div className="small" style={descStyle}>
          บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ
        </div>
      </div>
    </div>
  );
}
