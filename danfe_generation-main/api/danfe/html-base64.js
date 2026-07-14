const { XMLParser } = require("fast-xml-parser");
const bwipjs = require("bwip-js");

// Namespace NFe 4.00
const NFE_NS = "http://www.portalfiscal.inf.br/nfe";

// Template HTML DANFE - baseado no modelo do usuário
const PAGE_CSS = `
<style type="text/css">
    @media print {
        @page { margin: 2mm; }
        footer { page-break-after: always; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    * { margin: 0; }
    .ui-widget-content { border: none !important; }
    .nfeArea.page { 
        width: 198mm; 
        /* Sem min-height para evitar alinhamento vertical indesejado */
        position: relative; 
        font-family: "Times New Roman", serif; 
        color: #000; 
        margin: 0 auto; 
        display: block !important; /* Força comportamento de bloco */
        page-break-inside: avoid;
        page-break-before: always;
        overflow: hidden;
    }
    .nfeArea.page:first-of-type {
        page-break-before: auto;
    }
    .nfeArea.page:last-child { 
        page-break-after: auto; 
    }
    .nfeArea .font-12 { font-size: 12pt; }
    .nfeArea .font-8 { font-size: 8pt; }
    .nfeArea .bold { font-weight: bold; }
    .nfeArea .area-name { font-family: "Times New Roman", serif; color: #000; font-weight: bold; margin: 5px 0 0; font-size: 6pt; text-transform: uppercase; }
    .nfeArea .txt-upper { text-transform: uppercase; }
    .nfeArea .txt-center { text-align: center; }
    .nfeArea .txt-right { text-align: right; }
    .nfeArea .nf-label { text-transform: uppercase; margin-bottom: 3px; display: block; }
    .nfeArea .nf-label.label-small { letter-spacing: -0.5px; font-size: 4pt; }
    .nfeArea .info { font-weight: bold; font-size: 8pt; display: block; line-height: 1em; }
    .nfeArea table { font-family: "Times New Roman", serif; color: #000; font-size: 5pt; border-collapse: collapse; width: 100%; border-color: #000; }
    .nfeArea .no-top { margin-top: -1px; }
    .nfeArea .valign-middle { vertical-align: middle; }
    .nfeArea td { vertical-align: top; box-sizing: border-box; overflow: hidden; border-color: #000; padding: 1px; height: 5mm; }
    .nfeArea .tserie { width: 32.2mm; vertical-align: middle; font-size: 8pt; font-weight: bold; }
    .nfeArea .tserie span { display: block; }
    .nfeArea .entradaSaida .legenda { text-align: left; margin-left: 2mm; display: block; }
    .nfeArea .entradaSaida .legenda span { display: block; }
    .nfeArea .entradaSaida .identificacao { float: right; margin-right: 2mm; border: 1px solid black; width: 5mm; height: 5mm; text-align: center; line-height: 5mm; }
    .nfeArea .hr-dashed { border: none; border-top: 1px dashed #444; margin: 5px 0; }
    .nfeArea .client_logo { max-height: 100%; max-width: 100%; object-fit: contain; margin: 0 auto; display: block; }
    .nfeArea .title { font-size: 10pt; margin-bottom: 2mm; }
    .nfeArea .txtc { text-align: center; }
    .nfeArea .pd-0 { padding: 0; }
    .nfeArea .mb2 { margin-bottom: 2mm; }
    .nfeArea table table { margin: -1pt; width: 100.5%; }
    .nfeArea .wrapper-table { margin-bottom: 2pt; }
    .nfeArea .boxImposto { table-layout: fixed; }
    .nfeArea .boxImposto td { width: 11.11%; }
    .nfeArea .boxImposto .nf-label { font-size: 5pt; }
    .nfeArea .boxImposto .info { text-align: right; }
    .nfeArea .no-border { border: none !important; }
    .nfeArea .wrapper-border { border: 1px solid #000; border-width: 0 1px 1px; min-height: 90mm; }
    .nfeArea .wrapper-border.full-page { min-height: auto; }
    .nfeArea .wrapper-border table { margin: 0 -1px; width: 100.4%; }
    .nfeArea .content-spacer { display: block; height: 10px; }
    .nfeArea .titles th { padding: 3px 0; }
    .nfeArea .listProdutoServico td { padding: 0; }
    .nfeArea .codigo { display: block; text-align: center; margin-top: 5px; }
    .nfeArea .boxProdutoServico tr td:first-child { border-left: none; }
    .nfeArea .boxProdutoServico td { font-size: 8pt; height: auto; }
    .nfeArea .boxFatura span { display: block; }
    .nfeArea .boxFatura td { border: 1px solid #000; }
    .nfeArea .freteConta .border { width: 5mm; height: 5mm; float: right; text-align: center; line-height: 5mm; border: 1px solid black; }
    .nfeArea .freteConta .info { line-height: 5mm; }
    .page .boxFields td p { font-family: "Times New Roman", serif; font-size: 5pt; line-height: 1.2em; color: #000; }
    .page .boxFields td.txtc.txt-upper p { font-size: 7pt; }
    .nfeArea .block { display: block; }
    .barcode-container { display: flex; justify-content: center; align-items: center; height: 100%; width: 100%; padding: 2px; box-sizing: border-box; }
    .barcode { display: flex; height: 13mm; overflow: hidden; }
    .barcode .bar { background-color: #000 !important; height: 100%; display: inline-block; }
    .barcode .space { background-color: transparent; height: 100%; display: inline-block; }
</style>`;

