-- Remove as configuracoes de webhook da DANFE.
--
-- A geracao da nota fiscal saiu do n8n e passou para o endpoint /api/danfe do
-- proprio projeto (ver docs/geracao-nota-fiscal-danfe.md). Os fluxos gera_nf e
-- gera_nf_devolucao nao sao mais chamados por nenhuma tela, e os campos
-- correspondentes sairam de Configuracoes -> Integracoes.
--
-- Reversivel: se algum dia for preciso voltar, basta inserir a linha de novo
-- com a URL do webhook.
DELETE FROM public.webhook_settings
WHERE key IN ('gera_nf', 'gera_nf_devolucao');
