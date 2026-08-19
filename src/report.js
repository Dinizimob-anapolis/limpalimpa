const STATUS_LABEL = {
  pagou: '✅ Pagou',
  contratou: '🟢 Contratou',
  aguardando_pagamento: '⏳ Aguardando pagamento',
  nao_contratou: '🔴 Não contratou',
  em_atendimento: '🟡 Em atendimento',
};

function money(v) {
  if (v === null || v === undefined) return '—';
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}

function buildSummary(entries) {
  const totalRecebido = entries
    .filter((e) => e.status === 'pagou')
    .reduce((sum, e) => sum + (Number(e.value) || 0), 0);

  const servicosContratados = entries.filter((e) => ['pagou', 'contratou'].includes(e.status)).length;
  const clientesAtendidos = entries.length;
  const pagamentosPendentes = entries.filter((e) => e.status === 'aguardando_pagamento').length;
  const orcamentosSemFechamento = entries.filter((e) => e.status === 'nao_contratou').length;

  return { totalRecebido, servicosContratados, clientesAtendidos, pagamentosPendentes, orcamentosSemFechamento };
}

function buildReportText(dateStr, entries) {
  const summary = buildSummary(entries);

  const rows = entries
    .map((e) => {
      const name = e.clientName || '(sem nome)';
      const status = STATUS_LABEL[e.status] || e.status;
      const value = e.value ? money(e.value) : '—';
      const service = e.serviceType || (e.status === 'nao_contratou' ? 'Pediu orçamento' : '—');
      return `${name} | ${status} | ${value} | ${service}`;
    })
    .join('\n');

  const text = `📊 *Fechamento diário — Limpa Limpa* (${dateStr})

${rows || 'Nenhuma conversa registrada hoje.'}

*Hoje*
💰 Total recebido: ${money(summary.totalRecebido)}
🧹 Serviços contratados: ${summary.servicosContratados}
👥 Clientes atendidos: ${summary.clientesAtendidos}
⏳ Pagamentos pendentes: ${summary.pagamentosPendentes}
❌ Orçamentos sem fechamento: ${summary.orcamentosSemFechamento}`;

  return { text, summary };
}

function buildScheduleText(dateStr, scheduleEntries) {
  if (!scheduleEntries.length) {
    return `👷 *Escala de equipe — Limpa Limpa* (${dateStr})\n\nNenhuma conversa com a equipe registrada hoje.`;
  }

  const rows = scheduleEntries
    .map((e) => {
      const name = e.staffName || '(sem nome)';
      const flag = e.pendingConfirmation ? ' ⚠️ pendente de confirmação' : '';
      return `• *${name}*: ${e.summary || 'sem resumo'}${flag}`;
    })
    .join('\n');

  const pendingCount = scheduleEntries.filter((e) => e.pendingConfirmation).length;

  return `👷 *Escala de equipe — Limpa Limpa* (${dateStr})

${rows}

${pendingCount > 0 ? `⚠️ ${pendingCount} conversa(s) com confirmação pendente.` : '✅ Nenhuma pendência de confirmação.'}`;
}

module.exports = { buildReportText, buildSummary, buildScheduleText, STATUS_LABEL };