// -- PARTES DO TEMPLATE PARA PAGINAÇÃO --

const TPL_HEADER_REPEATED = `
    <div class="boxFields" style="padding-top: 5px;">
        <table cellpadding="0" cellspacing="0" border="1">
            <tbody>
                <tr>
                    <td colspan="2" class="txt-upper">Recebemos de [emit_xNome] os produtos e serviços constantes na nota fiscal indicada ao lado</td>
                    <td rowspan="2" class="tserie txt-center">
                        <span class="font-12" style="margin-bottom: 5px;">NF-e</span>
                        <span>Nº [ide_nNF]</span>
                        <span>Série [ide_serie]</span>
                    </td>
                </tr>
                <tr>
                    <td style="width: 32mm"><span class="nf-label">Data de recebimento</span></td>
                    <td style="width: 124.6mm"><span class="nf-label">Identificação de assinatura do Recebedor</span></td>
                </tr>
            </tbody>
        </table>
        <hr class="hr-dashed" />
        <table cellpadding="0" cellspacing="0" border="1" style="table-layout: fixed; width: 100%;">
            <tbody>
                <tr>
                    <td rowspan="3" style="width: 76mm; font-size: 7pt; vertical-align: top;" class="txt-center">
                        <div style="height: 18mm; width: 76mm; display: flex; align-items: center; justify-content: center; overflow: hidden; margin: 0 auto 1mm auto;">[logo_image]</div>
                        <div style="font-size: 7pt;">
                            <span class="mb2 bold block" style="font-size: 8pt;">[emit_xNome]</span>
                            <span class="block">[emit_xLgr], [emit_nro]</span>
                            <span class="block">[emit_xBairro] - [emit_CEP]</span>
                            <span class="block">[emit_xMun] - [emit_UF] - Fone: [emit_fone]</span>
                        </div>
                    </td>
                    <td rowspan="3" class="txtc txt-upper" style="width: 34mm; height: 29.5mm; font-size: 7pt;">
                        <h3 class="title">Danfe</h3>
                        <p class="mb2">Documento auxiliar da Nota Fiscal Eletrônica </p>
                        <p class="entradaSaida mb2">
                            <span class="identificacao"><span>[ide_tpNF]</span></span>
                            <span class="legenda"><span>0 - Entrada</span><span>1 - Saída</span></span>
                        </p>
                        <p>
                            <span class="block bold"><span>Nº</span> <span>[ide_nNF]</span></span>
                            <span class="block bold"><span>SÉRIE:</span> <span>[ide_serie]</span></span>
                            <span class="block"><span>Página [current_page] de [total_pages]</span></span>
                        </p>
                    </td>
                    <td class="txt-upper" style="height: auto;">
                        <span class="nf-label">Controle do Fisco</span>
                        <div class="codigo"><span style='font-size:7pt'>{BarCode}</span></div>
                    </td>
                </tr>
                <tr>
                    <td style="height: auto;"><span class="nf-label">CHAVE DE ACESSO</span><span class="bold block txt-center info">[chave_acesso]</span></td>
                </tr>
                <tr>
                    <td class="txt-center valign-middle" style="height: auto;"><span class="block">Consulta de autenticidade no portal nacional da NF-e </span> www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizada.</td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="boxNaturezaOperacao no-top" border="1">
            <tbody>
                <tr>
                    <td><span class="nf-label">NATUREZA DA OPERAÇÃO</span><span class="info">[ide_natOp]</span></td>
                    <td><span class="nf-label">PROTOCOLO DE AUTORIZAÇÃO DE USO</span><span class="info">[protocolo]</span></td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="boxInscricao no-top" border="1">
            <tbody>
                <tr>
                    <td><span class="nf-label">INSCRIÇÃO ESTADUAL</span><span class="info">[emit_IE]</span></td>
                    <td style="width: 67.5mm;"><span class="nf-label">INSCRIÇÃO ESTADUAL DO SUBST. TRIB.</span><span class="info">[emit_IEST]</span></td>
                    <td style="width: 64.3mm"><span class="nf-label">CNPJ</span><span class="info">[emit_CNPJ]</span></td>
                </tr>
            </tbody>
        </table>
`;

