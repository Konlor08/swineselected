// src/pages/ExportCsvPage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerSarabunNormal } from "../lib/pdfFonts/sarabun-normal";
import { registerSarabunBold } from "../lib/pdfFonts/sarabun-bold";

function todayYmdLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clean(v) {
  return String(v ?? "").trim();
}

function makeScopeKey(farmCode, flock) {
  return `${clean(farmCode)}||${clean(flock)}`;
}

function parseScopeKey(scopeKey) {
  const [farm_code = "", flock = ""] = String(scopeKey || "").split("||");
  return {
    farm_code: clean(farm_code),
    flock: clean(flock),
  };
}

function emptyShipmentStatusCounts() {
  return { draft: 0, submitted: 0, issued: 0 };
}

function createEmptyPreviewMeta() {
  return {
    hasPreviewed: false,
    reportType: "raw",
    scopeKey: "",
    fromFarmCode: "",
    fromFlock: "",
    toFarmId: "",
    dateFrom: "",
    dateTo: "",
    baseSwinesCount: 0,
    selectedUniqueCount: 0,
    cumulativeSelectedCount: 0,
    remainingCount: 0,
    shipmentHeadersFound: 0,
    shipmentHeadersAfterDestinationFilter: 0,
  };
}

function summarizeShipmentStatuses(shipments) {
  const counts = emptyShipmentStatusCounts();
  const seen = new Set();

  for (const shipment of shipments || []) {
    const key = clean(shipment?.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const s = String(shipment?.status || "").toLowerCase();
    if (s === "draft") counts.draft += 1;
    if (s === "submitted") counts.submitted += 1;
    if (s === "issued") counts.issued += 1;
  }

  return counts;
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  if (!rows?.length) return;

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
  ];

  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function safeText(v) {
  return String(v ?? "").trim();
}

function safeNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeCell(v) {
  return v === null || v === undefined ? "" : v;
}

function getBirthLotValue(row) {
  return safeText(
    row?.birth_lot ??
      row?.birthlot ??
      row?.birthLot ??
      row?.birth_lot_no ??
      row?.birthLotNo ??
      ""
  );
}

function avgFromRows(rows, key) {
  const nums = (rows || []).map((r) => safeNum(r?.[key])).filter((v) => v !== null);
  if (!nums.length) return "";
  const sum = nums.reduce((a, b) => a + b, 0);
  return +(sum / nums.length).toFixed(2);
}

function sumFromRows(rows, key) {
  const nums = (rows || []).map((r) => safeNum(r?.[key])).filter((v) => v !== null);
  if (!nums.length) return "";
  return +nums.reduce((a, b) => a + b, 0).toFixed(2);
}

function uniqueCountFromRows(rows, key) {
  const set = new Set();
  for (const row of rows || []) {
    const value = safeText(row?.[key]);
    if (value) set.add(value);
  }
  return set.size;
}

function countHeatRows(rows) {
  return (rows || []).filter((row) => String(row?.is_heat || "").toUpperCase() === "Y").length;
}

function buildOverallSummaryRows(flatRows, summaryMeta = {}) {
  const selectedUniqueCount =
    Number(summaryMeta?.selectedUniqueCount ?? uniqueCountFromRows(flatRows, "swine_code")) || 0;
  const cumulativeSelectedCount =
    Number(summaryMeta?.cumulativeSelectedCount ?? selectedUniqueCount) || 0;
  const baseSwinesCount = Number(summaryMeta?.baseSwinesCount || 0) || 0;
  const remainingCount =
    Number(
      summaryMeta?.remainingCount ??
        Math.max(baseSwinesCount - cumulativeSelectedCount, 0)
    ) || 0;

  return [
    { รายการ: "จำนวน shipment", ค่า: uniqueCountFromRows(flatRows, "shipment_id") },
    { รายการ: "จำนวนหมูทั้งหมดใน swines", ค่า: baseSwinesCount },
    { รายการ: "จำนวนหมูที่ถูกคัดในช่วงที่เลือก", ค่า: selectedUniqueCount },
    { รายการ: "จำนวนหมูคัดสะสมถึงวันสิ้นสุด", ค่า: cumulativeSelectedCount },
    { รายการ: "จำนวนหมูคงเหลือ", ค่า: remainingCount },
    { รายการ: "น้ำหนักรวมทั้งหมด", ค่า: sumFromRows(flatRows, "weight") },
    { รายการ: "น้ำหนักเฉลี่ยทั้งหมด", ค่า: avgFromRows(flatRows, "weight") },
    { รายการ: "จำนวนฟาร์มที่คัด", ค่า: uniqueCountFromRows(flatRows, "from_farm_code") },
    { รายการ: "จำนวนฟาร์มปลายทาง", ค่า: uniqueCountFromRows(flatRows, "to_farm_code") },
    { รายการ: "จำนวน birth_lot", ค่า: uniqueCountFromRows(flatRows, "birth_lot") },
    { รายการ: "จำนวนหมูติดสัด", ค่า: countHeatRows(flatRows) },
  ];
}

function makeSheetColsFromRows(...rowGroups) {
  let maxCols = 0;
  const maxLenByCol = [];

  for (const rows of rowGroups) {
    for (const row of rows || []) {
      const values = Array.isArray(row) ? row : Object.values(row || {});
      maxCols = Math.max(maxCols, values.length);
      values.forEach((value, idx) => {
        const len = String(value ?? "").length;
        maxLenByCol[idx] = Math.max(maxLenByCol[idx] || 0, len);
      });
    }
  }

  return Array.from({ length: maxCols }, (_, idx) => ({
    wch: Math.min(Math.max((maxLenByCol[idx] || 12) + 2, 12), 28),
  }));
}

function tryRegisterFont(registerFn, doc) {
  if (typeof registerFn !== "function") return false;

  const candidates = [doc, doc?.constructor, jsPDF, jsPDF?.API];

  for (const target of candidates) {
    try {
      if (target) registerFn(target);
    } catch (e) {
      // ลอง target ถัดไป
    }

    try {
      const fontList = doc?.getFontList?.() || {};
      if (fontList?.Sarabun) return true;
    } catch (e) {
      // ignore
    }
  }

  return false;
}

function ensurePdfThaiFont(doc) {
  tryRegisterFont(registerSarabunNormal, doc);
  tryRegisterFont(registerSarabunBold, doc);

  const fontList = doc?.getFontList?.() || {};
  return fontList?.Sarabun ? "Sarabun" : "helvetica";
}

function makeExportDateText(dateFrom, dateTo) {
  if (dateFrom && dateTo && dateFrom === dateTo) return dateFrom;
  if (dateFrom && dateTo) return `${dateFrom}_to_${dateTo}`;
  return todayYmdLocal();
}

function buildRawCsvRows(flatRows, { showDeliveryDate = false } = {}) {
  return (flatRows || []).map((r) => ({
    วันที่คัด: r.selected_date,
    ...(showDeliveryDate ? { วันที่จัดส่ง: r.delivery_date || "" } : {}),
    ฟาร์มที่คัด: r.from_farm_name,
    from_flock: r.from_flock,
    ฟาร์มปลายทาง: r.to_farm_name,
    โรงเรือน: r.house_no,
    flock: r.flock,
    เบอร์หมู: r.swine_code,
    dam_code: r.dam_code,
    sire_code: r.sire_code,
    birth_lot: r.birth_lot,
    วันเกิด: r.birth_date,
    "อายุ(วัน)": r.age_days,
    เต้าซ้าย: r.teats_left,
    เต้าขวา: r.teats_right,
    backfat: r.backfat,
    น้ำหนัก: r.weight,
    หมายเหตุ: r.remark,
    heat: r.is_heat,
    total_heat_count: r.total_heat_count,
    heat_1_date: r.heat_1_date,
    heat_2_date: r.heat_2_date,
    heat_3_date: r.heat_3_date,
    heat_4_date: r.heat_4_date,
  }));
}

function buildDailySummaryRows(flatRows) {
  const map = new Map();
  for (const r of flatRows || []) {
    const deliveryDate = safeText(r.delivery_date) || safeText(r.selected_date) || "ยังไม่ระบุ";
    if (!map.has(deliveryDate)) map.set(deliveryDate, []);
    map.get(deliveryDate).push(r);
  }
  return Array.from(map.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([deliveryDate, rows]) => ({
      วันที่จัดส่ง: deliveryDate,
      "จำนวนตัวรวมรายวัน": rows.length,
      "น้ำหนักรวมรายวัน": sumFromRows(rows, "weight"),
      "น้ำหนักเฉลี่ยรายวัน": avgFromRows(rows, "weight"),
    }));
}

function buildBirthLotSummaryRows(flatRows) {
  const map = new Map();
  for (const r of flatRows || []) {
    const deliveryDate = safeText(r.delivery_date) || safeText(r.selected_date) || "ยังไม่ระบุ";
    const fromFarm = safeText(r.from_farm_name);
    const toFarm = safeText(r.to_farm_name);
    const birthLot = safeText(r.birth_lot) || "-";
    const totalKey = [deliveryDate, fromFarm, toFarm].join("||");
    const key = [deliveryDate, fromFarm, toFarm, birthLot].join("||");
    if (!map.has(key)) {
      map.set(key, {
        วันที่จัดส่ง: deliveryDate,
        ฟาร์มที่คัด: fromFarm,
        ฟาร์มปลายทาง: toFarm,
        birth_lot: birthLot,
        __rows: [],
        __totalKey: totalKey,
      });
    }
    map.get(key).__rows.push(r);
  }
  const all = Array.from(map.values());
  const totalMap = new Map();
  for (const row of all) {
    if (!totalMap.has(row.__totalKey)) totalMap.set(row.__totalKey, []);
    totalMap.get(row.__totalKey).push(...row.__rows);
  }
  return all
    .sort((a, b) =>
      [a["วันที่จัดส่ง"], a["ฟาร์มที่คัด"], a["ฟาร์มปลายทาง"], a.birth_lot]
        .join("|")
        .localeCompare(
          [b["วันที่จัดส่ง"], b["ฟาร์มที่คัด"], b["ฟาร์มปลายทาง"], b.birth_lot].join("|")
        )
    )
    .map((row) => {
      const totalRows = totalMap.get(row.__totalKey) || [];
      return {
        วันที่จัดส่ง: row["วันที่จัดส่ง"],
        ฟาร์มที่คัด: row["ฟาร์มที่คัด"],
        ฟาร์มปลายทาง: row["ฟาร์มปลายทาง"],
        birth_lot: row.birth_lot,
        จำนวนตัว: row.__rows.length,
        "น้ำหนักรวมตาม birthlot": sumFromRows(row.__rows, "weight"),
        "น้ำหนักเฉลี่ยตาม birthlot": avgFromRows(row.__rows, "weight"),
        "น้ำหนักรวมทั้งหมด": sumFromRows(totalRows, "weight"),
        "น้ำหนักเฉลี่ยทั้งหมด": avgFromRows(totalRows, "weight"),
      };
    });
}

function buildExcelDetailRows(flatRows, { showDeliveryDate = false } = {}) {
  return (flatRows || []).map((r) => ({
    วันที่คัด: safeCell(r.selected_date),
    ...(showDeliveryDate ? { วันที่จัดส่ง: safeCell(r.delivery_date) } : {}),
    from_flock: safeCell(r.from_flock),
    โรงเรือน: safeCell(r.house_no),
    flock: safeCell(r.flock),
    เบอร์หมู: safeCell(r.swine_code),
    dam_code: safeCell(r.dam_code),
    sire_code: safeCell(r.sire_code),
    birth_lot: safeCell(r.birth_lot),
    วันเกิด: safeCell(r.birth_date),
    "อายุ(วัน)": safeCell(r.age_days),
    เต้าซ้าย: safeCell(r.teats_left),
    เต้าขวา: safeCell(r.teats_right),
    backfat: safeCell(r.backfat),
    น้ำหนัก: safeCell(r.weight),
    หมายเหตุ: safeCell(r.remark),
    heat: safeCell(r.is_heat),
    total_heat_count: safeCell(r.total_heat_count),
    heat_1_date: safeCell(r.heat_1_date),
    heat_2_date: safeCell(r.heat_2_date),
    heat_3_date: safeCell(r.heat_3_date),
    heat_4_date: safeCell(r.heat_4_date),
  }));
}

function exportExcelReport({
  flatRows,
  filename,
  title = "Swine Report",
  showDeliveryDate = false,
  summaryMeta = {},
}) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], []]);

  const overallRows = buildOverallSummaryRows(flatRows, summaryMeta);
  const dailyRows = buildDailySummaryRows(flatRows);
  const birthLotRows = buildBirthLotSummaryRows(flatRows);
  const detailRows = buildExcelDetailRows(flatRows, { showDeliveryDate });

  let nextRow = 2;

  XLSX.utils.sheet_add_aoa(ws, [["สรุปยอดรวมทั้งชุด"]], { origin: { r: nextRow, c: 0 } });
  nextRow += 1;
  XLSX.utils.sheet_add_json(ws, overallRows, {
    origin: { r: nextRow, c: 0 },
    skipHeader: false,
  });
  nextRow += overallRows.length + 3;

  XLSX.utils.sheet_add_aoa(ws, [["ยอดรวมรายวัน"]], { origin: { r: nextRow, c: 0 } });
  nextRow += 1;
  XLSX.utils.sheet_add_json(ws, dailyRows, {
    origin: { r: nextRow, c: 0 },
    skipHeader: false,
  });
  nextRow += dailyRows.length + 3;

  XLSX.utils.sheet_add_aoa(ws, [["สรุปตาม birth_lot"]], { origin: { r: nextRow, c: 0 } });
  nextRow += 1;
  XLSX.utils.sheet_add_json(ws, birthLotRows, {
    origin: { r: nextRow, c: 0 },
    skipHeader: false,
  });
  nextRow += birthLotRows.length + 3;

  XLSX.utils.sheet_add_aoa(ws, [["รายละเอียดรายตัว"]], { origin: { r: nextRow, c: 0 } });
  nextRow += 1;
  XLSX.utils.sheet_add_json(ws, detailRows, {
    origin: { r: nextRow, c: 0 },
    skipHeader: false,
  });

  const titleRows = [
    [title],
    [],
    ["สรุปยอดรวมทั้งชุด"],
    ["ยอดรวมรายวัน"],
    ["สรุปตาม birth_lot"],
    ["รายละเอียดรายตัว"],
  ];
  ws["!cols"] = makeSheetColsFromRows(
    titleRows,
    overallRows,
    dailyRows,
    birthLotRows,
    detailRows
  );

  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename);
}

