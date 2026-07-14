// Conversor XML NF-e (modelo 55) -> DANFE em HTML.
// Layout refeito (jul/2026): fonte legível, página A4 de altura travada
// (rodapé sempre fecha embaixo) e paginação por altura real em mm —
// notas com muitos itens quebram limpo, com cabeçalho repetido e "FOLHA X de Y".
// Núcleo exportado: processXmlToHtml(xml, logoBase64?) -> { html, meta }.
import { XMLParser } from "fast-xml-parser";
// @ts-ignore — bwip-js resolve em runtime (build node); os tipos não casam com moduleResolution bundler.
import bwipjs from "bwip-js";

// Namespace NFe 4.00
const NFE_NS = "http://www.portalfiscal.inf.br/nfe";

// ================================================
// CSS — página A4 exata; .page é flex-coluna com altura fixa, a área de
// itens estica (flex:1) e o rodapé fica sempre colado embaixo.
// ================================================
const PAGE_CSS = `
<style type="text/css">
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { margin: 0; box-sizing: border-box; }

    .page {
        width: 210mm;
        height: 296mm;                 /* levemente < 297 pra não estourar folha em branco */
        padding: 4mm 6mm;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        page-break-after: always;
        page-break-inside: avoid;
        background: #fff;
    }
    .page:last-child { page-break-after: auto; }

    .page table { border-collapse: collapse; width: 100%; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .page td, .page th { border: 1px solid #000; vertical-align: top; padding: 0.6mm 1mm; overflow: hidden; }

    .nf-label { display: block; font-size: 5pt; text-transform: uppercase; line-height: 1.25; letter-spacing: 0.1px; }
    .info { display: block; font-size: 8pt; font-weight: bold; line-height: 1.2; word-break: break-word; }
    .area-name { font-size: 6.5pt; font-weight: bold; text-transform: uppercase; margin: 1.2mm 0 0.5mm; }
    .txt-center { text-align: center; }
    .txt-right { text-align: right; }
    .txt-upper { text-transform: uppercase; }
    .bold { font-weight: bold; }
    .block { display: block; }
    .no-top td { border-top: none; }
    .hr-dashed { border: none; border-top: 1px dashed #444; margin: 1.6mm 0; }

    /* Canhoto (só folha 1) */
    .canhoto td { font-size: 6.5pt; }
    .canhoto .tserie { width: 34mm; vertical-align: middle; text-align: center; }
    .canhoto .tserie .nfe-title { font-size: 12pt; font-weight: bold; display: block; margin-bottom: 1mm; }
    .canhoto .tserie span { display: block; font-size: 8pt; font-weight: bold; }

    /* Cabeçalho do emitente */
    .emit-name { font-size: 9pt; font-weight: bold; display: block; margin-bottom: 1mm; }
    .emit-addr { font-size: 7pt; line-height: 1.35; }
    .danfe-title { font-size: 12pt; font-weight: bold; letter-spacing: 0.5px; }
    .danfe-sub { font-size: 6.5pt; line-height: 1.25; margin: 0.8mm 0; }
    .danfe-nf { font-size: 8.5pt; font-weight: bold; line-height: 1.35; }
    .danfe-folha { font-size: 7.5pt; font-weight: bold; }
    .entradaSaida { margin: 1mm 0; }
    .entradaSaida .legenda { text-align: left; margin-left: 3mm; display: inline-block; font-size: 6.5pt; line-height: 1.3; }
    .entradaSaida .legenda span { display: block; }
    .entradaSaida .identificacao { float: right; margin-right: 2mm; border: 1px solid #000; width: 5.5mm; height: 5.5mm; text-align: center; line-height: 5.5mm; font-size: 8pt; font-weight: bold; }
    .chave { font-size: 8pt; font-weight: bold; letter-spacing: 0.3px; }
    .consulta { font-size: 6.5pt; line-height: 1.3; }
    .client_logo { max-height: 100%; max-width: 100%; object-fit: contain; margin: 0 auto; display: block; }
    .barcode-cell img { width: 96%; max-height: 12mm; display: block; margin: 0.5mm auto; }

    /* Caixa de impostos: 9 colunas iguais */
    .boxImposto { table-layout: fixed; }
    .boxImposto td { width: 11.11%; }
    .boxImposto .nf-label { font-size: 4.6pt; letter-spacing: 0; }
    .boxImposto .info { text-align: right; }

    .freteConta .quadro { float: right; border: 1px solid #000; width: 5.5mm; height: 5.5mm; text-align: center; line-height: 5.5mm; font-size: 8pt; font-weight: bold; }
    .freteConta p { font-size: 5pt; line-height: 1.3; }

    .boxFatura .dup-list { border: 1px solid #000; padding: 1mm; font-size: 7pt; min-height: 7mm; line-height: 1.5; }

    /* Área de itens: estica pra preencher a folha */
    .items-area { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
    .items-box { flex: 1 1 auto; border: 1px solid #000; border-top: none; overflow: hidden; }
    .items-box table { table-layout: fixed; }
    .items-box th {
        font-size: 5.2pt; font-weight: bold; text-transform: uppercase;
        padding: 0.9mm 0.4mm; text-align: center; vertical-align: middle;
        border: 1px solid #000; border-top: 1px solid #000;
    }
    .items-box td {
        font-size: 7.5pt; line-height: 1.25; padding: 0.7mm 0.8mm;
        border: none; border-left: 1px solid #000; vertical-align: top;
        word-break: break-word;
    }
    .items-box td:first-child { border-left: none; }
    .items-box tbody tr:first-child td { padding-top: 1mm; }
    .item-infad { display: block; font-size: 7pt; margin-top: 0.3mm; }

    /* Rodapé (ISSQN + dados adicionais) */
    .boxDadosAdicionais td { height: 25mm; }
    .boxDadosAdicionais .obs { font-size: 6.5pt; line-height: 1.35; word-break: break-word; }
</style>`;

