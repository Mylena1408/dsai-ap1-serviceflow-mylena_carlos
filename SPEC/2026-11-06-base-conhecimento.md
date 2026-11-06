# SPEC — Base de conhecimento por serviço

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06, dentro da "leva recomendada" aprovada pela responsável (quarta funcionalidade). As decisões K1 a K7 da seção 9 foram adotadas como recomendadas. **Concluída em 2026-11-06** (SF-156 e SF-157; CA-KB-01 a 05 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md`: catálogo e serviços;
- `SPEC/2026-11-01-permissoes-configuraveis.md`: "Gerir serviços do setor".

## 1. Objetivo

Muitas solicitações poderiam ser evitadas com uma orientação simples, como "como redefinir a senha" ou "o que levar para a troca de crachá". Com a **base de conhecimento**, quem cuida do catálogo escreve **artigos ligados a cada serviço**. O solicitante os vê na página do serviço, **antes de abrir** a solicitação, e pode resolver sozinho ou abrir já sabendo o que informar.

## 2. Escopo

1. Artigos com título e texto, ligados a um serviço, com situação **publicado** ou **rascunho** e ordem de exibição.
2. Quem gerencia **(decisão K1)**:
   - o administrador, em todos os serviços, numa seção nova "Base de conhecimento" da administração;
   - quem tem "Gerir serviços do setor", nos serviços do próprio setor, na página "Serviços do setor".
3. Na página do serviço do catálogo, o bloco **"Antes de abrir, veja se isto resolve"** mostra os artigos **publicados** do serviço, na ordem definida.

## 3. Fora de escopo

- Busca de artigos, página geral de ajuda, artigos sem serviço **(decisão K2)**.
- Formatação rica (negrito, links, imagens): o texto é simples, com parágrafos **(decisão K3)**.
- Avaliação "isto ajudou?" e estatísticas de leitura.
- Artigos visíveis para atendentes, gestor, API ou MCP.

## 4. Regras

1. **Campos:**
   - **título:** de 1 a 160 caracteres, sem espaços nas pontas, único entre os artigos do mesmo serviço, sem diferenciar maiúsculas;
   - **texto:** de 1 a 20.000 caracteres;
   - **publicado:** sim ou não. O padrão é **não**: o artigo nasce como rascunho **(decisão K4)**;
   - **posição:** número inteiro de 0 a 999. O padrão é o fim da lista.
2. **Exibição ao solicitante:**
   - Só aparecem artigos publicados de serviços que o solicitante já pode ver (serviço, categoria e setor ativos).
   - A ordem é por posição e depois por título.
   - O texto aparece como texto simples, com as quebras de linha mantidas e nada interpretado como HTML.
   - Cada artigo aparece fechado, com o título visível, e abre ao clicar.
3. **Gerenciamento:**
   - criar, editar, publicar e despublicar;
   - excluir um **rascunho**; um artigo publicado precisa ser despublicado antes de excluir **(decisão K5)**.
4. **Escopo de quem gerencia:**
   - o administrador alcança qualquer serviço;
   - quem tem "Gerir serviços do setor" alcança só os serviços do próprio setor atual.

   Um artigo de outro escopo responde "não encontrado", e tudo é conferido no servidor.
5. **Auditoria:** criação, alteração, publicação, despublicação e exclusão entram na auditoria geral, como os outros cadastros do catálogo **(decisão K6)**.

## 5. Dados

Migration **aditiva**:
- tabela `KnowledgeArticle`:

  | Coluna | Tipo e regra |
  |---|---|
  | `id` | uuid |
  | `serviceId` | chave estrangeira |
  | `title` | `citext` |
  | `body` | `text` |
  | `isPublished` | booleano, padrão `false` |
  | `position` | inteiro, padrão 999 |
  | `createdById`, `updatedById` | chaves estrangeiras |
  | `createdAt`, `updatedAt` | datas |

- CHECKs de tamanho e de posição;
- índice único (`serviceId`, `title`);
- novo valor `KNOWLEDGE_ARTICLE` no tipo de entidade da auditoria.

## 6. Critérios de aceitação

- [x] **CA-KB-01** — O administrador cria um rascunho, edita, publica, despublica e exclui um rascunho em qualquer serviço. Quem tem "Gerir serviços do setor" faz o mesmo só nos serviços do próprio setor. *Verificado em 2026-11-06: integração (administrador: rascunho, edição, publicar, despublicar, excluir; quem tem "Gerir serviços do setor" só no próprio setor) e E2E.*
- [x] **CA-KB-02** — São recusados:
  - título repetido no serviço;
  - campos fora dos limites;
  - exclusão de artigo publicado;
  - artigo de outro escopo;
  - quem não é editor do catálogo.

  O banco também recusa título repetido e limites. *Verificado em 2026-11-06: integração (título repetido sem diferenciar maiúsculas, limites no banco, exclusão de publicado, outro setor "não encontrado", atendente sem permissão recusado) e unitários.*
- [x] **CA-KB-03** — A página do serviço mostra só os artigos publicados, na ordem de 4.2, como texto simples. Um rascunho nunca aparece ao solicitante. *Verificado em 2026-11-06: unitários (ordem e parágrafos como texto, sem HTML), integração (rascunho e serviço inativo não aparecem) e E2E (rascunho invisível, publicado visível).*
- [x] **CA-KB-04** — Cada mudança entra na auditoria com quem fez e o que mudou. *Verificado em 2026-11-06: integração (CREATED, 3 UPDATED e DELETED na auditoria; o texto longo não é copiado).*
- [x] **CA-KB-05** — Nenhuma dependência nova; a migration é aditiva. *Verificado em 2026-11-06: `package.json` sem mudança; a migration acrescenta um valor ao tipo de entidade da auditoria e uma tabela.*

## 7. Testes

- **Unitários:** validação, regras de escopo e de exclusão, ordenação e telas.
- **Integração:** schema, casos de uso por perfil e setor, leitura publicada e auditoria.
- **E2E:** o administrador escreve e publica um artigo; o solicitante o vê na página do serviço; um rascunho não aparece.

## 8. Tarefas

- **SF-156** — Migration e módulo `knowledge` (domínio, casos de uso, persistência, auditoria), com unitários e integração.
- **SF-157** — Seção da administração, bloco em "Serviços do setor", bloco no catálogo, E2E e registros.

## 9. Decisões tomadas (2026-11-06)

- **K1 — Os mesmos responsáveis pelo catálogo:** quem cuida do serviço sabe o que orientar, e as permissões já existem.
- **K2 — Só na página do serviço:** é onde a dúvida aparece; uma busca geral fica para uma SPEC futura.
- **K3 — Texto simples:** evita HTML e riscos de injeção; parágrafos bastam para orientações.
- **K4 — Nasce como rascunho:** permite revisar antes de mostrar ao solicitante.
- **K5 — Só rascunho se exclui:** evita sumir com uma orientação publicada por engano; despublicar é o primeiro passo.
- **K6 — Auditado como o catálogo:** artigos orientam o público e devem ter rastro de quem mudou.
- **K7 — Posição numérica simples:** permite ordenar sem arrastar e soltar; os empates vão por título.
