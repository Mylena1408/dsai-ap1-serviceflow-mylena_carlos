// Feedback of the administrative forms, shared by the administration and the sector page of a
// "Gerir serviços do setor" holder (SPEC 2026-11-01-permissoes-configuraveis, 5.3.1).
export function announcement(error?: string, notice?: string, entity?: string): string | null {
  // Reactivating a custom field fails on the limit or on a repeated label (SPEC 2026-11-01-campos-personalizados, 5.1).
  if (error === "dependency" && entity === "serviceFields") {
    return "Não foi possível concluir: o serviço já tem o limite de campos ativos ou outro campo ativo usa o mesmo rótulo.";
  }
  // SPEC 2026-11-01-permissoes-configuraveis, 5.2: profile not eligible or inactive user.
  if (error === "validation" && entity === "permissions") {
    return "Este perfil não pode receber essa permissão.";
  }
  if (error === "dependency" && entity === "permissions") {
    return "Usuários inativos não recebem permissões.";
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
  if (notice === "created") return "Registro criado.";
  if (notice === "updated") return "Alterações salvas.";
  if (notice === "status") return "Estado atualizado.";
  return null;
}
