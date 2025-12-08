export const config = { runtime: 'nodejs24.x' }
export default async function handler(req: any, res: any) {
  return res.status(200).json({ ok: true, ts: new Date().toISOString() })
}
