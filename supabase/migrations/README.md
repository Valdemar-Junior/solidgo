# Migrations — baseline único

## O que é isto

`00000000000000_baseline_schema.sql` é o **baseline**: uma fotografia fiel e **verificada** do schema completo do banco (projeto de teste `Banco_Teste_Soligo`), gerada com `pg_dump --schema-only` e comprovada.

Ele substitui as 137 migrations antigas, que estavam bagunçadas (sem ordem consistente, misturadas com scripts de teste/debug e duplicatas) e **não reproduziam mais o banco**.

## Prova de fidelidade

O baseline foi aplicado num Postgres vazio descartável (com os dublês do Supabase: roles `authenticated/anon/service_role/supabase_admin` e schema `auth`). Resultado: **zero erros** e contagens idênticas ao banco real:

| Objeto | Banco real | Reproduzido pelo baseline |
|---|---|---|
| Tabelas | 47 | 47 |
| Views | 2 | 2 |
| Funções | 74 | 74 |
| Triggers | 34 | 34 |
| Policies | 140 | 140 |

## Regra de ouro daqui pra frente

Toda mudança de banco vira **uma migration nova** (`<timestamp>_descricao.sql`) neste diretório. **Não editar o banco na mão** — senão o baseline volta a mentir.

## Observações

- As 137 migrations antigas estão em `supabase/migrations_archive/` (fora do Git, guardadas localmente; também no histórico do Git).
- O baseline foi levemente ajustado do dump cru: removidos comandos de psql v17 (`\restrict`), `SET transaction_timeout` (não existe no Postgres da máquina local) e `CREATE SCHEMA public` virou idempotente.
- **Se um dia for usar `supabase db push`** contra um banco que já tem esse schema: será preciso rodar `supabase migration repair --status applied 00000000000000` uma vez, para o CLI marcar o baseline como já aplicado (senão ele tenta recriar objetos que já existem).
