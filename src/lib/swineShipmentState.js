import { supabase } from "./supabase.js";

export const ACTIVE_SHIPMENT_STATUSES = ["draft", "submitted", "issued"];

const PAGE_SIZE = 1000;
const CODE_CHUNK_SIZE = 500;
const ID_CHUNK_SIZE = 500;

function clean(v) {
  return String(v ?? "").trim();
}

function chunkArray(arr, size = 1000) {
  const source = Array.isArray(arr) ? arr : [];
  const step = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < source.length; i += step) {
    out.push(source.slice(i, i + step));
  }
  return out;
}

async function fetchAllPages(fetcher, pageSize = PAGE_SIZE) {
  let from = 0;
  const rows = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetcher(from, to);
    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function ensureRows(label, rows, expectedMin = 1) {
  const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
  if (count < expectedMin) {
    throw new Error(`NO_ROWS_AFFECTED: ${label}`);
  }
  return count;
}

function uniqueCodes(codes = []) {
  return Array.from(new Set((codes || []).map(clean).filter(Boolean)));
}

async function readShipmentItemsMap(shipmentIds = []) {
  const ids = Array.from(new Set((shipmentIds || []).map(clean).filter(Boolean)));
  const map = new Map();

  for (const shipmentId of ids) {
    map.set(shipmentId, []);
  }

  for (const idChunk of chunkArray(ids, ID_CHUNK_SIZE)) {
    if (!idChunk.length) continue;

    const itemRows = await fetchAllPages((from, to) =>
      supabase
        .from("swine_shipment_items")
        .select("shipment_id, swine_code")
        .in("shipment_id", idChunk)
        .order("shipment_id", { ascending: true })
        .order("swine_code", { ascending: true })
        .range(from, to)
    );

    for (const row of itemRows || []) {
      const shipmentId = clean(row?.shipment_id);
      const swineCode = clean(row?.swine_code);
      if (!shipmentId || !swineCode) continue;
      if (!map.has(shipmentId)) map.set(shipmentId, []);
      map.get(shipmentId).push(swineCode);
    }
  }

  for (const [shipmentId, codes] of map.entries()) {
    map.set(shipmentId, uniqueCodes(codes));
  }

  return map;
}

async function readShipmentHeadersMap(shipmentIds = []) {
  const ids = Array.from(new Set((shipmentIds || []).map(clean).filter(Boolean)));
  const map = new Map();

  for (const idChunk of chunkArray(ids, ID_CHUNK_SIZE)) {
    if (!idChunk.length) continue;

    const { data, error } = await supabase
      .from("swine_shipments")
      .select(
        "id, status, selected_date, created_at, submitted_at, submitted_by, issued_at, issued_by, cancelled_at, cancelled_by"
      )
      .in("id", idChunk);

    if (error) throw error;

    for (const row of data || []) {
      map.set(clean(row?.id), row);
    }
  }

  return map;
}

async function readMasterRowsMap(swineCodes = []) {
  const codes = uniqueCodes(swineCodes);
  const map = new Map();

  for (const codeChunk of chunkArray(codes, CODE_CHUNK_SIZE)) {
    if (!codeChunk.length) continue;

    const { data, error } = await supabase
      .from("swine_master")
      .select(
        "swine_code, delivery_state, reserved_shipment_id, reserved_at, reserved_by, issued_shipment_id, issued_at, issued_by"
      )
      .in("swine_code", codeChunk);

    if (error) throw error;

    for (const row of data || []) {
      map.set(clean(row?.swine_code), row);
    }
  }

  return map;
}

function makeMasterSnapshotRows(masterRowsMap, swineCodes = []) {
  return uniqueCodes(swineCodes).map((swineCode) => {
    const row = masterRowsMap.get(swineCode);
    if (!row) {
      throw new Error(`MASTER_ROW_NOT_FOUND: ${swineCode}`);
    }
    return {
      swine_code: swineCode,
      delivery_state: clean(row?.delivery_state),
      reserved_shipment_id: row?.reserved_shipment_id || null,
      reserved_at: row?.reserved_at || null,
      reserved_by: row?.reserved_by || null,
      issued_shipment_id: row?.issued_shipment_id || null,
      issued_at: row?.issued_at || null,
      issued_by: row?.issued_by || null,
    };
  });
}

async function restoreMasterSnapshotRows(snapshotRows = []) {
  for (const row of snapshotRows || []) {
    const { data, error } = await supabase
      .from("swine_master")
      .update({
        delivery_state: clean(row?.delivery_state) || "available",
        reserved_shipment_id: row?.reserved_shipment_id || null,
        reserved_at: row?.reserved_at || null,
        reserved_by: row?.reserved_by || null,
        issued_shipment_id: row?.issued_shipment_id || null,
        issued_at: row?.issued_at || null,
        issued_by: row?.issued_by || null,
      })
      .eq("swine_code", clean(row?.swine_code))
      .select("swine_code");

    if (error) throw error;
    ensureRows(`restore swine_master ${clean(row?.swine_code)}`, data);
  }
}

function getStatusPriority(status) {
  const s = clean(status).toLowerCase();
  if (s === "issued") return 3;
  if (s === "submitted") return 2;
  if (s === "draft") return 1;
  return 0;
}

async function readOtherActiveShipmentByCode(swineCodes = [], excludeShipmentId = "") {
  const codes = uniqueCodes(swineCodes);
  const excludeId = clean(excludeShipmentId);
  const candidateMap = new Map();

  for (const codeChunk of chunkArray(codes, CODE_CHUNK_SIZE)) {
    if (!codeChunk.length) continue;

    const itemRows = await fetchAllPages((from, to) =>
      supabase
        .from("swine_shipment_items")
        .select("shipment_id, swine_code")
        .in("swine_code", codeChunk)
        .order("shipment_id", { ascending: true })
        .range(from, to)
    );

    const shipmentIds = Array.from(
      new Set(
        (itemRows || [])
          .map((row) => clean(row?.shipment_id))
          .filter((id) => id && id !== excludeId)
      )
    );

    const shipmentMap = new Map();

    for (const idChunk of chunkArray(shipmentIds, ID_CHUNK_SIZE)) {
      if (!idChunk.length) continue;

      const { data, error } = await supabase
        .from("swine_shipments")
        .select("id, status")
        .in("id", idChunk)
        .in("status", ACTIVE_SHIPMENT_STATUSES);

      if (error) throw error;

      for (const row of data || []) {
        shipmentMap.set(clean(row?.id), row);
      }
    }

    for (const item of itemRows || []) {
      const swineCode = clean(item?.swine_code);
      const shipmentId = clean(item?.shipment_id);
      if (!swineCode || !shipmentId || shipmentId === excludeId) continue;

      const shipment = shipmentMap.get(shipmentId);
      if (!shipment) continue;

      const current = candidateMap.get(swineCode);
      if (!current || getStatusPriority(shipment.status) > getStatusPriority(current.status)) {
        candidateMap.set(swineCode, shipment);
      }
    }
  }

  return candidateMap;
}

async function reassertReservedMasterState({ shipmentId, swineCodes, actorUserId, nowIso }) {
  const codes = uniqueCodes(swineCodes);
  if (!codes.length) {
    return { totalSwines: 0, masterSnapshotRows: [] };
  }

  const masterRowsMap = await readMasterRowsMap(codes);
  const snapshotRows = makeMasterSnapshotRows(masterRowsMap, codes);

  for (const swineCode of codes) {
    const row = masterRowsMap.get(swineCode);
    const deliveryState = clean(row?.delivery_state).toLowerCase();
    const reservedShipmentId = clean(row?.reserved_shipment_id);
    const issuedShipmentId = clean(row?.issued_shipment_id);

    const alreadyReservedHere = reservedShipmentId === clean(shipmentId) && deliveryState === "reserved";
    const canReserveFresh = deliveryState === "available" && !issuedShipmentId;

    if (!alreadyReservedHere && !canReserveFresh) {
      throw new Error(`MASTER_STATE_BLOCKED_FOR_SUBMIT: ${swineCode}`);
    }

    const { data, error } = await supabase
      .from("swine_master")
      .update({
        delivery_state: "reserved",
        reserved_shipment_id: clean(shipmentId),
        reserved_at: nowIso,
        reserved_by: actorUserId || null,
        issued_shipment_id: null,
        issued_at: null,
        issued_by: null,
      })
      .eq("swine_code", swineCode)
      .select("swine_code");

    if (error) throw error;
    ensureRows(`reserve swine_master ${swineCode}`, data);
  }

  return { totalSwines: codes.length, masterSnapshotRows: snapshotRows };
}

async function markMasterAsIssued({ shipmentId, swineCodes, actorUserId, nowIso }) {
  const codes = uniqueCodes(swineCodes);
  if (!codes.length) {
    return { totalSwines: 0, masterSnapshotRows: [] };
  }

  const masterRowsMap = await readMasterRowsMap(codes);
  const snapshotRows = makeMasterSnapshotRows(masterRowsMap, codes);

  for (const swineCode of codes) {
    const row = masterRowsMap.get(swineCode);
    const deliveryState = clean(row?.delivery_state).toLowerCase();
    const reservedShipmentId = clean(row?.reserved_shipment_id);
    const issuedShipmentId = clean(row?.issued_shipment_id);

    const allowed =
      (deliveryState === "reserved" && reservedShipmentId === clean(shipmentId)) ||
      (deliveryState === "issued" && issuedShipmentId === clean(shipmentId));

    if (!allowed) {
      throw new Error(`MASTER_STATE_BLOCKED_FOR_ISSUE: ${swineCode}`);
    }

    const { data, error } = await supabase
      .from("swine_master")
      .update({
        delivery_state: "issued",
        reserved_shipment_id: null,
        reserved_at: null,
        reserved_by: null,
        issued_shipment_id: clean(shipmentId),
        issued_at: row?.issued_at || nowIso,
        issued_by: row?.issued_by || actorUserId || null,
      })
      .eq("swine_code", swineCode)
      .select("swine_code");

    if (error) throw error;
    ensureRows(`issue swine_master ${swineCode}`, data);
  }

  return { totalSwines: codes.length, masterSnapshotRows: snapshotRows };
}

async function reconcileMasterAfterCancel({ shipmentId, swineCodes, actorUserId, nowIso }) {
  const codes = uniqueCodes(swineCodes);
  const masterRowsMap = await readMasterRowsMap(codes);
  const snapshotRows = makeMasterSnapshotRows(masterRowsMap, codes);
  const fallbackMap = await readOtherActiveShipmentByCode(codes, shipmentId);

  for (const swineCode of codes) {
    const fallbackShipment = fallbackMap.get(swineCode);
    let payload;

    if (!fallbackShipment) {
      payload = {
        delivery_state: "available",
        reserved_shipment_id: null,
        reserved_at: null,
        reserved_by: null,
        issued_shipment_id: null,
        issued_at: null,
        issued_by: null,
      };
    } else if (clean(fallbackShipment?.status).toLowerCase() === "issued") {
      const current = masterRowsMap.get(swineCode);
      payload = {
        delivery_state: "issued",
        reserved_shipment_id: null,
        reserved_at: null,
        reserved_by: null,
        issued_shipment_id: clean(fallbackShipment?.id),
        issued_at:
          clean(current?.issued_shipment_id) === clean(fallbackShipment?.id)
            ? current?.issued_at || nowIso
            : nowIso,
        issued_by:
          clean(current?.issued_shipment_id) === clean(fallbackShipment?.id)
            ? current?.issued_by || actorUserId || null
            : actorUserId || null,
      };
    } else {
      payload = {
        delivery_state: "reserved",
        reserved_shipment_id: clean(fallbackShipment?.id),
        reserved_at: nowIso,
        reserved_by: actorUserId || null,
        issued_shipment_id: null,
        issued_at: null,
        issued_by: null,
      };
    }

    const { data, error } = await supabase
      .from("swine_master")
      .update(payload)
      .eq("swine_code", swineCode)
      .select("swine_code");

    if (error) throw error;
    ensureRows(`reconcile swine_master ${swineCode}`, data);
  }

  return { totalSwines: codes.length, masterSnapshotRows: snapshotRows };
}

export async function submitDraftShipments({ shipments = [], actorUserId, nowIso = new Date().toISOString() }) {
  const shipmentList = (shipments || []).filter(
    (shipment) => clean(shipment?.status).toLowerCase() === "draft"
  );

  const itemMap = await readShipmentItemsMap(shipmentList.map((shipment) => shipment.id));
  let totalSwines = 0;

  for (const shipment of shipmentList) {
    const shipmentId = clean(shipment?.id);
    const swineCodes = itemMap.get(shipmentId) || uniqueCodes(shipment?.items?.map((x) => x?.swine_code));

    if (!shipmentId) throw new Error("SUBMIT_SHIPMENT_ID_REQUIRED");
    if (!swineCodes.length) throw new Error(`SHIPMENT_HAS_NO_ITEMS: ${shipmentId}`);

    const { masterSnapshotRows } = await reassertReservedMasterState({
      shipmentId,
      swineCodes,
      actorUserId,
      nowIso,
    });

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .update({
          status: "submitted",
          submitted_at: nowIso,
          submitted_by: actorUserId || null,
          updated_at: nowIso,
        })
        .eq("id", shipmentId)
        .eq("status", "draft")
        .select("id");

      if (error) throw error;
      ensureRows(`submit shipment ${shipmentId}`, data);
      totalSwines += swineCodes.length;
    } catch (error) {
      await restoreMasterSnapshotRows(masterSnapshotRows);
      throw error;
    }
  }

  return {
    shipmentCount: shipmentList.length,
    totalSwines,
  };
}

