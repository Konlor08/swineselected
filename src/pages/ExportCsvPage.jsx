// src/pages/ExportCsvPage.jsx

import React, { useState } from "react";

// ===== helper =====
function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function safeText(v) {
  return String(v ?? "").trim();
}

function getBirthLotValue(r) {
  return safeText(r.birth_lot || r.birthLot || r.birthlot);
}

function sumFromRows(rows, field) {
  return rows.reduce((sum, r) => {
    const v = Number(r[field] || 0);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
}

function avgFromRows(rows, field) {
  if (!rows.length) return 0;
  return (sumFromRows(rows, field) / rows.length).toFixed(2);
}

// ===== SUMMARY =====
function buildBirthLotSummaryRows(flatRows) {
  const map = new Map();

  for (const r of flatRows || []) {
    const selectedDate = safeText(r.selected_date) || "ยังไม่ระบุ";
    const birthLot = getBirthLotValue(r) || "-";

    const key = `${selectedDate}||${birthLot}`;

    if (!map.has(key)) {
      map.set(key, {
        วันที่คัด: selectedDate,
        birth_lot: birthLot,
        __rows: [],
      });
    }

    map.get(key).__rows.push(r);
  }

  return Array.from(map.values()).map(row => ({
    วันที่คัด: row["วันที่คัด"],
    birth_lot: row.birth_lot,
    "จำนวนตัว": row.__rows.length,
    "น้ำหนักรวม": sumFromRows(row.__rows, "weight"),
    "น้ำหนักเฉลี่ย": avgFromRows(row.__rows, "weight"),
  }));
}

// ===== PDF =====
function exportPdfHtml({ flatRows }) {

  // ✅ กันพัง: เช็ค CDN โหลดหรือยัง
  if (!window.html2pdf) {
    alert("html2pdf ยังไม่โหลด กรุณารีเฟรชหน้า");
    return;
  }

  const summaryRows = buildBirthLotSummaryRows(flatRows);

  const pageSize = 50;
  const pages = [];

  for (let i = 0; i < flatRows.length; i += pageSize) {
    pages.push(flatRows.slice(i, i + pageSize));
  }

  const container = document.createElement("div");

  container.innerHTML = `
    <style>
      .page {
        page-break-after: always;
        font-family: Sarabun, sans-serif;
        padding: 16px;
      }

      table {
        width:100%;
        border-collapse:collapse;
        font-size:9px;
      }

      th {
        background:#111827;
        color:white;
        border:1px solid #ccc;
        padding:4px;
      }

      td {
        border:1px solid #ddd;
        padding:3px;
      }

      .header {
        display:flex;
        align-items:center;
        gap:10px;
        margin-bottom:10px;
      }

      .title {
        font-size:18px;
        font-weight:bold;
      }

      .footer {
        text-align:right;
        font-size:10px;
        margin-top:6px;
      }
    </style>

    <!-- SUMMARY -->
    <div class="page">
      <div class="header">
        <img src="/logo.png" style="height:40px"/>
        <div>
          <div class="title">รายงานการส่งสุกร</div>
          <div>วันที่: ${todayYmdLocal()}</div>
        </div>
      </div>

      <h3>สรุปตาม Birth Lot + วันคัด</h3>

      <table>
        <thead>
          <tr>
            <th>วันที่คัด</th>
            <th>birth_lot</th>
            <th>จำนวนตัว</th>
            <th>น้ำหนักรวม</th>
            <th>น้ำหนักเฉลี่ย</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows.map(r=>`
            <tr>
              <td>${r["วันที่คัด"]}</td>
              <td>${r.birth_lot}</td>
              <td>${r["จำนวนตัว"]}</td>
              <td>${r["น้ำหนักรวม"]}</td>
              <td>${r["น้ำหนักเฉลี่ย"]}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- DETAIL -->
    ${pages.map((page,i)=>`
      <div class="page">
        <div class="header">
          <img src="/logo.png" style="height:30px"/>
          <div class="title">รายละเอียดรายตัว</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>วันที่คัด</th>
              <th>เบอร์หมู</th>
              <th>birthlot</th>
              <th>อายุ</th>
              <th>โรงเรือน</th>
              <th>flock</th>
              <th>นน.</th>
            </tr>
          </thead>

          <tbody>
            ${page.map(r=>`
              <tr>
                <td>${r.selected_date || ""}</td>
                <td>${r.swine_code}</td>
                <td>${r.birth_lot}</td>
                <td>${r.age_days}</td>
                <td>${r.house_no}</td>
                <td>${r.flock}</td>
                <td>${r.weight}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="footer">หน้า ${i+2} / ${pages.length+1}</div>
      </div>
    `).join("")}
  `;

  window.html2pdf().set({
    margin:5,
    filename:"swine_report.pdf",
    html2canvas:{scale:2},
    jsPDF:{unit:"mm",format:"a4",orientation:"landscape"}
  }).from(container).save();
}

// ===== MAIN =====
export default function ExportCsvPage() {

  const [rows] = useState([
    { selected_date:"2026-03-20", swine_code:"1001", birth_lot:"BL1", weight:100, age_days:120, house_no:"A1", flock:"F1" },
    { selected_date:"2026-03-20", swine_code:"1002", birth_lot:"BL1", weight:110, age_days:118, house_no:"A1", flock:"F1" },
    { selected_date:"2026-03-21", swine_code:"1003", birth_lot:"BL2", weight:95, age_days:115, house_no:"B1", flock:"F2" }
  ]);

  return (
    <div style={{padding:20}}>
      <h2>Export PDF</h2>

      <button onClick={()=>exportPdfHtml({flatRows:rows})}>
        Export PDF
      </button>
    </div>
  );
}