// ================================================
// TEMPLATES
// ================================================

// Canhoto de recebimento — só na folha 1
const TPL_CANHOTO = `
    <table class="canhoto" cellpadding="0" cellspacing="0">
        <tbody>
            <tr>
                <td colspan="2" class="txt-upper">Recebemos de [emit_xNome] os produtos e serviços constantes na nota fiscal indicada ao lado</td>
                <td rowspan="2" class="tserie">
                    <span class="nfe-title">NF-e</span>
                    <span>Nº [ide_nNF]</span>
                    <span>Série [ide_serie]</span>
                </td>
            </tr>
            <tr>
                <td style="width: 34mm; height: 7mm;"><span class="nf-label">Data de recebimento</span></td>
                <td><span class="nf-label">Identificação e assinatura do recebedor</span></td>
            </tr>
        </tbody>
    </table>
    <hr class="hr-dashed" />
`;

// Cabeçalho do DANFE — repetido em TODAS as folhas (padrão oficial)
const TPL_HEADER = `
    <table cellpadding="0" cellspacing="0" style="table-layout: fixed;">
        <tbody>
            <tr>
                <td rowspan="3" style="width: 74mm; vertical-align: middle;" class="txt-center">
                    <div style="height: 16mm; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 1mm;">[logo_image]</div>
                    <div class="emit-addr">
                        <span class="emit-name">[emit_xNome]</span>
                        <span class="block">[emit_xLgr], [emit_nro]</span>
                        <span class="block">[emit_xBairro] - [emit_CEP]</span>
                        <span class="block">[emit_xMun] - [emit_UF] - Fone: [emit_fone]</span>
                    </div>
                </td>
                <td rowspan="3" class="txt-center" style="width: 36mm; vertical-align: middle;">
                    <span class="danfe-title">DANFE</span>
                    <p class="danfe-sub">Documento Auxiliar da<br/>Nota Fiscal Eletrônica</p>
                    <p class="entradaSaida">
                        <span class="legenda"><span>0 - ENTRADA</span><span>1 - SAÍDA</span></span>
                        <span class="identificacao">[ide_tpNF]</span>
                    </p>
                    <span class="danfe-nf block">Nº [ide_nNF]</span>
                    <span class="danfe-nf block">SÉRIE [ide_serie]</span>
                    <span class="danfe-folha block">FOLHA [current_page] de [total_pages]</span>
                </td>
                <td class="barcode-cell txt-center" style="height: 15mm; vertical-align: middle;">{BarCode}</td>
            </tr>
            <tr>
                <td><span class="nf-label">Chave de acesso</span><span class="chave block txt-center">[chave_acesso]</span></td>
            </tr>
            <tr>
                <td class="txt-center consulta" style="vertical-align: middle;">Consulta de autenticidade no portal nacional da NF-e<br/>www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Natureza da operação</span><span class="info">[ide_natOp]</span></td>
                <td style="width: 90mm;"><span class="nf-label">Protocolo de autorização de uso</span><span class="info">[protocolo]</span></td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Inscrição estadual</span><span class="info">[emit_IE]</span></td>
                <td style="width: 66mm;"><span class="nf-label">Inscrição estadual do subst. trib.</span><span class="info">[emit_IEST]</span></td>
                <td style="width: 62mm;"><span class="nf-label">CNPJ</span><span class="info">[emit_CNPJ]</span></td>
            </tr>
        </tbody>
    </table>
`;

