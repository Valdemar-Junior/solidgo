const http = require('http');
const fs = require('fs');
const path = require('path');

function postRequest(xml, filename) {
    const data = JSON.stringify({
        xml: xml,
        logoBase64: "" // Optional
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/danfe/html-base64',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            if (res.statusCode === 200) {
                const response = JSON.parse(body);
                const html = Buffer.from(response.html_base64, 'base64').toString('utf8');
                fs.writeFileSync(filename, html);
                console.log(`Saved ${filename}`);

                // Basic Validation
                const pageCount = (html.match(/class="page nfeArea"/g) || []).length;
                console.log(`${filename}: Found ${pageCount} pages.`);
            } else {
                console.error(`Error for ${filename}: Status ${res.statusCode} - ${body}`);
            }
        });
    });

    req.on('error', error => {
        console.error(`Request error for ${filename}:`, error);
    });

    req.write(data);
    req.end();
}

function generateXml(itemCount) {
    let items = '';
    for (let i = 1; i <= itemCount; i++) {
        items += `
        <det nItem="${i}">
            <prod>
                <cProd>PROD${i}</cProd>
                <cEAN>SEM GTIN</cEAN>
                <xProd>Produto Teste ${i} Descricao Longa Para Testar Layout</xProd>
                <NCM>00000000</NCM>
                <CFOP>5102</CFOP>
                <uCom>UN</uCom>
                <qCom>1.0000</qCom>
                <vUnCom>10.00</vUnCom>
                <vProd>10.00</vProd>
                <cEANTrib>SEM GTIN</cEANTrib>
                <uTrib>UN</uTrib>
                <qTrib>1.0000</qTrib>
                <vUnTrib>10.00</vUnTrib>
                <indTot>1</indTot>
            </prod>
            <imposto>
                <ICMS>
                    <ICMS00>
                        <orig>0</orig>
                        <CST>00</CST>
                        <modBC>3</modBC>
                        <vBC>10.00</vBC>
                        <pICMS>18.00</pICMS>
                        <vICMS>1.80</vICMS>
                    </ICMS00>
                </ICMS>
                <IPI>
                    <cEnq>999</cEnq>
                    <IPITrib>
                        <CST>50</CST>
                        <vBC>10.00</vBC>
                        <pIPI>0.00</pIPI>
                        <vIPI>0.00</vIPI>
                    </IPITrib>
                </IPI>
                <PIS>
                    <PISAliq>
                        <CST>01</CST>
                        <vBC>10.00</vBC>
                        <pPIS>1.65</pPIS>
                        <vPIS>0.17</vPIS>
                    </PISAliq>
                </PIS>
                <COFINS>
                    <COFINSAliq>
                        <CST>01</CST>
                        <vBC>10.00</vBC>
                        <pCOFINS>7.60</pCOFINS>
                        <vCOFINS>0.76</vCOFINS>
                    </COFINSAliq>
                </COFINS>
            </imposto>
        </det>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
    <NFe>
        <infNFe Id="NFe35230100000000000000550010000000011000000001" versao="4.00">
            <ide>
                <cUF>35</cUF>
                <cNF>00000001</cNF>
                <natOp>VENDA</natOp>
                <mod>55</mod>
                <serie>1</serie>
                <nNF>1</nNF>
                <dhEmi>2023-01-01T12:00:00-03:00</dhEmi>
                <tpNF>1</tpNF>
                <idDest>1</idDest>
                <cMunFG>3550308</cMunFG>
                <tpImp>1</tpImp>
                <tpEmis>1</tpEmis>
                <cDV>1</cDV>
                <tpAmb>2</tpAmb>
                <finNFe>1</finNFe>
                <indFinal>1</indFinal>
                <indPres>1</indPres>
                <procEmi>0</procEmi>
                <verProc>4.00</verProc>
            </ide>
            <emit>
                <CNPJ>00000000000000</CNPJ>
                <xNome>EMPRESA EMITENTE TESTE LTDA</xNome>
                <xFant>EMITENTE TESTE</xFant>
                <enderEmit>
                    <xLgr>RUA DE TESTE</xLgr>
                    <nro>123</nro>
                    <xBairro>BAIRRO TESTE</xBairro>
                    <cMun>3550308</cMun>
                    <xMun>SAO PAULO</xMun>
                    <UF>SP</UF>
                    <CEP>00000000</CEP>
                    <cPais>1058</cPais>
                    <xPais>BRASIL</xPais>
                    <fone>1100000000</fone>
                </enderEmit>
                <IE>000000000</IE>
                <CRT>3</CRT>
            </emit>
            <dest>
                <CNPJ>00000000000000</CNPJ>
                <xNome>CLIENTE DESTINATARIO TESTE</xNome>
                <enderDest>
                    <xLgr>RUA DO CLIENTE</xLgr>
                    <nro>456</nro>
                    <xBairro>BAIRRO DO CLIENTE</xBairro>
                    <cMun>3550308</cMun>
                    <xMun>SAO PAULO</xMun>
                    <UF>SP</UF>
                    <CEP>00000000</CEP>
                    <cPais>1058</cPais>
                    <xPais>BRASIL</xPais>
                    <fone>1100000000</fone>
                </enderDest>
                <indIEDest>9</indIEDest>
            </dest>
            ${items}
            <total>
                <ICMSTot>
                    <vBC>100.00</vBC>
                    <vICMS>18.00</vICMS>
                    <vICMSDeson>0.00</vICMSDeson>
                    <vFCP>0.00</vFCP>
                    <vBCST>0.00</vBCST>
                    <vST>0.00</vST>
                    <vFCPST>0.00</vFCPST>
                    <vFCPSTRet>0.00</vFCPSTRet>
                    <vProd>100.00</vProd>
                    <vFrete>0.00</vFrete>
                    <vSeg>0.00</vSeg>
                    <vDesc>0.00</vDesc>
                    <vII>0.00</vII>
                    <vIPI>0.00</vIPI>
                    <vIPIDevol>0.00</vIPIDevol>
                    <vPIS>1.65</vPIS>
                    <vCOFINS>7.60</vCOFINS>
                    <vOutro>0.00</vOutro>
                    <vNF>100.00</vNF>
                </ICMSTot>
            </total>
            <transp>
                <modFrete>0</modFrete>
            </transp>
        </infNFe>
    </NFe>
</nfeProc>`;
}

// Scenarios
// 1. Few items (1 page) - Max is 6 on first page.
postRequest(generateXml(3), 'danfe_3_items.html');

// 2. Medium items (2 pages) - 6 on p1, remaining 4 on p2.
postRequest(generateXml(10), 'danfe_10_items.html');

// 3. Many items (3 pages) - 6 on p1, 25 on p2, 19 on p3.
// Total 50 items.
postRequest(generateXml(50), 'danfe_50_items.html');
