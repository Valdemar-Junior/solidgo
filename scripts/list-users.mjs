import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=\s*(.*)\s*$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch (e) {
    // ignore
  }
  return env;
}

async function main() {
  const root = process.cwd();
  const env = loadEnv(root);
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !anon) {
    console.error('Erro: VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configurados');
    process.exit(1);
  }

  const supabase = createClient(url, service || anon);

  const summary = { auth_users: [], public_users: [], notes: [] };

  // Listar public.users (tentar completo; se falhar, consultar por emails conhecidos)
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
      summary.notes.push(`Falha ao listar public.users: ${error.message}`);
      // fallback: checar emails conhecidos
      const targetEmails = [
        'admin@delivery.com',
        'driver@delivery.com',
        'admin@deliveryapp.com',
        'driver@deliveryapp.com'
      ];
      for (const email of targetEmails) {
        const { data: one, error: oneErr } = await supabase
          .from('users')
          .select('id,email,role')
          .eq('email', email)
          .limit(1);
        if (!oneErr && one && one.length > 0) {
          summary.public_users.push({ id: one[0].id, email: one[0].email, role: one[0].role });
        }
      }
    } else {
      summary.public_users = (data || []).map((u) => ({ id: u.id, email: u.email, role: u.role }));
    }
  } catch (e) {
    summary.notes.push(`Exceção ao listar public.users: ${e.message}`);
  }

  // Tentar listar auth.users (requer service role)
  if (!service) {
    summary.notes.push('Para listar auth.users, defina SUPABASE_SERVICE_ROLE_KEY no .env');
  } else {
    try {
      const { data, error } = await supabase.from('auth.users').select('id,email');
      if (error) {
        summary.notes.push(`Falha ao listar auth.users: ${error.message}`);
      } else {
        summary.auth_users = (data || []).map((u) => ({ id: u.id, email: u.email }));
      }
    } catch (e) {
      summary.notes.push(`Exceção ao listar auth.users: ${e.message}`);
    }
  }

  // Detectar conflitos simples por email
  const emailsPublic = new Set(summary.public_users.map((u) => u.email));
  const conflicts = [];
  for (const au of summary.auth_users) {
    if (!emailsPublic.has(au.email)) {
      conflicts.push({ email: au.email, issue: 'auth.users sem correspondente em public.users' });
    }
  }

  const output = { summary, conflicts };
  const outPath = path.join(process.cwd(), 'scripts', 'list-users-output.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Resultado salvo em: ${outPath}`);
}

main().catch((e) => {
  console.error('Erro geral:', e);
  process.exit(1);
});
