const asNumber = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asIntWithLimits = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const firstQueryValue = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
};

const fetchImage = async (url: string, headers?: Record<string, string>) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('image/')) return null;
    const buffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(buffer),
      contentType: response.headers.get('content-type') || 'image/png',
    };
  } finally {
    clearTimeout(timeout);
  }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const lat = asNumber(firstQueryValue(req.query?.lat));
  const lng = asNumber(firstQueryValue(req.query?.lng));
  if (lat === null || lng === null) {
    return res.status(400).json({ ok: false, error: 'Invalid lat/lng' });
  }

  const width = asIntWithLimits(firstQueryValue(req.query?.w), 640, 100, 640);
  const height = asIntWithLimits(firstQueryValue(req.query?.h), 300, 100, 640);
  const zoom = asIntWithLimits(firstQueryValue(req.query?.z), 16, 1, 20);

  const latText = encodeURIComponent(String(lat));
  const lngText = encodeURIComponent(String(lng));
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').trim();
  const referer = host ? `https://${host}/` : undefined;

  const googleKey = String(
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();

  const googleUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${latText},${lngText}&zoom=${zoom}&size=${width}x${height}&markers=color:red%7C${latText},${lngText}&key=${encodeURIComponent(googleKey)}`
    : null;

  const osmUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${latText},${lngText}&zoom=${zoom}&size=${width}x${height}&markers=${latText},${lngText},red-pushpin`;
  const yandexUrl = `https://static-maps.yandex.ru/1.x/?ll=${lngText},${latText}&z=${zoom}&size=${width},${height}&l=map&pt=${lngText},${latText},pm2rdm`;

  const commonHeaders: Record<string, string> = {
    'User-Agent': 'SOLIDGO-StaticMap/1.0',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (referer) commonHeaders.Referer = referer;

  const candidates = googleUrl ? [googleUrl, osmUrl, yandexUrl] : [osmUrl, yandexUrl];

  for (const url of candidates) {
    try {
      const image = await fetchImage(url, commonHeaders);
      if (!image) continue;
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(image.buffer);
    } catch {
      // Try next source.
    }
  }

  return res.status(502).json({ ok: false, error: 'Unable to fetch static map' });
}