export async function issueSubmittedShipments({ shipments = [], actorUserId, nowIso = new Date().toISOString() }) {
  const shipmentList = (shipments || []).filter(
    (shipment) => clean(shipment?.status).toLowerCase() === "submitted"
  );

  const itemMap = await readShipmentItemsMap(shipmentList.map((shipment) => shipment.id));
  let totalSwines = 0;

  for (const shipment of shipmentList) {
    const shipmentId = clean(shipment?.id);
    const swineCodes = itemMap.get(shipmentId) || uniqueCodes(shipment?.items?.map((x) => x?.swine_code));

    if (!shipmentId) throw new Error("ISSUE_SHIPMENT_ID_REQUIRED");
    if (!swineCodes.length) throw new Error(`SHIPMENT_HAS_NO_ITEMS: ${shipmentId}`);

    const { masterSnapshotRows } = await markMasterAsIssued({
      shipmentId,
      swineCodes,
      actorUserId,
      nowIso,
    });

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .update({
          status: "issued",
          issued_at: nowIso,
          issued_by: actorUserId || null,
          updated_at: nowIso,
        })
        .eq("id", shipmentId)
        .eq("status", "submitted")
        .select("id");

      if (error) throw error;
      ensureRows(`issue shipment ${shipmentId}`, data);
      totalSwines += swineCodes.length;
    } catch (error) {
      await restoreMasterSnapshotRows(masterSnapshotRows);
      throw error;
    }
  }

  return {
    shipmentCount: shipmentList.length,
    totalSwines,
  };
}

