const db = require('./db');
const { staffPriceFor } = require('./pricing');

const STATUS_TABS = [
  { key: 'pagou', label: '✅ Pagou' },
  { key: 'contratou', label: '🟢 Contratou' },
  { key: 'aguardando_pagamento', label: '⏳ Aguardando pagamento' },
  { key: 'em_atendimento', label: '🟡 Em atendimento' },
  { key: 'nao_contratou', label: '🔴 Não contratou' },
];

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

function phoneFromJid(remoteJid) {
  if (!remoteJid) return null;
  return remoteJid.split('@')[0];
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
  const agenda = [r.scheduled_date, r.scheduled_time].filter(Boolean).join(' ');
  const phone = phoneFromJid(r.remote_jid);
  const notesWithPhone = [phone ? `📞 ${phone}` : null, r.notes || null].filter(Boolean).join(' — ');
  return `<tr>
    <td>${escapeHtml(r.client_name || '(sem nome)')}</td>
    <td>${money(r.value)}</td>
    <td>${escapeHtml(r.service_type || (r.duration_hours ? `Faxina ${r.duration_hours}h` : '—'))}</td>
    <td>${escapeHtml(agenda || '—')}</td>
    <td>${escapeHtml(r.assigned_staff_name || '—')}</td>
    <td>${escapeHtml(r.address || '—')}</td>
    <td class="notes">${escapeHtml(notesWithPhone)}</td>
  </tr>`;
}

// Card visual de disponibilidade (verde/vermelho), sem tabela — é rápido de escanear.
function availabilityCard(r) {
  const isAvailable = r.availability_status === 'disponivel';
  const color = isAvailable ? '#1a7f37' : '#cf222e';
  const icon = isAvailable ? '🟢' : '🔴';
  return `<div class="avail-card" style="border-color:${color}">
    <div class="avail-name">${icon} ${escapeHtml(r.staff_name || '(sem nome)')}</div>
    <div class="avail-note">${escapeHtml(r.availability_note || '')}</div>
  </div>`;
}

