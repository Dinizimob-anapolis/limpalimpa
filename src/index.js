require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const db = require('./db');
const { parseIncomingMessage, sendText } = require('./evolution');
const { classifyConversation, classifyStaffConversation } = require('./classifier');
const { buildReportText, buildScheduleText } = require('./report');
const { registerDashboard } = require('./dashboard');
const { realNameFor } = require('./contacts');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;

registerDashboard(app);

// Reclassifica UMA conversa (cliente ou funcionária) com base na transcrição do dia
// e já salva o resultado em daily_status ou daily_schedule. Usado tanto em tempo real
// (toda vez que chega mensagem nova) quanto no fechamento das 18h.
async function reclassifyConversation(dateStr, remoteJid) {
  const ignoredJids = db.getIgnoredJidSet();
  if (ignoredJids.has(remoteJid)) {
    // Número ignorado (ex: conversa da própria dona da empresa) — não processa,
    // e remove qualquer registro antigo que já tenha ficado salvo por engano.
    await db.deleteDailyStatus(dateStr, remoteJid);
    await db.deleteDailySchedule(dateStr, remoteJid);
    return;
  }

  const staffJids = await db.getStaffJidSet();
  const conv = await db.getConversationTranscript(dateStr, remoteJid);
  if (!conv) return;

  if (staffJids.has(remoteJid)) {
    const classification = await classifyStaffConversation(conv.transcript, conv.push_name);
    await db.upsertDailySchedule(dateStr, {
      remoteJid,
      staffName: realNameFor(remoteJid) || classification.staff_name || conv.push_name,
      summary: classification.summary,
      pendingConfirmation: !!classification.pending_confirmation,
      servingClientName: classification.serving_client_name,
      durationHours: classification.duration_hours,
      workStatus: classification.work_status || 'aguardando',
      startTime: classification.start_time,
      endTime: classification.end_time,
      address: classification.address,
      isSchedulingRelated: classification.is_scheduling_related !== false,
      hasConfirmedJob: !!classification.has_confirmed_job,
      availabilityStatus: classification.availability_status,
      availabilityNote: classification.availability_note,
    });
    // Se essa conversa já tinha ficado gravada como cliente antes (ex: antes do
    // número entrar na lista STAFF_NUMBERS), remove o registro errado.
    await db.deleteDailyStatus(dateStr, remoteJid);
  } else {
    const classification = await classifyConversation(conv.transcript, conv.push_name);
    await db.upsertDailyStatus(dateStr, {
      remoteJid,
      clientName: realNameFor(remoteJid) || classification.client_name || conv.push_name,
      status: classification.status || 'em_atendimento',
      value: classification.value,
      serviceType: classification.service_type,
      isNewClient: !!classification.is_new_client,
      notes: classification.notes,
      durationHours: classification.duration_hours,
      scheduledDate: classification.scheduled_date,
      scheduledTime: classification.scheduled_time,
      address: classification.address,
      assignedStaffName: classification.assigned_staff_name,
    });
    // Mesma lógica ao contrário: se antes ela tinha sido classificada como equipe,
    // remove o registro velho da tabela de escala.
    await db.deleteDailySchedule(dateStr, remoteJid);
  }
}

// --- Webhook: recebe eventos do Evolution API (configurar em Settings > Webhook da instância limpa-limpa) ---
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body?.event;
    if (event === 'messages.upsert') {
      const parsed = parseIncomingMessage(req.body);
      if (parsed && parsed.body) {
        await db.saveMessage(parsed);
        // Responde o Evolution API já, e reclassifica a conversa em segundo plano
        // (não trava o webhook esperando o Claude responder).
        res.sendStatus(200);
        const dateStr = parsed.waTimestamp.toISOString().slice(0, 10);
        reclassifyConversation(dateStr, parsed.remoteJid).catch((err) =>
          console.error('[realtime] erro ao reclassificar:', err)
        );
        return;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] erro:', err);
    res.sendStatus(200); // sempre 200 pro Evolution não ficar reenviando
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Monta e opcionalmente envia o relatório consolidado do dia.
// A classificação em si já rola em tempo real a cada mensagem; aqui só juntamos
// o que já está salvo em daily_status / daily_schedule (com um passe final de segurança).
async function runDailyReport(dateStr, { send = true } = {}) {
  console.log(`[report] gerando relatório de ${dateStr}...`);
  const { clientConversations, staffConversations } = await db.getConversationsForDate(dateStr);

  // Passe final: garante que toda conversa do dia foi classificada pelo menos uma vez
  // (cobre casos raros de falha na classificação em tempo real).
  for (const conv of clientConversations) {
    await reclassifyConversation(dateStr, conv.remote_jid);
  }
  for (const conv of staffConversations) {
    await reclassifyConversation(dateStr, conv.remote_jid);
  }

  const [statusRows, scheduleRows] = await Promise.all([
    db.getDailyStatusForDate(dateStr),
    db.getDailyScheduleForDate(dateStr),
  ]);

  const entries = statusRows.map((r) => ({
    remoteJid: r.remote_jid,
    clientName: r.client_name,
    status: r.status,
    value: r.value,
    serviceType: r.service_type,
    isNewClient: r.is_new_client,
    notes: r.notes,
  }));

  const scheduleEntries = scheduleRows.map((r) => ({
    remoteJid: r.remote_jid,
    staffName: r.staff_name,
    summary: r.summary,
    pendingConfirmation: r.pending_confirmation,
  }));

  const { text, summary } = buildReportText(dateStr, entries);
  await db.saveDailyReport(dateStr, summary, text);

  const scheduleText = buildScheduleText(dateStr, scheduleEntries);

  if (send && process.env.REPORT_RECIPIENT_NUMBER) {
    await sendText(process.env.REPORT_RECIPIENT_NUMBER, text);
    await sendText(process.env.REPORT_RECIPIENT_NUMBER, scheduleText);
    console.log('[report] enviado via WhatsApp (comercial + escala).');
  }

  return { text, summary, entries, scheduleText, scheduleEntries };
}

// Endpoint manual pra testar/reprocessar sem esperar as 18h.
// Ex: GET /run-report?date=2026-08-18&send=false
app.get('/run-report', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const send = req.query.send !== 'false';
    const result = await runDailyReport(dateStr, { send });
    res.json(result);
  } catch (err) {
    console.error('[run-report] erro:', err);
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await db.initSchema();

  // Todo dia às 18h (fuso definido por TZ no .env, ex: America/Sao_Paulo)
  cron.schedule('0 18 * * *', () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    runDailyReport(dateStr).catch((err) => console.error('[cron] erro:', err));
  });

  app.listen(PORT, () => console.log(`[server] rodando na porta ${PORT}`));
}

start();
