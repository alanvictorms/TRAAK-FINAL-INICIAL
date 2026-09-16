# TrakAquire — PRD

## Problema Original
Plataforma de operação e atribuição para iGaming. Conecta clique → pessoa → canal/conversa → cadastro/depósito → atribuição → análise.

## Arquitetura
- Backend: FastAPI + MongoDB (motor) + JWT auth + emergentintegrations (Copiloto IA)
- Frontend: React + shadcn/ui + Tailwind (tema Forest/Lime Littlebee)
- Tema: fundo #031614, primário #B8FF59, Inter Variable

## Usuários
- Owner/Admin (platform_admin), Gestor, Analista, Atendente, Expert, Viewer

## O que foi implementado (16/09/2026)
- Auth completo (JWT, register, login, logout, refresh, forgot/reset password, brute force)
- Shell com sidebar (Overview, Connect, Observe, Operate, Prove, Config, Platform)
- F01 Comando: checklist onboarding, stats, ações rápidas
- F02 Analytics: mídia por fonte, atendimento básico
- F04 Integrações: CRUD completo, config credenciais, teste, catálogo 10 provedores
- F05 Domínios: CRUD, DNS/SSL/health tabs
- F06 Tracking: CRUD links, UTMs, slug uniqueness
- F07 Signal Ledger: CRUD eventos, deduplicação, filtros tipo/status, detalhe payload
- F08 Monitoramento: health integrações, DLQ, reprocessamento
- F09 Players: CRUD, ficha com eventos/conversas, filtros, tags
- F10 Identity Graph: listagem, confiança, PII vault com mascaramento
- F11 Inbox: conversas, mensagens, assumir, transferir, encerrar, notas internas
- F12 Automações: CRUD, editor com paleta 13 nós, publicar/pausar
- F13 Segmentos: builder E/OU, campos, operadores, presets
- F14 Disparos: compositor canal/segmento/agendamento, pré-voo info
- F15 Campanhas: CRUD, plataforma, orçamento, métricas
- F16 Receita: P&L, FTDs, net deposit, CPFTD, ROI, coortes
- F17 Relatórios: CRUD, tipo/período/métricas/dimensões
- F18 Governança: policies, aprovações aprovar/rejeitar, kill switches, PII vault, auditoria
- F19 Settings: workspace, equipe, API keys, auditoria
- P01-P04 Platform: overview, tenants, planos
- P09 Provedores IA: CRUD com provider/model/api_key configurável
- Copiloto: backend SSE streaming com GPT 5.4 Mini via emergentintegrations

## Backlog Prioritizado
### P0 (próxima entrega)
- Copiloto chat completo no frontend (streaming)
- Busca global funcional
- Notificações persistidas UI
- Fontes de tráfego página dedicada
- Faturamento / billing settings

### P1
- Área pública: /docs, /pricing, /status, /legal/*
- Convite: /convite/:token aceitar/recusar
- P05-P08: planos detalhados, direitos, medição, faturas
- P10-P13: roteamento IA, prompts, custo IA, guardrails
- Detalhe por provedor de integração (Meta CAPI, TAP postback, Telegram webhook)

### P2
- P14-P23: APIs registry, reliability, incidents, status page, releases, support, announcements, compliance, staff, settings plataforma
- Analytics gráficos temporais, funil visual, comparação períodos
- Automações: canvas visual drag-and-drop
- Tracking: detalhe link (A/B, regras, QR, snippet)
