require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const db = require('./db');
const { parseIncomingMessage, sendText } = require('./evolution');
const { classifyConversation } = require('./classifier');
const { buildReportText } = require('./report');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;

// --- Webhook: recebe eventos do Evolution API (configurar em Settings > Webhook da instância limpa-limpa) ---
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body?.event;
    if (event === 'messages.upsert') {
      const parsed = parseIncomingMessage(req.body);
      if (parsed && parsed.body) {
        await db.saveMessage(parsed);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] erro:', err);
    res.sendStatus(200); // sempre 200 pro Evolution não ficar reenviando
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Gera (ou regenera) o relatório de uma data específica e opcionalmente envia.
async function runDailyReport(dateStr, { send = true } = {}) {
  console.log(`[report] gerando relatório de ${dateStr}...`);
  const conversations = await db.getConversationsForDate(dateStr);

  const entries = [];
  for (const conv of conversations) {
    const classification = await classifyConversation(conv.transcript, conv.push_name);
    const entry = {
      remoteJid: conv.remote_jid,
      clientName: classification.client_name || conv.push_name,
      status: classification.status || 'em_atendimento',
      value: classification.value,
      serviceType: classification.service_type,
      isNewClient: !!classification.is_new_client,
      notes: classification.notes,
    };
    entries.push(entry);
    await db.upsertDailyStatus(dateStr, entry);
  }

  const { text, summary } = buildReportText(dateStr, entries);
  await db.saveDailyReport(dateStr, summary, text);

  if (send && process.env.REPORT_RECIPIENT_NUMBER) {
    await sendText(process.env.REPORT_RECIPIENT_NUMBER, text);
    console.log('[report] enviado via WhatsApp.');
  }

  return { text, summary, entries };
}

// Endpoint manual pra testar/reprocessar sem esperar as 19h.
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

  // Todo dia às 19h (fuso definido por TZ no .env, ex: America/Sao_Paulo)
  cron.schedule('0 19 * * *', () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    runDailyReport(dateStr).catch((err) => console.error('[cron] erro:', err));
  });

  app.listen(PORT, () => console.log(`[server] rodando na porta ${PORT}`));
}

start();
