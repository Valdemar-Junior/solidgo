-- FEATURE: "Confirmar retorno à loja" na Central de Devoluções.
--
-- Contexto: quando um item é devolvido/cancelado no ERP e vira BLOQUEADO
-- ("não entregar") numa rota, o motorista NÃO entrega e traz o móvel de volta
-- no caminhão. Depois que a rota é finalizada, esse item volta fisicamente pro
-- depósito — mas o sistema não tinha nenhum passo pra alguém da logística
-- CONFIRMAR "recebi de volta, tá na loja". A devolução ficava parada olhando
-- como pendência sem fim (diferente do caso "precisa coleta", que fecha quando
-- a coleta é feita).
--
-- Solução: 2 colunas de registro. O botão na central grava quem confirmou e
-- quando; a situação vira "Retornou à loja" (verde) e sai das pendências.
-- É só um carimbo de conferência — reversível (o botão vira "desfazer").

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS store_return_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS store_return_confirmed_by uuid;

COMMENT ON COLUMN public.order_returns.store_return_confirmed_at IS
  'Quando a logística confirmou que o produto devolvido/bloqueado voltou fisicamente pra loja (conferência de retorno). NULL = ainda não conferido.';
COMMENT ON COLUMN public.order_returns.store_return_confirmed_by IS
  'auth.uid() de quem confirmou o retorno à loja.';
