const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : undefined,
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[db] schema garantido');
}

async function saveMessage({ remoteJid, pushName, fromMe, body, messageType, waTimestamp }) {
  await pool.query(
    `INSERT INTO messages (remote_jid, push_name, from_me, body, message_type, wa_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [remoteJid, pushName || null, fromMe, body || null, messageType || null, waTimestamp]
  );
}

// Retorna todas as conversas que tiveram pelo menos 1 mensagem no dia (por remote_jid),
// junto com o texto completo da conversa daquele dia (pra mandar pro classificador).
async function getConversationsForDate(dateStr) {
  const { rows } = await pool.query(
    `SELECT remote_jid,
            MAX(push_name) AS push_name,
            STRING_AGG(
              (CASE WHEN from_me THEN 'Atendente' ELSE 'Cliente' END) || ': ' || COALESCE(body, '[mídia]'),
              E'\n' ORDER BY wa_timestamp
            ) AS transcript
     FROM messages
     WHERE wa_timestamp::date = $1::date
     GROUP BY remote_jid`,
    [dateStr]
  );
  return rows;
}

async function upsertDailyStatus(reportDate, entry) {
  await pool.query(
    `INSERT INTO daily_status (report_date, remote_jid, client_name, status, value, service_type, is_new_client, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (report_date, remote_jid) DO UPDATE SET
       client_name = EXCLUDED.client_name,
       status = EXCLUDED.status,
       value = EXCLUDED.value,
       service_type = EXCLUDED.service_type,
       is_new_client = EXCLUDED.is_new_client,
       notes = EXCLUDED.notes`,
    [reportDate, entry.remoteJid, entry.clientName, entry.status, entry.value, entry.serviceType, entry.isNewClient, entry.notes || null]
  );
}

async function saveDailyReport(reportDate, summary, reportText) {
  await pool.query(
    `INSERT INTO daily_reports (report_date, total_recebido, servicos_contratados, clientes_atendidos, pagamentos_pendentes, orcamentos_sem_fechamento, report_text, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (report_date) DO UPDATE SET
       total_recebido = EXCLUDED.total_recebido,
       servicos_contratados = EXCLUDED.servicos_contratados,
       clientes_atendidos = EXCLUDED.clientes_atendidos,
       pagamentos_pendentes = EXCLUDED.pagamentos_pendentes,
       orcamentos_sem_fechamento = EXCLUDED.orcamentos_sem_fechamento,
       report_text = EXCLUDED.report_text,
       sent_at = now()`,
    [reportDate, summary.totalRecebido, summary.servicosContratados, summary.clientesAtendidos, summary.pagamentosPendentes, summary.orcamentosSemFechamento, reportText]
  );
}

async function getDailyStatusForDate(dateStr) {
  const { rows } = await pool.query(
    `SELECT * FROM daily_status WHERE report_date = $1::date ORDER BY client_name NULLS LAST`,
    [dateStr]
  );
  return rows;
}

async function getReportForDate(dateStr) {
  const { rows } = await pool.query(
    `SELECT * FROM daily_reports WHERE report_date = $1::date`,
    [dateStr]
  );
  return rows[0] || null;
}

async function getRecentReportDates(limit = 14) {
  const { rows } = await pool.query(
    `SELECT report_date FROM daily_reports ORDER BY report_date DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.report_date.toISOString().slice(0, 10));
}

module.exports = {
  pool,
  initSchema,
  saveMessage,
  getConversationsForDate,
  upsertDailyStatus,
  saveDailyReport,
  getDailyStatusForDate,
  getReportForDate,
  getRecentReportDates,
};
