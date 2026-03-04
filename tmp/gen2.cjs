const fs = require('fs');
const data = [
    { "schemaname": "public", "tablename": "orders", "policyname": "Allow authenticated users to update orders", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "true", "with_check": "true" },
    { "schemaname": "public", "tablename": "webhook_settings", "policyname": "webhook_settings_select_authenticated", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "assembly_photos", "policyname": "Enable read access for authenticated users", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "assembly_photos", "policyname": "Enable insert for authenticated users", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "true" },
    { "schemaname": "public", "tablename": "assembly_photos", "policyname": "Enable delete for authenticated users", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "DELETE", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "sync_logs", "policyname": "Debug: Allow All Insert Logs", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "true" },
    { "schemaname": "public", "tablename": "drivers", "policyname": "Allow authenticated users to read drivers", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "drivers", "policyname": "Allow authenticated users to insert drivers", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "true" },
    { "schemaname": "public", "tablename": "assembly_routes", "policyname": "Enable read access for all users", "permissive": "PERMISSIVE", "roles": "{public}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "assembly_products", "policyname": "Enable read access for all users", "permissive": "PERMISSIVE", "roles": "{public}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "vehicles", "policyname": "vehicles_select_authenticated", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "app_settings", "policyname": "app_settings_select_authenticated", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null },
    { "schemaname": "public", "tablename": "webhook_settings", "policyname": "webhook_settings_modify_authenticated", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "true", "with_check": "true" },
    { "schemaname": "public", "tablename": "route_orders", "policyname": "enable_update_for_authenticated", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "true", "with_check": "true" }
];

const sql = data.map(p => {
    let stmt = `DROP POLICY IF EXISTS "${p.policyname}" ON "${p.schemaname}"."${p.tablename}";\n`;
    stmt += `CREATE POLICY "${p.policyname}" ON "${p.schemaname}"."${p.tablename}" AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.replace(/[{}]/g, '')}`;

    const replacement = p.roles.includes('authenticated') ? "((select auth.role()) = 'authenticated')" : "((select auth.role()) IN ('authenticated', 'anon', 'service_role'))";

    if (p.qual) {
        stmt += `\nUSING (${p.qual === 'true' ? replacement : p.qual})`;
    }
    if (p.with_check) {
        stmt += `\nWITH CHECK (${p.with_check === 'true' ? replacement : p.with_check})`;
    }
    stmt += ';\n';
    return stmt;
}).join('\n');

fs.writeFileSync('tmp/permissive_migration.sql', sql);
