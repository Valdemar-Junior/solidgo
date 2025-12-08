import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { route_name, driver_name, conferente, documentos, status, vehicle, observations } = req.body;

    // Validar dados obrigatórios
    if (!route_name || !driver_name || !documentos || !Array.isArray(documentos) || documentos.length === 0) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    // Criar mensagem formatada para o grupo
    const statusText = status === 'pending' ? 'Em Separação' : 
                      status === 'in_progress' ? 'Em Rota' : 'Concluída';
    
    const mensagem = `
🚚 *NOVA ROTA CRIADA* 🚚

📋 *Romaneio:* ${route_name}
👨‍💼 *Motorista:* ${driver_name}
${conferente ? `👷 *Conferente:* ${conferente}` : ''}
${vehicle ? `🚛 *Veículo:* ${vehicle}` : ''}
📊 *Status:* ${statusText}
${observations ? `📝 *Observações:* ${observations}` : ''}

📄 *Documentos:*
${documentos.map((doc, index) => `${index + 1}. ${doc}`).join('\n')}

⏰ *Horário:* ${new Date().toLocaleString('pt-BR')}
    `.trim();

    console.log('Mensagem para grupo:', mensagem);

    // Aqui você pode integrar com seu sistema de envio de mensagens
    // Por exemplo, WhatsApp API, Telegram, etc.
    
    return res.status(200).json({ 
      success: true, 
      message: 'Mensagem preparada para envio',
      data: {
        route_name,
        driver_name,
        conferente,
        vehicle,
        status: statusText,
        observations,
        documentos,
        mensagem
      }
    });

  } catch (error) {
    console.error('Erro no webhook de grupo:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}