function exportPdfReport({
  flatRows,
  filename,
  title = "Swine Report",
  dateText = "",
  fromFarmText = "",
  fromFlockText = "",
  toFarmText = "",
  showDeliveryDate = false,
  summaryMeta = {},
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pdfFont = ensurePdfThaiFont(doc);

  const overallRows = buildOverallSummaryRows(flatRows, summaryMeta);
  const dailyRows = buildDailySummaryRows(flatRows);
  const birthLotRows = buildBirthLotSummaryRows(flatRows);

  doc.setFont(pdfFont, "bold");
  doc.setFontSize(14);
  doc.text(title, 14, 12);

  doc.setFont(pdfFont, "normal");
  doc.setFontSize(9);
  doc.text(`ช่วงวันที่: ${dateText || "-"}`, 14, 18);
  doc.text(`ฟาร์มที่คัด: ${fromFarmText || "-"}`, 14, 23);
  doc.text(`Flock: ${fromFlockText || "-"}`, 14, 28);
  doc.text(`ฟาร์มปลายทาง: ${toFarmText || "all"}`, 14, 33);

  autoTable(doc, {
    startY: 39,
    head: [["รายการ", "ค่า"]],
    body: overallRows.map((r) => [r["รายการ"], r["ค่า"]]),
    styles: { font: pdfFont, fontSize: 8.5, cellPadding: 1.8, overflow: "linebreak" },
    headStyles: { font: pdfFont, fontStyle: "bold", fillColor: [15, 23, 42] },
    theme: "grid",
    margin: { left: 14, right: 14 },
    tableWidth: 90,
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 39) + 6,
    head: [["วันที่จัดส่ง", "จำนวนตัวรวมรายวัน", "น้ำหนักรวมรายวัน", "น้ำหนักเฉลี่ยรายวัน"]],
    body: dailyRows.map((r) => [
      r["วันที่จัดส่ง"],
      r["จำนวนตัวรวมรายวัน"],
      r["น้ำหนักรวมรายวัน"],
      r["น้ำหนักเฉลี่ยรายวัน"],
    ]),
    styles: { font: pdfFont, fontSize: 8, cellPadding: 1.8, overflow: "linebreak" },
    headStyles: { font: pdfFont, fontStyle: "bold", fillColor: [15, 23, 42] },
    theme: "grid",
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 39) + 6,
    head: [[
      "วันที่จัดส่ง",
      "ฟาร์มที่คัด",
      "ฟาร์มปลายทาง",
      "birth_lot",
      "จำนวนตัว",
      "น้ำหนักรวมตาม birthlot",
      "น้ำหนักเฉลี่ยตาม birthlot",
      "น้ำหนักรวมทั้งหมด",
      "น้ำหนักเฉลี่ยทั้งหมด",
    ]],
    body: birthLotRows.map((r) => [
      r["วันที่จัดส่ง"],
      r["ฟาร์มที่คัด"],
      r["ฟาร์มปลายทาง"],
      r["birth_lot"],
      r["จำนวนตัว"],
      r["น้ำหนักรวมตาม birthlot"],
      r["น้ำหนักเฉลี่ยตาม birthlot"],
      r["น้ำหนักรวมทั้งหมด"],
      r["น้ำหนักเฉลี่ยทั้งหมด"],
    ]),
    styles: { font: pdfFont, fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
    headStyles: { font: pdfFont, fontStyle: "bold", fillColor: [22, 163, 74] },
    theme: "grid",
    margin: { left: 8, right: 8 },
  });

  const detailRows = flatRows || [];
  const pageSize = 28;

  for (let i = 0; i < detailRows.length; i += pageSize) {
    const chunk = detailRows.slice(i, i + pageSize);

    doc.addPage("a4", "landscape");
    doc.setFont(pdfFont, "bold");
    doc.setFontSize(11);
    doc.text("รายละเอียดรายตัว", 14, 12);

    autoTable(doc, {
      startY: 16,
      head: [[
        "วันที่คัด",
        ...(showDeliveryDate ? ["วันที่จัดส่ง"] : []),
        "เบอร์หมู",
        "dam_code",
        "sire_code",
        "birth_lot",
        "วันเกิด",
        "อายุ(วัน)",
        "โรงเรือน",
        "flock",
        "เต้าซ้าย",
        "เต้าขวา",
        "backfat",
        "น้ำหนัก",
        "หมายเหตุ",
        "heat",
        "total_heat_count",
        "heat_1_date",
        "heat_2_date",
        "heat_3_date",
        "heat_4_date",
      ]],
      body: chunk.map((r) => [
        safeCell(r.selected_date),
        ...(showDeliveryDate ? [safeCell(r.delivery_date)] : []),
        safeCell(r.swine_code),
        safeCell(r.dam_code),
        safeCell(r.sire_code),
        safeCell(r.birth_lot),
        safeCell(r.birth_date),
        safeCell(r.age_days),
        safeCell(r.house_no),
        safeCell(r.flock),
        safeCell(r.teats_left),
        safeCell(r.teats_right),
        safeCell(r.backfat),
        safeCell(r.weight),
        safeCell(r.remark),
        safeCell(r.is_heat),
        safeCell(r.total_heat_count),
        safeCell(r.heat_1_date),
        safeCell(r.heat_2_date),
        safeCell(r.heat_3_date),
        safeCell(r.heat_4_date),
      ]),
      styles: { font: pdfFont, fontSize: 5.8, cellPadding: 0.9, overflow: "linebreak" },
      headStyles: { font: pdfFont, fontStyle: "bold", fillColor: [15, 23, 42] },
      theme: "grid",
      margin: { left: 6, right: 6 },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(8);
    doc.text(`หน้า ${page}/${pageCount}`, 287, 205, { align: "right" });
  }

  doc.save(filename);
}

function parseYmdToUtcDate(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function calcAgeDays(referenceDate, birthDate) {
  const s = parseYmdToUtcDate(referenceDate);
  const b = parseYmdToUtcDate(birthDate);
  if (!s || !b) return "";
  const diffMs = s.getTime() - b.getTime();
  const days = Math.floor(diffMs / 86400000);
  return days >= 0 ? days : "";
}

function chunkArray(arr, size = 200) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function sortByLabelTh(a, b) {
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th");
}

function formatStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "draft") return "draft";
  if (s === "submitted") return "submitted";
  if (s === "issued") return "issued";
  return s || "-";
}

function statusBadgeStyle(status) {
  const s = String(status || "").toLowerCase();

  if (s === "draft") {
    return {
      display: "inline-flex",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      border: "1px solid #fde68a",
      background: "#fffbeb",
      color: "#92400e",
      whiteSpace: "nowrap",
    };
  }

  if (s === "issued") {
    return {
      display: "inline-flex",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      border: "1px solid #cbd5e1",
      background: "#f8fafc",
      color: "#334155",
      whiteSpace: "nowrap",
    };
  }

  return {
    display: "inline-flex",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid #a7f3d0",
    background: "#ecfdf5",
    color: "#047857",
    whiteSpace: "nowrap",
  };
}

const pageWrapStyle = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f0fdf4 0%, #f8fafc 45%, #ffffff 100%)",
  boxSizing: "border-box",
};