// Header simplificado para páginas 2+ (SEM CANHOTO)
const TPL_HEADER_SIMPLE = `
    <div class="boxFields" style="padding-top: 5px;">
        <table cellpadding="0" cellspacing="0" border="1" style="table-layout: fixed; width: 100%;">
            <tbody>
                <tr>
                    <td rowspan="3" style="width: 76mm; font-size: 7pt; vertical-align: top;" class="txt-center">
                        <div style="height: 18mm; width: 76mm; display: flex; align-items: center; justify-content: center; overflow: hidden; margin: 0 auto 1mm auto;">[logo_image]</div>
                        <div style="font-size: 7pt;">
                            <span class="mb2 bold block" style="font-size: 8pt;">[emit_xNome]</span>
                            <span class="block">[emit_xLgr], [emit_nro]</span>
                            <span class="block">[emit_xBairro] - [emit_CEP]</span>
                            <span class="block">[emit_xMun] - [emit_UF] - Fone: [emit_fone]</span>
                        </div>
                    </td>
                    <td rowspan="3" class="txtc txt-upper" style="width: 34mm; height: 29.5mm; font-size: 7pt;">
                        <h3 class="title">Danfe</h3>
                        <p class="mb2">Documento auxiliar da Nota Fiscal Eletrônica </p>
                        <p class="entradaSaida mb2">
                            <span class="identificacao"><span>[ide_tpNF]</span></span>
                            <span class="legenda"><span>0 - Entrada</span><span>1 - Saída</span></span>
                        </p>
                        <p>
                            <span class="block bold"><span>Nº</span> <span>[ide_nNF]</span></span>
                            <span class="block bold"><span>SÉRIE:</span> <span>[ide_serie]</span></span>
                            <span class="block"><span>Página [current_page] de [total_pages]</span></span>
                        </p>
                    </td>
                    <td class="txt-upper">
                        <span class="nf-label">Controle do Fisco</span>
                        <span class="codigo"><span style='font-size:7pt'>{BarCode}</span></span>
                    </td>
                </tr>
                <tr>
                    <td><span class="nf-label">CHAVE DE ACESSO</span><span class="bold block txt-center info">[chave_acesso]</span></td>
                </tr>
                <tr>
                    <td class="txt-center valign-middle"><span class="block">Consulta de autenticidade no portal nacional da NF-e </span> www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizada.</td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="boxNaturezaOperacao no-top" border="1">
            <tbody>
                <tr>
                    <td><span class="nf-label">NATUREZA DA OPERAÇÃO</span><span class="info">[ide_natOp]</span></td>
                    <td><span class="nf-label">PROTOCOLO DE AUTORIZAÇÃO DE USO</span><span class="info">[protocolo]</span></td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="boxInscricao no-top" border="1">
            <tbody>
                <tr>
                    <td><span class="nf-label">INSCRIÇÃO ESTADUAL</span><span class="info">[emit_IE]</span></td>
                    <td style="width: 67.5mm;"><span class="nf-label">INSCRIÇÃO ESTADUAL DO SUBST. TRIB.</span><span class="info">[emit_IEST]</span></td>
                    <td style="width: 64.3mm"><span class="nf-label">CNPJ</span><span class="info">[emit_CNPJ]</span></td>
                </tr>
            </tbody>
        </table>
`;