// Destinatário + Fatura + Impostos + Transportadora — só na folha 1
const TPL_DESTINATARIO_BLOCK = `
    <p class="area-name">Destinatário / Remetente</p>
    <table cellpadding="0" cellspacing="0">
        <tbody>
            <tr>
                <td><span class="nf-label">Nome/Razão social</span><span class="info">[dest_xNome]</span></td>
                <td style="width: 38mm;"><span class="nf-label">CNPJ/CPF</span><span class="info">[dest_CNPJ_CPF]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Data de emissão</span><span class="info">[ide_dhEmi_data]</span></td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Endereço</span><span class="info">[dest_xLgr], [dest_nro]</span></td>
                <td style="width: 44mm;"><span class="nf-label">Bairro/Distrito</span><span class="info">[dest_xBairro]</span></td>
                <td style="width: 24mm;"><span class="nf-label">CEP</span><span class="info">[dest_CEP]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Data de entr./saída</span><span class="info">[ide_dhSaiEnt_data]</span></td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Município</span><span class="info">[dest_xMun]</span></td>
                <td style="width: 34mm;"><span class="nf-label">Fone/Fax</span><span class="info">[dest_fone]</span></td>
                <td style="width: 12mm;"><span class="nf-label">UF</span><span class="info">[dest_UF]</span></td>
                <td style="width: 42mm;"><span class="nf-label">Inscrição estadual</span><span class="info">[dest_IE]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Hora entr./saída</span><span class="info">[ide_dhSaiEnt_hora]</span></td>
            </tr>
        </tbody>
    </table>
    <div class="boxFatura"><p class="area-name">Fatura / Duplicatas</p>[duplicatas]</div>
    <p class="area-name">Cálculo do imposto</p>
    <table cellpadding="0" cellspacing="0" class="boxImposto">
        <tbody>
            <tr>
                <td><span class="nf-label">Base de cálc. do ICMS</span><span class="info">[tot_vBC]</span></td>
                <td><span class="nf-label">Valor do ICMS</span><span class="info">[tot_vICMS]</span></td>
                <td><span class="nf-label">Base de cálc. ICMS ST</span><span class="info">[tot_vBCST]</span></td>
                <td><span class="nf-label">Valor do ICMS ST</span><span class="info">[tot_vST]</span></td>
                <td><span class="nf-label">V. imp. importação</span><span class="info">[tot_vII]</span></td>
                <td><span class="nf-label">V. ICMS UF remet.</span><span class="info">[tot_vICMSUFRemet]</span></td>
                <td><span class="nf-label">Valor do FCP</span><span class="info">[tot_vFCP]</span></td>
                <td><span class="nf-label">Valor do PIS</span><span class="info">[tot_vPIS]</span></td>
                <td><span class="nf-label">V. total de produtos</span><span class="info">[tot_vProd]</span></td>
            </tr>
            <tr>
                <td><span class="nf-label">Valor do frete</span><span class="info">[tot_vFrete]</span></td>
                <td><span class="nf-label">Valor do seguro</span><span class="info">[tot_vSeg]</span></td>
                <td><span class="nf-label">Desconto</span><span class="info">[tot_vDesc]</span></td>
                <td><span class="nf-label">Outras despesas</span><span class="info">[tot_vOutro]</span></td>
                <td><span class="nf-label">Valor do IPI</span><span class="info">[tot_vIPI]</span></td>
                <td><span class="nf-label">V. ICMS UF dest.</span><span class="info">[tot_vICMSUFDest]</span></td>
                <td><span class="nf-label">V. aprox. do tributo</span><span class="info">{ApproximateTax}</span></td>
                <td><span class="nf-label">Valor da COFINS</span><span class="info">[tot_vCOFINS]</span></td>
                <td><span class="nf-label">V. total da nota</span><span class="info">[tot_vNF]</span></td>
            </tr>
        </tbody>
    </table>
    <p class="area-name">Transportador / Volumes transportados</p>
    <table cellpadding="0" cellspacing="0">
        <tbody>
            <tr>
                <td><span class="nf-label">Razão social</span><span class="info">[transp_xNome]</span></td>
                <td class="freteConta" style="width: 34mm;"><span class="nf-label">Frete por conta</span><span class="quadro">[transp_modFrete]</span><p>0 - Emitente</p><p>1 - Destinatário</p></td>
                <td style="width: 20mm;"><span class="nf-label">Código ANTT</span><span class="info">[transp_RNTC]</span></td>
                <td style="width: 24mm;"><span class="nf-label">Placa</span><span class="info">[transp_placa]</span></td>
                <td style="width: 12mm;"><span class="nf-label">UF</span><span class="info">[transp_UF]</span></td>
                <td style="width: 32mm;"><span class="nf-label">CNPJ/CPF</span><span class="info">[transp_CNPJ_CPF]</span></td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Endereço</span><span class="info">[transp_xEnder]</span></td>
                <td style="width: 54mm;"><span class="nf-label">Município</span><span class="info">[transp_xMun]</span></td>
                <td style="width: 12mm;"><span class="nf-label">UF</span><span class="info">[transp_UF2]</span></td>
                <td style="width: 42mm;"><span class="nf-label">Inscrição estadual</span><span class="info">[transp_IE]</span></td>
            </tr>
        </tbody>
    </table>
    <table cellpadding="0" cellspacing="0" class="no-top">
        <tbody>
            <tr>
                <td><span class="nf-label">Quantidade</span><span class="info">[vol_qVol]</span></td>
                <td style="width: 34mm;"><span class="nf-label">Espécie</span><span class="info">[vol_esp]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Marca</span><span class="info">[vol_marca]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Numeração</span><span class="info">[vol_nVol]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Peso bruto</span><span class="info txt-right">[vol_pesoB]</span></td>
                <td style="width: 30mm;"><span class="nf-label">Peso líquido</span><span class="info txt-right">[vol_pesoL]</span></td>
            </tr>
        </tbody>
    </table>
`;

