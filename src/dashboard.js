const db = require('./db');

const STATUS_META = {
  pagou: { label: '✅ Pagou', color: '#1a7f37' },
  contratou: { label: '🟢 Contratou', color: '#2da44e' },
  aguardando_pagamento: { label: '⏳ Aguardando pagamento', color: '#9a6700' },
  nao_contratou: { label: '🔴 Não contratou', color: '#cf222e' },
  em_atendimento: { label: '🟡 Em atendimento', color: '#bf8700' },
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

// Middleware de HTTP Basic Auth usando DASHBOARD_USER / DASHBOARD_PASSWORD
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

function renderPage(dateStr, statusRows, report, recentDates) {
  const rowsHtml = statusRows.length
    ? statusRows
        .map((r) => {
          const meta = STATUS_META[r.status] || { label: r.status, color: '#57606a' };
          return `<tr>
            <td>${escapeHtml(r.client_name || '(sem nome)')}</td>
            <td><span class="badge" style="background:${meta.color}">${meta.label}</span></td>
            <td>${money(r.value)}</td>
            <td>${escapeHtml(r.service_type || '—')}</td>
            <td>${r.is_new_client ? 'Novo' : '—'}</td>
            <td class="notes">${escapeHtml(r.notes || '')}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="empty">Nenhuma conversa registrada nesse dia.</td></tr>`;

  const summary = report || {
    total_recebido: 0,
    servicos_contratados: 0,
    clientes_atendidos: 0,
    pagamentos_pendentes: 0,
    orcamentos_sem_fechamento: 0,
  };

  const datesNav = recentDates
    .map((d) => `<a href="/dashboard?date=${d}" class="${d === dateStr ? 'active' : ''}">${d}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Limpa Limpa — Fechamento Diário</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .date-label { color: #8b949e; margin-bottom: 20px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 18px; min-width: 140px; }
  .card .value { font-size: 22px; font-weight: 700; }
  .card .label { color: #8b949e; font-size: 12px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d; font-size: 14px; }
  th { color: #8b949e; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .badge { color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .notes { color: #8b949e; font-size: 13px; }
  .empty { text-align: center; color: #8b949e; padding: 24px; }
  .nav { margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
  .nav a { color: #8b949e; text-decoration: none; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid #30363d; }
  .nav a.active { background: #1f6feb; color: white; border-color: #1f6feb; }
</style>
</head>
<body>
  <h1>📊 Limpa Limpa — Fechamento Diário</h1>
  <div class="date-label">${dateStr}</div>

  <div class="nav">${datesNav || '<span style="color:#8b949e">Nenhum relatório gerado ainda.</span>'}</div>

  <div class="cards">
    <div class="card"><div class="value">${money(summary.total_recebido)}</div><div class="label">💰 Total recebido</div></div>
    <div class="card"><div class="value">${summary.servicos_contratados}</div><div class="label">🧹 Serviços contratados</div></div>
    <div class="card"><div class="value">${summary.clientes_atendidos}</div><div class="label">👥 Clientes atendidos</div></div>
    <div class="card"><div class="value">${summary.pagamentos_pendentes}</div><div class="label">⏳ Pagamentos pendentes</div></div>
    <div class="card"><div class="value">${summary.orcamentos_sem_fechamento}</div><div class="label">❌ Sem fechamento</div></div>
  </div>

  <table>
    <thead>
      <tr><th>Cliente</th><th>Situação</th><th>Valor</th><th>Serviço</th><th>Novo?</th><th>Notas</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function registerDashboard(app) {
  app.get('/dashboard', basicAuth, async (req, res) => {
    try {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const [statusRows, report, recentDates] = await Promise.all([
        db.getDailyStatusForDate(dateStr),
        db.getReportForDate(dateStr),
        db.getRecentReportDates(14),
      ]);
      res.send(renderPage(dateStr, statusRows, report, recentDates));
    } catch (err) {
      console.error('[dashboard] erro:', err);
      res.status(500).send('Erro ao carregar dashboard.');
    }
  });

  // JSON cru, útil pra debugar ou integrar com outra coisa depois
  app.get('/api/status', basicAuth, async (req, res) => {
    try {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const [statusRows, report] = await Promise.all([
        db.getDailyStatusForDate(dateStr),
        db.getReportForDate(dateStr),
      ]);
      res.json({ date: dateStr, report, entries: statusRows });
    } catch (err) {
      console.error('[api/status] erro:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerDashboard };
