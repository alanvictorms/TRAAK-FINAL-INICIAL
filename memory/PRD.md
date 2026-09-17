# TrakAquire — PRD Completo

## 1. Visão do Produto
Plataforma de operação e atribuição para aquisição em iGaming. Conecta: clique → pessoa → canal/conversa → cadastro/depósito confirmado pelo provedor → atribuição e reconciliação → análise e otimização.

## 2. Arquitetura
- **Backend**: FastAPI + MongoDB (motor) + JWT auth + emergentintegrations (Copiloto IA GPT 5.4 Mini)
- **Frontend**: React 19 + shadcn/ui + Tailwind CSS (tema Forest/Lime Littlebee)
- **Tema**: fundo `#031614`, primário `#B8FF59`, fonte Inter Variable
- **DB**: MongoDB local via MONGO_URL, DB_NAME=test_database
- **Auth**: JWT (access 1h + refresh 7d), bcrypt, brute force protection, admin seed

## 3. Áreas do Sistema
| Área | Acesso | Rotas |
|------|--------|-------|
| Workspace operacional | Autenticado + workspace_id | /command, /analytics, /integrations, /domains, /tracking, /ledger, /monitoring, /players, /identity, /inbox, /automations, /segments, /disparos, /media, /revenue, /reports, /governance, /approvals |
| Configurações | Owner/Admin do workspace | /settings/* |
| Administração global | is_platform_admin=true | /platform/* |
| Área pública | Todos | /login, /docs, /pricing, /status, /legal/* |

## 4. Grupos de Navegação (sidebar)
- **OVERVIEW**: Comando (F01), Analytics mídia/atendimento (F02/F03)
- **CONNECT**: Integrações (F04), Domínios (F05), Links (F06)
- **OBSERVE**: Signal Ledger (F07), Monitoramento (F08), Players (F09), Identity Graph (F10)
- **OPERATE**: Inbox (F11), Automações (F12), Segmentos (F13), Disparos (F14), Campanhas (F15)
- **PROVE**: Receita (F16), Relatórios (F17), Governança (F18), Aprovações
- **CONFIGURAÇÕES**: Operação, Equipe, API, Auditoria
- **PLATAFORMA** (admin): Overview, Tenants, Planos, Provedores IA

## 5. Jornada Central
1. Configurar workspace, domínio, integrações (Connect)
2. Criar link de tracking com UTMs → captura clique com click_id
3. Postback do provedor (TAP) confirma registro/FTD/depósito via webhook
4. Evento deduplicado no Signal Ledger → vincula a Player via person_id
5. Player atualiza stats (FTD, depósitos, saques)
6. Inbox para atendimento, Automações para engajamento
7. Revenue consolida P&L, Analytics cruza métricas por fonte
8. Governança controla aprovações e kill switches

## 6. Integrações Suportadas
| Provedor | Categoria | Campos de Configuração | Status |
|----------|-----------|----------------------|--------|
| TAP | revenue | api_key, api_secret, postback_url, webhook_secret | ✅ Webhook implementado |
| Meta Ads | acquisition | app_id, app_secret, access_token, pixel_id, ad_account_id | ✅ Config dinâmica |
| Google Ads | acquisition | customer_id, mcc_id, developer_token, client_id, refresh_token | ✅ Config dinâmica |
| TikTok | acquisition | app_id, app_secret, access_token, pixel_id | ✅ Config dinâmica |
| Telegram | messaging | bot_token, webhook_url, bot_username | ✅ Config dinâmica |
| WhatsApp | messaging | phone_number_id, access_token, waba_id, verify_token | ✅ Config dinâmica |
| Zenvia SMS | messaging | api_token, sender_id | ✅ Config dinâmica |
| Zenvia Voz | messaging | api_token, caller_id | ✅ Config dinâmica |
| Cloudflare | infra | api_token, zone_id, account_id | ✅ Config dinâmica |
| OpenAI | ia | api_key, model, org_id | ✅ Config dinâmica |

## 7. Status de Implementação

### ✅ IMPLEMENTADO E FUNCIONAL
- Auth completo (login/register/logout/refresh/forgot/reset, brute force, admin seed)
- Shell Forest/Lime com sidebar completa e responsivo
- F01 Comando: checklist onboarding real, stats, ações rápidas
- F02 Analytics: agregação por fonte, atendimento (fila/ativos)
- F04 Integrações: CRUD com campos dinâmicos por provedor, teste, catálogo
- F05 Domínios: CRUD, DNS/SSL/health tabs, detalhe
- F06 Tracking: CRUD links, UTMs, slug unique
- F07 Signal Ledger: CRUD, deduplicação por external_id, filtros, detalhe payload
- F08 Monitoramento: health integrações, DLQ, reprocessamento
- F09 Players: CRUD, ficha completa (eventos, conversas, tags)
- F10 Identity Graph: listagem, confiança, PII vault mascaramento/revelação
- F11 Inbox: conversas, mensagens, assumir/encerrar, tempo real via SSE e painel CRM do lead com status, responsável, orçamento, contatos, tags, tarefas, financeiro, UTM, notas, engajamento e atividade
- F12 Automações: CRUD, editor visual React Flow, nós/arestas persistidos, vínculo obrigatório com conexão WhatsApp/Telegram, publicar/pausar, Analytics por bloco e histórico detalhado de execuções
- F13 Segmentos: builder E/OU, 8 campos, 7 operadores, 4 presets
- F14 Disparos: compositor com canal/segmento/agendamento, pré-voo
- F15 Campanhas: CRUD, plataforma, orçamento, métricas
- F16 Receita: P&L, FTDs, net deposit, CPFTD, ROI, decisões pendentes D05
- F17 Relatórios: CRUD, tipo/período/métricas/dimensões
- F18 Governança: policies, aprovações (aprovar/rejeitar), kill switches, PII vault, auditoria completa
- F19 Settings: workspace config, equipe + convites, API keys criar/revogar, audit log
- P01-P04 Platform: overview global, tenants, planos
- P09 Provedores IA: CRUD com provider/model/api_key no admin
- Copiloto IA: backend SSE streaming, config do admin ou fallback EMERGENT_LLM_KEY
- TAP Webhook: POST /api/webhooks/tap recebe postback, valida assinatura, deduplica, cria evento + atualiza player
- Telegram Updates: webhook por conexão, registro via Bot API, deduplicação e ingestão normalizada no Inbox
- Meta/WhatsApp: verificação e ingestão assinada de mensagens; endpoint CAPI por integração com envio ao Graph e registro no Signal Ledger

### ⚠️ PARCIAL (funciona mas falta profundidade)
- F02 Analytics: falta gráficos temporais, funil visual, comparação períodos, KPIs customizáveis
- F03 Atendimento: falta métricas 1ª resposta detalhadas, equipe, motivos, etiquetas
- F06 Tracking: falta detalhe link (A/B split visual, regras device/geo, QR, snippet)
- Copiloto: backend pronto, frontend falta chat streaming completo
- Busca global: campo existe, lógica de busca multi-módulo falta
- Notificações: endpoint existe, UI de listagem falta

### ❌ NÃO INICIADO
- Área pública: /docs, /pricing, /status, /legal/*
- Convite: /convite/:token aceitar/recusar
- P05-P08: planos detalhados, direitos/entitlements, medição uso, faturas
- P10-P13: roteamento IA, prompts versionados, custo IA, guardrails
- P14-P23: APIs registry, reliability SLOs, incidents, status page, releases, support console, announcements, compliance, staff global, settings plataforma
- Settings: faturamento, notificações config
- Métricas: catálogo central de definições versionadas (F06 seção 6)
- Coortes: endpoint existe, UI falta
- Exportação: CSV/PDF de tabelas

## 8. Decisões Pendentes (do fundador)
| ID | Decisão | Impacto |
|----|---------|---------|
| D01 | Tenant vs workspace vs operação | Nomenclatura e hierarquia |
| D02 | Etapas/pesos do onboarding | Checklist configurável |
| D03 | Estados/saúde integrações, promoção piloto | Janela/limiar por capacidade |
| D04 | Atribuição, unicidade FTD, click_id, fusão | Regra de atribuição (30d/last click = referência) |
| D05 | ROI, payout, margem, LTV, ticket | Fórmulas financeiras definitivas |
| D06 | Conversão por atendente, SLA, valor fila | Métricas de atendimento |
| D07 | Versionamento fluxo, segmento dinâmico/congelado | Publicação/pausa semântica |
| D08 | Aprovação vs execução, limiares, fechamento período | Estornos/ajustes tardios |
| D09 | Retenção por classe de dado | Política de exclusão |
| D10 | Matriz de acesso completa, preços, quotas | Permissões granulares |
| D11 | Cadastro/trial, textos públicos, rollout | Área pública e trial |

## 9. Próximos Passos Priorizados
1. **P0**: Copiloto frontend streaming, busca global, notificações UI
2. **P1**: Área pública, convites, detalhe por provedor, P05-P13
3. **P2**: Analytics avançado, automações canvas, exportação, P14-P23

## 10. Credenciais de Acesso
- Admin: netosantana.1mbuv1@bumpmail.io / TrakAdmin2026!
- Papel: owner + is_platform_admin=true
- Webhook TAP: POST /api/webhooks/tap (assinatura HMAC-SHA256 no header X-TAP-Signature)
