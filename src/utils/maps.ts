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

const splitStreetNumber = (raw?: string): { name: string; number: string } => {
  const s = String(raw || '').trim();
  if (!s) return { name: '', number: '' };
  const m = s.match(/^(.*?)(?:\s+(\d{1,6})(?:[^\d]|$))$/);
  if (m) {
    const name = m[1].trim();
    const number = m[2].trim();
    return { name, number };
  }
  return { name: s, number: '' };
};

const normalizeStreet = (street?: string, neighborhood?: string): string => {
  let s = String(street || '').trim();
  const nb = String(neighborhood || '').trim();
  if (nb) {
    const re = new RegExp(nb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    s = s.replace(re, '').replace(/\s{2,}/g, ' ').trim();
  }
  // Remover conectores comuns de bairro/POI que entram na rua
  s = s.replace(/\b(condominio|residencial|loteamento|conjunto|bairro|ubs|posto|pronto\s*socorro|igreja|mercado|praça)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return s;
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

export const buildStrictAddress = (a: any): string => {
  const rawStreet = normalizeStreet(a?.street, a?.neighborhood);
  const split = splitStreetNumber(rawStreet);
  const num = String(a?.number || split.number || '').trim();
  const street = split.name;
  const number = num ? `, ${num}` : '';
  const city = String(a?.city || '').trim();
  const state = a?.state ? ` - ${String(a.state).trim()}` : '';
  const cep = a?.zip ? `, ${formatCep(a.zip)}` : '';
  const base = `${street}${number}`.trim();
  const locality = `${city}${state}${cep}`.trim();
  return [base, locality, 'Brasil'].filter(Boolean).join(', ');
};

export const openNavigationByAddress = (address: string) => {
  const q = encodeURIComponent(address);
  // Tentar deep link do Waze primeiro
  const wazeDeep = `waze://?q=${q}&navigate=yes`;
  const wazeUrl = `https://waze.com/ul?q=${q}&navigate=yes`;
  const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Current Location')}&destination=${q}&travelmode=driving`;
  try {
    // Em mobile, o deep link abre o app diretamente
    window.location.href = wazeDeep;
    // Fallback em caso de ambiente que bloqueia deep link
    setTimeout(() => {
      try { window.open(wazeUrl, '_blank'); } catch { window.open(googleUrl, '_blank'); }
    }, 250);
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
  if (a && typeof a.lat !== 'undefined' && typeof a.lng !== 'undefined') {
    const lat = Number(a.lat);
    const lon = Number(a.lng);
    if (!isNaN(lat) && !isNaN(lon)) {
      const wazeUrl = `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
      window.open(wazeUrl, '_blank');
      return;
    }
  }
  const addr = buildFullAddress(a);
  if (!addr) return;
  try {
    const { name: streetName, number: guessedNumber } = splitStreetNumber(a?.street);
    const streetParam = encodeURIComponent(`${streetName || a?.street || ''} ${guessedNumber || ''}`.trim());
    const cityParam = encodeURIComponent(String(a?.city || ''));
    const stateParam = encodeURIComponent(String(a?.state || ''));
    const zipParam = encodeURIComponent(formatCep(a?.zip || ''));
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&country=Brazil&street=${streetParam}&city=${cityParam}&state=${stateParam}&postalcode=${zipParam}`;
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

export const openNavigationTextLikeUI = (a: any) => {
  const addr = buildStrictAddress(a);
  if (!addr) return;
  openNavigationByAddress(addr);
};
