# Segurança e privacidade

Dados de saúde são **dados pessoais sensíveis** (LGPD, art. 5º II e art. 11). A regra é: cada pessoa vê só o
necessário para a sua função, e tudo o que envolve dado clínico é rastreável.

## Autenticação e sessão

- Usuário individual (nunca compartilhado). Senhas com **argon2id** (perfil OWASP: 19 MiB, t=2); mínimo de 10
  caracteres com letras e números, lista de senhas comuns recusada, não pode conter o usuário.
- **Mensagem idêntica** para usuário inexistente, senha errada, conta inativa ou bloqueada, com tempo igualado
  (hash descartável) — não revela quais usuários existem.
- **Bloqueio** após 5 falhas por 15 min (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`) + rate limit por IP no login
  (API e Nginx).
- **Sessão opaca no servidor** (não JWT): o cookie leva 256 bits aleatórios; o banco guarda só o SHA-256. Permite
  revogação imediata (logout, troca/reset de senha, usuário desativado). Cookie `httpOnly`, `Secure`, `SameSite=Lax`,
  prefixo `__Host-` em produção.
- Expiração por **inatividade** (padrão 30 min) e **absoluta** (12 h), configuráveis; aviso 2 min antes na tela.
- Senha temporária (criação/reset pelo admin) ⇒ **troca obrigatória** antes de qualquer outra ação.

## Autorização (RBAC, menor privilégio)

Guard global **nega por padrão**: endpoint sem declaração de permissão é recusado. Além da permissão, há regras
por objeto (só quem está com o paciente edita a triagem; só o médico responsável edita a consulta; triagem não
reabre triagens já encerradas). Tentativas negadas são auditadas (`ACCESS_DENIED`).

| Perfil | Pode | Não pode (por padrão) |
|---|---|---|
| Recepção | buscar/cadastrar pacientes, ver documentos completos, criar e cancelar (antes da triagem) atendimentos, ver situação e linha do tempo geral | ver triagem, classificação, diagnóstico, prescrição |
| Triagem | fila, triagem, sinais vitais, classificar, acessibilidade, cancelar durante a triagem | prescrever, chamar paciente, ver consultas, ver documentos completos |
| Médico | fila médica, chamar, atender, diagnosticar, prescrever, finalizar, corrigir com motivo, reclassificar com motivo, histórico | administrar usuários, ver documentos completos |
| Administrador | usuários, perfis, setores, consultórios, parâmetros, indicadores, relatórios agregados, auditoria | **nenhum dado clínico** (pode ser concedido explicitamente na matriz, ficando auditado) |

O perfil Administrador não pode perder as permissões de gestão de usuários/perfis, e ninguém pode desativar a si
mesmo (evita trancar todos fora do sistema).

## Proteções da aplicação

| Ameaça | Proteção |
|---|---|
| SQL Injection | Prisma (consultas parametrizadas); SQL manual só com *tagged templates* parametrizados |
| XSS | React escapa toda saída; nenhum `dangerouslySetInnerHTML` com dados; CSP; cookie `httpOnly` |
| CSRF | `SameSite=Lax` + verificação de `Origin` + cabeçalho `X-Requested-With` obrigatório |
| Mass assignment | schemas zod descartam campos desconhecidos |
| Entrada inválida | o mesmo zod valida na tela e na API; CHECKs no banco como última barreira |
| Força bruta | bloqueio por usuário + rate limit (API e Nginx) |
| Vazamento por erro | filtro global: só mensagens amigáveis + `requestId`; detalhe técnico no log |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS |
| Cache de dados sensíveis | `Cache-Control: no-store` em toda resposta da API |
| Redirecionamento aberto | o retorno pós-login aceita só caminhos internos |

## Auditoria e rastreabilidade

- `audit_logs`: usuário, setor, ação, entidade, paciente, atendimento, IP, user-agent, `requestId`, data/hora.
  Gravado **na mesma transação** da mudança (sem auditoria, sem mudança). Inclui **leituras** de dados clínicos
  (`CLINICAL_RECORD_VIEWED`, `TRIAGE_VIEWED`, `CLINICAL_HISTORY_VIEWED`…), buscas (só os critérios, nunca o valor
  digitado) e consultas à própria auditoria.
- Dados clínicos: a auditoria guarda **nomes dos campos** alterados; o conteúdo anterior fica em
  `clinical_record_versions`. Cadastro: guarda antes/depois com documentos mascarados.
- `access_logs`: logins, falhas, bloqueios, expirações, trocas e resets de senha.
- **Imutável no banco**: triggers recusam UPDATE/DELETE/TRUNCATE em auditoria, linha do tempo, histórico de status,
  classificações, sinais vitais, chamadas, versões e notas. O usuário da API (`hospital_app`) também não tem esses
  privilégios.

## Privacidade

- Painel público e TV: **somente** senha, número do atendimento e consultório.
- Notificações internas: sem nome nem dado clínico (“Atendimento ATD-… aguardando triagem”).
- Eventos de tempo real: só IDs; o cliente rebusca com permissão.
- Listas e buscas: CPF/CNS/telefone mascarados.
- Logs da API: sem corpo, query string, cookies ou documentos (redação automática de chaves sensíveis).
  Nginx: formato de log sem query string (a busca usa `?q=`).
- Relatórios: só agregados; grupos de acessibilidade com menos de 3 casos aparecem como “<3”.
- Bilhete impresso: senha, ATD e horário — sem nome.

## Segredos e ambientes

- Nenhum segredo no código ou no git: `DATABASE_URL`, `PUBLIC_PANEL_KEY`, senhas de bootstrap e frase-senha do
  backup vêm de variáveis/arquivos fora do repositório (`.gitignore` e `.dockerignore` cobrem `.env*`,
  `deploy/env/*.env`, `deploy/secrets/`, certificados, backups, prints).
- A API **recusa iniciar** com combinações perigosas: produção com banco `*_dev`/`*_test`, desenvolvimento com
  banco `*_prod`/`*_staging`, produção sem HTTPS/cookie seguro.
- A suíte de testes só recria bancos `*_test`; o seed só roda em development/test.

## Limitações conhecidas e recomendações

1. **Criptografia em repouso**: o sistema não cifra colunas individualmente (CPF fica em texto no banco para permitir
   busca exata). Use disco/volume criptografado no servidor do banco e backups cifrados (já feito pelo `backup.sh`).
2. **Rate limit em memória**: correto com uma instância da API. Com várias, use o armazenamento Redis do throttler.
3. **2º fator (MFA)**: não implementado; recomendado para administradores se o sistema for exposto fora da intranet.
4. **Painel público**: sem `PUBLIC_PANEL_KEY`, qualquer um na rede vê senhas/ATD/consultórios (dados não
   identificáveis, mas configure a chave em produção).
5. **Catálogo CID-10 e de medicamentos**: texto livre com validação de formato; integração com catálogos oficiais é
   evolução futura.
6. Faça teste de intrusão independente e um RIPD (Relatório de Impacto à Proteção de Dados) antes de dados reais.