const shellStyle = {
  width: "100%",
  maxWidth: 1280,
  margin: "0 auto",
  display: "grid",
  gap: 16,
  boxSizing: "border-box",
};

const topCardStyle = {
  background: "#ffffff",
  border: "1px solid #d1fae5",
  borderRadius: 24,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(16, 185, 129, 0.10)",
};

const topHeadStyle = {
  background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
  color: "#ffffff",
};

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
  boxSizing: "border-box",
  minWidth: 0,
};

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  outline: "none",
  minWidth: 0,
  background: "#ffffff",
};

const disabledInputStyle = {
  ...inputStyle,
  background: "#f1f5f9",
  color: "#64748b",
};

const btnBaseStyle = {
  border: 0,
  borderRadius: 14,
  padding: "11px 16px",
  fontWeight: 700,
  cursor: "pointer",
  transition: "all .15s ease",
  minHeight: 44,
};

const btnLightStyle = {
  ...btnBaseStyle,
  background: "#ffffff",
  color: "#334155",
  border: "1px solid #cbd5e1",
};

const btnGreenStyle = {
  ...btnBaseStyle,
  background: "#059669",
  color: "#ffffff",
};

const btnDarkStyle = {
  ...btnBaseStyle,
  background: "#0f172a",
  color: "#ffffff",
};

const msgStyle = {
  borderRadius: 16,
  padding: "12px 14px",
  fontSize: 14,
  lineHeight: 1.6,
  fontWeight: 700,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e",
  wordBreak: "break-word",
};

const thStyle = {
  textAlign: "left",
  padding: "12px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  fontWeight: 800,
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const tdStyle = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  color: "#0f172a",
  verticalAlign: "top",
};

const emptyTdStyle = {
  padding: 18,
  textAlign: "center",
  color: "#64748b",
  fontSize: 14,
};

