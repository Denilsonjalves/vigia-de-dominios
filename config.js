/* Configuração do envio da lista de espera.
 * Pré-lançamento: formEndpoint VAZIO => "modo demonstração" (nada sai do navegador; o aviso deixa isso claro).
 * Para ativar (só com autorização do titular): crie um Google Forms com os campos abaixo, copie a URL "formResponse"
 * e os IDs "entry.XXXX" de cada pergunta (instruções em fase3/README.md). Sem custo, sem servidor. */
window.PZ_CONFIG = {
  formEndpoint: "",            // ex.: "https://docs.google.com/forms/d/e/<ID>/formResponse"
  fields: {                    // nome do campo da página -> entry.ID do Google Forms
    nome: "", email: "", agencia: "", site: "", cargo: "", n_dominios: "", dor: "", pagaria: "",
    comentario: "", origem: "", diag_dominio: "", consent: ""
  }
};
