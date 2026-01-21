import { AssemblyProductWithDetails } from '../types/database';

export interface ConsolidatedAssemblyItem {
    type: 'single' | 'kit';
    name: string;
    sku: string; // SKU of the kit (if available) or the single item
    quantity: number;
    status: 'pending' | 'completed' | 'returned' | 'cancelled' | 'in_progress';
    originalItems: AssemblyProductWithDetails[]; // Keep reference to original items
    kitId?: string; // codigo_kit_pai
    observations?: string;
}

export interface AssemblyStats {
    totalItems: number;
    completedItems: number;
    pendingItems: number;
    returnedItems: number;
    consolidatedList: ConsolidatedAssemblyItem[];
}

/**
 * Consolidates assembly products into a list of display items.
 * - Items marked as 'faz_parte_de_kit' are grouped by 'codigo_kit_pai' and counted based on recipe.
 * - Other items remain as single items.
 */
export const calculateAssemblyStats = (products: AssemblyProductWithDetails[]): AssemblyStats => {
    const consolidatedList: ConsolidatedAssemblyItem[] = [];

    // 1. Separate Kit Items vs Single Items
    const kitGroups = new Map<string, AssemblyProductWithDetails[]>();
    const singleItems: AssemblyProductWithDetails[] = [];

    for (const product of products) {
        // Try to find the item in the order's items_json to get metadata
        // We match by SKU. Note: OrderItem has 'sku', AssemblyProduct has 'product_sku'
        const orderItems = product.order?.items_json || [];
        const matchingOrderItem = orderItems.find(item => item.sku === product.product_sku);

        // Check raw_json as fallback or if specifically populated there
        const rawItem = product.order?.raw_json?.items?.find((i: any) => i.sku === product.product_sku);

        const isKit = (matchingOrderItem as any)?.faz_parte_de_kit === 'SIM' || (rawItem as any)?.faz_parte_de_kit === 'SIM';
        const kitCode = (matchingOrderItem as any)?.codigo_kit_pai || (rawItem as any)?.codigo_kit_pai;

        if (isKit && kitCode) {
            // Group identifier: OrderID + KitCode (Kits are per order)
            const groupKey = `${product.order_id}_${kitCode}`;
            if (!kitGroups.has(groupKey)) {
                kitGroups.set(groupKey, []);
            }
            kitGroups.get(groupKey)!.push(product);
        } else {
            singleItems.push(product);
        }
    }

    // 2. Process Single Items
    for (const item of singleItems) {
        consolidatedList.push({
            type: 'single',
            name: item.product_name,
            sku: item.product_sku || '',
            quantity: 1, // Always 1 for single assembly tasks
            status: item.status as any,
            originalItems: [item],
            observations: item.observations || item.technical_notes
        });
    }

    // 3. Process Kit Groups
    for (const [key, items] of kitGroups.entries()) {
        if (items.length === 0) continue;

        const firstItem = items[0];
        const orderItems = firstItem.order?.items_json || [];

        // Find kit metadata from the first item (assuming consistency within the group)
        const matchingOrderItem = orderItems.find(item => item.sku === firstItem.product_sku);
        const rawItem = firstItem.order?.raw_json?.items?.find((i: any) => i.sku === firstItem.product_sku);

        const kitName = (matchingOrderItem as any)?.nome_kit_pai || (rawItem as any)?.nome_kit_pai || 'Kit (Nome não encontrado)';
        // Use kit code as SKU for the display item
        const kitSku = (matchingOrderItem as any)?.codigo_kit_pai || (rawItem as any)?.codigo_kit_pai || '';

        // Calculate Quantity
        // Logic: Sum of (1 / qtde_receita) for each item present?
        // Actually user logic: "4 Bases (Receita 2) = 2 Kits".
        // So for each component type in the kit, we have Count / Recipe.
        // We should take the MAX or MIN? User said "O sistema agrupa... e aplica a fórmula... para descobrir a quantidade real".
        // Ideally all components are present, so the result is consistent.
        // Let's iterate distinct components in this group to calculate.

        // Group items by SKU within the kit to support multiple components (Example: Base + Mattress)
        const componentsBySku = new Map<string, AssemblyProductWithDetails[]>();
        for (const item of items) {
            const sku = item.product_sku || 'unknown';
            if (!componentsBySku.has(sku)) componentsBySku.set(sku, []);
            componentsBySku.get(sku)!.push(item);
        }

        // Calculate kit count based on the first component we find (as per user: "sistema aplica a fórmula em qualquer um dos itens do grupo")
        // We use the component with the highest count to be safe against missing items, implying "at least X kits started"?
        // Or we use the logic: Total Count of Component A / Recipe of Component A.

        let calculatedKits = 0;

        // Find valid recipe for one component
        for (const [sku, componentItems] of componentsBySku.entries()) {
            const compOrderItem = orderItems.find(i => i.sku === sku);
            const compRawItem = firstItem.order?.raw_json?.items?.find((i: any) => i.sku === sku);
            const recipeQty = Number((compOrderItem as any)?.qtde_receita || (compRawItem as any)?.qtde_receita || 1);

            if (recipeQty > 0) {
                calculatedKits = componentItems.length / recipeQty;
                break; // Found a valid calculation base
            }
        }

        // Fallback if recipe fails
        if (calculatedKits === 0) calculatedKits = 1;

        // Determine Status
        // If ANY item is pending, the Kit is Pending? Or only if ALL are completed?
        // "Montagem Unificada": usually means the job is done when the kit is assembled.
        // If 4 bases are done but 2 mattresses are pending, is the Kit Done? No.
        // Conservative Approach: Kit is COMPLETED only if ALL items are COMPLETED.
        // Kit is RETURNED if ANY item is RETURNED?

        const allCompleted = items.every(i => i.status === 'completed');
        const anyReturned = items.some(i => i.status === 'cancelled' || i.was_returned);

        let derivedStatus: 'pending' | 'completed' | 'returned' | 'cancelled' | 'in_progress' = 'pending';

        if (anyReturned) derivedStatus = 'returned';
        else if (allCompleted) derivedStatus = 'completed';
        else if (items.some(i => i.status === 'in_progress')) derivedStatus = 'in_progress';
        else derivedStatus = 'pending';

        consolidatedList.push({
            type: 'kit',
            name: kitName,
            sku: kitSku,
            quantity: calculatedKits,
            status: derivedStatus,
            originalItems: items,
            kitId: kitSku
        });
    }

    // 4. Calculate Totals
    const totalItems = consolidatedList.reduce((acc, item) => acc + item.quantity, 0);
    const completedItems = consolidatedList
        .filter(i => i.status === 'completed')
        .reduce((acc, item) => acc + item.quantity, 0);

    const returnedItems = consolidatedList
        .filter(i => i.status === 'returned' || i.status === 'cancelled')
        .reduce((acc, item) => acc + item.quantity, 0);

    // Everything else is pending/in-progress
    const pendingItems = totalItems - completedItems - returnedItems;

    return {
        totalItems,
        completedItems,
        pendingItems,
        returnedItems,
        consolidatedList
    };
};
