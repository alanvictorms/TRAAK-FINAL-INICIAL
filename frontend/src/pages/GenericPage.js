import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Inbox, Layers, Target, Send, Megaphone, FileText, Shield, CheckSquare, Globe, Fingerprint, Radar, Bell, CreditCard, Map } from 'lucide-react';

const icons = { domains: Globe, sources: Radar, monitoring: Radar, identity: Fingerprint, automations: Layers, segments: Target, disparos: Send, campaigns: Megaphone, reports: FileText, governance: Shield, approvals: CheckSquare, billing: CreditCard, notifications: Bell, roadmap: Map };

export default function GenericPage({ title, module }) {
  const Icon = icons[module] || Layers;
  const location = useLocation();
  const [data, setData] = useState(null);

  useEffect(() => {
    const endpoints = {
      domains: '/domains', monitoring: '/monitoring', identity: '/identity',
      automations: '/automations', segments: '/segments', disparos: '/disparos',
      campaigns: '/media', reports: '/reports', governance: '/governance',
      approvals: '/approvals', sources: '/tracking/sources',
    };
    const ep = endpoints[module];
    if (ep) {
      api.get(ep).then(r => setData(r.data)).catch(() => {});
    }
  }, [module]);

  const total = data?.total ?? data?.items?.length ?? 0;

  return (
    <div data-testid={`${module}-page`}>
      <div className="page-header">
        <div>
          <h1>{title}<span className="accent">.</span></h1>
          <p className="page-description">Módulo {title.toLowerCase()} do workspace.</p>
        </div>
        {total > 0 && <Badge variant="outline" className="text-[9px]">{total} registros</Badge>}
      </div>
      <div className="empty-state" style={{ minHeight: '300px' }}>
        <Icon size={40} />
        <h3>{title}</h3>
        <p>
          {total > 0
            ? `${total} registros encontrados neste módulo.`
            : 'Nenhum registro ainda. Crie o primeiro para começar a operar.'}
        </p>
      </div>
    </div>
  );
}
