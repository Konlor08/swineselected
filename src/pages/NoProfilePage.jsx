export default function NoProfilePage() {
  return (
    <div className="page">
      <div
        style={{
          maxWidth: 560,
          margin: "60px auto",
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 24,
          textAlign: "center",
          boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900, color: "#92400e" }}>
          No profile found
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          ไม่พบข้อมูลโปรไฟล์ผู้ใช้ในตาราง <b>profiles</b>
        </div>
        <div className="small" style={{ marginTop: 8, color: "#6b7280" }}>
          กรุณาตรวจสอบ trigger การสร้าง profile อัตโนมัติ หรือเพิ่มข้อมูลในตาราง profiles
        </div>
      </div>
    </div>
  );
}