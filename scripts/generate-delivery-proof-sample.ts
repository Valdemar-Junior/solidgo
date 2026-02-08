import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeliveryProofPdfGenerator } from '../src/utils/pdf/deliveryProofPdfGenerator';

const samplePixelRed =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+7xQAAAAASUVORK5CYII=';
const samplePixelBlue =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwMBARm6XhYAAAAASUVORK5CYII=';

const nowIso = new Date().toISOString();

const sampleOrder: any = {
  id: '11111111-1111-1111-1111-111111111111',
  order_id_erp: 'COMP-EXEMPLO-0001',
  customer_name: 'Cliente Exemplo',
  phone: '(62) 99999-0000',
  customer_cpf: '123.456.789-00',
  address_json: {
    street: 'Rua Exemplo',
    number: '123',
    neighborhood: 'Centro',
    city: 'Goiania',
    state: 'GO',
    zip: '74000-000',
    complement: 'Casa',
  },
  items_json: [],
  status: 'delivered',
  created_at: nowIso,
  updated_at: nowIso,
};

async function run() {
  const pdfBytes = await DeliveryProofPdfGenerator.generate({
    order: sampleOrder,
    route: {
      routeName: 'Rota Exemplo Norte',
      routeCode: 'RT-2026-0001',
      routeId: '22222222-2222-2222-2222-222222222222',
      routeOrderId: '33333333-3333-3333-3333-333333333333',
      routeOrderStatus: 'delivered',
      deliveredAt: nowIso,
      driverName: 'Motorista Exemplo',
      vehicleInfo: 'HR HDB-1234',
    },
    receipt: {
      id: '44444444-4444-4444-4444-444444444444',
      deliveredAtServer: nowIso,
      deviceTimestamp: nowIso,
      recipientName: 'Joao da Silva',
      recipientRelation: 'Filho',
      recipientNotes: 'Recebido sem avarias',
      gpsStatus: 'ok',
      gpsLat: -16.6869,
      gpsLng: -49.2648,
      gpsAccuracyM: 12,
      syncStatus: 'synced',
      networkMode: 'online',
      photoCount: 2,
      proofHash: 'sample-proof-hash-1234567890abcdef',
    },
    deliveredByName: 'Motorista Exemplo',
    photos: [
      {
        id: 'photo-1',
        url: samplePixelRed,
        label: 'Produto na porta',
        createdAt: nowIso,
      },
      {
        id: 'photo-2',
        url: samplePixelBlue,
        label: 'Recibo assinado',
        createdAt: nowIso,
      },
    ],
    generatedAt: nowIso,
  });

  const outDir = resolve(process.cwd(), 'docs', 'samples');
  const outPath = resolve(outDir, 'comprovante_digital_exemplo.pdf');
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, pdfBytes);

  console.log(`PDF gerado em: ${outPath}`);
}

run().catch((error) => {
  console.error('Falha ao gerar PDF de exemplo:', error);
  process.exit(1);
});

