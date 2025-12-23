import { supabase } from '../supabase/client';

export type ColumnConfig = {
    id: string;
    label: string;
    visible: boolean;
};

export type PreferenceKey =
    | 'rc_columns_conf'    // RouteCreation columns configuration
    | 'am_columns_conf';   // AssemblyManagement columns configuration

/**
 * Save user preference to Supabase
 * @param userId User ID
 * @param key Preference key
 * @param value Preference value (will be stored as JSON)
 */
export async function saveUserPreference(
    userId: string,
    key: PreferenceKey,
    value: any
): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('user_preferences')
            .upsert(
                {
                    user_id: userId,
                    pref_key: key,
                    pref_value: value,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'user_id,pref_key' }
            );

        if (error) {
            console.error('[UserPreferences] Error saving preference:', error);
            return false;
        }

        // Also save to localStorage as backup/cache
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('[UserPreferences] localStorage not available');
        }

        return true;
    } catch (error) {
        console.error('[UserPreferences] Error saving preference:', error);
        return false;
    }
}

/**
 * Load user preference from Supabase
 * Falls back to localStorage if Supabase fails
 * @param userId User ID
 * @param key Preference key
 * @returns The preference value or null if not found
 */
export async function loadUserPreference<T = any>(
    userId: string,
    key: PreferenceKey
): Promise<T | null> {
    try {
        const { data, error } = await supabase
            .from('user_preferences')
            .select('pref_value')
            .eq('user_id', userId)
            .eq('pref_key', key)
            .single();

        if (error) {
            // If not found in Supabase, try localStorage
            if (error.code === 'PGRST116') {
                console.log('[UserPreferences] Preference not found in Supabase, checking localStorage');
                return loadFromLocalStorage<T>(key);
            }
            console.error('[UserPreferences] Error loading preference:', error);
            return loadFromLocalStorage<T>(key);
        }

        if (data?.pref_value) {
            // Cache to localStorage
            try {
                localStorage.setItem(key, JSON.stringify(data.pref_value));
            } catch (e) {
                console.warn('[UserPreferences] Could not cache to localStorage');
            }
            return data.pref_value as T;
        }

        return null;
    } catch (error) {
        console.error('[UserPreferences] Error loading preference:', error);
        return loadFromLocalStorage<T>(key);
    }
}

/**
 * Load preference from localStorage (fallback)
 */
function loadFromLocalStorage<T>(key: string): T | null {
    try {
        const saved = localStorage.getItem(key);
        if (saved) {
            return JSON.parse(saved) as T;
        }
    } catch (e) {
        console.warn('[UserPreferences] Error reading from localStorage:', e);
    }
    return null;
}

/**
 * Merge saved columns configuration with defaults
 * Ensures no missing columns and preserves order/visibility from saved config
 */
export function mergeColumnsConfig(
    saved: ColumnConfig[] | null,
    defaults: ColumnConfig[]
): ColumnConfig[] {
    if (!saved || !Array.isArray(saved) || saved.length === 0) {
        return defaults;
    }

    // Filter valid entries
    const validSaved = saved.filter(
        (c: any) => c && typeof c === 'object' && 'id' in c
    );

    if (validSaved.length === 0) {
        return defaults;
    }

    // Create a map of saved configs for quick lookup
    const savedMap = new Map(validSaved.map(c => [c.id, c]));

    // Build result: first add all saved columns in their order
    const result: ColumnConfig[] = [];
    const addedIds = new Set<string>();

    // Add saved columns first (preserving their order)
    for (const col of validSaved) {
        const defaultCol = defaults.find(d => d.id === col.id);
        if (defaultCol) {
            result.push({
                ...defaultCol,
                visible: col.visible,
                label: col.label || defaultCol.label
            });
            addedIds.add(col.id);
        }
    }

    // Add any missing columns from defaults (new columns that weren't in saved)
    for (const defaultCol of defaults) {
        if (!addedIds.has(defaultCol.id)) {
            result.push(defaultCol);
        }
    }

    return result;
}
