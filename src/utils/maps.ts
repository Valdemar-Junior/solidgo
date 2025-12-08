export const formatCep = (cep?: string): string => {
  const digits = String(cep || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length === 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
};

export const buildFullAddress = (a: any): string => {
  const street = String(a?.street || '').trim();
  const number = a?.number ? `, ${String(a.number).trim()}` : '';
  const complement = a?.complement ? ` - ${String(a.complement).trim()}` : '';
  const neighborhood = a?.neighborhood ? ` - ${String(a.neighborhood).trim()}` : '';
  const city = String(a?.city || '').trim();
  const state = a?.state ? ` - ${String(a.state).trim()}` : '';
  const cep = a?.zip ? ` - CEP ${formatCep(a.zip)}` : '';
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
  const addr = buildFullAddress(a);
  if (!addr) return;
  openNavigationByAddress(addr);
};

