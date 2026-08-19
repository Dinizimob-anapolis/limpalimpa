const db = require('./db');
const { staffPriceFor } = require('./pricing');

const STATUS_META = {
  pagou: { label: '✅ Pagou', color: '#1a7f37' },
  contratou: { label: '🟢 Contratou', color: '#2da44e' },
  aguardando_pagamento: { label: '⏳ Aguardando pagamento', color: '#9a6700' },
  nao_contratou: { label: '🔴 Não contratou', color: '#cf222e' },
  em_atendimento: { label: '🟡 Em atendimento', color: '#bf8700' },
};

const WORK_STATUS_META = {
  aguardando: { label: '⏸️ Aguardando', color: '#57606a' },
  em_andamento: { label: '🟡 Em andamento', color: '#bf8700' },
  concluido: { label: '✅ Concluído', color: '#1a7f37' },
};

function money(v) {
  if (v === null || v === undefined) return '—';
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function basicAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;

  if (!user || !pass) {
    return res.status(500).send('DASHBOARD_USER / DASHBOARD_PASSWORD não configurados.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    const reqUser = decoded.slice(0, sepIndex);
    const reqPass = decoded.slice(sepIndex + 1);
    if (reqUser === user && reqPass === pass) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Limpa Limpa Dashboard"');
  return res.status(401).send('Autenticação necessária.');
}

function clientRow(r) {
  const meta = STATUS_META[r.status] || { label: r.status, color: '#57606a' };
  const agenda = [r.scheduled_date, r.scheduled_time].filter(Boolean).join(' ');
  return `<tr>
    <td>${escapeHtml(r.client_name || '(sem nome)')}</td>
    <td><span class="badge" style="background:${meta.color}">${meta.label}</span></td>
    <td>${money(r.value)}</td>
    <td>${escapeHtml(r.service_type || (r.duration_hours ? `Faxina ${r.duration_hours}h` : '—'))}</td>
    <td>${escapeHtml(agenda || '—')}</td>
    <td>${escapeHtml(r.assigned_staff_name || '—')}</td>
    <td>${escapeHtml(r.address || '—')}</td>
    <td class="notes">${escapeHtml(r.notes || '')}</td>
  </tr>`;
}

function staffRow(r) {
  const meta = WORK_STATUS_META[r.work_status] || WORK_STATUS_META.aguardando;
  const horario = [r.start_time, r.end_time].filter(Boolean).join(' — ');
  const pay = r.duration_hours ? money(staffPriceFor(r.duration_hours)) : '—';
  return `<tr>
    <td>${escapeHtml(r.staff_name || '(sem nome)')}</td>
    <td><span class="badge" style="background:${meta.color}">${meta.label}</span></td>
    <td>${escapeHtml(r.serving_client_name || '—')}</td>
    <td>${escapeHtml(r.address || '—')}</td>
    <td>${r.duration_hours ? r.duration_hours + 'h' : '—'}</td>
    <td>${escapeHtml(horario || '—')}</td>
    <td>${pay}</td>
    <td class="notes">${escapeHtml(r.summary || '')}${r.pending_confirmation ? ' <span class="pending">⚠️ pendente</span>' : ''}</td>
  </tr>`;
}

function renderPage(dateStr, statusRows, scheduleRows, report, recentDates, activeTab) {
  const clientRowsHtml = statusRows.length
    ? statusRows.map(clientRow).join('')
    : `<tr><td colspan="8" class="empty">Nenhuma conversa de cliente registrada nesse dia.</td></tr>`;

  const staffRowsHtml = scheduleRows.length
    ? scheduleRows.map(staffRow).join('')
    : `<tr><td colspan="8" class="empty">Nenhuma conversa com a equipe registrada nesse dia.</td></tr>`;

  const summary = report || {
    total_recebido: 0,
    servicos_contratados: 0,
    clientes_atendidos: 0,
    pagamentos_pendentes: 0,
    orcamentos_sem_fechamento: 0,
  };

  const emAndamento = scheduleRows.filter((r) => r.work_status === 'em_andamento').length;
  const concluidos = scheduleRows.filter((r) => r.work_status === 'concluido').length;
  const totalFolha = scheduleRows.reduce((sum, r) => sum + (r.duration_hours ? staffPriceFor(r.duration_hours) : 0), 0);

  const datesNav = recentDates
    .map((d) => `<a href="/dashboard?date=${d}&tab=${activeTab}" class="${d === dateStr ? 'active' : ''}">${d}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Limpa Limpa — Painel</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .date-label { color: #8b949e; margin-bottom: 16px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .tabs a { padding: 8px 16px; border-radius: 8px; text-decoration: none; color: #8b949e; border: 1px solid #30363d; font-weight: 600; font-size: 14px; }
  .tabs a.active { background: #1f6feb; color: white; border-color: #1f6feb; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 18px; min-width: 140px; }
  .card .value { font-size: 22px; font-weight: 700; }
  .card .label { color: #8b949e; font-size: 12px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d; font-size: 13px; }
  th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .badge { color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .notes { color: #8b949e; font-size: 12px; max-width: 240px; }
  .pending { color: #d29922; font-weight: 600; }
  .empty { text-align: center; color: #8b949e; padding: 24px; }
  .nav { margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
  .nav a { color: #8b949e; text-decoration: none; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid #30363d; }
  .nav a.active { background: #30363d; color: white; }
  .section { display: ${activeTab === 'clientes' ? 'block' : 'none'}; }
  .section.staff { display: ${activeTab === 'funcionarias' ? 'block' : 'none'}; }
</style>
</head>
<body>
  <h1>🧹 Limpa Limpa — Painel</h1>
  <div class="date-label">${dateStr}</div>

  <div class="nav">${datesNav || '<span style="color:#8b949e">Nenhum relatório gerado ainda.</span>'}</div>

  <div class="tabs">
    <a href="/dashboard?date=${dateStr}&tab=clientes" class="${activeTab === 'clientes' ? 'active' : ''}">👥 Clientes</a>
    <a href="/dashboard?date=${dateStr}&tab=funcionarias" class="${activeTab === 'funcionarias' ? 'active' : ''}">🧹 Funcionárias</a>
  </div>

  <div class="section">
    <div class="cards">
      <div class="card"><div class="value">${money(summary.total_recebido)}</div><div class="label">💰 Total recebido</div></div>
      <div class="card"><div class="value">${summary.servicos_contratados}</div><div class="label">🧹 Serviços contratados</div></div>
      <div class="card"><div class="value">${summary.clientes_atendidos}</div><div class="label">👥 Clientes atendidos</div></div>
      <div class="card"><div class="value">${summary.pagamentos_pendentes}</div><div class="label">⏳ Pagamentos pendentes</div></div>
      <div class="card"><div class="value">${summary.orcamentos_sem_fechamento}</div><div class="label">❌ Sem fechamento</div></div>
    </div>
    <table>
      <thead>
        <tr><th>Cliente</th><th>Situação</th><th>Valor</th><th>Serviço</th><th>Agenda</th><th>Funcionária</th><th>Endereço</th><th>Notas</th></tr>
      </thead>
      <tbody>${clientRowsHtml}</tbody>
    </table>
  </div>

  <div class="section staff">
    <div class="cards">
      <div class="card"><div class="value">${scheduleRows.length}</div><div class="label">🧹 Funcionárias ativas</div></div>
      <div class="card"><div class="value">${emAndamento}</div><div class="label">🟡 Em andamento</div></div>
      <div class="card"><div class="value">${concluidos}</div><div class="label">✅ Concluídos</div></div>
      <div class="card"><div class="value">${money(totalFolha)}</div><div class="label">💸 Total a pagar (folha do dia)</div></div>
    </div>
    <table>
      <thead>
        <tr><th>Funcionária</th><th>Status</th><th>Cliente</th><th>Local</th><th>Duração</th><th>Horário</th><th>Recebe</th><th>Notas</th></tr>
      </thead>
      <tbody>${staffRowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function registerDashboard(app) {
  app.get('/dashboard', basicAuth, async (req, res) => {
    try {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const activeTab = req.query.tab === 'funcionarias' ? 'funcionarias' : 'clientes';
      const [statusRows, scheduleRows, report, recentDates] = await Promise.all([
        db.getDailyStatusForDate(dateStr),
        db.getDailyScheduleForDate(dateStr),
        db.getReportForDate(dateStr),
        db.getRecentReportDates(14),
      ]);
      res.send(renderPage(dateStr, statusRows, scheduleRows, report, recentDates, activeTab));
    } catch (err) {
      console.error('[dashboard] erro:', err);
      res.status(500).send('Erro ao carregar dashboard.');
    }
  });

  app.get('/api/status', basicAuth, async (req, res) => {
    try {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const [statusRows, scheduleRows, report] = await Promise.all([
        db.getDailyStatusForDate(dateStr),
        db.getDailyScheduleForDate(dateStr),
        db.getReportForDate(dateStr),
      ]);
      res.json({ date: dateStr, report, clientEntries: statusRows, staffEntries: scheduleRows });
    } catch (err) {
      console.error('[api/status] erro:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerDashboard };
