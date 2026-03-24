import type { FleetInspectionItemStatus, FleetInspectionOverallStatus } from '../types/database';

export interface FleetChecklistDefinition {
  item_code: string;
  category: string;
  label: string;
  sort_order: number;
}

export const FLEET_INSPECTION_CHECKLIST: FleetChecklistDefinition[] = [
  { item_code: 'doc_plate_visible', category: 'Documentação e identificação', label: 'Placa visível e legível', sort_order: 1 },
  { item_code: 'doc_documents', category: 'Documentação e identificação', label: 'Documentação e regularidade', sort_order: 2 },
  { item_code: 'tire_condition', category: 'Pneus e rodas', label: 'Estado dos pneus', sort_order: 3 },
  { item_code: 'tire_spare', category: 'Pneus e rodas', label: 'Estepe e fixação', sort_order: 4 },
  { item_code: 'lights_main', category: 'Iluminação e elétrica', label: 'Faróis e iluminação principal', sort_order: 5 },
  { item_code: 'lights_signals_panel', category: 'Iluminação e elétrica', label: 'Setas, lanternas e alertas de painel', sort_order: 6 },
  { item_code: 'cabin_safety', category: 'Cabine e segurança', label: 'Cinto, kit e extintor', sort_order: 7 },
  { item_code: 'cabin_visibility', category: 'Cabine e segurança', label: 'Retrovisores e limpadores', sort_order: 8 },
  { item_code: 'structure_glass', category: 'Estrutura e carroceria', label: 'Vidros e para-brisa', sort_order: 9 },
  { item_code: 'structure_body_leaks', category: 'Estrutura e carroceria', label: 'Lataria/carroceria e vazamentos aparentes', sort_order: 10 },
  { item_code: 'mechanics_fluids', category: 'Mecânica básica', label: 'Óleo e arrefecimento', sort_order: 11 },
  { item_code: 'mechanics_brakes_suspension', category: 'Mecânica básica', label: 'Freios e suspensão', sort_order: 12 },
];

export function calculateFleetInspectionOverallStatus(
  items: Array<{ status: FleetInspectionItemStatus }>
): FleetInspectionOverallStatus {
  if (items.some((item) => item.status === 'critical')) {
    return 'critical';
  }

  if (items.some((item) => item.status === 'attention')) {
    return 'attention';
  }

  return 'approved';
}
