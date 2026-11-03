// Feedback of the administrative forms, shared by the administration and the sector page of a
// "Gerir serviços do setor" holder (SPEC 2026-11-01-permissoes-configuraveis, 5.3.1).
export function announcement(error?: string, notice?: string, entity?: string): string | null {
  // Reactivating a custom field fails on the limit or on a repeated label (SPEC 2026-11-01-campos-personalizados, 5.1).
  if (error === "dependency" && entity === "serviceFields") {
    return "Não foi possível concluir: o serviço já tem o limite de campos ativos, outro campo ativo usa o mesmo rótulo, ou a mudança quebraria a condição de outro campo (SPEC de campos condicionais, 5.3).";
  }
  // SPEC 2026-11-01-permissoes-configuraveis, 5.2: profile not eligible or inactive user.
  if (error === "validation" && entity === "permissions") {
    return "Este perfil não pode receber essa permissão.";
  }
  if (error === "dependency" && entity === "permissions") {
    return "Usuários inativos não recebem permissões.";
  }
  // SPEC 2026-11-02-auditoria-lgpd, 5.5.1 and 5.5.2: conditions and explicit confirmation.
  // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.3: only failed or cancelled deliveries of active webhooks.
  if (error === "dependency" && entity === "webhookDeliveries") {
    return "Só é possível reenviar entregas que falharam ou foram canceladas, de webhooks ativos.";
  }
  // SPEC 2026-11-02-api-externa-webhooks, 5.6: limit of active webhooks.
  if (error === "dependency" && entity === "webhooks") {
    return "Já há 10 webhooks ativos. Desative um antes de reativar este.";
  }
  if (error === "validation" && entity === "webhooks") {
    return "Confira o nome, o endereço (https público, porta padrão, 443 ou 8443) e escolha pelo menos um evento.";
  }
  // SPEC 2026-11-03-pausa-sla-calendario, 5.1.
  if (error === "validation" && entity === "calendar") {
    return "Confira o expediente: marque pelo menos um dia, use HH:MM com o início antes do fim e um fuso horário válido.";
  }
  if (error === "validation" && entity === "holidays") {
    return "Confira o feriado: informe uma data válida e um nome de até 80 caracteres.";
  }
  if (error === "dependency" && entity === "holidays") {
    return "Já existe um feriado cadastrado nessa data.";
  }
  if (error === "dependency" && entity === "anonymization") {
    return "Só é possível anonimizar pessoas desativadas, sem solicitações abertas ou em atendimento, e nunca a própria conta.";
  }
  if (error === "validation" && entity === "anonymization") {
    return "Confirme que entende que a anonimização é irreversível.";
  }
  // Reactivating a stage fails on the limit or on a repeated name (SPEC 2026-11-01-fluxos-configuraveis, 5.1).
  if (error === "dependency" && entity === "serviceStages") {
    return "Não foi possível concluir: o serviço já tem o limite de etapas ativas ou outra etapa ativa usa o mesmo nome.";
  }
  if (error === "dependency") {
    return "A operação não pode ser concluída enquanto existirem dependências ativas ou solicitações pendentes.";
  }
  if (error === "validation") {
    return "Confira os campos: há valores ausentes ou inválidos.";
  }
  if (error === "missing") {
    return "O registro não existe mais. Atualize a página e tente novamente.";
  }
  if (error === "access") {
    return "Sua sessão não tem permissão para essa operação.";
  }
  if (error === "unexpected") {
    return "Não foi possível concluir a operação. Tente novamente.";
  }
  // SPEC 2026-11-03-pausa-sla-calendario, 5.7.
  if (notice === "updated" && entity === "calendar") return "Expediente salvo. Vale para os próximos cálculos de prazo.";
  if (notice === "created" && entity === "holidays") return "Feriado cadastrado.";
  if (notice === "deleted" && entity === "holidays") return "Feriado removido.";
  if (notice === "created") return "Registro criado.";
  if (notice === "updated") return "Alterações salvas.";
  if (notice === "status") return "Estado atualizado.";
  if (notice === "anonymized") return "Pessoa anonimizada.";
  // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.3.
  if (notice === "resent" && entity === "webhookDeliveries") return "Entrega reenviada. Ela sai logo em seguida.";
  // SPEC 2026-11-02-api-externa-webhooks, 5.1: revocation counts on the next call.
  if (notice === "revoked" && entity === "apiTokens") return "Token revogado. Ele deixa de funcionar na próxima chamada.";
  return null;
}
