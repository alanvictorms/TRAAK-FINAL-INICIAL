import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Archive, Ban, Check, ChevronDown, CircleDollarSign, ClipboardList,
  Mail, MapPin, Phone, Plus, Tags, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { money as fmtMoney } from '@/lib/utils';

const money = value => fmtMoney(value || 0);
const initials = name => (name || 'Lead').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

export default function LeadDetailsPanel({ conversation, onRefresh, onArchive, onClose }) {
  const [lead, setLead] = useState(conversation.lead || {});
  const [tag, setTag] = useState('');
  const [task, setTask] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setLead(conversation.lead || {}), [conversation]);

  const identifier = useMemo(() => {
    if (lead.phone) return lead.phone;
    if (lead.external_ids?.telegram_username) return `@${lead.external_ids.telegram_username}`;
    return lead.external_ids?.telegram_user_id || lead.external_ids?.whatsapp_user_id || 'Não informado';
  }, [lead]);

  const updateLead = async patch => {
    setSaving(true);
    setLead(current => ({ ...current, ...patch }));
    try {
      await api.put(`/inbox/${conversation._id}/lead`, patch);
      await onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao atualizar lead');
      setLead(conversation.lead || {});
    } finally { setSaving(false); }
  };

  const addTag = async event => {
    event.preventDefault();
    const value = tag.trim();
    if (!value || (lead.tags || []).includes(value)) return;
    await updateLead({ tags: [...(lead.tags || []), value] });
    setTag('');
  };

  const removeTag = value => updateLead({ tags: (lead.tags || []).filter(item => item !== value) });

  const addTask = async event => {
    event.preventDefault();
    if (!task.trim()) return;
    try {
      await api.post(`/inbox/${conversation._id}/tasks`, { title: task.trim() });
      setTask('');
      await onRefresh();
    } catch { toast.error('Erro ao criar tarefa'); }
  };

  const toggleTask = async taskId => {
    try { await api.put(`/inbox/${conversation._id}/tasks/${taskId}/toggle`); await onRefresh(); }
    catch { toast.error('Erro ao atualizar tarefa'); }
  };

  const blockLead = async () => {
    if (!window.confirm('Bloquear este lead e encerrar a conversa?')) return;
    await updateLead({ blocked: true });
    toast.success('Lead bloqueado');
  };

  return (
    <aside className="lead-details-panel" data-testid="lead-details-panel">
      <div className="lead-panel-close"><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar detalhes"><X size={15} /></Button></div>
      <div className="lead-profile">
        <div className="lead-avatar">{initials(lead.name)}</div>
        <Input className="lead-name-input" value={lead.name || ''} onChange={event => setLead(current => ({ ...current, name: event.target.value }))} onBlur={event => event.target.value !== conversation.lead?.name && updateLead({ name: event.target.value })} />
        <div className="lead-identifier">{identifier}</div>
        <Badge variant="outline" className="lead-channel-badge">{conversation.channel}</Badge>
      </div>

      <div className="lead-actions">
        <button type="button" onClick={() => lead.phone ? (window.location.href = `tel:${lead.phone}`) : toast.info('Telefone não informado')}><Phone /><span>Ligar</span></button>
        <button type="button" onClick={() => updateLead({ pipeline_stage: lead.pipeline_stage === 'Sem etapa' ? 'Em atendimento' : lead.pipeline_stage })}><ClipboardList /><span>Kanban</span></button>
        <button type="button" onClick={onArchive}><Archive /><span>Arquivar</span></button>
        <button type="button" onClick={blockLead} disabled={lead.blocked}><Ban /><span>{lead.blocked ? 'Bloqueado' : 'Bloquear'}</span></button>
      </div>

      <PanelSection title="Status">
        <div className="lead-grid-two">
          <Select value={lead.pipeline_stage || 'Sem etapa'} onValueChange={value => updateLead({ pipeline_stage: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Sem etapa">Sem etapa</SelectItem><SelectItem value="Novo lead">Novo lead</SelectItem><SelectItem value="Em atendimento">Em atendimento</SelectItem><SelectItem value="Qualificado">Qualificado</SelectItem><SelectItem value="Convertido">Convertido</SelectItem></SelectContent></Select>
          <Input placeholder="Responsável" value={lead.expert_name || ''} onChange={event => setLead(current => ({ ...current, expert_name: event.target.value }))} onBlur={event => event.target.value !== conversation.lead?.expert_name && updateLead({ expert_name: event.target.value })} />
        </div>
      </PanelSection>

      <PanelSection title="Valor de orçamento">
        <div className="budget-input"><CircleDollarSign size={14} /><Input type="number" min="0" step="0.01" value={lead.budget || ''} placeholder="0,00" onChange={event => setLead(current => ({ ...current, budget: event.target.value }))} onBlur={event => updateLead({ budget: Number(event.target.value || 0) })} /></div>
      </PanelSection>

      <PanelSection title="Contato">
        <DetailRow icon={Phone} label="Telefone / identificador" value={identifier} />
        <DetailRow icon={Mail} label="E-mail" value={lead.email || 'Não informado'} />
        <DetailRow icon={MapPin} label="Origem" value={`${lead.origin || conversation.channel} inbound`} accent />
      </PanelSection>

      <PanelSection title="Tags">
        <div className="lead-tags">{(lead.tags || []).map(value => <button type="button" key={value} onClick={() => removeTag(value)}><Tags size={10} />{value}<X size={9} /></button>)}</div>
        <form className="lead-inline-form" onSubmit={addTag}><Input value={tag} onChange={event => setTag(event.target.value)} placeholder="Adicionar tag" /><Button type="submit" size="icon" variant="outline"><Plus size={13} /></Button></form>
      </PanelSection>

      <PanelSection title={`Tarefas · ${(lead.tasks || []).filter(item => !item.completed).length}`}>
        <div className="lead-task-list">{(lead.tasks || []).map(item => <button type="button" key={item._id} className={item.completed ? 'is-complete' : ''} onClick={() => toggleTask(item._id)}><span>{item.completed && <Check size={10} />}</span>{item.title}</button>)}</div>
        <form className="lead-inline-form" onSubmit={addTask}><Input value={task} onChange={event => setTask(event.target.value)} placeholder="Nova tarefa" /><Button type="submit" size="icon" variant="outline"><Plus size={13} /></Button></form>
      </PanelSection>

      <PanelSection title="Financeiro">
        <div className="lead-metrics"><Metric label="Depósitos" value={money(lead.total_deposits)} /><Metric label="Saques" value={money(lead.total_withdrawals)} /><Metric label="FTD" value={lead.has_ftd ? money(lead.ftd_value) : '—'} /><Metric label="Saldo líquido" value={money((lead.total_deposits || 0) - (lead.total_withdrawals || 0))} /></div>
      </PanelSection>

      <PanelSection title="Marketing / UTM">
        {Object.keys(lead.utm || {}).length ? <div className="utm-list">{Object.entries(lead.utm).map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}</div> : <p className="lead-empty-copy">Nenhuma UTM registrada.</p>}
      </PanelSection>

      <PanelSection title="Notas internas">
        <Textarea rows={4} value={lead.internal_notes || ''} onChange={event => setLead(current => ({ ...current, internal_notes: event.target.value }))} onBlur={event => event.target.value !== conversation.lead?.internal_notes && updateLead({ internal_notes: event.target.value })} placeholder="Adicione observações sobre o lead..." />
        <small className="autosave-copy">{saving ? 'Salvando...' : 'Salvo automaticamente ao sair do campo'}</small>
      </PanelSection>

      <PanelSection title={`Engajamento · ${lead.message_count || 0} msg · ${lead.engagement_days || 1}d`}>
        <div className="lead-metrics"><Metric label="Mensagens" value={lead.message_count || 0} /><Metric label="No pipeline" value={`${lead.engagement_days || 1}d`} /></div>
      </PanelSection>

      <PanelSection title={`Atividade · ${(lead.activity || []).length}`}>
        <div className="activity-list">{(lead.activity || []).slice(0, 10).map((item, index) => <div key={`${item.type}-${index}`}><span /><p><strong>{item.label}</strong><small>{item.detail} · {item.at ? new Date(item.at).toLocaleString('pt-BR') : ''}</small></p></div>)}</div>
      </PanelSection>
    </aside>
  );
}

function PanelSection({ title, children }) {
  return <section className="lead-panel-section"><header><span>{title}</span><ChevronDown size={12} /></header>{children}</section>;
}

function DetailRow({ icon: Icon, label, value, accent }) {
  return <div className="lead-detail-row"><span><Icon size={13} /></span><p><small>{label}</small><strong className={accent ? 'accent-value' : ''}>{value}</strong></p></div>;
}

function Metric({ label, value }) {
  return <div className="lead-metric"><span>{label}</span><strong>{value}</strong></div>;
}
