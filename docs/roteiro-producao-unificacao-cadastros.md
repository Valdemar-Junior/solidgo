# Roteiro de aplicação em produção — Unificação de cadastros (motorista e veículo)

> Objetivo: levar para o sistema real a mudança que deixou **motorista e veículo com um cadastro só** (em "Cadastros e Equipes"), com MDF-e e Controle de Frota reaproveitando os mesmos dados.
>
> ⚠️ Leia tudo antes de começar. A ordem importa. Faça **backup** antes.

---

## 1. O que muda no sistema real

- **Motorista:** passa a ter CPF no cadastro principal; o MDF-e usa esse motorista (não a lista separada).
- **Veículo:** o cadastro principal ganha os campos fiscais (MDF-e) e os operacionais (frota: odômetro, status, chassi…). As tabelas separadas de veículo da frota (`fleet_vehicles`) são **fundidas** na tabela principal (`vehicles`). MDF-e e Frota passam a usar o mesmo veículo.
- **Telas antigas** de "Motoristas MDF-e" e "Veículos MDF-e" deixam de existir.
- **Placa** passa a ser salva no formato que a Focus aceita (maiúscula, só letras/números).

---

## 2. ANTES de tudo (pré-checagem)

1. **Backup do banco de produção** (snapshot no painel do Supabase).
2. **Confira se o banco real bate com o esperado.** Rode este bloco de verificação no SQL Editor (só leitura, não muda nada):

```sql
-- (a) A tabela de veículo da frota existe? (esperado: 1 linha)
select count(*) as tem_fleet_vehicles
from information_schema.tables
where table_schema='public' and table_name='fleet_vehicles';

-- (b) Nomes das chaves estrangeiras que a fusão vai trocar (esperado: 2 linhas)
select conname
from pg_constraint
where conname in ('fleet_inspections_vehicle_id_fkey','fleet_occurrences_vehicle_id_fkey');

-- (c) As 4 funções da frota existem? (esperado: 4 linhas)
select proname
from pg_proc
where proname in (
  'create_fleet_inspection','create_fleet_inspection_assignment',
  'submit_fleet_inspection','update_fleet_occurrence_status'
);

-- (d) A coluna cpf já existe em drivers? (esperado: 1 linha)
select column_name from information_schema.columns
where table_schema='public' and table_name='drivers' and column_name='cpf';
```

**Se algum resultado vier diferente do esperado, PARE e me chame** — significa que o banco real diverge do de teste (isso já aconteceu neste projeto), e precisamos ajustar antes de aplicar.

---

## 3. Ordem de aplicação

> Regra de ouro: **primeiro as migrations (banco), depois o código novo (frontend).**
> O código novo precisa das colunas/tabelas novas; se subir o código antes, ele quebra.

### Passo 3.1 — Migration: campos fiscais no veículo
Arquivo: `supabase/migrations/20260713120000_veiculo_campos_fiscais_mdfe.sql`
- Só acrescenta colunas (seguro). Cole e rode no SQL Editor.

### Passo 3.2 — Migration: fundir veículo da frota
Arquivo: `supabase/migrations/20260713130000_fundir_fleet_vehicles_em_vehicles.sql`
- Acrescenta colunas operacionais, **migra os veículos da frota** para a tabela principal, reaponta inspeções/ocorrências e **remove a `fleet_vehicles`**.
- Os dados dos veículos são preservados (migrados, não apagados). As inspeções são reapontadas.
- ⚠️ Depende do passo 2(b): se os nomes das FKs em produção forem **diferentes** de `fleet_inspections_vehicle_id_fkey` / `fleet_occurrences_vehicle_id_fkey`, me avise — a migration usa esses nomes.

### Passo 3.3 — Migration: ajustar as funções da frota
Arquivo: `supabase/migrations/20260713140000_fleet_funcs_usar_vehicles.sql`
- Reescreve 4 funções para usarem `vehicles` no lugar de `fleet_vehicles`.
- ⚠️ **Cuidado especial (leia!):** este arquivo foi gerado a partir das funções do banco de **teste**. Se em produção essas funções tiverem uma versão diferente (várias IAs mexeram no projeto), aplicar este arquivo **substitui** a versão de produção pela de teste. **Antes de rodar**, confirme comigo que as funções de produção são iguais — ou eu gero uma versão específica a partir do que está em produção. É a única parte deste roteiro que exige essa conferência.

### Passo 3.4 — Subir o código novo (frontend)
- Depois que as 3 migrations acima rodarem sem erro, publique a versão nova do site (deploy).
- O código novo inclui: campo CPF, campos fiscais/operacionais do veículo, MDF-e usando o cadastro principal, Frota usando `vehicles`, telas antigas removidas e placa padronizada.

---

## 4. Depois de aplicar (checklist de teste em produção)

1. **Cadastros e Equipes → Usuários:** editar um motorista e ver o campo **CPF**; salvar.
2. **Cadastros e Equipes → Veículos:** editar um veículo e ver os **dados fiscais**; salvar.
3. **Controle de Frota → Veículos:** os veículos aparecem (vindos do cadastro principal)? Editar odômetro/status salva?
4. **Controle de Frota → Nova inspeção:** criar uma inspeção — **não pode dar erro** de `fleet_vehicles`.
5. **MDF-e (dentro de uma rota):** abrir o modal de emissão e ver se motorista e veículo aparecem no seletor (só os que têm CPF válido / dados fiscais completos).
6. Confirmar que as telas antigas `/admin/mdfe/drivers` e `/admin/mdfe/vehicles` **não abrem mais**.

---

## 5. Preencher os dados que faltam (tarefa do dono, sem pressa)

Depois de aplicado, para o MDF-e funcionar com todos:
- Preencher o **CPF real** dos motoristas (senão não aparecem na emissão).
- Preencher os **dados fiscais** dos veículos que emitem MDF-e (rodado, carroceria, UF, tara) — senão o veículo não aparece na emissão.

---

## 6. Se algo der errado (rollback)

- Como foi feito **backup** (passo 2.1), o caminho mais seguro é **restaurar o snapshot**.
- Os passos 3.1 e 3.3 são reversíveis com facilidade; o 3.2 remove a `fleet_vehicles`, por isso o backup é essencial antes dele.

---

## 7. Resumo rápido (cola)

| Ordem | O quê | Arquivo / ação | Risco |
|---|---|---|---|
| 1 | Backup + pré-checagem | painel Supabase + SQL do item 2 | — |
| 2 | Colunas fiscais no veículo | `20260713120000_...` | baixo (aditivo) |
| 3 | Fundir veículo da frota | `20260713130000_...` | médio (remove fleet_vehicles) |
| 4 | Ajustar funções da frota | `20260713140000_...` | médio (conferir versão de produção antes) |
| 5 | Deploy do frontend | publicar site | baixo |
| 6 | Testar (checklist item 4) | — | — |

> Motorista (CPF) e a ponte do MDF-e são **só frontend** — entram no deploy do passo 5, não precisam de migration.