const TPL_DESTINATARIO_BLOCK = `
        <p class="area-name">Destinatário/Emitente</p>
        <table cellpadding="0" cellspacing="0" class="boxDestinatario" border="1">
            <tbody>
                <tr>
                    <td class="pd-0 no-border">
                        <table cellpadding="0" cellspacing="0" border="1">
                            <tbody><tr><td class="no-border"><span class="nf-label">NOME/RAZÃO SOCIAL</span><span class="info">[dest_xNome]</span></td><td style="width: 40mm; border-left: 1px solid black;" class="no-border"><span class="nf-label">CNPJ/CPF</span><span class="info">[dest_CNPJ_CPF]</span></td></tr></tbody>
                        </table>
                    </td>
                    <td><span class="nf-label">DATA DE EMISSÃO</span><span class="info">[ide_dhEmi_data]</span></td>
                </tr>
                <tr>
                    <td class="pd-0 no-border">
                        <table cellpadding="0" cellspacing="0" border="1">
                            <tbody><tr><td><span class="nf-label">ENDEREÇO</span><span class="info">[dest_xLgr], [dest_nro]</span></td><td style="width: 47mm;"><span class="nf-label">BAIRRO/DISTRITO</span><span class="info">[dest_xBairro]</span></td><td style="width: 37.2 mm"><span class="nf-label">CEP</span><span class="info">[dest_CEP]</span></td></tr></tbody>
                        </table>
                    </td>
                    <td><span class="nf-label">DATA DE ENTR./SAÍDA</span><span class="info">[ide_dhSaiEnt_data]</span></td>
                </tr>
                <tr>
                    <td class="pd-0 no-border">
                        <table cellpadding="0" cellspacing="0" style="margin-bottom: -1px;" border="1">
                            <tbody><tr><td><span class="nf-label">MUNICÍPIO</span><span class="info">[dest_xMun]</span></td><td style="width: 34mm"><span class="nf-label">FONE/FAX</span><span class="info">[dest_fone]</span></td><td style="width: 28mm"><span class="nf-label">UF</span><span class="info">[dest_UF]</span></td><td style="width: 51mm"><span class="nf-label">INSCRIÇÃO ESTADUAL</span><span class="info">[dest_IE]</span></td></tr></tbody>
                        </table>
                    </td>
                    <td><span class="nf-label">HORA ENTR./SAÍDA</span><span class="info">[ide_dhSaiEnt_hora]</span></td>
                </tr>
            </tbody>
        </table>
        <div class="boxFatura"><p class="area-name">Fatura</p>[duplicatas]</div>
        <p class="area-name">Calculo do imposto</p>
        <div class="wrapper-table">
            <table cellpadding="0" cellspacing="0" border="1" class="boxImposto">
                <tbody>
                    <tr>
                        <td><span class="nf-label label-small">BASE DE CÁLC. DO ICMS</span><span class="info">[tot_vBC]</span></td>
                        <td><span class="nf-label">VALOR DO ICMS</span><span class="info">[tot_vICMS]</span></td>
                        <td><span class="nf-label label-small" style="font-size: 4pt;">BASE DE CÁLC. DO ICMS ST</span><span class="info">[tot_vBCST]</span></td>
                        <td><span class="nf-label">VALOR DO ICMS ST</span><span class="info">[tot_vST]</span></td>
                        <td><span class="nf-label label-small">V. IMP. IMPORTAÇÃO</span><span class="info">[tot_vII]</span></td>
                        <td><span class="nf-label label-small">V. ICMS UF REMET.</span><span class="info">[tot_vICMSUFRemet]</span></td>
                        <td><span class="nf-label">VALOR DO FCP</span><span class="info">[tot_vFCP]</span></td>
                        <td><span class="nf-label">VALOR DO PIS</span><span class="info">[tot_vPIS]</span></td>
                        <td><span class="nf-label label-small">V. TOTAL DE PRODUTOS</span><span class="info">[tot_vProd]</span></td>
                    </tr>
                    <tr>
                        <td><span class="nf-label">VALOR DO FRETE</span><span class="info">[tot_vFrete]</span></td>
                        <td><span class="nf-label">VALOR DO SEGURO</span><span class="info">[tot_vSeg]</span></td>
                        <td><span class="nf-label">DESCONTO</span><span class="info">[tot_vDesc]</span></td>
                        <td><span class="nf-label">OUTRAS DESP.</span><span class="info">[tot_vOutro]</span></td>
                        <td><span class="nf-label">VALOR DO IPI</span><span class="info">[tot_vIPI]</span></td>
                        <td><span class="nf-label">V. ICMS UF DEST.</span><span class="info">[tot_vICMSUFDest]</span></td>
                        <td><span class="nf-label label-small">V. APROX. DO TRIBUTO</span><span class="info">{ApproximateTax}</span></td>
                        <td><span class="nf-label label-small">VALOR DA COFINS</span><span class="info">[tot_vCOFINS]</span></td>
                        <td><span class="nf-label label-small">V. TOTAL DA NOTA</span><span class="info">[tot_vNF]</span></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="area-name">Transportador/volumes transportados</p>
        <table cellpadding="0" cellspacing="0" border="1">
            <tbody>
                <tr>
                    <td><span class="nf-label">RAZÃO SOCIAL</span><span class="info">[transp_xNome]</span></td>
                    <td class="freteConta" style="width: 32mm"><span class="nf-label">FRETE POR CONTA</span><div class="border"><span class="info">[transp_modFrete]</span></div><p>0 - Emitente</p><p>1 - Destinatário</p></td>
                    <td style="width: 17.3mm"><span class="nf-label">CÓDIGO ANTT</span><span class="info">[transp_RNTC]</span></td>
                    <td style="width: 24.5mm"><span class="nf-label">PLACA</span><span class="info">[transp_placa]</span></td>
                    <td style="width: 11.3mm"><span class="nf-label">UF</span><span class="info">[transp_UF]</span></td>
                    <td style="width: 29.5mm"><span class="nf-label">CNPJ/CPF</span><span class="info">[transp_CNPJ_CPF]</span></td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" border="1" class="no-top">
            <tbody>
                <tr>
                    <td class="field endereco"><span class="nf-label">ENDEREÇO</span><span class="content-spacer info">[transp_xEnder]</span></td>
                    <td style="width: 32mm"><span class="nf-label">MUNICÍPIO</span><span class="info">[transp_xMun]</span></td>
                    <td style="width: 31mm"><span class="nf-label">UF</span><span class="info">[transp_UF2]</span></td>
                    <td style="width: 51.4mm"><span class="nf-label">INSC. ESTADUAL</span><span class="info">[transp_IE]</span></td>
                </tr>
            </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" border="1" class="no-top">
            <tbody>
                <tr>
                    <td class="field quantidade"><span class="nf-label">QUANTIDADE</span><span class="content-spacer info">[vol_qVol]</span></td>
                    <td style="width: 31.4mm"><span class="nf-label">ESPÉCIE</span><span class="info">[vol_esp]</span></td>
                    <td style="width: 31mm"><span class="nf-label">MARCA</span><span class="info">[vol_marca]</span></td>
                    <td style="width: 31.5mm"><span class="nf-label">NUMERAÇÃO</span><span class="info">[vol_nVol]</span></td>
                    <td style="width: 31.5mm"><span class="nf-label">PESO BRUTO</span><span class="info">[vol_pesoB]</span></td>
                    <td style="width: 32.5mm"><span class="nf-label">PESO LÍQUIDO</span><span class="info">[vol_pesoL]</span></td>
                </tr>
            </tbody>
        </table>
`;

