// Arquivo de teste para a API DANFE HTML
// Execute com: node test.js

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe35210312345678000123550010001234561234567890" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>12345678</cNF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>123456</nNF>
        <dhEmi>2024-01-15T10:30:00-03:00</dhEmi>
        <dhSaiEnt>2024-01-15T14:00:00-03:00</dhSaiEnt>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>0</cDV>
        <tpAmb>1</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>1</indFinal>
        <indPres>1</indPres>
        <procEmi>0</procEmi>
        <verProc>1.0</verProc>
      </ide>
      <emit>
        <CNPJ>12345678000123</CNPJ>
        <xNome>EMPRESA EXEMPLO LTDA</xNome>
        <xFant>EMPRESA EXEMPLO</xFant>
        <enderEmit>
          <xLgr>Rua das Flores</xLgr>
          <nro>100</nro>
          <xBairro>Centro</xBairro>
          <cMun>3550308</cMun>
          <xMun>São Paulo</xMun>
          <UF>SP</UF>
          <CEP>01310100</CEP>
          <cPais>1058</cPais>
          <xPais>Brasil</xPais>
          <fone>1133334444</fone>
        </enderEmit>
        <IE>123456789012</IE>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CPF>12345678901</CPF>
        <xNome>JOAO DA SILVA</xNome>
        <enderDest>
          <xLgr>Avenida Brasil</xLgr>
          <nro>500</nro>
          <xCpl>Apto 101</xCpl>
          <xBairro>Jardim América</xBairro>
          <cMun>3550308</cMun>
          <xMun>São Paulo</xMun>
          <UF>SP</UF>
          <CEP>01430000</CEP>
          <cPais>1058</cPais>
          <xPais>Brasil</xPais>
          <fone>11999998888</fone>
        </enderDest>
        <indIEDest>9</indIEDest>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>001</cProd>
          <cEAN>7891234567890</cEAN>
          <xProd>PRODUTO EXEMPLO A - COR AZUL</xProd>
          <NCM>94036000</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>2.0000</qCom>
          <vUnCom>150.00</vUnCom>
          <vProd>300.00</vProd>
          <cEANTrib>7891234567890</cEANTrib>
          <uTrib>UN</uTrib>
          <qTrib>2.0000</qTrib>
          <vUnTrib>150.00</vUnTrib>
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>300.00</vBC>
              <pICMS>18.00</pICMS>
              <vICMS>54.00</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <cProd>002</cProd>
          <cEAN>7891234567891</cEAN>
          <xProd>PRODUTO EXEMPLO B - COR VERMELHA</xProd>
          <NCM>94036000</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>1.0000</qCom>
          <vUnCom>250.00</vUnCom>
          <vProd>250.00</vProd>
          <cEANTrib>7891234567891</cEANTrib>
          <uTrib>UN</uTrib>
          <qTrib>1.0000</qTrib>
          <vUnTrib>250.00</vUnTrib>
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>250.00</vBC>
              <pICMS>18.00</pICMS>
              <vICMS>45.00</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>550.00</vBC>
          <vICMS>99.00</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>550.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>0.00</vPIS>
          <vCOFINS>0.00</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>550.00</vNF>
          <vTotTrib>99.00</vTotTrib>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>9</modFrete>
      </transp>
      <pag>
        <detPag>
          <tPag>01</tPag>
          <vPag>550.00</vPag>
        </detPag>
      </pag>
      <infAdic>
        <infCpl>Informações complementares da nota fiscal. Valor aproximado dos tributos federais, estaduais e municipais: R$ 99,00 (18,00%).</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>1</tpAmb>
      <verAplic>SP_NFE_PL009_V4</verAplic>
      <chNFe>35210312345678000123550010001234561234567890</chNFe>
      <dhRecbto>2024-01-15T10:35:00-03:00</dhRecbto>
      <nProt>135240000001234</nProt>
      <digVal>abc123</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;

async function testApi() {
    console.log("🧪 Testando API DANFE HTML...\n");

    try {
        const response = await fetch("http://localhost:3000/danfe/html-base64", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ xml }),
        });

        const data = await response.json();

        if (response.ok) {
            console.log("✅ Sucesso!\n");
            console.log("📋 Metadados:");
            console.log(`   - NF: ${data.meta.nNF}`);
            console.log(`   - Série: ${data.meta.serie}`);
            console.log(`   - Chave: ${data.meta.chave}`);
            console.log(`   - Emitente: ${data.meta.emitente}`);
            console.log(`   - Destinatário: ${data.meta.destinatario}`);
            console.log(`\n📄 HTML Base64 (primeiros 100 chars): ${data.html_base64.substring(0, 100)}...`);
            console.log(`\n📏 Tamanho do HTML Base64: ${data.html_base64.length} caracteres`);

            // Decodifica e mostra um trecho do HTML
            const htmlDecoded = Buffer.from(data.html_base64, "base64").toString("utf8");
            console.log(`\n📏 Tamanho do HTML decodificado: ${htmlDecoded.length} caracteres`);

            // Salva HTML para visualização
            const fs = require("fs");
            fs.writeFileSync("danfe_teste.html", htmlDecoded);
            console.log("\n💾 HTML salvo em danfe_teste.html - abra no navegador para visualizar");
        } else {
            console.log("❌ Erro:", data);
        }
    } catch (error) {
        console.log("❌ Erro de conexão:", error.message);
        console.log("   Certifique-se de que o servidor está rodando (npm run dev)");
    }
}

testApi();