function confirmedJobRow(r) {
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

function staffRandomRow(r) {
  const phone = phoneFromJid(r.remote_jid);
  const notesWithPhone = [phone ? `📞 ${phone}` : null, r.summary || null].filter(Boolean).join(' — ');
  return `<tr>
    <td>${escapeHtml(r.staff_name || '(sem nome)')}</td>
    <td class="notes">${escapeHtml(notesWithPhone)}</td>
  </tr>`;
}

function table(headers, rowsHtml, emptyMsg) {
  return `<table>
    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="${headers.length}" class="empty">${emptyMsg}</td></tr>`}</tbody>
  </table>`;
}

function renderPage(dateStr, statusRows, scheduleRows, report, recentDates, activeTab, activeStatus) {
  // --- Clientes, por aba de status ---
  const statusCounts = {};
  STATUS_TABS.forEach((t) => { statusCounts[t.key] = statusRows.filter((r) => r.status === t.key).length; });

  const currentStatusRows = statusRows.filter((r) => r.status === activeStatus);
  const clientHeaders = ['Cliente', 'Valor', 'Serviço', 'Agenda', 'Funcionária', 'Endereço', 'Notas'];
  const clientTableHtml = table(clientHeaders, currentStatusRows.map(clientRow).join(''), 'Nenhum cliente nessa situação hoje.');

  const statusTabsHtml = STATUS_TABS
    .map((t) => `<a href="/dashboard?date=${dateStr}&tab=clientes&status=${t.key}" class="${activeStatus === t.key ? 'active' : ''}">${t.label} (${statusCounts[t.key]})</a>`)
    .join('');

  // --- Equipe, em 3 blocos: disponibilidade / serviços confirmados / conversa aleatória ---
  const availabilityRows = scheduleRows.filter((r) => r.availability_status === 'disponivel' || r.availability_status === 'indisponivel');
  const confirmedRows = scheduleRows.filter((r) => r.has_confirmed_job);
  const randomRows = scheduleRows.filter((r) => r.is_scheduling_related === false);

  const availableCount = availabilityRows.filter((r) => r.availability_status === 'disponivel').length;
  const unavailableCount = availabilityRows.filter((r) => r.availability_status === 'indisponivel').length;

  const availabilityHtml = availabilityRows.length
    ? `<div class="avail-grid">${availabilityRows.map(availabilityCard).join('')}</div>`
    : `<div class="empty">Nenhuma funcionária mencionou disponibilidade hoje.</div>`;

  const staffHeaders = ['Funcionária', 'Status', 'Cliente', 'Local', 'Duração', 'Horário', 'Recebe', 'Notas'];
  const confirmedHtml = table(staffHeaders, confirmedRows.map(confirmedJobRow).join(''), 'Nenhum serviço confirmado com a equipe hoje.');
  const randomHtml = table(['Funcionária', 'Conversa'], randomRows.map(staffRandomRow).join(''), 'Nenhuma conversa fora do assunto de agendamento hoje.');

  const summary = report || {
    total_recebido: 0,
    servicos_contratados: 0,
    clientes_atendidos: 0,
    pagamentos_pendentes: 0,
    orcamentos_sem_fechamento: 0,
  };

  const emAndamento = confirmedRows.filter((r) => r.work_status === 'em_andamento').length;
  const concluidos = confirmedRows.filter((r) => r.work_status === 'concluido').length;
  const totalFolha = confirmedRows.reduce((sum, r) => sum + (r.duration_hours ? staffPriceFor(r.duration_hours) : 0), 0);

  const datesNav = recentDates
    .map((d) => `<a href="/dashboard?date=${d}&tab=${activeTab}&status=${activeStatus}" class="${d === dateStr ? 'active' : ''}">${d}</a>`)
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
  h2 { font-size: 15px; color: #c9d1d9; margin: 24px 0 10px; }
  .date-label { color: #8b949e; margin-bottom: 16px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .tabs a { padding: 8px 16px; border-radius: 8px; text-decoration: none; color: #8b949e; border: 1px solid #30363d; font-weight: 600; font-size: 14px; }
  .tabs a.active { background: #1f6feb; color: white; border-color: #1f6feb; }
  .status-tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .status-tabs a { padding: 6px 12px; border-radius: 20px; text-decoration: none; color: #c9d1d9; border: 1px solid #30363d; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .status-tabs a.active { background: #21262d; border-color: #58a6ff; color: #58a6ff; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 18px; min-width: 140px; }
  .card .value { font-size: 22px; font-weight: 700; }
  .card .label { color: #8b949e; font-size: 12px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d; font-size: 13px; }
  th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .badge { color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .notes { color: #8b949e; font-size: 12px; max-width: 260px; }
  .pending { color: #d29922; font-weight: 600; }
  .empty { text-align: center; color: #8b949e; padding: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
  .nav { margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
  .nav a { color: #8b949e; text-decoration: none; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid #30363d; }
  .nav a.active { background: #30363d; color: white; }
  .section { display: ${activeTab === 'clientes' ? 'block' : 'none'}; }
  .section.staff { display: ${activeTab === 'funcionarias' ? 'block' : 'none'}; }
  .avail-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .avail-card { background: #161b22; border: 1px solid #30363d; border-left: 4px solid; border-radius: 8px; padding: 10px 14px; min-width: 200px; max-width: 280px; }
  .avail-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .avail-note { color: #8b949e; font-size: 12px; }
</style>
</head>
<body>
  <h1>🧹 Limpa Limpa — Painel</h1>
  <div class="date-label">${dateStr}</div>

  <div class="nav">${datesNav || '<span style="color:#8b949e">Nenhum relatório gerado ainda.</span>'}</div>

  <div class="tabs">
    <a href="/dashboard?date=${dateStr}&tab=clientes&status=${activeStatus}" class="${activeTab === 'clientes' ? 'active' : ''}">👥 Clientes</a>
    <a href="/dashboard?date=${dateStr}&tab=funcionarias" class="${activeTab === 'funcionarias' ? 'active' : ''}">🧹 Funcionárias</a>
  </div>

  <div class="section">
    <div class="cards">
      <div class="card"><div class="value">${money(summary.total_recebido)}</div><div class="label">💰 Total recebido</div></div>
      <div class="card"><div class="value">${summary.servicos_contratados}</div><div class="label">🧹 Serviços contratados</div></div>
      <div class="card"><div class="value">${summary.clientes_atendidos}</div><div class="label">👥 Clientes atendidos</div></div>
    </div>

    <div class="status-tabs">${statusTabsHtml}</div>
    ${clientTableHtml}
  </div>

  <div class="section staff">
    <div class="cards">
      <div class="card"><div class="value">${availableCount}</div><div class="label">🟢 Disponíveis</div></div>
      <div class="card"><div class="value">${unavailableCount}</div><div class="label">🔴 Indisponíveis</div></div>
      <div class="card"><div class="value">${confirmedRows.length}</div><div class="label">📅 Serviços confirmados</div></div>
      <div class="card"><div class="value">${emAndamento}</div><div class="label">🟡 Em andamento</div></div>
      <div class="card"><div class="value">${concluidos}</div><div class="label">✅ Concluídos</div></div>
      <div class="card"><div class="value">${money(totalFolha)}</div><div class="label">💸 Folha do dia</div></div>
    </div>

    <h2>🚦 Disponibilidade informada</h2>
    ${availabilityHtml}

    <h2>📅 Serviços confirmados</h2>
    ${confirmedHtml}

    <h2>💬 Conversas fora de agendamento</h2>
    ${randomHtml}
  </div>
</body>
</html>`;
}

function registerDashboard(app) {
  app.get('/dashboard', basicAuth, async (req, res) => {
    try {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const activeTab = req.query.tab === 'funcionarias' ? 'funcionarias' : 'clientes';
      const validStatuses = STATUS_TABS.map((t) => t.key);
      const activeStatus = validStatuses.includes(req.query.status) ? req.query.status : 'pagou';
      const [statusRows, scheduleRows, report, recentDates] = await Promise.all([
        db.getDailyStatusForDate(dateStr),
        db.getDailyScheduleForDate(dateStr),
        db.getReportForDate(dateStr),
        db.getRecentReportDates(14),
      ]);
      res.send(renderPage(dateStr, statusRows, scheduleRows, report, recentDates, activeTab, activeStatus));
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