// Cabeçalho da tabela de itens (colunas fixas; soma = 100%)
const TPL_ITEMS_TABLE_START = `
    <div class="items-area">
        <p class="area-name">Dados do produto / serviço[continuacao]</p>
        <div class="items-box">
            <table cellpadding="0" cellspacing="0">
                <thead>
                    <tr>
                        <th style="width: 7.2%;">Código</th>
                        <th style="width: 27.6%;">Descrição do produto/serviço</th>
                        <th style="width: 7.6%;">NCM/SH</th>
                        <th style="width: 3.4%;">CST</th>
                        <th style="width: 4.2%;">CFOP</th>
                        <th style="width: 3.6%;">UN</th>
                        <th style="width: 6%;">Qtd.</th>
                        <th style="width: 6.8%;">Vlr. unit.</th>
                        <th style="width: 6.8%;">Vlr. total</th>
                        <th style="width: 6.6%;">BC ICMS</th>
                        <th style="width: 6.2%;">Vlr. ICMS</th>
                        <th style="width: 5.2%;">Vlr. IPI</th>
                        <th style="width: 4.6%;">% ICMS</th>
                        <th style="width: 4.2%;">% IPI</th>
                    </tr>
                </thead>
                <tbody>
`;

const TPL_ITEMS_TABLE_END = `
                </tbody>
            </table>
        </div>
    </div>
`;

// Rodapé — ISSQN + Dados adicionais (em todas as folhas, fecha o layout)
const TPL_FOOTER_BLOCK = `
    <p class="area-name">Cálculo do ISSQN</p>
    <table cellpadding="0" cellspacing="0">
        <tbody>
            <tr>
                <td><span class="nf-label">Inscrição municipal</span><span class="info">[emit_IM]</span></td>
                <td><span class="nf-label">Valor total dos serviços</span><span class="info txt-right">[issqn_vServ]</span></td>
                <td><span class="nf-label">Base de cálculo do ISSQN</span><span class="info txt-right">[issqn_vBC]</span></td>
                <td><span class="nf-label">Valor do ISSQN</span><span class="info txt-right">[issqn_vISSQN]</span></td>
            </tr>
        </tbody>
    </table>
    <p class="area-name">Dados adicionais</p>
    <table cellpadding="0" cellspacing="0" class="boxDadosAdicionais">
        <tbody>
            <tr>
                <td><span class="nf-label">Informações complementares</span><span class="obs">[infCpl]</span></td>
                <td style="width: 80mm;"><span class="nf-label">Reservado ao fisco</span></td>
            </tr>
        </tbody>
    </table>
`;


