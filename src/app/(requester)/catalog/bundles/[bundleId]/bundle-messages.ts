// Messages of the bundle page (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3): a refusal opens
// nothing, and the page says so.

export function bundleErrorMessage(error: string | undefined): string | null {
  if (error === "fields") return "Confira os campos indicados abaixo. Nenhuma solicitação foi aberta.";
  if (error === "fields-changed") {
    return "Os campos de algum serviço do pacote mudaram enquanto você preenchia. Confira o formulário abaixo e envie novamente.";
  }
  if (error === "validation") return "Informe uma descrição válida, com até 10.000 caracteres.";
  if (error === "unavailable") return "Este pacote não está mais disponível. Nenhuma solicitação foi aberta.";
  if (error === "access") return "Sua sessão não permite abrir este pacote.";
  if (error === "unexpected") return "Não foi possível abrir o pacote. Nenhuma solicitação foi aberta.";
  return null;
}