const TPL_ITEMS_TABLE_START = `
        <p class="area-name">Dados do produto/serviço</p>
        <div class="wrapper-border [extra_class]">
            <table cellpadding="0" cellspacing="0" border="1" class="boxProdutoServico">
                <thead class="listProdutoServico" id="table">
                    <tr class="titles">
                        <th class="cod" style="width: 15.5mm">CÓDIGO</th>
                        <th class="descrit" style="width: 66.1mm">DESCRIÇÃO DO PRODUTO/SERVIÇO</th>
                        <th class="ncmsh">NCMSH</th><th class="cst">CST</th><th class="cfop">CFOP</th><th class="un">UN</th>
                        <th class="amount">QTD.</th><th class="valUnit">VLR.UNIT</th><th class="valTotal">VLR.TOTAL</th>
                        <th class="bcIcms">BC ICMS</th><th class="valIcms">VLR.ICMS</th><th class="valIpi">VLR.IPI</th>
                        <th class="aliqIcms">ALIQ.ICMS</th><th class="aliqIpi">ALIQ.IPI</th>
                    </tr>
                </thead>
                <tbody>
`;

const TPL_FOOTER_BLOCK = `
        <p class="area-name">Calculo do issqn</p>
        <table cellpadding="0" cellspacing="0" border="1" class="boxIssqn">
            <tbody>
                <tr>
                    <td class="field inscrMunicipal"><span class="nf-label">INSCRIÇÃO MUNICIPAL</span><span class="info txt-center">[emit_IM]</span></td>
                    <td class="field valorTotal"><span class="nf-label">VALOR TOTAL DOS SERVIÇOS</span><span class="info txt-right">[issqn_vServ]</span></td>
                    <td class="field baseCalculo"><span class="nf-label">BASE DE CÁLCULO DO ISSQN</span><span class="info txt-right">[issqn_vBC]</span></td>
                    <td class="field valorIssqn"><span class="nf-label">VALOR DO ISSQN</span><span class="info txt-right">[issqn_vISSQN]</span></td>
                </tr>
            </tbody>
        </table>
        <p class="area-name">Dados adicionais</p>
        <table cellpadding="0" cellspacing="0" border="1" class="boxDadosAdicionais">
            <tbody>
                <tr>
                    <td class="field infoComplementar"><span class="nf-label">INFORMAÇÕES COMPLEMENTARES</span><span>[infCpl]</span></td>
                    <td class="field reservaFisco" style="width: 85mm; height: 24mm"><span class="nf-label">RESERVA AO FISCO</span><span></span></td>
                </tr>
            </tbody>
        </table>
    </div>
</div>
`;


