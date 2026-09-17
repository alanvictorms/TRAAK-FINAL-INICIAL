import { useCallback, useEffect, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Bot, Brain, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const fail = err => toast.error(formatApiError(err.response?.data?.detail));
const TEMPLATES = {
  Vendas: 'Você é um vendedor da operação falando com {{nome}}.\n\nApresente os benefícios, tire dúvidas e leve o lead ao primeiro depósito.\n\n- Pergunte o que o lead procura\n- Ofereça o bônus vigente\n- Se pedir condição especial, transfira para humano',
  Suporte: 'Você é o suporte da operação falando com {{nome}}.\n\nResolva dúvidas de cadastro, depósito e saque com respostas curtas.\n\n- Confirme o problema antes de responder\n- Nunca prometa prazo que não seja oficial\n- Caso financeiro travado, transfira para humano',
  Geral: 'Você é um atendente da operação falando com {{nome}}.\n\nSeja cordial, prestativo e responda de forma clara e objetiva.',
  Qualificação: 'Você qualifica leads da operação falando com {{nome}}.\n\nDescubra origem, interesse e se já depositou. Faça uma pergunta por vez e registre o interesse.',
};
const EMPTY = {
  name: '', description: '', avatar: 0, mode: 'suggested', audience: 'external', model: 'claude-haiku-4-5-20251001',
  channels: [], humanize: { typing: true, delay: true, wait_lead: true }, prompt: '', tone: 'amigavel',
  max_words: 100, temperature: 0.7, guidelines: '', memory_messages: 30,
  hours: { enabled: true, days: ['seg', 'ter', 'qua', 'qui', 'sex'], start: '09:00', end: '18:00', outside: 'ai' },
  triggers: { new_lead: true, keywords_enabled: false, keywords: [], idle_enabled: false, idle_hours: 24, silence_enabled: false, operator_silence_min: 30 },
  filters: { skip_assigned: true, excluded_tags: [] },
  followup_enabled: false, followups: [{ after_min: 60, tone: 'leve' }],
  handoff: { keywords: [], max_replies: 0, on_fail: 'human', message: '' },
  status: 'inactive',
};

function Section({ icon: Icon, title, hint, children }) {
  return (
    <section className="agent-section">
      <header><span className="agent-section-icon"><Icon size={13} /></span><div><strong>{title}</strong><small>{hint}</small></div></header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, testid }) {
  return (
    <div className="agent-toggle">
      <div><span>{label}</span><small>{hint}</small></div>
      <Switch checked={!!checked} onCheckedChange={onChange} data-testid={testid} />
    </div>
  );
}

function Chips({ values = [], onChange, placeholder, testid }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map(v => (
          <Badge key={v} variant="outline" className="text-[9px] gap-1 pr-1">{v}
            <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(values.filter(x => x !== v))}>×</button>
          </Badge>
        ))}
      </div>
      <Input className="text-xs h-8" value={draft} placeholder={placeholder} data-testid={testid}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

