export interface DeliveryProofFlags {
  enabled: boolean;
  requireRecipient: boolean;
  requireGps: boolean;
  blockOnError: boolean;
}

const asBool = (value: string | undefined, fallback: boolean): boolean => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const getDeliveryProofFlags = (): DeliveryProofFlags => ({
  enabled: asBool(process.env.DELIVERY_PROOF_ENABLED, false),
  requireRecipient: asBool(process.env.DELIVERY_PROOF_REQUIRE_RECIPIENT, false),
  requireGps: asBool(process.env.DELIVERY_PROOF_REQUIRE_GPS, false),
  blockOnError: asBool(process.env.DELIVERY_PROOF_BLOCK_ON_ERROR, false),
});

