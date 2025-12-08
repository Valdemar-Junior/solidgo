#!/usr/bin/env node
const { execSync } = require('node:child_process')

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' })
  } catch (e) {
    return ''
  }
}

function fail(msg) {
  console.error(`\n[SECURITY BLOCK] ${msg}\n`)
  process.exit(1)
}

const staged = run('git diff --cached --name-only').split(/\r?\n/).filter(Boolean)
const blockedFiles = ['.env', '.env.local', '.env.production', '.env.development']
if (staged.some(f => blockedFiles.includes(f))) {
  fail('Não é permitido commitar arquivos .env/*. Remova-os do staging e use variáveis de ambiente na Vercel.')
}

const diff = run('git diff --cached')
const patterns = [
  /sb_secret_[A-Za-z0-9_\-\.]+/i,
  /SUPABASE_SERVICE_KEY\s*=\s*.+/i,
  /AWS_SECRET_ACCESS_KEY\s*=\s*.+/i,
]
if (diff && patterns.some(p => p.test(diff))) {
  fail('Detectado possível segredo nas mudanças staged. Remova credenciais antes do commit.')
}

process.exit(0)

