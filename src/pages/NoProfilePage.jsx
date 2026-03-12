const pageStyle = { display: "flex", justifyContent: "center", padding: "60px 16px" };
const cardStyle = {
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 24,
  textAlign: "center",
  boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
};
const titleStyle = { fontSize: 24, fontWeight: 900, color: "#92400e" };
const descStyle = { marginTop: 10 };
const hintStyle = { marginTop: 8, color: "#6b7280" };

export default function NoProfilePage() {
  return (
    <div className="page" style={pageStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>No profile found</div>
        <div className="small" style={descStyle}>
          ไม่พบข้อมูลโปรไฟล์ผู้ใช้ในตาราง <b>profiles</b>
        </div>
        <div className="small" style={hintStyle}>
          กรุณาตรวจสอบ trigger การสร้าง profile อัตโนมัติ หรือเพิ่มข้อมูลในตาราง profiles
        </div>
      </div>
    </div>
  );
}
