export const formatCep = (cep?: string): string => {
  const digits = String(cep || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length === 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
};

const sanitizeComplement = (raw?: string): string => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const noisy = /(proximo|próximo|perto|vizinh|ao lado|em frente|atrás|posto|ubs|igreja|mercado|bar|praça|esquina)/i;
  if (noisy.test(s)) return '';
  const hasPhoneOrUrl = /(https?:\/\/|www\.|\b\d{9,}\b)/i;
  if (hasPhoneOrUrl.test(s)) return '';
  if (s.length > 40) return '';
  const allowed = /(ap(t|to)?\.?|apartamento|bloco|torre|casa|lote|quadra|sala|conjunto|andar|fundos|frente|térreo|terreo|galpão|galpao|km|quiosque|box)/i;
  return allowed.test(s) ? s : '';
};

export const buildFullAddress = (a: any): string => {
  const street = String(a?.street || '').trim();
  const number = a?.number ? `, ${String(a.number).trim()}` : '';
  const complement = a?.complement ? ` ${String(a.complement).trim()}` : '';
  const neighborhood = a?.neighborhood ? `, ${String(a.neighborhood).trim()}` : '';
  const city = String(a?.city || '').trim();
  const state = a?.state ? ` - ${String(a.state).trim()}` : '';
  const cep = a?.zip ? `, ${formatCep(a.zip)}` : '';
  const base = `${street}${number}${complement}${neighborhood}`.trim();
  const locality = `${city}${state}${cep}`.trim();
  return [base, locality].filter(Boolean).join(', ');
};

export const openNavigationByAddress = (address: string) => {
  const q = encodeURIComponent(address);
  // Preferir Waze via deep link web, que geralmente abre o app no celular
  const wazeUrl = `https://waze.com/ul?q=${q}&navigate=yes`;
  const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Current Location')}&destination=${q}&travelmode=driving`;
  try {
    window.open(wazeUrl, '_blank');
  } catch {
    window.open(googleUrl, '_blank');
  }
};

export const openNavigationByAddressJson = (a: any) => {
  const street = String(a?.street || '').trim();
  const number = a?.number ? `, ${String(a.number).trim()}` : '';
  const complement = sanitizeComplement(a?.complement) ? ` ${sanitizeComplement(a?.complement)}` : '';
  const neighborhood = a?.neighborhood ? `, ${String(a.neighborhood).trim()}` : '';
  const city = String(a?.city || '').trim();
  const state = a?.state ? ` - ${String(a.state).trim()}` : '';
  const cep = a?.zip ? `, ${formatCep(a.zip)}` : '';
  const parts = [`${street}${number}${complement}${neighborhood}`.trim(), `${city}${state}`.trim(), `${cep}`.trim(), 'Brasil'];
  const addr = parts.filter(s => s && s !== ',').join(', ').replace(/\s+,/g, ',');
  if (!addr) return;
  openNavigationByAddress(addr);
};

export const openNavigationSmartAddressJson = async (a: any) => {
  const addr = buildFullAddress(a);
  if (!addr) return;
  try {
    const q = encodeURIComponent(addr);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=${q}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data: any[] = await resp.json();
    const first = Array.isArray(data) ? data[0] : null;
    const lat = first ? Number(first.lat) : NaN;
    const lon = first ? Number(first.lon) : NaN;
    if (!isNaN(lat) && !isNaN(lon)) {
      const wazeUrl = `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
      window.open(wazeUrl, '_blank');
      return;
    }
  } catch {}
  openNavigationByAddress(addr);
};