export default function ExportCsvPage() {
  const nav = useNavigate();

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  const [pageLoading, setPageLoading] = useState(true);
  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeExportKind, setActiveExportKind] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [msg, setMsg] = useState("");

  const [myProfile, setMyProfile] = useState(null);
  const [myRole, setMyRole] = useState("");
  const [myScope, setMyScope] = useState([]);

  const [reportType, setReportType] = useState("raw"); // raw | not_selected

  const [dateFrom, setDateFrom] = useState(todayYmdLocal());
  const [dateTo, setDateTo] = useState(todayYmdLocal());

  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [toFarmId, setToFarmId] = useState("");
  const [fromFarmQ, setFromFarmQ] = useState("");
  const [toFarmQ, setToFarmQ] = useState("");

  const [fromFarmOptions, setFromFarmOptions] = useState([]);
  const [toFarmOptions, setToFarmOptions] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewShipments, setPreviewShipments] = useState([]);
  const [previewMeta, setPreviewMeta] = useState(createEmptyPreviewMeta());
  const [deliveryDateDrafts, setDeliveryDateDrafts] = useState({});
  const [savingDeliveryDateMap, setSavingDeliveryDateMap] = useState({});

  const authSeqRef = useRef(0);
  const fromFarmReqRef = useRef(0);
  const toFarmReqRef = useRef(0);
  const previewReqRef = useRef(0);

  const isAdmin = String(myRole).toLowerCase() === "admin";
  const isUser = String(myRole).toLowerCase() === "user";
  const isActive = myProfile?.is_active !== false;
  const canUsePage = isActive && (isAdmin || isUser);

  const effectiveDateFrom = dateFrom;
  const effectiveDateTo = dateTo;

  const myScopeKeySet = useMemo(() => {
    return new Set(
      (myScope || []).map((x) => makeScopeKey(x.farm_code, x.flock)).filter(Boolean)
    );
  }, [myScope]);

  const selectedScope = useMemo(() => parseScopeKey(selectedScopeKey), [selectedScopeKey]);
  const selectedFromFarmCode = selectedScope.farm_code;
  const selectedFromFlock = selectedScope.flock;

  const selectedScopeOption = useMemo(() => {
    return fromFarmOptions.find((x) => x.value === selectedScopeKey) || null;
  }, [fromFarmOptions, selectedScopeKey]);

  const dateRangeValid = useMemo(() => {
    return Boolean(
      effectiveDateFrom &&
        effectiveDateTo &&
        String(effectiveDateFrom) <= String(effectiveDateTo)
    );
  }, [effectiveDateFrom, effectiveDateTo]);

  const canPreviewExport = useMemo(() => {
    if (!dateRangeValid) return false;
    if (!selectedScopeKey) return false;
    if (!isAdmin && !myScopeKeySet.has(selectedScopeKey)) return false;

    return Boolean(effectiveDateFrom && effectiveDateTo);
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    selectedScopeKey,
    isAdmin,
    myScopeKeySet,
  ]);

  const canSubmitRows =
    reportType === "raw" &&
    Boolean(
      dateRangeValid &&
        effectiveDateFrom === effectiveDateTo &&
        selectedScopeKey &&
        toFarmId &&
        (isAdmin || myScopeKeySet.has(selectedScopeKey))
    );

  const showDeliveryDate = reportType === "raw" && Boolean(toFarmId);

  const deliveryDateShipments = useMemo(() => {
    if (reportType !== "raw" || !toFarmId) return [];

    const rows = (previewShipments || []).filter(
      (shipment) => clean(shipment?.to_farm_id) === clean(toFarmId)
    );

    return rows.slice().sort((a, b) => {
      const da = String(a?.selected_date || "");
      const db = String(b?.selected_date || "");
      if (da !== db) return da.localeCompare(db);
      return String(a?.shipment_no || a?.id || "").localeCompare(
        String(b?.shipment_no || b?.id || "")
      );
    });
  }, [previewShipments, reportType, toFarmId]);

  const missingDeliveryDateCount = useMemo(() => {
    return deliveryDateShipments.filter((shipment) => !clean(shipment?.delivery_date)).length;
  }, [deliveryDateShipments]);

  const previewScopeText = useMemo(() => {
    const farmCode = clean(previewMeta?.fromFarmCode);
    const flock = clean(previewMeta?.fromFlock);
    const farmName = clean(selectedScopeOption?.farm_name);
    if (!farmCode) return "-";
    return farmName
      ? `${farmCode} - ${farmName} | flock: ${flock || "-"}`
      : `${farmCode} | flock: ${flock || "-"}`;
  }, [previewMeta, selectedScopeOption]);

  const selectedToFarmOption = useMemo(() => {
    return toFarmOptions.find((x) => x.value === toFarmId) || null;
  }, [toFarmOptions, toFarmId]);

  const activeDestinationBadgeText = useMemo(() => {
    if (reportType !== "raw") return "";
    if (!toFarmId) return "กำลังดูทุกปลายทาง";
    return `กำลังดูปลายทาง: ${selectedToFarmOption?.label || clean(toFarmId)}`;
  }, [reportType, toFarmId, selectedToFarmOption]);

  const previewDestinationText = useMemo(() => {
    if (previewMeta?.reportType !== "raw") return "";
    if (!clean(previewMeta?.toFarmId)) return "ทุกปลายทาง";
    return (
      toFarmOptions.find((x) => x.value === previewMeta?.toFarmId)?.label ||
      clean(previewMeta?.toFarmId)
    );
  }, [previewMeta, toFarmOptions]);

  const resetRuntimeState = useCallback(({ keepDates = true } = {}) => {
    setMsg("");
    setMyProfile(null);
    setMyRole("");
    setMyScope([]);
    setReportType("raw");
    if (!keepDates) {
      const today = todayYmdLocal();
      setDateFrom(today);
      setDateTo(today);
    }
    setSelectedScopeKey("");
    setToFarmId("");
    setFromFarmQ("");
    setToFarmQ("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setPreviewRows([]);
    setPreviewShipments([]);
    setPreviewMeta(createEmptyPreviewMeta());
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});
  }, []);

  useEffect(() => {
    setDeliveryDateDrafts((prev) => {
      const next = {};
      const ids = new Set();

      for (const shipment of deliveryDateShipments) {
        const id = clean(shipment?.id);
        if (!id) continue;
        ids.add(id);
        next[id] = Object.prototype.hasOwnProperty.call(prev || {}, id)
          ? prev[id]
          : clean(shipment?.delivery_date);
      }

      const prevKeys = Object.keys(prev || {});
      const sameLength = prevKeys.length === ids.size;
      const sameValues = sameLength && prevKeys.every((k) => ids.has(k) && next[k] === prev[k]);
      return sameValues ? prev : next;
    });
  }, [deliveryDateShipments]);

  const handleDeliveryDateDraftChange = useCallback((shipmentId, value) => {
    const id = clean(shipmentId);
    if (!id) return;

    setDeliveryDateDrafts((prev) => ({
      ...(prev || {}),
      [id]: value,
    }));
  }, []);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const loadMyFarmFlockScope = useCallback(async (userId) => {
    if (!userId) return [];

    const { data, error } = await supabase
      .from("swine_shipments")
      .select("from_farm_code, from_farm_name, from_flock")
      .eq("created_by", userId)
      .in("status", ["draft", "submitted", "issued"])
      .order("from_farm_code", { ascending: true });

    if (error) throw error;

    const map = new Map();

    for (const row of data || []) {
      const farmCode = clean(row?.from_farm_code);
      const farmName = clean(row?.from_farm_name);
      const flock = clean(row?.from_flock);
      if (!farmCode || !flock) continue;

      const key = makeScopeKey(farmCode, flock);
      if (!map.has(key)) {
        map.set(key, {
          farm_code: farmCode,
          farm_name: farmName,
          flock,
          scope_key: key,
          label: farmName
            ? `${farmCode} - ${farmName} | flock: ${flock}`
            : `${farmCode} | flock: ${flock}`,
        });
      }
    }

    return Array.from(map.values());
  }, []);

  useEffect(() => {
    let alive = true;

    async function initForCurrentSession() {
      const runId = ++authSeqRef.current;
      setPageLoading(true);
      setMsg("");
      setPreviewRows([]);

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;

        const uid = session?.user?.id || null;
        if (!uid) {
          if (alive && authSeqRef.current === runId) {
            resetRuntimeState();
            setMsg("ไม่พบผู้ใช้งาน กรุณา login ใหม่");
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive || authSeqRef.current !== runId) return;

        setMyProfile(profile || null);
        const role = String(profile?.role || "").toLowerCase();
        setMyRole(role);

        if (profile?.is_active === false) {
          setMyScope([]);
          setMsg("ผู้ใช้งานถูกปิดสิทธิ์");
          return;
        }

        if (role === "admin") {
          setMyScope([]);
          return;
        }

        const scope = await loadMyFarmFlockScope(uid);
        if (!alive || authSeqRef.current !== runId) return;
        setMyScope(scope);
      } catch (e) {
        console.error("init ExportCsvPage error:", e);
        if (alive && authSeqRef.current === runId) {
          resetRuntimeState();
          setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
        }
      } finally {
        if (alive && authSeqRef.current === runId) {
          setPageLoading(false);
        }
      }
    }

    void initForCurrentSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      resetRuntimeState();
      setPageLoading(true);
      void initForCurrentSession();
    });

    return () => {
      alive = false;
      subscription?.unsubscribe?.();
    };
  }, [loadMyFarmFlockScope, resetRuntimeState]);

  const filterShipmentsByScope = useCallback(
    (shipments) => {
      if (isAdmin) return shipments || [];
      if (!myScopeKeySet.size) return [];

      return (shipments || []).filter((row) =>
        myScopeKeySet.has(makeScopeKey(row?.from_farm_code, row?.from_flock))
      );
    },
    [isAdmin, myScopeKeySet]
  );

  const resetPreviewState = useCallback(() => {
    previewReqRef.current += 1;
    setPreviewRows([]);
    setPreviewShipments([]);
    setPreviewMeta(createEmptyPreviewMeta());
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});
    setMsg("");
  }, []);

  const resetSelectionsAfterDateChange = useCallback(() => {
    previewReqRef.current += 1;
    toFarmReqRef.current += 1;
    setToFarmId("");
    setToFarmQ("");
    setToFarmOptions([]);
    setPreviewRows([]);
    setPreviewShipments([]);
    setPreviewMeta(createEmptyPreviewMeta());
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});
    setMsg("");
  }, []);

  const loadFromFarmOptions = useCallback(async () => {
    const reqId = ++fromFarmReqRef.current;

    if (!canUsePage) {
      if (reqId === fromFarmReqRef.current) setFromFarmOptions([]);
      return;
    }

    setFromFarmLoading(true);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name, from_flock")
        .in("status", ["draft", "submitted", "issued"])
        .order("from_farm_code", { ascending: true });

      if (error) throw error;

      const rows = isAdmin
        ? data || []
        : (data || []).filter((row) =>
            myScopeKeySet.has(makeScopeKey(row?.from_farm_code, row?.from_flock))
          );

      const map = new Map();

      for (const row of rows) {
        const code = clean(row?.from_farm_code);
        const name = clean(row?.from_farm_name);
        const flock = clean(row?.from_flock);
        if (!code || !flock) continue;

        const scopeKey = makeScopeKey(code, flock);
        const existing = map.get(scopeKey);
        if (!existing) {
          map.set(scopeKey, {
            value: scopeKey,
            scope_key: scopeKey,
            farm_code: code,
            farm_name: name,
            flock,
            label: name
              ? `${code} - ${name} | flock: ${flock}`
              : `${code} | flock: ${flock}`,
          });
        } else if (!existing.farm_name && name) {
          existing.farm_name = name;
          existing.label = `${code} - ${name} | flock: ${flock}`;
        }
      }

      if (!isAdmin) {
        for (const scope of myScope || []) {
          const code = clean(scope?.farm_code);
          const name = clean(scope?.farm_name);
          const flock = clean(scope?.flock);
          if (!code || !flock) continue;

          const scopeKey = makeScopeKey(code, flock);
          if (!map.has(scopeKey)) {
            map.set(scopeKey, {
              value: scopeKey,
              scope_key: scopeKey,
              farm_code: code,
              farm_name: name,
              flock,
              label: name
                ? `${code} - ${name} | flock: ${flock}`
                : `${code} | flock: ${flock}`,
            });
          }
        }
      }

      if (reqId !== fromFarmReqRef.current) return;
      setFromFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadFromFarmOptions error:", e);
      if (reqId !== fromFarmReqRef.current) return;
      setFromFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์ม+flock ไม่สำเร็จ");
    } finally {
      if (reqId === fromFarmReqRef.current) setFromFarmLoading(false);
    }
  }, [canUsePage, isAdmin, myScope, myScopeKeySet]);

  const loadToFarmOptions = useCallback(async () => {
    const reqId = ++toFarmReqRef.current;

    if (
      reportType !== "raw" ||
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !selectedFromFarmCode ||
      !selectedFromFlock
    ) {
      if (reqId === toFarmReqRef.current) setToFarmOptions([]);
      return;
    }

    setToFarmLoading(true);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select(`
          from_farm_code,
          from_flock,
          to_farm_id,
          to_farm:master_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .gte("selected_date", effectiveDateFrom)
        .lte("selected_date", effectiveDateTo)
        .eq("from_farm_code", selectedFromFarmCode)
        .eq("from_flock", selectedFromFlock)
        .in("status", ["draft", "submitted", "issued"])
        .order("created_at", { ascending: false });

      if (error) throw error;

      const scopedRows = filterShipmentsByScope(data || []);
      const rows = isAdmin ? data || [] : scopedRows;

      const map = new Map();

      for (const row of rows) {
        const id = clean(row?.to_farm_id);
        const farmCode = clean(row?.to_farm?.farm_code);
        const farmName = clean(row?.to_farm?.farm_name);
        if (!id) continue;

        if (!map.has(id)) {
          map.set(id, {
            value: id,
            label: farmCode ? `${farmCode} - ${farmName}` : farmName || id,
            farm_code: farmCode,
            farm_name: farmName,
          });
        }
      }

      if (reqId !== toFarmReqRef.current) return;
      setToFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadToFarmOptions error:", e);
      if (reqId !== toFarmReqRef.current) return;
      setToFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์มปลายทางไม่สำเร็จ");
    } finally {
      if (reqId === toFarmReqRef.current) setToFarmLoading(false);
    }
  }, [
    reportType,
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    selectedFromFarmCode,
    selectedFromFlock,
    filterShipmentsByScope,
    isAdmin,
  ]);

  useEffect(() => {
    if (!canUsePage) {
      setFromFarmOptions([]);
      return;
    }
    void loadFromFarmOptions();
  }, [canUsePage, loadFromFarmOptions]);

  useEffect(() => {
    if (
      !canUsePage ||
      reportType !== "raw" ||
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !selectedFromFarmCode ||
      !selectedFromFlock
    ) {
      setToFarmOptions([]);
      return;
    }
    void loadToFarmOptions();
  }, [
    canUsePage,
    reportType,
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    selectedFromFarmCode,
    selectedFromFlock,
    loadToFarmOptions,
  ]);

  const fetchBaseSwinesByScope = useCallback(async (farmCode, flock) => {
    const cleanFarmCode = clean(farmCode);
    const cleanFlock = clean(flock);

    if (!cleanFarmCode || !cleanFlock) return [];

    const pageSize = 1000;
    let from = 0;
    const allRows = [];

    while (true) {
      const { data, error } = await supabase
        .from("swines")
        .select(
          "id, swine_code, farm_code, farm_name, house_no, flock, birth_date, birth_lot, dam_code, sire_code"
        )
        .eq("farm_code", cleanFarmCode)
        .eq("flock", cleanFlock)
        .order("house_no", { ascending: true })
        .order("swine_code", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const rows = data || [];
      allRows.push(
        ...rows.map((row) => ({
          ...row,
          birth_lot: getBirthLotValue(row),
        }))
      );

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return allRows;
  }, []);

  async function loadSwineMapByCodes(swineCodes) {
    const uniqueCodes = Array.from(
      new Set((swineCodes || []).map((x) => clean(x)).filter(Boolean))
    );

    if (!uniqueCodes.length) return {};

    const chunks = chunkArray(uniqueCodes, 200);
    const allRows = [];

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swines")
        .select(
          "swine_code, house_no, flock, birth_date, birth_lot, dam_code, sire_code, farm_code, farm_name"
        )
        .in("swine_code", chunk);

      if (error) throw error;
      allRows.push(...(data || []));
    }

    const map = {};
    for (const row of allRows) {
      map[clean(row.swine_code)] = {
        ...row,
        birth_lot: getBirthLotValue(row),
      };
    }
    return map;
  }

  async function loadHeatMapByCodes(swineCodes) {
    const uniqueCodes = Array.from(
      new Set((swineCodes || []).map((x) => clean(x)).filter(Boolean))
    );

    if (!uniqueCodes.length) return {};

    const chunks = chunkArray(uniqueCodes, 200);
    const allRows = [];

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swine_heat_report")
        .select(
          "swine_code, heat_1_date, heat_2_date, heat_3_date, heat_4_date, total_heat_count"
        )
        .in("swine_code", chunk);

      if (error) throw error;
      allRows.push(...(data || []));
    }

    const map = {};
    for (const row of allRows) {
      const totalHeat = Number(row?.total_heat_count || 0);
      map[clean(row.swine_code)] = {
        is_heat: totalHeat > 0 ? "Y" : "N",
        total_heat_count: totalHeat,
        heat_1_date: row?.heat_1_date || "",
        heat_2_date: row?.heat_2_date || "",
        heat_3_date: row?.heat_3_date || "",
        heat_4_date: row?.heat_4_date || "",
      };
    }

    return map;
  }

  async function fetchShipmentItemsMap(shipmentIds) {
    const uniqueIds = Array.from(
      new Set((shipmentIds || []).map((x) => clean(x)).filter(Boolean))
    );

    if (!uniqueIds.length) return {};

    const chunks = chunkArray(uniqueIds, 200);
    const map = {};

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swine_shipment_items")
        .select("id, shipment_id, swine_code, teats_left, teats_right, backfat, weight")
        .in("shipment_id", chunk);

      if (error) throw error;

      for (const row of data || []) {
        const shipmentId = clean(row?.shipment_id);
        if (!shipmentId) continue;
        if (!map[shipmentId]) map[shipmentId] = [];
        map[shipmentId].push(row);
      }
    }

    return map;
  }

  const fetchCumulativeSelectedSnapshot = useCallback(async () => {
    if (!dateRangeValid || !effectiveDateTo || !selectedFromFarmCode || !selectedFromFlock) {
      return { shipments: [], selectedCodeSet: new Set(), selectedUniqueCount: 0 };
    }

    const { data: shipmentHeaders, error: shipmentError } = await supabase
      .from("swine_shipments")
      .select("id, from_farm_code, from_flock, status, selected_date")
      .lte("selected_date", effectiveDateTo)
      .eq("from_farm_code", selectedFromFarmCode)
      .eq("from_flock", selectedFromFlock)
      .in("status", ["draft", "submitted", "issued"]);

    if (shipmentError) throw shipmentError;

    const scopedHeaders = filterShipmentsByScope(shipmentHeaders || []);
    const shipments = isAdmin ? shipmentHeaders || [] : scopedHeaders;

    const itemsMap = await fetchShipmentItemsMap(shipments.map((x) => x.id));
    const selectedCodeSet = new Set();

    for (const shipment of shipments) {
      const items = itemsMap[clean(shipment?.id)] || [];
      for (const item of items) {
        const code = clean(item?.swine_code);
        if (code) selectedCodeSet.add(code);
      }
    }

    return {
      shipments,
      selectedCodeSet,
      selectedUniqueCount: selectedCodeSet.size,
    };
  }, [
    dateRangeValid,
    effectiveDateTo,
    selectedFromFarmCode,
    selectedFromFlock,
    filterShipmentsByScope,
    isAdmin,
  ]);

  const fetchExportBaseData = useCallback(async () => {
    if (
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !selectedFromFarmCode ||
      !selectedFromFlock
    ) {
      return { shipments: [], swineMap: {}, heatMap: {}, baseSwinesRows: [], cumulativeSelectedCount: 0 };
    }

    const query = supabase
      .from("swine_shipments")
      .select(`
        id,
        shipment_no,
        selected_date,
        delivery_date,
        from_farm_code,
        from_farm_name,
        from_flock,
        remark,
        to_farm_id,
        status,
        created_at,
        updated_at,
        to_farm:master_farms!swine_shipments_to_farm_id_fkey (
          id,
          farm_code,
          farm_name
        )
      `)
      .gte("selected_date", effectiveDateFrom)
      .lte("selected_date", effectiveDateTo)
      .eq("from_farm_code", selectedFromFarmCode)
      .eq("from_flock", selectedFromFlock)
      .in("status", ["draft", "submitted", "issued"])
      .order("created_at", { ascending: false });

    const [{ data, error }, baseSwinesRows, cumulativeSnapshot] = await Promise.all([
      query,
      fetchBaseSwinesByScope(selectedFromFarmCode, selectedFromFlock),
      fetchCumulativeSelectedSnapshot(),
    ]);

    if (error) throw error;

    const scopedHeaders = filterShipmentsByScope(data || []);
    const shipmentHeaders = isAdmin ? data || [] : scopedHeaders;
    const shipmentHeadersFound = shipmentHeaders.length;

    const filteredShipmentHeaders =
      reportType === "raw" && clean(toFarmId)
        ? shipmentHeaders.filter(
            (shipment) => clean(shipment?.to_farm_id) === clean(toFarmId)
          )
        : shipmentHeaders;

    const shipmentHeadersAfterDestinationFilter = filteredShipmentHeaders.length;

    const shipments = filteredShipmentHeaders.map((shipment) => ({
      ...shipment,
      items: [],
    }));

    const itemsMap = await fetchShipmentItemsMap(shipments.map((x) => x.id));
    for (const shipment of shipments) {
      shipment.items = itemsMap[clean(shipment?.id)] || [];
    }

    const allCodes = [];
    for (const shipment of shipments) {
      for (const item of shipment.items || []) {
        if (item?.swine_code) allCodes.push(item.swine_code);
      }
    }

    const [swineMap, heatMap] = await Promise.all([
      loadSwineMapByCodes(allCodes),
      loadHeatMapByCodes(allCodes),
    ]);

    return {
      shipments,
      swineMap,
      heatMap,
      baseSwinesRows,
      cumulativeSelectedCount: Number(cumulativeSnapshot?.selectedUniqueCount || 0),
      shipmentHeadersFound,
      shipmentHeadersAfterDestinationFilter,
    };
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    selectedFromFarmCode,
    selectedFromFlock,
    reportType,
    toFarmId,
    fetchBaseSwinesByScope,
    fetchCumulativeSelectedSnapshot,
    filterShipmentsByScope,
    isAdmin,
  ]);

  function buildFlatRows(shipments, swineMap, heatMap, options = {}) {
    const rows = [];
    const deliveryDateEnabled = Boolean(options?.deliveryDateEnabled);

    for (const shipment of shipments || []) {
      for (const item of shipment.items || []) {
        const code = clean(item?.swine_code);
        const swine = swineMap[code] || {};
        const heat = heatMap[code] || {
          is_heat: "N",
          total_heat_count: 0,
          heat_1_date: "",
          heat_2_date: "",
          heat_3_date: "",
          heat_4_date: "",
        };

        const ageRefDate = clean(shipment?.delivery_date) || clean(shipment?.selected_date);

        rows.push({
          shipment_id: shipment.id || "",
          shipment_no: shipment.shipment_no || "",
          shipment_status: shipment.status || "",
          selected_date: shipment.selected_date || "",
          delivery_date: deliveryDateEnabled ? shipment.delivery_date || "-" : "",
          from_farm_code: shipment.from_farm_code || "",
          from_farm_name: shipment.from_farm_name || "",
          from_flock: shipment.from_flock || "",
          house_no: swine.house_no || "",
          flock: swine.flock || "",
          to_farm_code: shipment.to_farm?.farm_code || "",
          to_farm_name: shipment.to_farm?.farm_name || "",
          swine_code: code,
          dam_code: swine?.dam_code || "",
          sire_code: swine?.sire_code || "",
          birth_lot: getBirthLotValue(swine),
          birth_date: swine.birth_date || "",
          age_days: calcAgeDays(ageRefDate, swine.birth_date),
          is_heat: heat.is_heat,
          total_heat_count: heat.total_heat_count,
          heat_1_date: heat.heat_1_date,
          heat_2_date: heat.heat_2_date,
          heat_3_date: heat.heat_3_date,
          heat_4_date: heat.heat_4_date,
          teats_left: item?.teats_left ?? "",
          teats_right: item?.teats_right ?? "",
          backfat: item?.backfat ?? "",
          weight: item?.weight ?? "",
          remark: shipment.remark || "",
          created_at: shipment.created_at || "",
          updated_at: shipment.updated_at || "",
        });
      }
    }

    return rows;
  }

  const fetchNotSelectedRows = useCallback(async () => {
    if (
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !selectedFromFarmCode ||
      !selectedFromFlock
    ) {
      return {
        rows: [],
        shipments: [],
        baseSwinesRows: [],
        selectedUniqueCount: 0,
        cumulativeSelectedCount: 0,
      };
    }

    const [baseSwinesRows, cumulativeSnapshot] = await Promise.all([
      fetchBaseSwinesByScope(selectedFromFarmCode, selectedFromFlock),
      fetchCumulativeSelectedSnapshot(),
    ]);

    const selectedCodeSet = cumulativeSnapshot?.selectedCodeSet || new Set();

    const notSelected = baseSwinesRows.filter((row) => {
      const code = clean(row?.swine_code);
      if (!code) return false;
      return !selectedCodeSet.has(code);
    });

    const heatMap = await loadHeatMapByCodes(notSelected.map((x) => x.swine_code));

    const rows = notSelected.map((row) => {
      const code = clean(row?.swine_code);
      const heat = heatMap[code] || {
        is_heat: "N",
        total_heat_count: 0,
        heat_1_date: "",
        heat_2_date: "",
        heat_3_date: "",
        heat_4_date: "",
      };

      return {
        farm_code: row?.farm_code || "",
        farm_name: row?.farm_name || "",
        house_no: row?.house_no || "",
        flock: row?.flock || "",
        swine_code: code,
        birth_date: row?.birth_date || "",
        birth_lot: getBirthLotValue(row),
        is_heat: heat.is_heat,
        total_heat_count: heat.total_heat_count,
        heat_1_date: heat.heat_1_date,
        heat_2_date: heat.heat_2_date,
        heat_3_date: heat.heat_3_date,
        heat_4_date: heat.heat_4_date,
      };
    });

    return {
      rows,
      shipments: cumulativeSnapshot?.shipments || [],
      baseSwinesRows,
      selectedUniqueCount: cumulativeSnapshot?.selectedUniqueCount || 0,
      cumulativeSelectedCount: cumulativeSnapshot?.selectedUniqueCount || 0,
    };
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    selectedFromFarmCode,
    selectedFromFlock,
    fetchBaseSwinesByScope,
    fetchCumulativeSelectedSnapshot,
  ]);


  const refreshPreviewRows = useCallback(async () => {
    const reqId = ++previewReqRef.current;

    if (reportType === "not_selected") {
      const {
        rows,
        shipments,
        baseSwinesRows,
        selectedUniqueCount,
        cumulativeSelectedCount,
      } = await fetchNotSelectedRows();

      if (reqId === previewReqRef.current) {
        setPreviewRows(rows);
        setPreviewShipments(shipments || []);
        setPreviewMeta({
          hasPreviewed: true,
          reportType,
          scopeKey: selectedScopeKey,
          fromFarmCode: selectedFromFarmCode,
          fromFlock: selectedFromFlock,
          toFarmId: "",
          dateFrom: effectiveDateFrom,
          dateTo: effectiveDateTo,
          baseSwinesCount: baseSwinesRows.length,
          selectedUniqueCount,
          cumulativeSelectedCount,
          remainingCount: rows.length,
          shipmentHeadersFound: 0,
          shipmentHeadersAfterDestinationFilter: 0,
        });
      }
      return { shipments, rows };
    }

    const {
      shipments,
      swineMap,
      heatMap,
      baseSwinesRows,
      cumulativeSelectedCount,
      shipmentHeadersFound,
      shipmentHeadersAfterDestinationFilter,
    } = await fetchExportBaseData();

    const rows = buildFlatRows(shipments, swineMap, heatMap, {
      deliveryDateEnabled: Boolean(toFarmId),
    });
    const selectedUniqueCount = uniqueCountFromRows(rows, "swine_code");
    const remainingCount = Math.max(baseSwinesRows.length - cumulativeSelectedCount, 0);

    if (reqId === previewReqRef.current) {
      setPreviewRows(rows);
      setPreviewShipments(shipments);
      setPreviewMeta({
        hasPreviewed: true,
        reportType,
        scopeKey: selectedScopeKey,
        fromFarmCode: selectedFromFarmCode,
        fromFlock: selectedFromFlock,
        toFarmId: clean(toFarmId),
        dateFrom: effectiveDateFrom,
        dateTo: effectiveDateTo,
        baseSwinesCount: baseSwinesRows.length,
        selectedUniqueCount,
        cumulativeSelectedCount,
        remainingCount,
        shipmentHeadersFound,
        shipmentHeadersAfterDestinationFilter,
      });
    }
    return { shipments, rows };
  }, [
    reportType,
    fetchNotSelectedRows,
    fetchExportBaseData,
    selectedScopeKey,
    selectedFromFarmCode,
    selectedFromFlock,
    effectiveDateFrom,
    effectiveDateTo,
    toFarmId,
  ]);


  const handleSaveDeliveryDate = useCallback(
    async (shipment) => {
      const shipmentId = clean(shipment?.id);
      const shipmentNo = clean(shipment?.shipment_no) || shipmentId;
      const selectedDate = clean(shipment?.selected_date);
      const targetToFarmId = clean(shipment?.to_farm_id);
      const draftValue = clean(deliveryDateDrafts[shipmentId]);

      if (!shipmentId) {
        setMsg("ไม่พบ shipment ที่ต้องการบันทึกวันที่จัดส่ง");
        return;
      }

      if (!targetToFarmId) {
        setMsg("กรุณาเลือกหรือบันทึกฟาร์มปลายทางก่อน แล้วจึงเพิ่มวันที่จัดส่ง");
        return;
      }

      if (!draftValue) {
        setMsg("กรุณาเลือกวันที่จัดส่งก่อนบันทึก");
        return;
      }

      if (selectedDate && draftValue < selectedDate) {
        setMsg(`วันที่จัดส่งของ ${shipmentNo} ต้องไม่น้อยกว่าวันที่คัด (${selectedDate})`);
        return;
      }

      setSavingDeliveryDateMap((prev) => ({
        ...(prev || {}),
        [shipmentId]: true,
      }));
      setMsg("");

      try {
        const { error } = await supabase
          .from("swine_shipments")
          .update({ delivery_date: draftValue })
          .eq("id", shipmentId);

        if (error) throw error;

        await refreshPreviewRows();
        setMsg(`บันทึกวันที่จัดส่งของ ${shipmentNo} เรียบร้อยแล้ว`);
      } catch (e) {
        console.error("handleSaveDeliveryDate error:", e);
        setMsg(e?.message || "บันทึกวันที่จัดส่งไม่สำเร็จ");
      } finally {
        setSavingDeliveryDateMap((prev) => ({
          ...(prev || {}),
          [shipmentId]: false,
        }));
      }
    },
    [deliveryDateDrafts, refreshPreviewRows]
  );

  const handlePreview = useCallback(async () => {
    if (!canPreviewExport) return;

    setPreviewLoading(true);
    setMsg("");
    setPreviewRows([]);
    setPreviewShipments([]);
    setPreviewMeta(createEmptyPreviewMeta());
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});

    try {
      const { rows } = await refreshPreviewRows();

      if (!rows.length) {
        setMsg(
          reportType === "not_selected"
            ? "ไม่พบเบอร์หมูที่ไม่ถูกคัดตามเงื่อนไขที่เลือก"
            : "ไม่พบข้อมูลตามเงื่อนไขที่เลือก"
        );
      }
    } catch (e) {
      console.error("handlePreview error:", e);
      setPreviewRows([]);
      setPreviewShipments([]);
      setPreviewMeta(createEmptyPreviewMeta());
      setMsg(e?.message || "โหลดตัวอย่างข้อมูลไม่สำเร็จ");
    } finally {
      setPreviewLoading(false);
    }
  }, [canPreviewExport, reportType, refreshPreviewRows]);

  const exportCurrentRows = useCallback(
    async (kind) => {
      if (!canPreviewExport) return;

      setExporting(true);
      setActiveExportKind(kind);
      setMsg("");

      try {
        if (!previewMeta.hasPreviewed) {
          setMsg("กรุณากดแสดงข้อมูลก่อน แล้วจึง Export");
          return;
        }

        if (previewMeta.reportType !== reportType) {
          setMsg("เงื่อนไขเปลี่ยนแล้ว กรุณากดแสดงข้อมูลใหม่ก่อน Export");
          return;
        }

        if (!previewRows.length) {
          setMsg("ไม่พบข้อมูลสำหรับ export");
          return;
        }

        const previewShowDeliveryDate =
          previewMeta.reportType === "raw" && Boolean(previewMeta.toFarmId);

        const fromFarmText = clean(previewMeta.fromFarmCode) || "all";
        const fromFlockText = clean(previewMeta.fromFlock) || "allflock";
        const toFarmText =
          toFarmOptions.find((x) => x.value === previewMeta.toFarmId)?.farm_code ||
          clean(previewMeta.toFarmId) ||
          "all";
        const dateText = makeExportDateText(previewMeta.dateFrom, previewMeta.dateTo);

        if (reportType === "not_selected") {
          if (kind !== "csv") {
            setMsg("รายงาน Not Selected รองรับเฉพาะ Export CSV");
            return;
          }

          const exportRows = previewRows.map((r) => ({
            ฟาร์ม: r.farm_name,
            รหัสฟาร์ม: r.farm_code,
            เล้า: r.house_no,
            flock: r.flock,
            เบอร์หมู: r.swine_code,
            วันเกิด: r.birth_date,
            birth_lot: r.birth_lot,
            heat: r.is_heat,
            total_heat_count: r.total_heat_count,
            heat_1_date: r.heat_1_date,
            heat_2_date: r.heat_2_date,
            heat_3_date: r.heat_3_date,
            heat_4_date: r.heat_4_date,
          }));

          const filename = `swine_not_selected_${dateText}_${fromFarmText}_${fromFlockText}.csv`;
          downloadCsv(filename, exportRows);
          setMsg(`Export CSV สำเร็จ ${exportRows.length} รายการ`);
          return;
        }

        const baseName = `swine_report_${dateText}_${fromFarmText}_${fromFlockText}_${toFarmText}`;

        if (kind === "csv") {
          const csvRows = buildRawCsvRows(previewRows, {
            showDeliveryDate: previewShowDeliveryDate,
          });
          downloadCsv(`${baseName}.csv`, csvRows);
          setMsg(`Export CSV สำเร็จ ${previewRows.length} รายการ`);
          return;
        }

        if (kind === "excel") {
          exportExcelReport({
            flatRows: previewRows,
            filename: `${baseName}.xlsx`,
            title: "Swine Report",
            showDeliveryDate: previewShowDeliveryDate,
            summaryMeta: previewMeta,
          });
          setMsg(`Export Excel สำเร็จ ${previewRows.length} รายการ`);
          return;
        }

        if (kind === "pdf") {
          exportPdfReport({
            flatRows: previewRows,
            filename: `${baseName}.pdf`,
            title: "Swine Report",
            dateText,
            fromFarmText,
            fromFlockText,
            toFarmText,
            showDeliveryDate: previewShowDeliveryDate,
            summaryMeta: previewMeta,
          });
          setMsg(`Export PDF สำเร็จ ${previewRows.length} รายการ`);
          return;
        }

        setMsg("ไม่รู้จักประเภท export");
      } catch (e) {
        console.error("exportCurrentRows error:", e);
        setMsg(e?.message || `Export ${kind?.toUpperCase?.() || ""} ไม่สำเร็จ`);
      } finally {
        setExporting(false);
        setActiveExportKind("");
      }
    },
    [canPreviewExport, previewMeta, previewRows, reportType, toFarmOptions]
  );

  const handleExportCsv = useCallback(async () => {
    await exportCurrentRows("csv");
  }, [exportCurrentRows]);

  const handleExportExcel = useCallback(async () => {
    await exportCurrentRows("excel");
  }, [exportCurrentRows]);

  const handleExportPdf = useCallback(async () => {
    await exportCurrentRows("pdf");
  }, [exportCurrentRows]);

  const handleSubmitConfirm = useCallback(async () => {
    if (!canSubmitRows) return;

    const ok = window.confirm(
      "ยืนยัน Submit ใช่หรือไม่\nระบบจะเปลี่ยนเฉพาะ shipment ที่เป็น submitted ให้เป็น issued"
    );
    if (!ok) return;

    setSubmitting(true);
    setMsg("");

    try {
      const { shipments } = await fetchExportBaseData();
      const submittedShipments = (shipments || []).filter(
        (x) => String(x?.status || "").toLowerCase() === "submitted"
      );

      if (!submittedShipments.length) {
        setMsg("ไม่พบ shipment สถานะ submitted สำหรับยืนยัน");
        return;
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;
      if (!user?.id) throw new Error("ไม่พบผู้ใช้งาน กรุณา login ใหม่");

      const nowIso = new Date().toISOString();
      let totalSwines = 0;

      for (const shipment of submittedShipments) {
        const codes = (shipment.items || [])
          .map((x) => clean(x?.swine_code))
          .filter(Boolean);

        totalSwines += codes.length;

        const { error: e2 } = await supabase
          .from("swine_shipments")
          .update({
            status: "issued",
            issued_at: nowIso,
            issued_by: user.id,
          })
          .eq("id", shipment.id)
          .eq("status", "submitted");

        if (e2) throw e2;
      }

      await refreshPreviewRows();
      await loadFromFarmOptions();
      await loadToFarmOptions();

      setMsg(
        `Submit สำเร็จ ${submittedShipments.length} shipment (${totalSwines} ตัว) และอัปเดตเฉพาะสถานะ shipment เป็น issued แล้ว`
      );
    } catch (e) {
      console.error("handleSubmitConfirm error:", e);
      setMsg(e?.message || "Submit ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmitRows,
    fetchExportBaseData,
    loadFromFarmOptions,
    loadToFarmOptions,
    refreshPreviewRows,
  ]);


  function handleDateFromChange(e) {
    const value = e.target.value;
    setDateFrom(value);
    resetSelectionsAfterDateChange();
  }

  function handleDateToChange(e) {
    const value = e.target.value;
    setDateTo(value);
    resetSelectionsAfterDateChange();
  }

  function handleFromFarmChange(e) {
    toFarmReqRef.current += 1;
    const value = e.target.value;
    setSelectedScopeKey(value);
    setToFarmId("");
    setToFarmQ("");
    setToFarmOptions([]);
    resetPreviewState();
  }

  function handleToFarmChange(e) {
    const value = e.target.value;
    setToFarmId(value);
    resetPreviewState();
  }

  const filteredFromFarmOptions = useMemo(() => {
    const q = clean(fromFarmQ).toLowerCase();
    if (!q) return fromFarmOptions;

    return fromFarmOptions.filter((opt) => {
      const text =
        `${opt.farm_code || ""} ${opt.farm_name || ""} ${opt.flock || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [fromFarmOptions, fromFarmQ]);

  const filteredToFarmOptions = useMemo(() => {
    const q = clean(toFarmQ).toLowerCase();
    if (!q) return toFarmOptions;

    return toFarmOptions.filter((opt) => {
      const text =
        `${opt.farm_code || ""} ${opt.farm_name || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [toFarmOptions, toFarmQ]);

  const previewTop100 = useMemo(() => previewRows.slice(0, 100), [previewRows]);

  const previewStatusCounts = useMemo(() => {
    if (reportType !== "raw") {
      return emptyShipmentStatusCounts();
    }

    return summarizeShipmentStatuses(previewShipments);
  }, [previewShipments, reportType]);

  const dateSummaryText = useMemo(() => {
    if (!effectiveDateFrom || !effectiveDateTo) return "-";
    if (effectiveDateFrom === effectiveDateTo) return effectiveDateFrom;
    return `${effectiveDateFrom} ถึง ${effectiveDateTo}`;
  }, [effectiveDateFrom, effectiveDateTo]);

  if (pageLoading) {
    return (
      <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
        <div style={{ ...shellStyle, padding: isMobile ? "0 2px" : 0 }}>
          <div style={cardStyle}>กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
        <div style={{ ...shellStyle, padding: isMobile ? "0 2px" : 0 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#dc2626" }}>
              ไม่มีสิทธิ์เข้าใช้งาน
            </div>
            <button
              type="button"
              onClick={() => nav(-1)}
              style={{
                ...btnDarkStyle,
                marginTop: 14,
                width: isMobile ? "100%" : "auto",
              }}
            >
              กลับ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
      <div
        style={{
          ...shellStyle,
          padding: isMobile ? "0 2px" : 0,
        }}
      >
        <div style={topCardStyle}>
          <div
            style={{
              ...topHeadStyle,
              padding: isMobile ? 16 : 20,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-between",
                alignItems: isMobile ? "stretch" : "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 17 : 18, fontWeight: 900 }}>
                  Export Report
                </div>
                <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
                  Role: <b>{myRole || "-"}</b>
                  {isAdmin
                    ? " — export ได้ทุกข้อมูล แต่ต้องเลือกฟาร์ม+flock ก่อน"
                    : " — export ได้เฉพาะฟาร์ม+flock ที่เคยคัด"}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                  ประเภทรายงาน:{" "}
                  <b>{reportType === "not_selected" ? "เบอร์หมูที่ไม่ถูกคัด" : "เบอร์หมูที่ถูกคัด"}</b>
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                  ช่วงวันที่: <b>{dateSummaryText}</b>
                </div>
                {!isAdmin ? (
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                    Scope farm+flock: <b>{myScope.length}</b> คู่
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => nav(-1)}
                style={{
                  ...btnBaseStyle,
                  width: isMobile ? "100%" : "auto",
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.35)",
                }}
              >
                กลับ
              </button>
            </div>
          </div>

          {reportType === "raw" ? (
            <div
              style={{
                padding: isMobile ? "12px 14px 14px" : "14px 18px 18px",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#92400e",
                }}
              >
                draft: {previewStatusCounts.draft}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "1px solid #a7f3d0",
                  background: "#ecfdf5",
                  color: "#047857",
                }}
              >
                submitted: {previewStatusCounts.submitted}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#334155",
                }}
              >
                issued: {previewStatusCounts.issued}
              </span>
            </div>
          ) : null}
        </div>

        <div
          style={{
            ...cardStyle,
            padding: isMobile ? 14 : 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                ประเภทรายงาน
              </div>
              <select
                value={reportType}
                onChange={(e) => {
                  setReportType(e.target.value);
                  setToFarmId("");
                  setToFarmQ("");
                  setToFarmOptions([]);
                  resetPreviewState();
                }}
                style={inputStyle}
              >
                <option value="raw">เบอร์หมูที่ถูกคัด</option>
                <option value="not_selected">เบอร์หมูที่ไม่ถูกคัด</option>
              </select>
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                วันที่เริ่ม
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={handleDateFromChange}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                วันที่สิ้นสุด
              </div>
              <input
                type="date"
                value={dateTo}
                onChange={handleDateToChange}
                style={inputStyle}
              />
              {!dateRangeValid ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>
                  วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม
                </div>
              ) : null}
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                ฟาร์มที่คัด + Flock
              </div>

              <input
                type="text"
                value={fromFarmQ}
                onChange={(e) => setFromFarmQ(e.target.value)}
                placeholder={fromFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name / flock"}
                disabled={fromFarmLoading}
                style={
                  fromFarmLoading
                    ? { ...disabledInputStyle, marginBottom: 8 }
                    : { ...inputStyle, marginBottom: 8 }
                }
              />

              <select
                value={selectedScopeKey}
                onChange={handleFromFarmChange}
                disabled={fromFarmLoading}
                style={fromFarmLoading ? disabledInputStyle : inputStyle}
              >
                <option value="">
                  {fromFarmLoading
                    ? "กำลังโหลด..."
                    : filteredFromFarmOptions.length
                    ? "เลือกฟาร์ม+flock"
                    : "ไม่พบฟาร์ม+flock"}
                </option>
                {filteredFromFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                ทั้งหมด {fromFarmOptions.length} รายการ / ตรงคำค้น {filteredFromFarmOptions.length} รายการ
              </div>
            </label>

            {reportType === "raw" ? (
              <label style={{ display: "block", minWidth: 0 }}>
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#334155",
                  }}
                >
                  ฟาร์มปลายทาง {isAdmin ? "(ไม่บังคับ)" : ""}
                </div>

                <input
                  type="text"
                  value={toFarmQ}
                  onChange={(e) => setToFarmQ(e.target.value)}
                  placeholder={toFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name"}
                  disabled={!selectedScopeKey || toFarmLoading}
                  style={
                    !selectedScopeKey || toFarmLoading
                      ? { ...disabledInputStyle, marginBottom: 8 }
                      : { ...inputStyle, marginBottom: 8 }
                  }
                />

                <select
                  value={toFarmId}
                  onChange={handleToFarmChange}
                  disabled={!selectedScopeKey || toFarmLoading}
                  style={!selectedScopeKey || toFarmLoading ? disabledInputStyle : inputStyle}
                >
                  <option value="">
                    {toFarmLoading
                      ? "กำลังโหลด..."
                      : "ทุกปลายทาง"}
                  </option>
                  {filteredToFarmOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div
                style={{
                  display: "block",
                  minWidth: 0,
                  paddingTop: 28,
                  color: "#64748b",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                รายงานนี้ใช้ฟาร์ม+flock และวันที่สิ้นสุด
                <br />
                เพื่อตรวจว่าเบอร์หมูใดบ้างยังไม่อยู่ใน shipment สถานะ draft/submitted/issued ณ วันสิ้นสุดที่เลือก
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handlePreview}
              disabled={!canPreviewExport || previewLoading || exporting || submitting}
              style={{
                ...btnLightStyle,
                width: isMobile ? "100%" : "auto",
                flex: isMobile ? "1 1 100%" : "1 1 160px",
                opacity: !canPreviewExport || previewLoading || exporting || submitting ? 0.6 : 1,
                cursor:
                  !canPreviewExport || previewLoading || exporting || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {previewLoading ? "กำลังโหลด..." : "แสดงข้อมูล"}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!canPreviewExport || exporting || previewLoading || submitting}
              style={{
                ...btnGreenStyle,
                width: isMobile ? "100%" : "auto",
                flex: isMobile ? "1 1 100%" : "1 1 150px",
                opacity: !canPreviewExport || exporting || previewLoading || submitting ? 0.6 : 1,
                cursor:
                  !canPreviewExport || exporting || previewLoading || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {exporting && activeExportKind === "csv" ? "กำลัง Export CSV..." : "Export CSV"}
            </button>

            {reportType === "raw" ? (
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={!canPreviewExport || exporting || previewLoading || submitting}
                style={{
                  ...btnGreenStyle,
                  width: isMobile ? "100%" : "auto",
                  flex: isMobile ? "1 1 100%" : "1 1 150px",
                  opacity: !canPreviewExport || exporting || previewLoading || submitting ? 0.6 : 1,
                  cursor:
                    !canPreviewExport || exporting || previewLoading || submitting
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {exporting && activeExportKind === "excel" ? "กำลัง Export Excel..." : "Export Excel"}
              </button>
            ) : null}

            {reportType === "raw" ? (
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={!canPreviewExport || exporting || previewLoading || submitting}
                style={{
                  ...btnGreenStyle,
                  width: isMobile ? "100%" : "auto",
                  flex: isMobile ? "1 1 100%" : "1 1 150px",
                  opacity: !canPreviewExport || exporting || previewLoading || submitting ? 0.6 : 1,
                  cursor:
                    !canPreviewExport || exporting || previewLoading || submitting
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {exporting && activeExportKind === "pdf" ? "กำลัง Export PDF..." : "Export PDF"}
              </button>
            ) : null}

            {reportType === "raw" ? (
              <button
                type="button"
                onClick={handleSubmitConfirm}
                disabled={!canSubmitRows || submitting || previewLoading || exporting}
                style={{
                  ...btnDarkStyle,
                  width: isMobile ? "100%" : "auto",
                  flex: isMobile ? "1 1 100%" : "1 1 160px",
                  opacity: !canSubmitRows || submitting || previewLoading || exporting ? 0.6 : 1,
                  cursor:
                    !canSubmitRows || submitting || previewLoading || exporting
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {submitting ? "กำลัง Submit..." : "Submit"}
              </button>
            ) : null}
          </div>

          {reportType === "raw" ? (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 800,
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                }}
              >
                {activeDestinationBadgeText}
              </span>
            </div>
          ) : null}

          {!isAdmin ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              User ดูข้อมูลได้ตามฟาร์ม+flock ที่เคยคัด และเลือกช่วงวันที่เพื่อตรวจสอบย้อนหลังได้
              <br />
              แต่ Submit ใช้ได้เฉพาะเมื่อเลือกวันเดียวกัน และเลือกทั้งฟาร์มต้นทาง+flock กับฟาร์มปลายทาง
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              Admin ดูข้อมูลได้ทั้งหมด แต่ต้องเลือกฟาร์ม+flock ก่อน
              <br />
              และ Submit จะอัปเดตเฉพาะ shipment จาก submitted เป็น issued เมื่อเลือกวันเดียวกัน และเลือกทั้งฟาร์มต้นทาง+flock กับฟาร์มปลายทาง
            </div>
          )}

          {reportType === "raw" && !toFarmId ? (
            <div
              style={{
                marginTop: 14,
                borderRadius: 14,
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.6,
                border: "1px solid #fde68a",
                background: "#fffbeb",
                color: "#92400e",
              }}
            >
              วันที่จัดส่งจะแสดงใน Preview และใน CSV ได้เมื่อเลือกฟาร์มปลายทางแล้วเท่านั้น ถ้ายังไม่บันทึกวันจัดส่ง จะแสดงเป็น -
            </div>
          ) : null}

          {msg ? <div style={{ ...msgStyle, marginTop: 14 }}>{msg}</div> : null}
        </div>

        {previewMeta.hasPreviewed ? (
          <div
            style={{
              ...cardStyle,
              padding: isMobile ? 14 : 18,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
              สรุปตามเงื่อนไขที่แสดง
            </div>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 14,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 12, color: "#64748b" }}>Scope</div>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, lineHeight: 1.5 }}>
                  {previewScopeText}
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 14,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 12, color: "#64748b" }}>จำนวนหมูทั้งหมดใน swines</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                  {previewMeta.baseSwinesCount}
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 14,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {reportType === "not_selected" ? "จำนวนหมูคัดสะสมถึงวันสิ้นสุด" : "จำนวนหมูที่ถูกคัดในช่วงที่เลือก"}
                </div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                  {previewMeta.selectedUniqueCount}
                </div>
              </div>

              {reportType === "raw" ? (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 16,
                    padding: 14,
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    จำนวนหมูคัดสะสมถึงวันสิ้นสุด
                  </div>
                  <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                    {previewMeta.cumulativeSelectedCount}
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 14,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {reportType === "not_selected" ? "จำนวนหมูที่ไม่ถูกคัด" : "จำนวนหมูคงเหลือ"}
                </div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                  {previewMeta.remainingCount}
                </div>
              </div>
            </div>

            {reportType === "raw" ? (
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 14,
                  padding: "10px 12px",
                  border: "1px dashed #cbd5e1",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 12,
                  lineHeight: 1.7,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  wordBreak: "break-word",
                }}
              >
                shipment headers found = {previewMeta.shipmentHeadersFound}
                {" | "}
                after destination filter = {previewMeta.shipmentHeadersAfterDestinationFilter}
                {" | "}
                destination = {previewDestinationText || "ทุกปลายทาง"}
                {!clean(previewMeta?.toFarmId) && previewMeta.shipmentHeadersFound === 0
                  ? " | 0 มาจากช่วงวันที่"
                  : ""}
              </div>
            ) : null}
          </div>
        ) : null}

        {reportType === "raw" && toFarmId ? (
          <div
            style={{
              ...cardStyle,
              padding: isMobile ? 14 : 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isMobile ? "stretch" : "center",
                flexDirection: isMobile ? "column" : "row",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                  เพิ่มวันที่จัดส่ง
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                  เลือกฟาร์มปลายทางแล้ว จึงเพิ่มวันที่จัดส่งราย shipment ได้จากหน้านี้
                  {missingDeliveryDateCount > 0
                    ? ` · ยังไม่มีวันที่จัดส่ง ${missingDeliveryDateCount} shipment`
                    : " · ทุก shipment มีวันที่จัดส่งแล้ว"}
                </div>
              </div>
            </div>

            {!deliveryDateShipments.length ? (
              <div
                style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                ยังไม่มี shipment ตามเงื่อนไขที่เลือกสำหรับเพิ่มวันที่จัดส่ง กรุณากด “แสดงข้อมูล” ก่อน
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>เลข shipment</th>
                      <th style={thStyle}>สถานะ</th>
                      <th style={thStyle}>วันที่คัด</th>
                      <th style={thStyle}>ฟาร์มปลายทาง</th>
                      <th style={thStyle}>จำนวนตัว</th>
                      <th style={thStyle}>วันที่จัดส่งปัจจุบัน</th>
                      <th style={thStyle}>เพิ่ม/แก้วันที่จัดส่ง</th>
                      <th style={thStyle}>บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryDateShipments.map((shipment) => {
                      const shipmentId = clean(shipment?.id);
                      const currentDeliveryDate = clean(shipment?.delivery_date);
                      const draftValue = deliveryDateDrafts[shipmentId] ?? currentDeliveryDate;
                      const saving = Boolean(savingDeliveryDateMap[shipmentId]);
                      const selectedDate = clean(shipment?.selected_date);
                      const itemCount = Array.isArray(shipment?.items) ? shipment.items.length : 0;
                      const invalidDate = Boolean(
                        draftValue && selectedDate && draftValue < selectedDate
                      );
                      const unchanged = clean(draftValue) === currentDeliveryDate;
                      const canSaveRow = Boolean(
                        shipmentId &&
                          clean(shipment?.to_farm_id) &&
                          draftValue &&
                          !invalidDate &&
                          !unchanged &&
                          !saving
                      );

                      return (
                        <tr key={shipmentId}>
                          <td style={tdStyle}>{shipment.shipment_no || shipmentId}</td>
                          <td style={tdStyle}>
                            <span style={statusBadgeStyle(shipment.status)}>
                              {formatStatus(shipment.status)}
                            </span>
                          </td>
                          <td style={tdStyle}>{shipment.selected_date || "-"}</td>
                          <td style={tdStyle}>{shipment.to_farm?.farm_name || "-"}</td>
                          <td style={tdStyle}>{itemCount}</td>
                          <td style={tdStyle}>{currentDeliveryDate || "-"}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "grid", gap: 6 }}>
                              <input
                                type="date"
                                value={draftValue || ""}
                                min={selectedDate || undefined}
                                onChange={(e) =>
                                  handleDeliveryDateDraftChange(shipmentId, e.target.value)
                                }
                                style={inputStyle}
                              />
                              {invalidDate ? (
                                <div style={{ fontSize: 12, color: "#dc2626" }}>
                                  วันที่จัดส่งต้องไม่น้อยกว่าวันที่คัด {selectedDate}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => handleSaveDeliveryDate(shipment)}
                              disabled={!canSaveRow}
                              style={{
                                ...btnGreenStyle,
                                minHeight: 38,
                                padding: "8px 12px",
                                opacity: canSaveRow ? 1 : 0.6,
                                cursor: canSaveRow ? "pointer" : "not-allowed",
                              }}
                            >
                              {saving ? "กำลังบันทึก..." : currentDeliveryDate ? "อัปเดต" : "บันทึก"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div
          style={{
            ...cardStyle,
            padding: isMobile ? 14 : 18,
          }}
        >
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: isMobile ? "flex-start" : "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Preview ({previewRows.length} รายการ)
            </div>

            {previewRows.length > 100 ? (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                แสดงตัวอย่าง 100 แถวแรก
              </div>
            ) : null}
          </div>

          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              background: "#fff",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth:
                  reportType === "not_selected"
                    ? isMobile
                      ? 1100
                      : 1300
                    : isMobile
                    ? 2000
                    : 2450,
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                {reportType === "not_selected" ? (
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={thStyle}>ฟาร์ม</th>
                    <th style={thStyle}>รหัสฟาร์ม</th>
                    <th style={thStyle}>เล้า</th>
                    <th style={thStyle}>flock</th>
                    <th style={thStyle}>เบอร์หมู</th>
                    <th style={thStyle}>วันเกิด</th>
                    <th style={thStyle}>birth_lot</th>
                    <th style={thStyle}>heat</th>
                    <th style={thStyle}>total_heat_count</th>
                    <th style={thStyle}>heat_1_date</th>
                    <th style={thStyle}>heat_2_date</th>
                    <th style={thStyle}>heat_3_date</th>
                    <th style={thStyle}>heat_4_date</th>
                  </tr>
                ) : (
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={thStyle}>วันที่คัด</th>
                    {showDeliveryDate ? <th style={thStyle}>วันที่จัดส่ง</th> : null}
                    <th style={thStyle}>ฟาร์มที่คัด</th>
                    <th style={thStyle}>from_flock</th>
                    <th style={thStyle}>ฟาร์มปลายทาง</th>
                    <th style={thStyle}>โรงเรือน</th>
                    <th style={thStyle}>flock</th>
                    <th style={thStyle}>เบอร์หมู</th>
                    <th style={thStyle}>dam_code</th>
                    <th style={thStyle}>sire_code</th>
                    <th style={thStyle}>birth_lot</th>
                    <th style={thStyle}>วันเกิด</th>
                    <th style={thStyle}>อายุ(วัน)</th>
                    <th style={thStyle}>เต้าซ้าย</th>
                    <th style={thStyle}>เต้าขวา</th>
                    <th style={thStyle}>backfat</th>
                    <th style={thStyle}>น้ำหนัก</th>
                    <th style={thStyle}>หมายเหตุ</th>
                    <th style={thStyle}>heat</th>
                    <th style={thStyle}>total_heat_count</th>
                    <th style={thStyle}>heat_1_date</th>
                    <th style={thStyle}>heat_2_date</th>
                    <th style={thStyle}>heat_3_date</th>
                    <th style={thStyle}>heat_4_date</th>
                  </tr>
                )}
              </thead>

              <tbody>
                {previewTop100.length === 0 ? (
                  <tr>
                    <td
                      colSpan={reportType === "not_selected" ? 13 : showDeliveryDate ? 24 : 23}
                      style={emptyTdStyle}
                    >
                      ยังไม่มีข้อมูลแสดง
                    </td>
                  </tr>
                ) : reportType === "not_selected" ? (
                  previewTop100.map((row, idx) => (
                    <tr key={`${row.swine_code}-${idx}`}>
                      <td style={tdStyle}>{row.farm_name}</td>
                      <td style={tdStyle}>{row.farm_code}</td>
                      <td style={tdStyle}>{row.house_no}</td>
                      <td style={tdStyle}>{row.flock}</td>
                      <td style={tdStyle}>{row.swine_code}</td>
                      <td style={tdStyle}>{row.birth_date}</td>
                      <td style={tdStyle}>{row.birth_lot}</td>
                      <td style={tdStyle}>{row.is_heat}</td>
                      <td style={tdStyle}>{row.total_heat_count}</td>
                      <td style={tdStyle}>{row.heat_1_date}</td>
                      <td style={tdStyle}>{row.heat_2_date}</td>
                      <td style={tdStyle}>{row.heat_3_date}</td>
                      <td style={tdStyle}>{row.heat_4_date}</td>
                    </tr>
                  ))
                ) : (
                  previewTop100.map((row, idx) => (
                    <tr key={`${row.swine_code}-${row.created_at}-${idx}`}>
                      <td style={tdStyle}>{row.selected_date}</td>
                      {showDeliveryDate ? <td style={tdStyle}>{row.delivery_date}</td> : null}
                      <td style={tdStyle}>{row.from_farm_name}</td>
                      <td style={tdStyle}>{row.from_flock}</td>
                      <td style={tdStyle}>{row.to_farm_name}</td>
                      <td style={tdStyle}>{row.house_no}</td>
                      <td style={tdStyle}>{row.flock}</td>
                      <td style={tdStyle}>{row.swine_code}</td>
                      <td style={tdStyle}>{row.dam_code}</td>
                      <td style={tdStyle}>{row.sire_code}</td>
                      <td style={tdStyle}>{row.birth_lot}</td>
                      <td style={tdStyle}>{row.birth_date}</td>
                      <td style={tdStyle}>{row.age_days}</td>
                      <td style={tdStyle}>{row.teats_left}</td>
                      <td style={tdStyle}>{row.teats_right}</td>
                      <td style={tdStyle}>{row.backfat}</td>
                      <td style={tdStyle}>{row.weight}</td>
                      <td style={tdStyle}>{row.remark}</td>
                      <td style={tdStyle}>{row.is_heat}</td>
                      <td style={tdStyle}>{row.total_heat_count}</td>
                      <td style={tdStyle}>{row.heat_1_date}</td>
                      <td style={tdStyle}>{row.heat_2_date}</td>
                      <td style={tdStyle}>{row.heat_3_date}</td>
                      <td style={tdStyle}>{row.heat_4_date}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
