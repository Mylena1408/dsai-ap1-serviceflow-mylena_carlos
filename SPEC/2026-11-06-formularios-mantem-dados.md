# SPEC — Formulários mantêm o que foi digitado quando o envio é recusado

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06. A responsável aprovou "1- manutenção curta" (primeiro item da lista de próximos passos). **Concluída em 2026-11-06** (SF-158; CA-FMD-01 a 04 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `NOTES.md`, seção "SF-072": observação "em todos os formulários de criação da área administrativa, um envio recusado também limpa o que foi digitado";
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md`: cadastros da administração.

## 1. Problema

Os formulários que usam `useActionState` com `<form action={...}>` são limpos pelo React 19 **depois de toda ação**, inclusive quando o servidor recusa o envio. Por exemplo, num "Criar usuário" com e-mail repetido, a mensagem de erro aparece, mas nome, e-mail, perfil e setor somem e precisam ser digitados de novo. Nos formulários de edição, os campos voltam ao valor salvo, e a correção que a pessoa fazia se perde.

## 2. Escopo

Formulários afetados:

1. **Criação na administração** (componente compartilhado `AdminCreateForm`): usuários, setores, categorias, serviços, documentos exigidos, campos personalizados e etapas.
2. **Edição na administração:**
   - registros (usuário, setor, categoria, serviço);
   - documento exigido;
   - campo personalizado;
   - etapa.
3. **Criação de webhook** e **criação de token de API** ("Acesso à API").

## 3. Fora de escopo

- **Troca de senha:** o formulário continua limpo depois de cada envio, porque os campos são senhas.
- **Abertura de solicitação e campos de atendimento:** já guardam um rascunho próprio, que sobrevive à limpeza e ao redirecionamento.
- Formulários de servidor sem `useActionState` (recarregam a página) e botões isolados (mover, desativar, reativar, gerar segredo), que não têm o que digitar.
- Qualquer mudança nas ações do servidor, nas mensagens ou nas regras de validação.

## 4. Regras

1. **Envio recusado:** tudo o que foi digitado ou escolhido permanece na tela, junto com a mensagem de erro.
2. **Criação com sucesso:** o formulário é limpo, como hoje.
3. **Edição com sucesso:** o comportamento continua o de hoje (o editor fecha e a lista é atualizada).
4. **Botão durante o envio:** continua desabilitado, para evitar envio duplo.
5. **Implementação:** uma única peça compartilhada, sem dependência nova.

## 5. Critérios de aceitação

- [x] **CA-FMD-01** — Na criação de usuário recusada por e-mail repetido, nome, e-mail, perfil e setor continuam preenchidos e a mensagem de erro aparece. Corrigido o e-mail, o envio cria o usuário e limpa o formulário. *Verificado em 2026-11-06: E2E `tests/e2e/form-keeps-values.spec.ts`; sem a correção, o mesmo teste falha com o nome apagado.*
- [x] **CA-FMD-02** — Na edição de um registro recusada, o valor digitado permanece no campo. *Verificado em 2026-11-06: o mesmo E2E (edição de usuário recusada por e-mail repetido mantém o e-mail digitado).*
- [x] **CA-FMD-03** — Os formulários da seção 2 usam a peça compartilhada; a troca de senha continua limpando os campos. *Verificado em 2026-11-06: os 7 componentes da seção 2 usam `keepValuesOnSubmit`; `change-password-form.tsx` não foi alterado.*
- [x] **CA-FMD-04** — Nenhuma dependência nova; lint, typecheck, build e as suítes existentes passam. *Verificado em 2026-11-06: `package.json` sem mudança; lint, typecheck e build OK; unitários 1193/1193; E2E 31/31.*

## 6. Testes

- **Unitário:** a peça compartilhada envia os dados do formulário dentro de uma transição e não chama a ação nativa do formulário.
- **E2E:** criação de usuário recusada mantém os campos e, corrigida, cria e limpa (CA-FMD-01); edição recusada mantém o valor (CA-FMD-02).

## 7. Tarefas

- **SF-158** — Peça compartilhada, aplicação nos formulários da seção 2, testes e registros.
