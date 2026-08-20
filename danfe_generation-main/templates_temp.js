
const PAGE_CSS = `
<style type="text/css">
    @media print {
        @page { margin: 6mm; }
        footer { page-break-after: always; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    * { margin: 0; }
    .ui-widget-content { border: none !important; }
    .nfeArea.page { width: 198mm; position: relative; font-family: "Times New Roman", serif; color: #000; margin: 0 auto; overflow: hidden; page-break-after: always; }
    .nfeArea.page:last-child { page-break-after: auto; }
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
    .nfeArea .wrapper-border { border: 1px solid #000; border-width: 0 1px 1px; min-height: 105mm; }
    .nfeArea .wrapper-border.full-page { min-height: 250mm; border-bottom: 1px solid #000; }
    .nfeArea .wrapper-border table { margin: 0 -1px; width: 100.4%; }
    .nfeArea .content-spacer { display: block; height: 10px; }
    .nfeArea .titles th { padding: 3px 0; }
    .nfeArea .listProdutoServico td { padding: 0; }
    .nfeArea .codigo { display: block; text-align: center; margin-top: 5px; }
    .nfeArea .boxProdutoServico tr td:first-child { border-left: none; }
    .nfeArea .boxProdutoServico td { font-size: 6pt; height: auto; }
    .nfeArea .boxFatura span { display: block; }
    .nfeArea .boxFatura td { border: 1px solid #000; }
    .nfeArea .freteConta .border { width: 5mm; height: 5mm; float: right; text-align: center; line-height: 5mm; border: 1px solid black; }
    .nfeArea .freteConta .info { line-height: 5mm; }
    .page .boxFields td p { font-family: "Times New Roman", serif; font-size: 5pt; line-height: 1.2em; color: #000; }
    .nfeArea .block { display: block; }
    .barcode-container { display: flex; justify-content: center; align-items: center; height: 100%; width: 100%; padding: 2px; box-sizing: border-box; }
    .barcode { display: flex; height: 13mm; overflow: hidden; }
    .barcode .bar { background-color: #000 !important; height: 100%; display: inline-block; box-sizing: border-box; border-left: 1px solid #000; width: 0 !important; }
    .barcode .space { background-color: transparent; height: 100%; display: inline-block; border: none; }
</style>`;

// Templates para montagem dinâmica
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
                    <td rowspan="3" class="txtc txt-upper" style="width: 34mm; height: 29.5mm;">
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
                    <td class="pd-0">
                        <table cellpadding="0" cellspacing="0" border="1">
                            <tbody><tr><td><span class="nf-label">NOME/RAZÃO SOCIAL</span><span class="info">[dest_xNome]</span></td><td style="width: 40mm"><span class="nf-label">CNPJ/CPF</span><span class="info">[dest_CNPJ_CPF]</span></td></tr></tbody>
                        </table>
                    </td>
                    <td style="width: 22mm"><span class="nf-label">DATA DE EMISSÃO</span><span class="info">[ide_dhEmi_data]</span></td>
                </tr>
                <tr>
                    <td class="pd-0">
                        <table cellpadding="0" cellspacing="0" border="1">
                            <tbody><tr><td><span class="nf-label">ENDEREÇO</span><span class="info">[dest_xLgr], [dest_nro]</span></td><td style="width: 47mm;"><span class="nf-label">BAIRRO/DISTRITO</span><span class="info">[dest_xBairro]</span></td><td style="width: 37.2 mm"><span class="nf-label">CEP</span><span class="info">[dest_CEP]</span></td></tr></tbody>
                        </table>
                    </td>
                    <td><span class="nf-label">DATA DE ENTR./SAÍDA</span><span class="info">[ide_dhSaiEnt_data]</span></td>
                </tr>
                <tr>
                    <td class="pd-0">
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

const TPL_ITEMS_TABLE_END = `
                </tbody>
            </table>
        </div>
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
