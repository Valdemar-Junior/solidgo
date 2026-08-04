/**
 * Remove fotos de entrega duplicadas geradas pelo reenvio do mesmo lote.
 *
 * Uma duplicata é definida como mais de uma linha em delivery_photos com o mesmo
 * (route_order_id, file_name). O file_name é gerado uma única vez na captura, com
 * timestamp + random, então repetição do nome significa a mesma foto gravada N vezes.
 * Mantém a linha mais antiga de cada grupo e apaga as demais, junto com os arquivos
 * correspondentes no Storage (cada cópia foi para um storage_path distinto).
 *
 * Uso:
 *   node scripts/cleanup-duplicate-delivery-photos.mjs           # dry-run, só relata
 *   node scripts/cleanup-duplicate-delivery-photos.mjs --apply   # executa a limpeza
 *
 * Requer SUPABASE_SERVICE_ROLE_KEY (no .env ou no ambiente): o RLS não permite
 * DELETE para um cliente anônimo.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';

const BUCKET_NAME = 'delivery-photos';
const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;

function loadEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=\s*(.*)\s*$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch {
    // ignore
  }
  return env;
}

async function fetchAllPhotos(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('delivery_photos')
      .select('id, route_order_id, file_name, storage_path, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Falha ao ler delivery_photos: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export function findDuplicates(rows) {
  const groups = new Map();
  let semNome = 0;

  for (const row of rows) {
    if (!row.file_name) {
      semNome++;
      continue;
    }
    const key = `${row.route_order_id}|${row.file_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const excedentes = [];
  let gruposAfetados = 0;

  for (const grupo of groups.values()) {
    if (grupo.length < 2) continue;
    gruposAfetados++;
    // Já vem ordenado por created_at ascendente: mantém o primeiro.
    excedentes.push(...grupo.slice(1));
  }

  return { excedentes, gruposAfetados, gruposTotais: groups.size, semNome };
}

async function chunkedDelete(supabase, excedentes) {
  let arquivosRemovidos = 0;
  let linhasRemovidas = 0;

  for (let i = 0; i < excedentes.length; i += BATCH_SIZE) {
    const lote = excedentes.slice(i, i + BATCH_SIZE);

    const paths = lote.map((r) => r.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);
      // Arquivo ausente não impede a remoção da linha órfã.
      if (error) console.warn(`  aviso: falha ao remover arquivos do Storage: ${error.message}`);
      else arquivosRemovidos += paths.length;
    }

    const ids = lote.map((r) => r.id);
    const { error: deleteError } = await supabase.from('delivery_photos').delete().in('id', ids);
    if (deleteError) throw new Error(`Falha ao apagar linhas: ${deleteError.message}`);
    linhasRemovidas += ids.length;

    console.log(`  ${linhasRemovidas}/${excedentes.length} linhas apagadas...`);
  }

  return { arquivosRemovidos, linhasRemovidas };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = loadEnv(process.cwd());
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    '';

  if (!url) {
    console.error('Erro: VITE_SUPABASE_URL não configurado.');
    process.exit(1);
  }
  if (!service) {
    console.error('Erro: SUPABASE_SERVICE_ROLE_KEY não configurado (necessário para apagar linhas).');
    process.exit(1);
  }

  const supabase = createClient(url, service, { auth: { persistSession: false } });

  console.log('Lendo delivery_photos...');
  const rows = await fetchAllPhotos(supabase);
  const { excedentes, gruposAfetados, gruposTotais, semNome } = findDuplicates(rows);

  console.log('');
  console.log(`Linhas na tabela:      ${rows.length}`);
  console.log(`Fotos reais (grupos):  ${gruposTotais}`);
  console.log(`Grupos com duplicata:  ${gruposAfetados}`);
  console.log(`Linhas excedentes:     ${excedentes.length}`);
  if (semNome > 0) console.log(`Linhas sem file_name ignoradas: ${semNome}`);
  console.log('');

  if (excedentes.length === 0) {
    console.log('Nada a limpar.');
    return;
  }

  if (!apply) {
    console.log('Dry-run. Amostra do que seria apagado:');
    for (const row of excedentes.slice(0, 10)) {
      console.log(`  ${row.created_at}  ${row.file_name}  ${row.storage_path}`);
    }
    if (excedentes.length > 10) console.log(`  ... e mais ${excedentes.length - 10}`);
    console.log('');
    console.log('Rode com --apply para executar.');
    return;
  }

  console.log('Aplicando limpeza...');
  const { arquivosRemovidos, linhasRemovidas } = await chunkedDelete(supabase, excedentes);

  console.log('');
  console.log(`Concluído: ${linhasRemovidas} linhas e ${arquivosRemovidos} arquivos removidos.`);
  console.log('Rode a migration 20260804120000_dedupe_delivery_photos.sql para recalcular');
  console.log('o photo_count dos comprovantes e criar o índice de unicidade.');
}

// Só executa quando chamado direto, para permitir importar findDuplicates em testes.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error('Erro:', e.message || e);
    process.exit(1);
  });
}
