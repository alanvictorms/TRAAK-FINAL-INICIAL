/** Rótulos em português para os status que vêm do servidor. */
const LABELS = {
  active: 'Ativo', inactive: 'Inativo', paused: 'Pausado', draft: 'Rascunho',
  configured: 'Configurado', connected: 'Conectado', available: 'Disponível', restricted: 'Restrito',
  error: 'Com erro', failed: 'Falhou', pending: 'Pendente', pending_dns: 'Aguardando DNS', dns_ok: 'DNS apontado',
  queued: 'Na fila', queue: 'Na fila', scheduled: 'Agendado', sending: 'Enviando', sent: 'Enviado',
  cancelled: 'Cancelado', resolved: 'Encerrada', running: 'Em execução', waiting: 'Aguardando',
  waiting_reply: 'Esperando resposta', completed: 'Concluída', blocked: 'Bloqueado',
  awaiting_approval: 'Aguardando aprovação', approved: 'Aprovada', rejected: 'Rejeitada',
  published: 'Publicado', valid: 'Válido', ok: 'Confirmado', divergent: 'Divergente',
  duplicate: 'Duplicado', ignored: 'Ignorado', processed: 'Processado', received: 'Recebido',
  high: 'Alta', medium: 'Média', low: 'Baixa',
};

export function statusLabel(value) {
  if (!value) return '—';
  return LABELS[value] || String(value).replace(/_/g, ' ');
}

export default statusLabel;
