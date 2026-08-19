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

// Lê a lista de números de funcionárias da variável de ambiente STAFF_NUMBERS
// (formato: "5562991111111,5562992222222", sem @s.whatsapp.net) e devolve um Set
// já normalizado pro formato usado no remote_jid.
function getStaffJidSet() {
  const raw = process.env.STAFF_NUMBERS || '';
  const numbers = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  return new Set(numbers.map((n) => `${n}@s.whatsapp.net`));
}

// Números que devem ser completamente ignorados (nem cliente, nem equipe) —
// ex: a conversa da própria dona/gestão da empresa.
function getIgnoredJidSet() {
  const raw = process.env.IGNORED_NUMBERS || '';
  const numbers = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  return new Set(numbers.map((n) => `${n}@s.whatsapp.net`));
}

// Retorna todas as conversas do dia, já separadas em "clientes" e "equipe"
// com base na lista de números de funcionárias (STAFF_NUMBERS), excluindo
// qualquer número presente em IGNORED_NUMBERS.
async function getConversationsForDate(dateStr) {
  const { rows } = await pool.query(
    `SELECT remote_jid,
            MAX(push_name) AS push_name,
            STRING_AGG(
              (CASE WHEN from_me THEN 'Atendente' ELSE 'Contato' END) || ': ' || COALESCE(body, '[mídia]'),
              E'\n' ORDER BY wa_timestamp
            ) AS transcript
     FROM messages
     WHERE wa_timestamp::date = $1::date
     GROUP BY remote_jid`,
    [dateStr]
  );

  const staffJids = getStaffJidSet();
  const ignoredJids = getIgnoredJidSet();
  const visibleRows = rows.filter((r) => !ignoredJids.has(r.remote_jid));
  const clientConversations = visibleRows.filter((r) => !staffJids.has(r.remote_jid));
  const staffConversations = visibleRows.filter((r) => staffJids.has(r.remote_jid));

  return { clientConversations, staffConversations };
}

// Busca a transcrição do dia de UMA conversa específica (usado pra reclassificar em tempo real).
async function getConversationTranscript(dateStr, remoteJid) {
  const { rows } = await pool.query(
    `SELECT remote_jid,
            MAX(push_name) AS push_name,
            STRING_AGG(
              (CASE WHEN from_me THEN 'Atendente' ELSE 'Contato' END) || ': ' || COALESCE(body, '[mídia]'),
              E'\n' ORDER BY wa_timestamp
            ) AS transcript
     FROM messages
     WHERE wa_timestamp::date = $1::date AND remote_jid = $2
     GROUP BY remote_jid`,
    [dateStr, remoteJid]
  );
  return rows[0] || null;
}

async function deleteDailyStatus(reportDate, remoteJid) {
  await pool.query(`DELETE FROM daily_status WHERE report_date = $1::date AND remote_jid = $2`, [reportDate, remoteJid]);
}

async function deleteDailySchedule(reportDate, remoteJid) {
  await pool.query(`DELETE FROM daily_schedule WHERE report_date = $1::date AND remote_jid = $2`, [reportDate, remoteJid]);
}

async function upsertDailySchedule(reportDate, entry) {
  await pool.query(
    `INSERT INTO daily_schedule (report_date, remote_jid, staff_name, summary, pending_confirmation, serving_client_name, duration_hours, work_status, start_time, end_time, address, is_scheduling_related)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (report_date, remote_jid) DO UPDATE SET
       staff_name = EXCLUDED.staff_name,
       summary = EXCLUDED.summary,
       pending_confirmation = EXCLUDED.pending_confirmation,
       serving_client_name = EXCLUDED.serving_client_name,
       duration_hours = EXCLUDED.duration_hours,
       work_status = EXCLUDED.work_status,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       address = EXCLUDED.address,
       is_scheduling_related = EXCLUDED.is_scheduling_related`,
    [
      reportDate,
      entry.remoteJid,
      entry.staffName,
      entry.summary,
      entry.pendingConfirmation,
      entry.servingClientName || null,
      entry.durationHours || null,
      entry.workStatus || 'aguardando',
      entry.startTime || null,
      entry.endTime || null,
      entry.address || null,
      entry.isSchedulingRelated !== false,
    ]
  );
}

async function getDailyScheduleForDate(dateStr) {
  const { rows } = await pool.query(
    `SELECT * FROM daily_schedule WHERE report_date = $1::date ORDER BY staff_name NULLS LAST`,
    [dateStr]
  );
  return rows;
}

async function upsertDailyStatus(reportDate, entry) {
  await pool.query(
    `INSERT INTO daily_status (report_date, remote_jid, client_name, status, value, service_type, is_new_client, notes, duration_hours, scheduled_date, scheduled_time, address, assigned_staff_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (report_date, remote_jid) DO UPDATE SET
       client_name = EXCLUDED.client_name,
       status = EXCLUDED.status,
       value = EXCLUDED.value,
       service_type = EXCLUDED.service_type,
       is_new_client = EXCLUDED.is_new_client,
       notes = EXCLUDED.notes,
       duration_hours = EXCLUDED.duration_hours,
       scheduled_date = EXCLUDED.scheduled_date,
       scheduled_time = EXCLUDED.scheduled_time,
       address = EXCLUDED.address,
       assigned_staff_name = EXCLUDED.assigned_staff_name`,
    [
      reportDate,
      entry.remoteJid,
      entry.clientName,
      entry.status,
      entry.value,
      entry.serviceType,
      entry.isNewClient,
      entry.notes || null,
      entry.durationHours || null,
      entry.scheduledDate || null,
      entry.scheduledTime || null,
      entry.address || null,
      entry.assignedStaffName || null,
    ]
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
  getConversationTranscript,
  getStaffJidSet,
  getIgnoredJidSet,
  upsertDailyStatus,
  saveDailyReport,
  getDailyStatusForDate,
  getReportForDate,
  getRecentReportDates,
  upsertDailySchedule,
  getDailyScheduleForDate,
  deleteDailyStatus,
  deleteDailySchedule,
};
