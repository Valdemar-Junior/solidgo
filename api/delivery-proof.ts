import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getDeliveryProofFlags } from './_lib/feature-flags';

type AnyRecord = Record<string, any>;

const asString = (value: unknown): string => String(value ?? '').trim();

const asNumber = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asDateIsoOrNull = (value: unknown): string | null => {
  const text = asString(value);
  if (!text) return null;
  const dt = new Date(text);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

const asNetworkMode = (value: unknown): 'online' | 'offline' => {
  return asString(value).toLowerCase() === 'offline' ? 'offline' : 'online';
};

const safeDeviceInfo = (value: unknown): AnyRecord => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as AnyRecord;
  return {};
};

const safePhotoRefs = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  return [];
};

const normalizeBody = (body: AnyRecord) => {
  const gps = (body.gps && typeof body.gps === 'object') ? body.gps : {};

  const orderId = asString(body.orderId || body.order_id);
  const routeId = asString(body.routeId || body.route_id);
  const routeOrderId = asString(body.routeOrderId || body.route_order_id);
  const deliveredByUserId = asString(body.deliveredByUserId || body.delivered_by_user_id);
  const recipientName = asString(body.recipientName || body.recipient_name);
  const recipientRelation = asString(body.recipientRelation || body.recipient_relation);
  const recipientNotes = asString(body.recipientNotes || body.recipient_notes) || null;
  const gpsLat = asNumber(body.gpsLat ?? body.gps_lat ?? gps.lat);
  const gpsLng = asNumber(body.gpsLng ?? body.gps_lng ?? gps.lng ?? gps.lon);
  const gpsAccuracyM = asNumber(body.gpsAccuracyM ?? body.gps_accuracy_m ?? gps.accuracy);
  const gpsFailureReason = asString(body.gpsFailureReason || body.gps_failure_reason || gps.failureReason || gps.failure_reason) || null;
  const gpsStatus = gpsLat !== null && gpsLng !== null ? 'ok' : 'failed';
  const photoRefs = safePhotoRefs(body.photoRefs || body.photo_refs);
  const explicitPhotoCount = asNumber(body.photoCount || body.photo_count);
  const photoCount = explicitPhotoCount !== null ? Math.max(0, Math.floor(explicitPhotoCount)) : photoRefs.length;
  const networkMode = asNetworkMode(body.networkMode || body.network_mode);
  const deviceInfo = safeDeviceInfo(body.deviceInfo || body.device_info);
  const appVersion = asString(body.appVersion || body.app_version) || null;
  const deviceTimestamp = asDateIsoOrNull(body.deviceTimestamp || body.device_timestamp);
  const syncStatus = networkMode === 'offline' ? 'pending_sync' : 'synced';

  return {
    orderId,
    routeId,
    routeOrderId,
    deliveredByUserId,
    recipientName,
    recipientRelation,
    recipientNotes,
    gpsLat,
    gpsLng,
    gpsAccuracyM,
    gpsStatus,
    gpsFailureReason,
    photoCount,
    photoRefs,
    networkMode,
    deviceInfo,
    appVersion,
    deviceTimestamp,
    syncStatus,
  };
};

const buildProofHash = (payload: AnyRecord): string => {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const fail = (res: any, flags: ReturnType<typeof getDeliveryProofFlags>, message: string, statusIfBlocking = 400) => {
  if (flags.blockOnError) {
    return res.status(statusIfBlocking).json({ ok: false, error: message, blocking: true });
  }
  return res.status(200).json({ ok: false, skipped: true, warning: message, blocking: false });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const flags = getDeliveryProofFlags();
  if (!flags.enabled) return res.status(200).json({ ok: true, skipped: true, reason: 'DELIVERY_PROOF_DISABLED' });

  const url = asString(process.env.SUPABASE_URL).replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '');
  const serviceKey = asString(process.env.SUPABASE_SERVICE_KEY).replace(/\s+/g, '');
  if (!url || !serviceKey) {
    return fail(res, flags, 'Server not configured for delivery proof', 500);
  }

  const admin = createClient(url, serviceKey);
  const rawBody = (req.body || {}) as AnyRecord;
  const payload = normalizeBody(rawBody);

  let authenticatedUserId = '';
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const token = String(authHeader).startsWith('Bearer ') ? String(authHeader).slice(7).trim() : '';
    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user?.id) authenticatedUserId = data.user.id;
    }
  } catch {
    // Non-blocking: token verification is best-effort for shadow mode.
  }

  const deliveredByUserId = asString(authenticatedUserId || payload.deliveredByUserId) || null;

  if (!payload.orderId || !payload.routeId || !payload.routeOrderId) {
    return fail(res, flags, 'Missing required identifiers: orderId/routeId/routeOrderId');
  }

  if (flags.requireRecipient) {
    if (!payload.recipientName) return fail(res, flags, 'Recipient name is required');
    if (!payload.recipientRelation) return fail(res, flags, 'Recipient relation is required');
  }

  if (flags.requireGps && payload.gpsStatus === 'failed' && !payload.gpsFailureReason) {
    return fail(res, flags, 'GPS is required or technical reason must be provided');
  }

  const proofHash = asString(rawBody.proofHash || rawBody.proof_hash) || buildProofHash({
    orderId: payload.orderId,
    routeId: payload.routeId,
    routeOrderId: payload.routeOrderId,
    deliveredByUserId,
    recipientName: payload.recipientName,
    recipientRelation: payload.recipientRelation,
    gpsLat: payload.gpsLat,
    gpsLng: payload.gpsLng,
    gpsStatus: payload.gpsStatus,
    photoCount: payload.photoCount,
    deviceTimestamp: payload.deviceTimestamp,
  });

  const row = {
    order_id: payload.orderId,
    route_id: payload.routeId,
    route_order_id: payload.routeOrderId,
    delivered_by_user_id: deliveredByUserId,
    device_timestamp: payload.deviceTimestamp,
    gps_lat: payload.gpsLat,
    gps_lng: payload.gpsLng,
    gps_accuracy_m: payload.gpsAccuracyM,
    gps_status: payload.gpsStatus,
    gps_failure_reason: payload.gpsFailureReason,
    recipient_name: payload.recipientName || null,
    recipient_relation: payload.recipientRelation || null,
    recipient_notes: payload.recipientNotes,
    photo_count: payload.photoCount,
    photo_refs: payload.photoRefs,
    network_mode: payload.networkMode,
    device_info: payload.deviceInfo,
    app_version: payload.appVersion,
    sync_status: payload.syncStatus,
    proof_hash: proofHash,
  };

  const { data, error } = await admin
    .from('delivery_receipts')
    .insert(row)
    .select('id, created_at')
    .single();

  if (error) {
    return fail(res, flags, `Failed to save delivery receipt: ${error.message}`, 500);
  }

  return res.status(200).json({
    ok: true,
    receiptId: data.id,
    createdAt: data.created_at,
    shadowMode: !flags.blockOnError,
  });
}