// ================================================
// LÓGICA DE PAGINAÇÃO E PARSE
// ================================================

function fillTemplate(template, replacements) {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.split(key).join(value);
    }
    return result;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function processXmlToHtml(xmlString, logoBase64) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseTagValue: false,
        isArray: (name) => ["det", "dup", "vol"].includes(name),
    });

    const parsed = parser.parse(xmlString);
    let nfeProc = parsed.nfeProc || parsed;

    const NFe = nfeProc.NFe || nfeProc;
    const infNFe = NFe.infNFe || {};
    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const total = infNFe.total || {};
    const transp = infNFe.transp || {};
    const cobr = infNFe.cobr || {};
    const infAdic = infNFe.infAdic || {};
    const dets = infNFe.det || [];
    const protNFe = nfeProc.protNFe || {};
    const infProt = protNFe.infProt || {};

    const enderEmit = emit.enderEmit || {};
    const enderDest = dest.enderDest || {};
    const transporta = transp.transporta || {};
    const veicTransp = transp.veicTransp || {};
    const vol = transp.vol || [];
    const firstVol = Array.isArray(vol) ? vol[0] || {} : vol || {};

    const ICMSTot = total.ICMSTot || {};
    const ISSQNtot = total.ISSQNtot || {};

    const dup = cobr.dup || [];
    const duplicatas = Array.isArray(dup) ? dup : dup ? [dup] : [];
    const items = Array.isArray(dets) ? dets : dets ? [dets] : [];

    // Lógica da Logo
    let logoHtml = "";
    if (logoBase64) {
        let mimeType = "image/png";
        if (logoBase64.startsWith("/9j/")) mimeType = "image/jpeg";
        logoHtml = '<img class="client_logo" src="data:' + mimeType + ';base64,' + logoBase64 + '" alt="Logo" />';
    }

    const chave = infProt.chNFe || infNFe["@_Id"]?.replace("NFe", "") || "";
    const chaveFormatada = formatChaveNFe(chave);

    const nProt = infProt.nProt || "";
    const dhRecbto = infProt.dhRecbto || "";
    const protocoloFormatado = nProt ? nProt + " - " + formatDate(dhRecbto) + " " + formatTime(dhRecbto) : "";

    // 1. Dados comuns (Replacements Base)
    const baseReplacements = {
        "[logo_image]": logoHtml,
        "[emit_xNome]": escapeHtml(emit.xNome || emit.xFant || ""),
        "[emit_xLgr]": escapeHtml(enderEmit.xLgr || ""),
        "[emit_nro]": escapeHtml(enderEmit.nro || ""),
        "[emit_xBairro]": escapeHtml(enderEmit.xBairro || ""),
        "[emit_CEP]": formatCep(enderEmit.CEP),
        "[emit_xMun]": escapeHtml(enderEmit.xMun || ""),
        "[emit_UF]": enderEmit.UF || "",
        "[emit_fone]": formatPhone(enderEmit.fone),
        "[emit_IE]": emit.IE || "",
        "[emit_IEST]": emit.IEST || "",
        "[emit_IM]": emit.IM || "",
        "[emit_CNPJ]": formatCnpjCpf(emit.CNPJ || emit.CPF),
        "[ide_nNF]": ide.nNF || "",
        "[ide_serie]": ide.serie || "",
        "[ide_tpNF]": ide.tpNF || "",
        "[ide_natOp]": escapeHtml(ide.natOp || ""),
        "[chave_acesso]": chaveFormatada,
        "[protocolo]": protocoloFormatado,
        "{BarCode}": await generateBarcode(chave), // Async generation
        "[ide_dhEmi_data]": formatDate(ide.dhEmi),
        "[ide_dhSaiEnt_data]": formatDate(ide.dhSaiEnt || ide.dhEmi),
        "[ide_dhSaiEnt_hora]": formatTime(ide.dhSaiEnt || ide.dhEmi),
        "[dest_xNome]": escapeHtml(dest.xNome || ""),
        "[dest_CNPJ_CPF]": formatCnpjCpf(dest.CNPJ || dest.CPF),
        "[dest_xLgr]": escapeHtml(enderDest.xLgr || ""),
        "[dest_nro]": escapeHtml(enderDest.nro || ""),
        "[dest_xBairro]": escapeHtml(enderDest.xBairro || ""),
        "[dest_CEP]": formatCep(enderDest.CEP),
        "[dest_xMun]": escapeHtml(enderDest.xMun || ""),
        "[dest_UF]": enderDest.UF || "",
        "[dest_fone]": formatPhone(enderDest.fone),
        "[dest_IE]": dest.IE || "",
        "[tot_vBC]": formatCurrency(ICMSTot.vBC),
        "[tot_vICMS]": formatCurrency(ICMSTot.vICMS),
        "[tot_vBCST]": formatCurrency(ICMSTot.vBCST),
        "[tot_vST]": formatCurrency(ICMSTot.vST),
        "[tot_vII]": formatCurrency(ICMSTot.vII),
        "[tot_vICMSUFRemet]": formatCurrency(ICMSTot.vICMSUFRemet),
        "[tot_vFCP]": formatCurrency(ICMSTot.vFCP),
        "[tot_vPIS]": formatCurrency(ICMSTot.vPIS),
        "[tot_vProd]": formatCurrency(ICMSTot.vProd),
        "[tot_vFrete]": formatCurrency(ICMSTot.vFrete),
        "[tot_vSeg]": formatCurrency(ICMSTot.vSeg),
        "[tot_vDesc]": formatCurrency(ICMSTot.vDesc),
        "[tot_vOutro]": formatCurrency(ICMSTot.vOutro),
        "[tot_vIPI]": formatCurrency(ICMSTot.vIPI),
        "[tot_vICMSUFDest]": formatCurrency(ICMSTot.vICMSUFDest),
        "{ApproximateTax}": formatCurrency(ICMSTot.vTotTrib),
        "[tot_vCOFINS]": formatCurrency(ICMSTot.vCOFINS),
        "[tot_vNF]": formatCurrency(ICMSTot.vNF),
        "[issqn_vServ]": formatCurrency(ISSQNtot.vServ),
        "[issqn_vBC]": formatCurrency(ISSQNtot.vBC),
        "[issqn_vISSQN]": formatCurrency(ISSQNtot.vISS),
        "[transp_xNome]": escapeHtml(transporta.xNome || ""),
        "[transp_modFrete]": transp.modFrete || "",
        "[transp_RNTC]": veicTransp.RNTC || "",
        "[transp_placa]": veicTransp.placa || "",
        "[transp_UF]": veicTransp.UF || "",
        "[transp_CNPJ_CPF]": formatCnpjCpf(transporta.CNPJ || transporta.CPF),
        "[transp_xEnder]": escapeHtml(transporta.xEnder || ""),
        "[transp_xMun]": escapeHtml(transporta.xMun || ""),
        "[transp_UF2]": transporta.UF || "",
        "[transp_IE]": transporta.IE || "",
        "[vol_qVol]": firstVol.qVol || "",
        "[vol_esp]": escapeHtml(firstVol.esp || ""),
        "[vol_marca]": escapeHtml(firstVol.marca || ""),
        "[vol_nVol]": firstVol.nVol || "",
        "[vol_pesoB]": formatWeight(firstVol.pesoB),
        "[vol_pesoL]": formatWeight(firstVol.pesoL),
        "[infCpl]": escapeHtml(infAdic.infCpl || ""),
    };

    // Montar Duplicatas — texto corrido dentro da caixa
    let duplicatesHtml = "";
    if (duplicatas.length > 0) {
        let dupTexts = [];
        for (const d of duplicatas) {
            dupTexts.push(`<b>${d.nDup || ""}</b> ${formatDate(d.dVenc)} R$ ${formatCurrency(d.vDup)}`);
        }
        duplicatesHtml = '<div class="dup-list">' + dupTexts.join(" &nbsp;•&nbsp; ") + "</div>";
    } else {
        duplicatesHtml = '<div class="dup-list"></div>';
    }
    baseReplacements["[duplicatas]"] = duplicatesHtml;


    // 2. Paginação por ALTURA (mm), conservadora.
    // Cada página tem um orçamento em mm pra área de itens; cada item custa
    // uma base + extra por linha de descrição (coluna ~62mm, fonte 7.5pt).
    const CHARS_PER_LINE = 34;      // conservador: sobra espaço, nunca corta
    const ROW_BASE_MM = 4.8;        // 1ª linha do item (com paddings)
    const ROW_LINE_MM = 3.0;        // cada linha extra de descrição
    const PAGE1_BUDGET_MM = 82;     // folha 1 (canhoto + cabeçalho + destinatário...)
    const PAGEN_BUDGET_MM = 164;    // folhas 2+ (cabeçalho + rodapé apenas)

    let pages = [];
    let currentPage = { items: [], isFirst: true, usedMm: 0 };

    for (let i = 0; i < items.length; i++) {
        let item = items[i];

        let descLen = (item.prod && item.prod.xProd) ? String(item.prod.xProd).length : 0;
        let descLines = Math.max(1, Math.ceil(descLen / CHARS_PER_LINE));
        if (item.infAdProd && String(item.infAdProd).trim()) descLines += 1; // linha da cor/variação
        let itemCostMm = ROW_BASE_MM + (descLines - 1) * ROW_LINE_MM;

        let budget = currentPage.isFirst ? PAGE1_BUDGET_MM : PAGEN_BUDGET_MM;

        if (currentPage.usedMm + itemCostMm > budget && currentPage.items.length > 0) {
            pages.push(currentPage);
            currentPage = { items: [], isFirst: false, usedMm: 0 };
        }

        currentPage.items.push(item);
        currentPage.usedMm += itemCostMm;
    }

    // Garante ao menos 1 página (mesmo sem itens) e fecha a última
    if (currentPage.items.length > 0 || pages.length === 0) {
        pages.push(currentPage);
    }

    let totalPages = pages.length;
    let finalHtmlBody = "";

    // 3. Montagem das Páginas
    pages.forEach((page, index) => {
        let pageNum = index + 1;

        let pageReplacements = {
            ...baseReplacements,
            "[current_page]": pageNum,
            "[total_pages]": totalPages,
            "[continuacao]": page.isFirst ? "" : " — continuação",
        };

        let pageHtml = '<div class="page">';

        if (page.isFirst) pageHtml += fillTemplate(TPL_CANHOTO, pageReplacements);
        pageHtml += fillTemplate(TPL_HEADER, pageReplacements);
        if (page.isFirst) pageHtml += fillTemplate(TPL_DESTINATARIO_BLOCK, pageReplacements);

        pageHtml += fillTemplate(TPL_ITEMS_TABLE_START, pageReplacements);

        for (let det of page.items) {
            const prod = det.prod || {};
            const imposto = det.imposto || {};
            const icmsData = extractICMSData(imposto);
            const ipiData = extractIPIData(imposto);

            // Descrição = xProd + infAdProd (cor/variação, ex.: "CARVALHO/TITANIO"),
            // igual o DANFE oficial: a info adicional do item entra no fim da descrição.
            const infAd = det.infAdProd ? String(det.infAdProd).trim() : "";
            const descCell = escapeHtml(prod.xProd || "") +
                (infAd ? '<span class="item-infad">' + escapeHtml(infAd) + '</span>' : "");

            pageHtml += '<tr>' +
                '<td class="txt-center">' + escapeHtml(prod.cProd || "") + '</td>' +
                '<td>' + descCell + '</td>' +
                '<td class="txt-center">' + (prod.NCM || "") + '</td>' +
                '<td class="txt-center">' + icmsData.CST + '</td>' +
                '<td class="txt-center">' + (prod.CFOP || "") + '</td>' +
                '<td class="txt-center">' + escapeHtml(prod.uCom || "") + '</td>' +
                '<td class="txt-right">' + formatQuantity(prod.qCom) + '</td>' +
                '<td class="txt-right">' + formatCurrency(prod.vUnCom) + '</td>' +
                '<td class="txt-right">' + formatCurrency(prod.vProd) + '</td>' +
                '<td class="txt-right">' + formatCurrency(icmsData.vBC) + '</td>' +
                '<td class="txt-right">' + formatCurrency(icmsData.vICMS) + '</td>' +
                '<td class="txt-right">' + formatCurrency(ipiData.vIPI) + '</td>' +
                '<td class="txt-right">' + (icmsData.pICMS ? formatCurrency(icmsData.pICMS) : "") + '</td>' +
                '<td class="txt-right">' + (ipiData.pIPI ? formatCurrency(ipiData.pIPI) : "") + '</td>' +
                '</tr>';
        }

        pageHtml += TPL_ITEMS_TABLE_END;
        pageHtml += fillTemplate(TPL_FOOTER_BLOCK, pageReplacements);
        pageHtml += "</div>";

        finalHtmlBody += pageHtml;
    });

    const fullHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>DANFE - NF-e ${ide.nNF || ""}</title>${PAGE_CSS}</head><body>${finalHtmlBody}</body></html>`;

    const meta = {
        nNF: String(ide.nNF || ""),
        serie: String(ide.serie || ""),
        chave: chave,
        emitente: emit.xNome || emit.xFant || "",
        destinatario: dest.xNome || "",
    };

    return { html: fullHtml, meta };
}

// ================================================
// FUNÇÕES AUXILIARES
// ================================================

function formatCurrency(value) {
    if (!value && value !== 0) return "0,00";
    const num = parseFloat(value);
    if (isNaN(num)) return "0,00";
    return num.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatQuantity(value) {
    if (!value) return "0,0000";
    const num = parseFloat(value);
    if (isNaN(num)) return "0,0000";
    return num.toLocaleString("pt-BR", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    });
}

function formatWeight(value) {
    if (!value) return "0,000";
    const num = parseFloat(value);
    if (isNaN(num)) return "0,000";
    return num.toLocaleString("pt-BR", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
    });
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    // Se vier YYYY-MM-DD
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        const [datePart] = dateStr.split("T");
        const [year, month, day] = datePart.split("-");
        return `${day}/${month}/${year}`;
    }
    return dateStr;
}

function formatTime(dateStr) {
    if (!dateStr || !dateStr.includes("T")) return "";
    const [_, timePart] = dateStr.split("T");
    const [hours, minutes, seconds] = timePart.split(":");
    return `${hours}:${minutes}:${seconds.split("-")[0]}`; // Remove fuso
}

function formatCnpjCpf(value) {
    if (!value) return "";
    const clean = value.replace(/\D/g, "");
    if (clean.length === 11) {
        return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    if (clean.length === 14) {
        return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    }
    return value;
}

function formatCep(value) {
    if (!value) return "";
    const clean = value.replace(/\D/g, "");
    return clean.replace(/(\d{5})(\d{3})/, "$1-$2");
}

function formatPhone(value) {
    if (!value) return "";
    const clean = String(value).replace(/\D/g, "");
    if (clean.length === 11) return clean.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    if (clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    return value;
}

function formatChaveNFe(value) {
    if (!value) return "";
    const clean = value.replace(/\D/g, "");
    return clean.replace(/(\d{4})/g, "$1 ").trim();
}

function extractICMSData(imposto) {
    const ICMS = imposto.ICMS || {};
    // Pega o primeiro filho (ICMS00, ICMS20, etc)
    const icmsValue: any = Object.values(ICMS)[0] || {};

    return {
        CST: icmsValue.CST || icmsValue.CSOSN || "",
        vBC: icmsValue.vBC || "0.00",
        pICMS: icmsValue.pICMS || "",
        vICMS: icmsValue.vICMS || "0.00"
    };
}

function extractIPIData(imposto) {
    const IPI = imposto.IPI || {};
    const IPITrib = IPI.IPITrib || {};

    return {
        vIPI: IPITrib.vIPI || "0.00",
        pIPI: IPITrib.pIPI || ""
    };
}

async function generateBarcode(text) {
    if (!text) return "";
    try {
        const png = await bwipjs.toBuffer({
            bcid: 'code128',       // Barcode type
            text: text,            // Text to encode
            scale: 3,              // 3x scaling factor
            height: 10,            // Bar height, in millimeters
            includetext: false,    // Show human-readable text
            textxalign: 'center',  // Always good to set this
        });
        return '<img style="width: 96%; max-height: 12mm;" src="data:image/png;base64,' + png.toString('base64') + '" />';
    } catch (e) {
        console.error("Erro ao gerar barcode:", e);
        return ""; // Fallback sem barcode
    }
}

export { processXmlToHtml };
