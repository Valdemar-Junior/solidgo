-- ⚠️ PERIGO: ESTE SCRIPT APAGA TUDO DO BANCO DE DADOS ⚠️
-- DESTRUIÇÃO TOTAL DO SCHEMA PUBLIC
-- USE APENAS EM PROJETOS NOVOS/TESTE PARA LIMPAR ANTES DE IMPORTAR
-- NUNCA RODE ISSO NO BANCO DE PRODUÇÃO DO SEU CLIENTE ATUAL

-- 1. Apaga o schema 'public' inteiro e tudo que tem dentro (tabelas, views, triggers, functions, types)
DROP SCHEMA public CASCADE;

-- 2. Recria o schema 'public' limpo
CREATE SCHEMA public;

-- 3. Restaura as permissões padrões do Supabase
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;

-- Prontinho! O banco está zerado como se acabasse de nascer.
-- Agora pode rodar o 'schema_consolidado.sql' sem erros.
