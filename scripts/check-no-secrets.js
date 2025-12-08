#!/usr/bin/env node
const { execSync } = require('node:child_process')

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' })
}

function fail(msg) {
  console.error(`\n[SECURITY BLOCK] ${msg}\n`)
  process.exit(1)
}

// 1) Block committing env files
const staged = run('git diff --cached --name-only').split(/\r?\n/).filter(Boolean)
const blockedFiles = ['.env', '.env.local', '.env.production', '.env.development']
if (staged.some(f => blockedFiles.includes(f))) {
  fail('Não é permitido commitar arquivos .env/*. Remova-os do staging e use variáveis de ambiente na Vercel.')
}

// 2) Scan staged content for known secret patterns
const patterns = [
  /sb_secret_[A-Za-z0-9_\-\.]+/i,
  /SUPABASE_SERVICE_KEY\s*=\s*.+/i,
  /SUPABASE_URL\s*=\s*https?:\/\//i,
  /AWS_SECRET_ACCESS_KEY\s*=\s*.+/i,
  /GOOGLE_API_KEY\s*=\s*.+/i,
]

if (staged.length) {
  const diff = run('git diff --cached')
  if (patterns.some(p => p.test(diff))) {
    fail('Detectado possível segredo nas mudanças staged. Remova credenciais antes do commit.')
  }
}

process.exit(0)