// ================================================
// ================================================
// ENDPOINT E SERVIDOR VERCEL ADAPTER
// ================================================

module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method === "GET") {
        return res.send(`
            <html>
                <head><title>DANFE Server (Vercel)</title></head>
                <body style="font-family: sans-serif; padding: 20px;">
                    <h1>Servidor DANFE Online 🚀 (Vercel)</h1>
                    <p>O endpoint de geração está ativo.</p>
                    <p>Faça um POST neste mesmo endereço com o campo <code>xml</code>.</p>
                </body>
            </html>
        `);
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    try {
        const { xml, logoBase64 } = req.body;

        // Validação
        if (!xml) {
            return res.status(400).json({
                error: "Campo 'xml' é obrigatório",
            });
        }

        // Processa XML
        const { html, meta } = await processXmlToHtml(xml, logoBase64);

        // Converte para Base64
        const html_base64 = Buffer.from(html, "utf8").toString("base64");

        // Retorna resposta
        res.json({
            html_base64,
            meta,
        });
    } catch (error) {
        // Log genérico sem payload (LGPD)
        console.error("Erro ao processar requisição:", error.message);

        res.status(500).json({
            error: "Erro interno ao processar XML",
            message: error.message,
        });
    }
};


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
        "[emit_xNome]": emit.xNome || emit.xFant || "",
        "[emit_xLgr]": enderEmit.xLgr || "",
        "[emit_nro]": enderEmit.nro || "",
        "[emit_xBairro]": enderEmit.xBairro || "",
        "[emit_CEP]": formatCep(enderEmit.CEP),
        "[emit_xMun]": enderEmit.xMun || "",
        "[emit_UF]": enderEmit.UF || "",
        "[emit_fone]": formatPhone(enderEmit.fone),
        "[emit_IE]": emit.IE || "",
        "[emit_IEST]": emit.IEST || "",
        "[emit_IM]": emit.IM || "",
        "[emit_CNPJ]": formatCnpjCpf(emit.CNPJ || emit.CPF),
        "[ide_nNF]": ide.nNF || "",
        "[ide_serie]": ide.serie || "",
        "[ide_tpNF]": ide.tpNF || "",
        "[ide_natOp]": ide.natOp || "",
        "[chave_acesso]": chaveFormatada,
        "[protocolo]": protocoloFormatado,
        "{BarCode}": await generateBarcode(chave), // Async generation
        "[ide_dhEmi_data]": formatDate(ide.dhEmi),
        "[ide_dhSaiEnt_data]": formatDate(ide.dhSaiEnt || ide.dhEmi),
        "[ide_dhSaiEnt_hora]": formatTime(ide.dhSaiEnt || ide.dhEmi),
        "[dest_xNome]": dest.xNome || "",
        "[dest_CNPJ_CPF]": formatCnpjCpf(dest.CNPJ || dest.CPF),
        "[dest_xLgr]": enderDest.xLgr || "",
        "[dest_nro]": enderDest.nro || "",
        "[dest_xBairro]": enderDest.xBairro || "",
        "[dest_CEP]": formatCep(enderDest.CEP),
        "[dest_xMun]": enderDest.xMun || "",
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
        "[transp_xNome]": transporta.xNome || "",
        "[transp_modFrete]": transp.modFrete || "",
        "[transp_RNTC]": veicTransp.RNTC || "",
        "[transp_placa]": veicTransp.placa || "",
        "[transp_UF]": veicTransp.UF || "",
        "[transp_CNPJ_CPF]": formatCnpjCpf(transporta.CNPJ || transporta.CPF),
        "[transp_xEnder]": transporta.xEnder || "",
        "[transp_xMun]": transporta.xMun || "",
        "[transp_UF2]": transporta.UF || "",
        "[transp_IE]": transporta.IE || "",
        "[vol_qVol]": firstVol.qVol || "",
        "[vol_esp]": firstVol.esp || "",
        "[vol_marca]": firstVol.marca || "",
        "[vol_nVol]": firstVol.nVol || "",
        "[vol_pesoB]": formatWeight(firstVol.pesoB),
        "[vol_pesoL]": formatWeight(firstVol.pesoL),
        "[infCpl]": infAdic.infCpl || "",
    };

    // Montar Duplicatas para o Replacements - Texto Corrido Simplificado
    let duplicatesHtml = "";
    if (duplicatas.length > 0) {
        duplicatesHtml = '<div style="width:100%; border:1px solid black; padding: 2px; font-size: 7pt; min-height: 8mm; box-sizing: border-box;">';

        let dupTexts = [];
        for (const d of duplicatas) {
            dupTexts.push(`${d.nDup || ""} &nbsp; ${formatDate(d.dVenc)} &nbsp; R$ ${formatCurrency(d.vDup)}`);
        }
        duplicatesHtml += dupTexts.join(" - ");
        duplicatesHtml += '</div>';
    } else {
        // Empty box if no duplicates
        duplicatesHtml = '<div style="width:100%; border:1px solid black; height: 8mm;"></div>';
    }
    baseReplacements["[duplicatas]"] = duplicatesHtml;


    // 2. Paginação Inteligente (Baseada em Altura Estimada)
    // Em vez de contar apenas "itens", contamos "linhas estimadas".
    // 1 item pode ocupar 2 ou 3 linhas se a descrição for longa.
    // Estimativa: ~60 caracteres por linha na descrição (fonte 6pt).

    // Limites de linhas "visuais" (Ajustado para fonte 8pt e preencher melhor a página)
    const linesPerPage1 = 16;
    const linesPerPageN = 22;

    let pages = [];
    let currentPage = { items: [], isFirst: true, currentLines: 0 };

    for (let i = 0; i < items.length; i++) {
        let item = items[i];

        // Calcular "custo" de altura do item
        // Minimo 1 linha. A cada 45 caracteres na descrição (fonte 8pt), adiciona +1 linha.
        let descLen = (item.prod && item.prod.xProd) ? item.prod.xProd.length : 0;
        let itemHeightCost = Math.max(1, Math.ceil(descLen / 40));

        let limit = currentPage.isFirst ? linesPerPage1 : linesPerPageN;

        // Verifica se cabe na página atual
        if (currentPage.currentLines + itemHeightCost > limit && currentPage.items.length > 0) {
            // Não cabe: Salva página atual e cria uma nova
            pages.push(currentPage);

            // Nova página começa vazia (e não é mais a primeira)
            currentPage = {
                items: [],
                isFirst: false,
                currentLines: 0
            };
        }

        // Adiciona item na página atual
        currentPage.items.push(item);
        currentPage.currentLines += itemHeightCost;
    }

    // Adiciona a última página se tiver sobrado algo
    if (currentPage.items.length > 0) {
        pages.push(currentPage);
    }

    let totalPages = pages.length;
    let finalHtmlBody = "";

    // 3. Montagem das Páginas
    pages.forEach((page, index) => {
        let pageNum = index + 1;
        let isLastPage = (pageNum === totalPages);

        // Prepara Replacements da Página
        let pageReplacements = {
            ...baseReplacements,
            "[current_page]": pageNum,
            "[total_pages]": totalPages
        };

        let pageHtml = "";

        // Abre div Page
        pageHtml += '<div class="page nfeArea">';

        // Header: Página 1 usa o Completo (com Canhoto), Demais usam Simples
        let headerTpl = page.isFirst ? TPL_HEADER_REPEATED : TPL_HEADER_SIMPLE;
        pageHtml += fillTemplate(headerTpl, pageReplacements);

        // Se for Página 1: Inserir Destinatário + Impostos + Transportadora
        // OBS: No meu template TPL_DESTINATARIO_BLOCK já tem tudo isso.
        if (page.isFirst) {
            pageHtml += fillTemplate(TPL_DESTINATARIO_BLOCK, pageReplacements);
        }

        // Tabela de Itens (Inicio)
        // Se for pagina 2+, a classe full-page aumenta a altura minima da borda
        let extraClass = page.isFirst ? "" : "full-page";

        // Hack: replace no template da tabela
        let tableHeader = TPL_ITEMS_TABLE_START.replace("[extra_class]", extraClass);
        pageHtml += tableHeader;

        // Linhas dos itens
        for (let det of page.items) {
            const prod = det.prod || {};
            const imposto = det.imposto || {};
            const icmsData = extractICMSData(imposto);
            const ipiData = extractIPIData(imposto);

            let row = '<tr>' +
                '<td class="txt-center">' + (prod.cProd || "") + '</td>' +
                '<td>' + (prod.xProd || "") + '</td>' +
                '<td class="txt-center">' + (prod.NCM || "") + '</td>' +
                '<td class="txt-center">' + icmsData.CST + '</td>' +
                '<td class="txt-center">' + (prod.CFOP || "") + '</td>' +
                '<td class="txt-center">' + (prod.uCom || "") + '</td>' +
                '<td class="txt-right">' + formatQuantity(prod.qCom) + '</td>' +
                '<td class="txt-right">' + formatCurrency(prod.vUnCom) + '</td>' +
                '<td class="txt-right">' + formatCurrency(prod.vProd) + '</td>' +
                '<td class="txt-right">' + formatCurrency(icmsData.vBC) + '</td>' +
                '<td class="txt-right">' + formatCurrency(icmsData.vICMS) + '</td>' +
                '<td class="txt-right">' + formatCurrency(ipiData.vIPI) + '</td>' +
                '<td class="txt-right">' + (icmsData.pICMS ? formatCurrency(icmsData.pICMS) : "") + '</td>' +
                '<td class="txt-right">' + (ipiData.pIPI ? formatCurrency(ipiData.pIPI) : "") + '</td>' +
                '</tr>';
            pageHtml += row;
        }

        pageHtml += "</tbody></table></div>"; // Fecha tabela e wrapper

        // Rodapé (ISSQN + Dados Adicionais)
        // Antes era apenas na última página (if (isLastPage)).
        // Agora incluímos em TODAS as páginas para fechar o layout.

        // Se quisermos que nas páginas intermediárias os valores venham zerados ou diferentes,
        // podemos clonar o 'pageReplacements' e alterar aqui. 
        // Por enquanto, vou manter igual para garantir o fechamento visual.

        pageHtml += fillTemplate(TPL_FOOTER_BLOCK, pageReplacements);

        // Fecha div da página
        pageHtml += "</div>";

        // Quebra de pagina na impressao (o CSS page-break-after handle isso na classe .page)

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
    // Exemplo simples
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
    const icmsValue = Object.values(ICMS)[0] || {};

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
        return '<div style="padding: 0 10px; box-sizing: border-box;"><img style="width: 100%; max-height: 13mm;" src="data:image/png;base64,' + png.toString('base64') + '" /></div>';
    } catch (e) {
        console.error("Erro ao gerar barcode:", e);
        return ""; // Fallback sem barcode
    }
}
