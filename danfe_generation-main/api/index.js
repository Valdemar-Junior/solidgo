module.exports = (req, res) => {
    res.json({
        status: "ok",
        message: "API DANFE HTML - Pronta para uso",
        endpoints: {
            "POST /danfe/html-base64": "Gera DANFE HTML a partir de XML NF-e",
        },
        usage: {
            method: "POST",
            body: {
                xml: "XML da NF-e (obrigatório)",
                logoBase64: "Logo em Base64 (opcional)"
            }
        }
    });
};
