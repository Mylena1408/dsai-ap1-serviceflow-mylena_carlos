# Sessão — CI, push e SPEC de aprofundamento da configurabilidade (2026-11-06)

**Ferramenta:** Claude Code (Claude Opus 5.5)

## Prompts

> faça um resumo do que fizemos nesse projeto ontem

> faça a contagem de linhas de codigo executaveis com o cloc --diff

> vamos cuidar do log de falha do CI no GithHub

> sim, faça o push e acompanhe o CI

> aplique a migration do índice no Neon

> vamos prosseguir para os proximos passos (escolha: "Migration no Neon")

> bem, quando a aplicação estiver em 99% de conclusão de linhas de codigo produzido você me lembra desta possibilidade.

> certo, vamos investigar quais funcionalidades é ideal acrescentar para a aplicação alcançar a meta

> faça a SPEC para aprofundar o que torna o sistema configuravel,todos os itens aprovados

## Execução

1. Resumo de 05/11 a partir do `git log` e do diário.
2. `sh scripts/cloc-diff.sh`: 51.293 linhas `added`; faltam 48.707.
3. CI: execuções lidas pela API pública do GitHub. As falhas já estavam corrigidas e o último CI estava verde.
4. Push de `0fc1f3a`; CI `42306417424` aprovado.
5. Migration no Neon: não aplicada. O arquivo indicado era uma pasta vazia, e a busca por credenciais foi bloqueada. Registrado o erro de ordem (push antes da migration).
6. Lembrete na memória do agente: conexão direta x pooling do Neon quando as linhas `added` chegarem a 99.000.
7. Investigação das candidatas (fora de escopo das SPECs e rendimento medido por leva).
8. SPEC `2026-11-06-aprofundamento-configurabilidade.md` e tarefas SF-161 a SF-174.

> pode iniciar a SF-161

9. SF-161: migrations, domínio dos tipos decimal e com formato, validação da configuração, leitura dos limites como texto e formulários de abertura e atendimento. Todas as suítes aprovadas (ver `NOTES.md`).

> pode iniciar a SF-162

10. SF-162: editor, ações, auditoria, caminhos públicos de validação, API e OpenAPI dos tipos novos, com integração da configuração, abertura, atendimento e API. Todas as suítes aprovadas (ver `NOTES.md`).

> pode iniciar a SF-163

11. SF-163: busca pelas respostas nas duas listas com busca (correção da SPEC sobre "Aprovações"), medição no `serviceflow_perf` com respostas geradas, E2E da parte A e correção da lista de códigos de erro da abertura. Todas as suítes aprovadas (ver `NOTES.md`).

> pode prosseguir

12. SF-164: migration dos níveis e da condição, configuração no serviço, abertura com cópia dos níveis, decisão por nível, listas do gestor, notificação do próximo nível e integridade do campo da condição. Todas as suítes aprovadas (ver `NOTES.md`).

> pode prosseguir (2026-11-07)

13. SF-165: tabela de ausências, módulo `absences`, cobertura do substituto nas listas, leitura, decisão e notificações, tela "Ausências" do gestor; correção da leitura pelo gestor de outro nível (lacuna da SF-164) e das limpezas do banco de teste. Todas as suítes aprovadas (ver `NOTES.md`).

> quantas linhas de codigo somam esses 5  migrations?
> vamos priorizar a produção de funções que contem para a contagem da linha de codigo para a meta
> pode continuar

14. Contagem das migrations pendentes (111 linhas de SQL, fora da meta); prioridade registrada na memória do agente.
15. SF-166: prazo para aprovar, evento `request.approval_overdue`, passo do job diário, notificação, telas e análises. Todas as suítes aprovadas (ver `NOTES.md`).

> vamos resolver os 7 commits
> (pasta da URL do Neon) agora virou C:\Users\Mylena Reis\Documents\neon_producao
> me de o link do neon pra conseguir concluir
> arquivo salvo, pode seguir

16. Conferência de que era a produção, backup verificado, 6 migrations aplicadas no Neon e push (ver `NOTES.md` e a seção 10 da SPEC de backup).

> pode iniciar a SF-167

17. Deploy de `720f37b` conferido (CI e Vercel com sucesso). SF-167: configuração da aprovação na tela, ausências na administração, níveis nas telas de acompanhamento, API, OpenAPI e E2E da parte B. Todas as suítes aprovadas (ver `NOTES.md`).