function AgentForm({ agent, options, onSaved, onClose }) {
  const [form, setForm] = useState(agent || { ...EMPTY, prompt: options.default_prompt || '' });
  const [tab, setTab] = useState('config');
  const [chat, setChat] = useState({ input: '', history: [] });
  const [runs, setRuns] = useState([]);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const setIn = (key, patch) => setForm(f => ({ ...f, [key]: { ...f[key], ...patch } }));

  useEffect(() => {
    if (tab === 'history' && form._id) api.get(`/ai-agents/${form._id}/runs`).then(r => setRuns(r.data.items)).catch(() => {});
  }, [tab, form._id]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form._id) await api.put(`/ai-agents/${form._id}`, form);
      else await api.post('/ai-agents', form);
      toast.success('Agente salvo');
      onSaved();
    } catch (err) { fail(err); }
  };

  const test = async () => {
    if (!form._id) { toast.error('Salve o agente antes de testar'); return; }
    const message = chat.input.trim();
    if (!message) return;
    setChat(c => ({ input: '', history: [...c.history, { role: 'user', content: message }] }));
    try {
      const { data } = await api.post(`/ai-agents/${form._id}/test`, { message, history: chat.history });
      setChat(c => ({ ...c, history: [...c.history, { role: 'assistant', content: data.reply }] }));
    } catch (err) { fail(err); }
  };

  return (
    <form onSubmit={save} className="agent-form">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="config" className="text-xs">Configuração</TabsTrigger>
          <TabsTrigger value="test" className="text-xs">Testar</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-3 space-y-3">
          <Section icon={Bot} title="Identidade" hint="Como o agente se chama e o que ele faz">
            <div><Label className="text-xs">Nome do agente</Label><Input required className="text-xs mt-1" placeholder="Ex: Atendente de vendas" value={form.name} onChange={e => set({ name: e.target.value })} data-testid="agent-name" /></div>
            <div><Label className="text-xs">Descrição (interna)</Label><Input className="text-xs mt-1" placeholder="Para que serve este agente" value={form.description || ''} onChange={e => set({ description: e.target.value })} /></div>
            <div>
              <Label className="text-xs">Avatar</Label>
              <div className="agent-avatars">
                {[0, 1, 2, 3].map(i => (
                  <button key={i} type="button" className={`agent-avatar av-${i} ${form.avatar === i ? 'is-selected' : ''}`} aria-label={`Avatar ${i + 1}`} onClick={() => set({ avatar: i })}>
                    <Bot size={20} />
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section icon={Sparkles} title="Atuação" hint="Onde e como o agente responde">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(options.modes || {}).map(([key, label]) => (
                <button key={key} type="button" className={`agent-choice ${form.mode === key ? 'is-selected' : ''}`} onClick={() => set({ mode: key })} data-testid={`mode-${key}`}>
                  <strong>{key === 'suggested' ? 'Sugerido' : 'Automático'}</strong><small>{label}</small>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Tipo de atendimento</Label>
                <Select value={form.audience} onValueChange={v => set({ audience: v })}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(options.audiences || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Modelo da IA</Label>
                <Select value={form.model} onValueChange={v => set({ model: v })}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{(options.models || []).map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Canais</Label>
              {(options.channels || []).length === 0 ? (
                <p className="text-[10px] text-muted-foreground mt-1">Nenhum canal cadastrado. Crie uma integração de mensageria para vincular o agente.</p>
              ) : (
                <div className="flex flex-wrap gap-1 mt-1">
                  {options.channels.map(c => (
                    <button key={c.id} type="button" className={`agent-chip ${form.channels.includes(c.id) ? 'is-selected' : ''}`}
                      onClick={() => set({ channels: form.channels.includes(c.id) ? form.channels.filter(x => x !== c.id) : [...form.channels, c.id] })}>
                      {c.name} · {c.provider}
                    </button>
                  ))}
                  <span className="text-[9px] text-muted-foreground self-center">{form.channels.length ? '' : 'nenhum marcado = todos os canais'}</span>
                </div>
              )}
            </div>
          </Section>

          <Section icon={Sparkles} title="Humanização" hint="Faz a IA parecer mais natural ao responder">
            <Toggle label='Mostrar "digitando…"' hint="exibe o indicador antes de enviar a mensagem" checked={form.humanize.typing} onChange={v => setIn('humanize', { typing: v })} />
            <Toggle label="Pausa entre mensagens" hint="quando a IA gera várias mensagens seguidas" checked={form.humanize.delay} onChange={v => setIn('humanize', { delay: v })} />
            <Toggle label="Aguardar o lead terminar de digitar" hint="junta mensagens em rajada e responde uma vez só" checked={form.humanize.wait_lead} onChange={v => setIn('humanize', { wait_lead: v })} />
          </Section>

          <Section icon={Bot} title="Comportamento" hint="Personalidade, prompt e tom de voz">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Prompt do agente</Label>
              <div className="flex gap-1">
                {Object.keys(TEMPLATES).map(t => (
                  <button key={t} type="button" className="agent-chip" onClick={() => set({ prompt: TEMPLATES[t] })}>{t}</button>
                ))}
              </div>
            </div>
            <Textarea required rows={7} className="text-xs" value={form.prompt} onChange={e => set({ prompt: e.target.value })} data-testid="agent-prompt" />
            <div className="flex flex-wrap gap-1">
              <span className="text-[9px] text-muted-foreground self-center">Variáveis:</span>
              {(options.variables || []).map(v => (
                <button key={v} type="button" className="agent-chip" onClick={() => set({ prompt: `${form.prompt}{{${v}}}` })}>{`{{${v}}}`}</button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Tom de voz</Label>
                <Select value={form.tone} onValueChange={v => set({ tone: v })}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(options.tones || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Máx. palavras</Label><Input type="number" min={20} max={600} className="text-xs mt-1" value={form.max_words} onChange={e => set({ max_words: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Temperatura</Label><Input type="number" min={0} max={1} step={0.1} className="text-xs mt-1" value={form.temperature} onChange={e => set({ temperature: Number(e.target.value) })} /><small className="text-[9px] text-muted-foreground">0 = previsível · 1 = criativo</small></div>
            </div>
            <div><Label className="text-xs">Diretrizes adicionais</Label><Textarea rows={3} className="text-xs mt-1" placeholder="Ex: foco em planos premium. Não dar desconto sem aprovação." value={form.guidelines || ''} onChange={e => set({ guidelines: e.target.value })} /></div>
            <div><Label className="text-xs">Memória de contexto (últimas mensagens)</Label><Input type="number" min={5} max={100} className="text-xs mt-1 w-32" value={form.memory_messages} onChange={e => set({ memory_messages: Number(e.target.value) })} />
              <small className="text-[9px] text-muted-foreground">Quantas mensagens passadas a IA recebe. Aumente se a conversa é longa e ela repete perguntas.</small>
            </div>
          </Section>

          <Section icon={Bot} title="Disponibilidade" hint="Quando o agente deve responder">
            <Toggle label="Limitar ao horário comercial" hint="fora desse horário, encaminha para humano" checked={form.hours.enabled} onChange={v => setIn('hours', { enabled: v })} testid="hours-enabled" />
            {form.hours.enabled && (
              <>
                <div className="flex flex-wrap gap-1">
                  {(options.weekdays || []).map(d => (
                    <button key={d} type="button" className={`agent-chip ${form.hours.days.includes(d) ? 'is-selected' : ''}`}
                      onClick={() => setIn('hours', { days: form.hours.days.includes(d) ? form.hours.days.filter(x => x !== d) : [...form.hours.days, d] })}>
                      {d}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Início</Label><Input type="time" className="text-xs mt-1" value={form.hours.start} onChange={e => setIn('hours', { start: e.target.value })} /></div>
                  <div><Label className="text-xs">Fim</Label><Input type="time" className="text-xs mt-1" value={form.hours.end} onChange={e => setIn('hours', { end: e.target.value })} /></div>
                </div>
                <div><Label className="text-xs">Fora do horário</Label>
                  <Select value={form.hours.outside} onValueChange={v => setIn('hours', { outside: v })}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(options.outside_hours || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
          </Section>

          <Section icon={Sparkles} title="Quando ativar" hint="Defina exatamente quando a IA responde">
            <Toggle label="Lead novo" hint="responde na primeira mensagem do lead" checked={form.triggers.new_lead} onChange={v => setIn('triggers', { new_lead: v })} testid="trigger-new" />
            <Toggle label="Palavras-chave" hint="ativa só quando o lead disser uma destas palavras" checked={form.triggers.keywords_enabled} onChange={v => setIn('triggers', { keywords_enabled: v })} />
            {form.triggers.keywords_enabled && <Chips values={form.triggers.keywords} onChange={v => setIn('triggers', { keywords: v })} placeholder="orçamento, preço, info… (Enter para adicionar)" testid="trigger-keywords" />}
            <Toggle label="Lead sem resposta há X horas" hint="operador não responde há tempo, a IA assume" checked={form.triggers.idle_enabled} onChange={v => setIn('triggers', { idle_enabled: v })} />
            {form.triggers.idle_enabled && <Input type="number" min={1} className="text-xs h-8 w-28" value={form.triggers.idle_hours} onChange={e => setIn('triggers', { idle_hours: Number(e.target.value) })} />}
            <Toggle label="Silêncio do operador (min)" hint="operador parou de responder há X minutos, a IA assume" checked={form.triggers.silence_enabled} onChange={v => setIn('triggers', { silence_enabled: v })} />
            {form.triggers.silence_enabled && <Input type="number" min={1} className="text-xs h-8 w-28" value={form.triggers.operator_silence_min} onChange={e => setIn('triggers', { operator_silence_min: Number(e.target.value) })} />}
          </Section>

          <Section icon={Bot} title="Filtros" hint="Quando não atender, mesmo com gatilho batendo">
            <Toggle label="Não atender lead já atribuído" hint="se tem operador responsável, a IA fica fora" checked={form.filters.skip_assigned} onChange={v => setIn('filters', { skip_assigned: v })} />
            <div>
              <Label className="text-xs">Etiquetas excluídas</Label>
              {(options.tags || []).length === 0 ? <p className="text-[10px] text-muted-foreground mt-1">Cadastre etiquetas em Configurações para usar aqui.</p> : (
                <div className="flex flex-wrap gap-1 mt-1">
                  {options.tags.map(t => (
                    <button key={t} type="button" className={`agent-chip ${form.filters.excluded_tags.includes(t) ? 'is-selected' : ''}`}
                      onClick={() => setIn('filters', { excluded_tags: form.filters.excluded_tags.includes(t) ? form.filters.excluded_tags.filter(x => x !== t) : [...form.filters.excluded_tags, t] })}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section icon={Sparkles} title="Follow-up automático" hint="Reabordagens quando o lead não responde">
            <Toggle label="Ativar follow-up" hint="a IA reaborda se o lead ficar em silêncio" checked={form.followup_enabled} onChange={v => set({ followup_enabled: v })} testid="followup-enabled" />
            {form.followup_enabled && (
              <>
                {form.followups.map((step, i) => (
                  <div key={i} className="agent-followup">
                    <span>#{i + 1}</span>
                    <div><Label className="text-[9px]">Após (min)</Label><Input type="number" min={1} className="text-xs h-8" value={step.after_min} onChange={e => set({ followups: form.followups.map((s, idx) => idx === i ? { ...s, after_min: Number(e.target.value) } : s) })} /></div>
                    <div className="flex-1"><Label className="text-[9px]">Tom</Label>
                      <Select value={step.tone} onValueChange={v => set({ followups: form.followups.map((s, idx) => idx === i ? { ...s, tone: v } : s) })}>
                        <SelectTrigger className="text-xs h-8 mt-0.5"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(options.followup_tones || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <button type="button" aria-label="Remover passo" onClick={() => set({ followups: form.followups.filter((_, idx) => idx !== i) })}>×</button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-full text-[10px]" onClick={() => set({ followups: [...form.followups, { after_min: 60, tone: 'leve' }] })}>+ Adicionar passo</Button>
                <p className="text-[9px]" style={{ color: 'hsl(42 70% 60%)' }}>O follow-up é cancelado quando o lead responde, quando alguém assume a conversa ou quando o agente é desligado.</p>
              </>
            )}
          </Section>

          <Section icon={Send} title="Transferência para humano" hint="Quando o agente deve passar para um operador">
            <div><Label className="text-xs">Palavras que transferem na hora</Label>
              <Chips values={form.handoff.keywords} onChange={v => setIn('handoff', { keywords: v })} placeholder="humano, atendente, falar com pessoa…" testid="handoff-keywords" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Máx. respostas por conversa</Label><Input type="number" min={0} className="text-xs mt-1" value={form.handoff.max_replies} onChange={e => setIn('handoff', { max_replies: Number(e.target.value) })} /><small className="text-[9px] text-muted-foreground">0 = sem limite</small></div>
              <div><Label className="text-xs">Quando a IA falhar</Label>
                <Select value={form.handoff.on_fail} onValueChange={v => setIn('handoff', { on_fail: v })}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(options.on_fail || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Mensagem de transferência</Label><Textarea rows={2} className="text-xs mt-1" placeholder="Vou te transferir para um atendente. Um momento." value={form.handoff.message || ''} onChange={e => setIn('handoff', { message: e.target.value })} /></div>
          </Section>
        </TabsContent>

        <TabsContent value="test" className="mt-3">
          <div className="stat-card p-3 space-y-2">
            <p className="text-[10px] text-muted-foreground">Conversa de teste. Nada é enviado para o cliente.</p>
            <div className="agent-test-log">
              {chat.history.length === 0 && <p className="text-[10px] text-muted-foreground">Escreva como se fosse o cliente.</p>}
              {chat.history.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'is-lead' : 'is-ai'}><span>{m.role === 'user' ? 'Cliente' : form.name || 'Agente'}</span><p>{m.content}</p></div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input className="text-xs" value={chat.input} onChange={e => setChat(c => ({ ...c, input: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); test(); } }} placeholder="Mensagem do cliente…" data-testid="agent-test-input" />
              <Button type="button" onClick={test} data-testid="agent-test-send"><Send size={13} /></Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <div className="stat-card p-3 max-h-[60vh] overflow-auto space-y-2">
            {runs.length === 0 && <p className="text-[10px] text-muted-foreground">O agente ainda não respondeu ninguém.</p>}
            {runs.map(run => (
              <div key={run._id} className="agent-run">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium">{run.player_name || 'Lead'}</span>
                  <span className="text-[9px] text-muted-foreground">{run.trigger} · {new Date(run.created_at).toLocaleString('pt-BR')}</span>
                </div>
                {run.error ? <p className="text-[10px] text-destructive">{run.error}</p> : (
                  <>
                    <p className="text-[10px] text-muted-foreground">Cliente: {run.incoming}</p>
                    <p className="text-xs">{run.reply}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter className="mt-4">
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" data-testid="submit-agent">{form._id ? 'Salvar agente' : 'Criar agente'}</Button>
      </DialogFooter>
    </form>
  );
}

function BrainPanel() {
  const [brain, setBrain] = useState(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api.get('/ai-brain').then(r => setBrain(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const addNote = async (e) => {
    e.preventDefault();
    try { await api.post('/ai-brain/notes', { text: note }); setNote(''); load(); } catch (err) { fail(err); }
  };
  const refresh = async () => {
    try { await api.post('/ai-brain/refresh'); load(); toast.success('Cérebro atualizado'); } catch (err) { fail(err); }
  };
  if (!brain) return null;
  return (
    <div className="stat-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Brain size={14} className="text-primary" /><strong className="text-xs">Cérebro da workspace</strong></div>
        <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={refresh} data-testid="refresh-brain">Atualizar</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">O agente lê isto antes de responder: volume de leads, fontes, assuntos, etiquetas e o que você ensinar aqui.</p>
      <div className="lead-metrics">
        <div className="lead-metric"><span>Leads</span><strong>{brain.players}</strong></div>
        <div className="lead-metric"><span>Com FTD</span><strong>{brain.ftds}</strong></div>
        <div className="lead-metric"><span>Conversas abertas</span><strong>{brain.open_conversations}</strong></div>
        <div className="lead-metric"><span>Atualizado</span><strong className="text-[10px]">{new Date(brain.updated_at).toLocaleString('pt-BR')}</strong></div>
      </div>
      <div>
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Assuntos que os leads mais trazem</p>
        <div className="flex flex-wrap gap-1">{(brain.subjects || []).map(s => <Badge key={s.term} variant="outline" className="text-[9px]">{s.term} · {s.count}</Badge>)}</div>
      </div>
      <div>
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Fontes</p>
        <div className="flex flex-wrap gap-1">{(brain.sources || []).map(s => <Badge key={s.source} variant="outline" className="text-[9px]">{s.source} · {s.count}</Badge>)}</div>
      </div>
      <div>
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Aprendizados que você ensinou</p>
        {(brain.notes_detail || []).map(n => (
          <div key={n._id} className="flex items-start gap-2 py-1 border-b border-border last:border-0">
            <p className="text-[10px] flex-1">{n.text}</p>
            <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remover aprendizado"
              onClick={async () => { await api.delete(`/ai-brain/notes/${n._id}`); load(); }}><Trash2 size={11} /></button>
          </div>
        ))}
        <form onSubmit={addNote} className="flex gap-2 mt-2">
          <Input className="text-xs h-8" placeholder="Ex: o bônus de boas-vindas é 100% até R$ 500" value={note} onChange={e => setNote(e.target.value)} data-testid="brain-note" />
          <Button type="submit" size="sm">Ensinar</Button>
        </form>
      </div>
    </div>
  );
}

export default function AIAgentsPage() {
  const [items, setItems] = useState([]);
  const [options, setOptions] = useState({});
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/ai-agents').then(r => setItems(r.data.items)).catch(() => {}), []);
  useEffect(() => { load(); api.get('/ai-agents/meta/options').then(r => setOptions(r.data)).catch(() => {}); }, [load]);

  const toggle = async (agent, active) => {
    try { await api.put(`/ai-agents/${agent._id}`, { status: active ? 'active' : 'inactive' }); load(); }
    catch (err) { fail(err); }
  };
  const remove = async (agent) => {
    if (!window.confirm(`Remover o agente “${agent.name}”?`)) return;
    try { await api.delete(`/ai-agents/${agent._id}`); load(); } catch (err) { fail(err); }
  };

  return (
    <div data-testid="ai-agents-page">
      <div className="page-header">
        <div><h1>Agentes de IA<span className="accent">.</span></h1><p className="page-description">Atendimento com IA: memória da operação, gatilhos, follow-up e transferência para humano.</p></div>
        <Button onClick={() => setEditing({})} data-testid="create-agent"><Plus size={14} className="mr-2" /> Novo agente</Button>
      </div>

      <div className="agent-grid">
        {items.length === 0 ? (
          <div className="stat-card empty-state" style={{ gridColumn: '1 / -1' }}>
            <Bot size={32} />
            <h3>Nenhum agente de IA</h3>
            <p>Crie o primeiro agente. Ele lê o cérebro da workspace antes de responder.</p>
          </div>
        ) : items.map(agent => (
          <div key={agent._id} className={`stat-card agent-card ${agent.status === 'active' ? 'is-active' : ''}`} data-testid={`agent-${agent._id}`}>
            <div className="flex items-start justify-between">
              <div className={`agent-avatar av-${agent.avatar || 0}`}><Bot size={20} /></div>
              <Switch checked={agent.status === 'active'} onCheckedChange={v => toggle(agent, v)} aria-label="Ativar agente" />
            </div>
            <strong className="text-sm mt-2 block">{agent.name}</strong>
            <span className="text-[10px] text-muted-foreground">{agent.description || (agent.mode === 'automatic' ? 'Responde sozinho' : 'Sugere para o operador')}</span>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="outline" className="text-[9px]">{(options.tones || {})[agent.tone] || agent.tone}</Badge>
              <Badge variant="outline" className="text-[9px]">{((options.models || []).find(m => m.id === agent.model) || {}).label || agent.model}</Badge>
              {agent.followup_enabled && <Badge variant="outline" className="text-[9px]">follow-up</Badge>}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="flex-1 text-[10px] h-7" onClick={() => setEditing(agent)}>Configurar</Button>
              <Button size="sm" variant="outline" className="text-[10px] h-7 text-destructive" onClick={() => remove(agent)}><Trash2 size={12} /></Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4"><BrainPanel /></div>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-auto">
          <DialogHeader><DialogTitle>{editing?._id ? `Agente ${editing.name}` : 'Novo agente de IA'}</DialogTitle></DialogHeader>
          {editing && <AgentForm agent={editing._id ? editing : null} options={options} onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
