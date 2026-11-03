const forge = require("node-forge");

/**
 * Certificado A1 de mentira, gerado na hora para os testes de NFS-e.
 * Serve para provar que a DPS é assinada e que a assinatura confere; não tem
 * valor nenhum fora da suíte.
 */
function gerarCertificadoDeTeste({ senha = "teste", cn = "PAUTA TESTE:12345678000199" } = {}) {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const certificado = forge.pki.createCertificate();

  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = "01";
  certificado.validity.notBefore = new Date();
  certificado.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const campos = [
    { name: "commonName", value: cn },
    { name: "countryName", value: "BR" },
    { name: "organizationName", value: "Pauta Testes" },
  ];
  certificado.setSubject(campos);
  certificado.setIssuer(campos);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha, { algorithm: "3des" });

  return {
    senha,
    base64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    certificadoPem: forge.pki.certificateToPem(certificado),
  };
}

module.exports = { gerarCertificadoDeTeste };
