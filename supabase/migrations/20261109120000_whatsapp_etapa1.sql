-- WhatsApp dentro do SolidGo (Evolution API) — etapa 1: conexão e recebimento.
--
-- Tudo aqui é acessado só pelo servidor (service key, em api/agente.ts), que exige
-- admin logado ou o segredo do webhook: RLS ligada e sem policy, como nas tabelas
-- do agente. A tela de Atendimento (etapa 2) abre o que precisar de leitura direta.
--
-- Pode rodar mais de uma vez sem problema.

-- 1) Conversas: uma por telefone ------------------------------------------------
create table if not exists public.wa_conversas (
  id                 uuid primary key default gen_random_uuid(),
  telefone           text not null unique,  -- dígitos com 55, sempre com o 9º dígito; 'lid:...' se o WhatsApp esconder o número
  remote_jid         text not null,         -- endereço real no WhatsApp (pode não ter o 9º dígito); é para ele que se responde
  nome_contato       text,
  order_id_erp       text,
  atendente_id       uuid,
  status             text not null default 'aberta' check (status in ('aberta', 'aguardando', 'fechada')),
  ultima_mensagem    text,
  ultima_mensagem_em timestamptz,
  nao_lidas          int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_wa_conv_ultima on public.wa_conversas (ultima_mensagem_em desc nulls last);
alter table public.wa_conversas enable row level security;

-- 2) Mensagens ------------------------------------------------------------------
create table if not exists public.wa_mensagens (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid not null references public.wa_conversas(id) on delete cascade,
  message_id     text not null unique,  -- key.id do WhatsApp: impede gravar a mesma mensagem duas vezes
  direcao        text not null check (direcao in ('in', 'out')),
  tipo           text not null check (tipo in ('texto', 'imagem', 'audio', 'video', 'documento', 'localizacao', 'outro')),
  texto          text,
  midia_path     text,                  -- caminho no bucket wa-midia
  midia_mimetype text,
  lat            double precision,
  lng            double precision,
  local_nome     text,
  autor          text,                  -- 'cliente', 'celular' ou nome do atendente
  status_envio   text check (status_envio in ('pending', 'sent', 'delivered', 'read', 'failed')),
  enviada_em     timestamptz not null,
  chave          jsonb,                 -- key original do WhatsApp, para diagnóstico de @lid
  created_at     timestamptz not null default now()
);
create index if not exists idx_wa_msg_conversa on public.wa_mensagens (conversa_id, enviada_em desc);
create index if not exists idx_wa_msg_recentes on public.wa_mensagens (enviada_em desc);
alter table public.wa_mensagens enable row level security;

-- 3) Estado da conexão (uma linha por instância) --------------------------------
create table if not exists public.wa_instancia_status (
  instancia     text primary key,
  estado        text not null,
  numero        text,
  nome_perfil   text,
  conectado_em  timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.wa_instancia_status enable row level security;

-- 4) Resumo da conversa: só roda quando a mensagem é gravada de verdade,
--    então reenvio do webhook não conta não lida duas vezes ------------------------
create or replace function public.wa_atualizar_conversa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_previa text := coalesce(nullif(left(new.texto, 200), ''), case new.tipo
    when 'imagem' then '📷 Foto'
    when 'audio' then '🎤 Áudio'
    when 'video' then '🎬 Vídeo'
    when 'documento' then '📄 Documento'
    when 'localizacao' then '📍 Localização'
    else 'Mensagem' end);
begin
  update public.wa_conversas c set
    ultima_mensagem    = case when new.enviada_em >= coalesce(c.ultima_mensagem_em, '-infinity') then v_previa else c.ultima_mensagem end,
    ultima_mensagem_em = greatest(c.ultima_mensagem_em, new.enviada_em),
    nao_lidas          = c.nao_lidas + case when new.direcao = 'in' then 1 else 0 end,
    status             = case when new.direcao = 'in' and c.status = 'fechada' then 'aberta' else c.status end,
    updated_at         = now()
  where c.id = new.conversa_id;
  return new;
end;
$$;
revoke all on function public.wa_atualizar_conversa() from public, anon, authenticated;

drop trigger if exists trg_wa_atualizar_conversa on public.wa_mensagens;
create trigger trg_wa_atualizar_conversa
  after insert on public.wa_mensagens
  for each row execute function public.wa_atualizar_conversa();

-- 5) Arquivos: bucket privado, 16 MB por arquivo --------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-midia', 'wa-midia', false, 16777216)
on conflict (id) do update set public = false, file_size_limit = 16777216;
