export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'driver';
  phone?: string;
  created_at: string;
}

export interface Driver {
  id: string;
  user_id: string;
  cpf: string;
  vehicle_id?: string;
  active: boolean;
  name?: string;
}

export interface DriverWithUser extends Driver {
  user: User;
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  capacity?: number;
  active?: boolean;
}

export interface Order {
  id: string;
  order_id_erp: string;
  customer_name: string;
  phone: string;
  address_json: Address;
  items_json: OrderItem[];
  total: number;
  status: 'imported' | 'assigned' | 'delivered' | 'returned';
  observations?: string;
  danfe_base64?: string;
  danfe_gerada_em?: string;
  xml_documento?: string;
  raw_json?: any;
  created_at: string;
  updated_at: string;
}

export interface Address {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  complement?: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Route {
  id: string;
  name: string;
  driver_id: string;
  vehicle_id?: string;
  conferente?: string;
  observations?: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface RouteWithDetails extends Route {
  driver: DriverWithUser;
  vehicle?: Vehicle;
  route_orders: RouteOrderWithDetails[];
}

export interface RouteOrder {
  id: string;
  route_id: string;
  order_id: string;
  sequence: number;
  status: 'pending' | 'delivered' | 'returned';
  delivery_observations?: string;
  return_reason_id?: string;
  signature_url?: string;
  delivered_at?: string;
  returned_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteOrderWithDetails extends RouteOrder {
  order: Order;
  return_reason?: ReturnReason;
}

export interface ReturnReason {
  id: string;
  reason: string;
  description?: string;
}

export interface DeliveryConfirmation {
  route_order_id: string;
  status: 'delivered' | 'returned';
  observations?: string;
  return_reason_id?: string;
  signature?: string;
  delivered_at: string;
}

export interface SyncLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete';
  data: any;
  synced: boolean;
  created_at: string;
  synced_at?: string;
}

export interface DashboardMetrics {
  total_routes_today: number;
  pending_deliveries: number;
  completed_deliveries: number;
  success_rate: number;
  expired_returns: number;
}

export interface WebhookResponse {
  status: string;
  message: string;
  orders?: any[];
}
