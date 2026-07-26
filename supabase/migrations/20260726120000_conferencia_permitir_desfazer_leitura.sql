-- Conferência de mercadoria: permitir DESFAZER uma leitura.
--
-- Problema: route_conference_scans só tinha política de INSERT e SELECT.
-- Sem política de DELETE, o botão "Desfazer" da tela do conferente removia o
-- volume da tela mas NÃO apagava no banco (o Postgres não dá erro: só apaga
-- zero linhas). Ao recarregar a tela, o volume "desfeito" voltava, e a
-- auditoria ficava com leituras que nunca deveriam ter contado.
--
-- Regra: só dá pra apagar leitura de uma conferência AINDA EM ANDAMENTO, e
-- só o próprio conferente que a iniciou (ou um admin). Conferência finalizada
-- fica congelada.

DROP POLICY IF EXISTS rcs_delete_own ON public.route_conference_scans;

CREATE POLICY rcs_delete_own ON public.route_conference_scans
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.route_conferences rc
      WHERE rc.id = route_conference_scans.route_conference_id
        AND rc.status = 'in_progress'
        AND (
          rc.user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'
          )
        )
    )
  );
