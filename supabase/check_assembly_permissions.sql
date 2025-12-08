-- Check current permissions for assembly tables
SELECT grantee, table_name, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
  AND grantee IN ('anon', 'authenticated') 
  AND table_name IN ('assembly_routes', 'assembly_products') 
ORDER BY table_name, grantee;

-- Check RLS policies for assembly_routes
SELECT polname, polcmd, polroles::regrole[], polqual, polwithcheck 
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'assembly_routes';

-- Check RLS policies for assembly_products
SELECT polname, polcmd, polroles::regrole[], polqual, polwithcheck 
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'assembly_products';