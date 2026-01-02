import localforage from 'localforage';
import type { DeliveryConfirmation } from '../../types/database';

// Configure localforage instances
const offlineStorage = localforage.createInstance({
  name: 'deliveryApp',
  storeName: 'offline_data',
  description: 'Offline storage for delivery app data',
});

const syncQueueStorage = localforage.createInstance({
  name: 'deliveryApp',
  storeName: 'sync_queue',
  description: 'Queue for actions to sync when online',
});

export interface SyncQueueItem {
  id: string;
  type: 'delivery_confirmation' | 'order_update' | 'return_revert' | 'assembly_confirmation' | 'assembly_return' | 'assembly_undo' | 'delivery_revert' | 'route_completion' | 'assembly_route_completion';
  data: any;
  timestamp: string;
  attempts: number;
  last_attempt?: string;
  status: 'pending' | 'syncing' | 'failed' | 'completed';
}

export class OfflineStorage {
  // Store data offline
  static async setItem(key: string, value: any): Promise<void> {
    try {
      await offlineStorage.setItem(key, value);
    } catch (error) {
      console.error('Error storing offline data:', error);
      throw error;
    }
  }

  // Get data from offline storage
  static async getItem(key: string): Promise<any> {
    try {
      return await offlineStorage.getItem(key);
    } catch (error) {
      console.error('Error retrieving offline data:', error);
      throw error;
    }
  }

  // Remove item from offline storage
  static async removeItem(key: string): Promise<void> {
    try {
      await offlineStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing offline data:', error);
      throw error;
    }
  }

  // Get all keys
  static async keys(): Promise<string[]> {
    try {
      return await offlineStorage.keys();
    } catch (error) {
      console.error('Error getting offline storage keys:', error);
      throw error;
    }
  }

  // Clear all offline data
  static async clear(): Promise<void> {
    try {
      await offlineStorage.clear();
    } catch (error) {
      console.error('Error clearing offline storage:', error);
      throw error;
    }
  }
}

export class SyncQueue {
  // Add item to sync queue
  static async addItem(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'attempts' | 'status'>): Promise<string> {
    const id = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const queueItem: SyncQueueItem = {
      ...item,
      id,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    try {
      // CONSOLIDAÇÃO INTELIGENTE:
      // Se já houver ações pendentes para o mesmo item_id e route_id, removê-las.
      // A nova ação substitui qualquer estado anterior pendente.
      const itemId = item.data?.item_id;
      const routeId = item.data?.route_id;

      if (itemId && routeId) {
        const keys = await syncQueueStorage.keys();
        for (const key of keys) {
          const existing = await syncQueueStorage.getItem(key) as SyncQueueItem;
          // Verifica se é uma ação de item de montagem (não rota, não delete, etc)
          if (existing &&
            existing.status === 'pending' &&
            existing.data?.item_id === itemId &&
            String(existing.data?.route_id) === String(routeId) &&
            ['assembly_confirmation', 'assembly_return', 'assembly_undo'].includes(existing.type) &&
            ['assembly_confirmation', 'assembly_return', 'assembly_undo'].includes(item.type)
          ) {
            // Remove a ação obsoleta
            await syncQueueStorage.removeItem(key);
            console.log('[SyncQueue] Consolidating: removed obsolete action', existing.type, 'for item', itemId);
          }
        }
      }

      await syncQueueStorage.setItem(id, queueItem);
      return id;
    } catch (error) {
      console.error('Error adding to sync queue:', error);
      throw error;
    }
  }

  // Get all pending items
  static async getPendingItems(): Promise<SyncQueueItem[]> {
    try {
      const keys = await syncQueueStorage.keys();
      const items: SyncQueueItem[] = [];

      for (const key of keys) {
        const item = await syncQueueStorage.getItem(key) as SyncQueueItem;
        if (item && (item.status === 'pending' || item.status === 'failed')) {
          items.push(item);
        }
      }

      return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (error) {
      console.error('Error getting pending sync items:', error);
      throw error;
    }
  }

  // Update sync item status
  static async updateItemStatus(id: string, status: SyncQueueItem['status'], attempts?: number): Promise<void> {
    try {
      const item = await syncQueueStorage.getItem(id) as SyncQueueItem;
      if (item) {
        item.status = status;
        item.last_attempt = new Date().toISOString();
        if (attempts !== undefined) {
          item.attempts = attempts;
        }
        await syncQueueStorage.setItem(id, item);
      }
    } catch (error) {
      console.error('Error updating sync item status:', error);
      throw error;
    }
  }

  // Remove completed items
  static async removeCompletedItems(): Promise<void> {
    try {
      const keys = await syncQueueStorage.keys();

      for (const key of keys) {
        const item = await syncQueueStorage.getItem(key) as SyncQueueItem;
        if (item && item.status === 'completed') {
          await syncQueueStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error('Error removing completed sync items:', error);
      throw error;
    }
  }

  // Clear all sync queue items
  static async clear(): Promise<void> {
    try {
      await syncQueueStorage.clear();
    } catch (error) {
      console.error('Error clearing sync queue:', error);
      throw error;
    }
  }
}

// Network status utility
export class NetworkStatus {
  private static online = navigator.onLine;
  private static listeners: Array<(online: boolean) => void> = [];

  static init(): void {
    window.addEventListener('online', () => {
      this.online = true;
      this.notifyListeners(true);
    });

    window.addEventListener('offline', () => {
      this.online = false;
      this.notifyListeners(false);
    });
  }

  static isOnline(): boolean {
    return this.online;
  }

  static addListener(listener: (online: boolean) => void): void {
    this.listeners.push(listener);
  }

  static removeListener(listener: (online: boolean) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private static notifyListeners(online: boolean): void {
    this.listeners.forEach(listener => listener(online));
  }
}

// Initialize network status monitoring
NetworkStatus.init();