export async function cancelShipmentWithSync({
  shipmentId,
  actorUserId,
  nowIso = new Date().toISOString(),
  cancelReason = "",
}) {
  const id = clean(shipmentId);
  if (!id) throw new Error("CANCEL_SHIPMENT_ID_REQUIRED");

  const shipmentMap = await readShipmentHeadersMap([id]);
  const shipment = shipmentMap.get(id);
  if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");

  const currentStatus = clean(shipment?.status).toLowerCase();
  if (currentStatus === "cancelled") {
    return { shipmentCount: 0, totalSwines: 0, status: currentStatus };
  }
  if (!ACTIVE_SHIPMENT_STATUSES.includes(currentStatus)) {
    throw new Error(`CANCEL_STATUS_NOT_ALLOWED: ${currentStatus || "unknown"}`);
  }
  if (currentStatus === "issued") {
    throw new Error("CANCEL_ISSUED_NOT_ALLOWED");
  }

  const itemMap = await readShipmentItemsMap([id]);
  const swineCodes = itemMap.get(id) || [];
  const { masterSnapshotRows } = await reconcileMasterAfterCancel({
    shipmentId: id,
    swineCodes,
    actorUserId,
    nowIso,
  });

  try {
    const { data, error } = await supabase
      .from("swine_shipments")
      .update({
        status: "cancelled",
        cancelled_at: nowIso,
        cancelled_by: actorUserId || null,
        cancel_reason: clean(cancelReason) || null,
        reservation_status: "cancelled",
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("status", currentStatus)
      .select("id");

    if (error) throw error;
    ensureRows(`cancel shipment ${id}`, data);
  } catch (error) {
    await restoreMasterSnapshotRows(masterSnapshotRows);
    throw error;
  }

  return {
    shipmentCount: 1,
    totalSwines: swineCodes.length,
    status: currentStatus,
  };
}
