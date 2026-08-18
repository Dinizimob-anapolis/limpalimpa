const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você lê a transcrição de uma conversa de WhatsApp entre uma atendente da empresa de limpeza "Limpa Limpa" e um cliente, referente a UM único dia.
Sua tarefa é extrair informações estruturadas sobre o andamento comercial dessa conversa NAQUELE DIA.

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{
  "client_name": string ou null (nome do cliente, se identificável na conversa),
  "status": um dos valores: "pagou" | "contratou" | "aguardando_pagamento" | "nao_contratou" | "em_atendimento",
  "value": number ou null (valor em reais combinado/pago, sem símbolo),
  "service_type": string ou null (ex: "Faxina 6h", "Plano semanal", "Pós-obra", "Faxina avulsa"),
  "is_new_client": boolean (parece ser a primeira conversa desse cliente, baseado no tom/contexto),
  "notes": string curta ou null (ex: "Pediu orçamento mas não retornou")
}

Observação sobre mídia: quando a transcrição contiver algo como "[Cliente enviou uma imagem (possível comprovante de pagamento)]" ou "[Cliente enviou um documento/PDF...]", trate isso como um forte indício de que o cliente mandou um comprovante de pagamento (recibo, print do PIX, etc), mesmo sem texto explicando. Combine esse indício com o resto da conversa (ex: se antes disso a atendente pediu pagamento, e depois disso agradeceu ou confirmou recebimento) para decidir o status.

Definições dos status:
- "pagou": cliente confirmou pagamento nessa conversa (inclui ter mandado um comprovante em imagem/PDF que fecha o ciclo de uma cobrança).
- "contratou": fechou o serviço mas o pagamento ainda não foi confirmado no texto.
- "aguardando_pagamento": serviço combinado, cobrança enviada, aguardando confirmação de pagamento.
- "nao_contratou": pediu orçamento/informação mas não fechou.
- "em_atendimento": conversa em andamento, sem desfecho claro ainda.

Se não houver informação suficiente para algum campo, use null. Não invente valores.`;

async function classifyConversation(transcript, pushName) {
  const userMsg = `Nome salvo no WhatsApp (pode ser impreciso): ${pushName || 'desconhecido'}

Transcrição do dia:
${transcript}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock ? textBlock.text.trim() : '{}';
  const clean = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error('[classifier] falha ao parsear resposta do Claude:', raw);
    return {
      client_name: pushName || null,
      status: 'em_atendimento',
      value: null,
      service_type: null,
      is_new_client: false,
      notes: 'Falha ao classificar automaticamente',
    };
  }
}

module.exports = { classifyConversation };
