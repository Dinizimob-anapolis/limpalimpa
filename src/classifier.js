const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { clientPriceFor } = require('./pricing');

const SYSTEM_PROMPT = `Você lê a transcrição de uma conversa de WhatsApp entre uma atendente da empresa de limpeza "Limpa Limpa" e um cliente, referente a UM único dia.
Sua tarefa é extrair informações estruturadas sobre o andamento comercial dessa conversa NAQUELE DIA.

A empresa trabalha com pacotes de 4h, 6h ou 8h, com preço padrão (4h=R$160, 6h=R$196, 8h=R$215). Alguns clientes têm desconto negociado ou fazem parte de um plano com preço próprio — nesses casos, o valor da conversa vale mais que o preço padrão.

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{
  "client_name": string ou null (nome do cliente, se identificável na conversa),
  "status": um dos valores: "pagou" | "contratou" | "aguardando_pagamento" | "nao_contratou" | "em_atendimento",
  "duration_hours": 4 ou 6 ou 8 ou null (duração do pacote contratado/combinado, se mencionada),
  "value": number ou null (valor em reais efetivamente combinado/pago NESSA conversa — só preencha se um valor específico foi mencionado no texto, ex: desconto, plano com preço próprio, ou confirmação de pagamento de um valor exato. Se nada foi dito sobre valor, deixe null e o sistema aplica o preço padrão pela duração),
  "service_type": string ou null (ex: "Faxina 6h", "Plano semanal", "Pós-obra", "Faxina avulsa"),
  "scheduled_date": string no formato "YYYY-MM-DD" ou null (data combinada do serviço, SOMENTE se uma data explícita foi mencionada; não deduza a partir de "sexta-feira" sem data),
  "scheduled_time": string tipo "09:00" ou null (horário combinado, se mencionado),
  "address": string ou null (endereço do serviço, se mencionado),
  "assigned_staff_name": string ou null (nome da funcionária que a atendente disse que vai/foi mandar pra esse cliente, se mencionado),
  "is_new_client": boolean (parece ser a primeira conversa desse cliente, baseado no tom/contexto),
  "notes": string curta ou null (ex: "Pediu orçamento mas não retornou". Se houver desconto, mencione aqui, ex: "Desconto de R$20 combinado")
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
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock ? textBlock.text.trim() : '{}';
  const clean = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(clean);
    // O preço padrão só entra como valor de referência quando a conversa NÃO mencionou
    // um valor específico (ex: desconto ou preço de plano). Se a IA já extraiu um valor
    // do texto, esse valor combinado é respeitado e não é sobrescrito.
    if ((parsed.value === null || parsed.value === undefined) && parsed.duration_hours) {
      const defaultPrice = clientPriceFor(parsed.duration_hours);
      if (defaultPrice !== null) parsed.value = defaultPrice;
    }
    return parsed;
  } catch (err) {
    console.error('[classifier] falha ao parsear resposta do Claude:', raw);
    return {
      client_name: pushName || null,
      status: 'em_atendimento',
      value: null,
      duration_hours: null,
      service_type: null,
      scheduled_date: null,
      scheduled_time: null,
      address: null,
      assigned_staff_name: null,
      is_new_client: false,
      notes: 'Falha ao classificar automaticamente',
    };
  }
}

module.exports = { classifyConversation, classifyStaffConversation };

const STAFF_SYSTEM_PROMPT = `Você lê a transcrição de uma conversa de WhatsApp entre a gestão da empresa de limpeza "Limpa Limpa" e uma FUNCIONÁRIA da equipe (não é cliente), referente a UM único dia.
O assunto normal dessas conversas é: combinar escala de faxinas, endereço do cliente, horário, confirmação de presença, aviso de início/término do serviço, ou perguntas sobre disponibilidade em dias futuros.

MUITO IMPORTANTE — distinga dois tipos de informação diferentes:
1) DISPONIBILIDADE: a funcionária diz que ESTÁ ou NÃO ESTÁ livre em algum dia (hoje, amanhã, sexta, sábado, etc), SEM que isso seja necessariamente um serviço já fechado. Ex: "posso sexta à tarde", "não dá amanhã de manhã", "só sábado depois das 15h".
2) SERVIÇO CONFIRMADO: um atendimento específico foi de fato combinado, com cliente, endereço e/ou horário definidos, e a funcionária confirmou que vai fazer aquele serviço. Só marque has_confirmed_job como true nesse caso — simplesmente ela dizer "posso sexta" NÃO é um serviço confirmado, é só disponibilidade.

Se a conversa tiver as duas coisas (ela disse que está disponível E um serviço específico foi fechado), preencha os dois blocos.

A empresa trabalha com pacotes de 4h, 6h ou 8h.

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{
  "staff_name": string ou null (nome da funcionária, se identificável),
  "availability_status": um dos valores "disponivel" | "indisponivel" | null (null se a conversa não tocou no assunto de disponibilidade),
  "availability_note": string curta ou null (ex: "Livre sábado após 15h e domingo o dia todo", "Não pode amanhã de manhã"),
  "has_confirmed_job": boolean (true SOMENTE se um serviço específico foi realmente fechado — cliente + endereço/horário definidos e ela confirmou presença),
  "serving_client_name": string ou null (nome do cliente que ela vai atender, só se has_confirmed_job for true),
  "duration_hours": 4 ou 6 ou 8 ou null (duração do pacote, só se has_confirmed_job for true),
  "address": string ou null (endereço do serviço, só se has_confirmed_job for true),
  "work_status": um dos valores: "aguardando" | "em_andamento" | "concluido" (só relevante se has_confirmed_job for true; aguardando = ainda não começou; em_andamento = avisou que começou; concluido = avisou que terminou),
  "start_time": string tipo "09:00" ou null (só se has_confirmed_job for true e ela avisou o horário de início),
  "end_time": string tipo "17:00" ou null (só se has_confirmed_job for true e ela avisou o horário de término),
  "is_scheduling_related": boolean (true se a conversa é sobre agenda/disponibilidade/serviço de faxina; false se for papo pessoal ou assunto não relacionado a isso),
  "summary": string curta (1-2 frases) resumindo a conversa do dia,
  "pending_confirmation": boolean (true se ficou algo em aberto sem resposta clara da funcionária)
}

Se não houver informação suficiente, use null nos campos de texto, false em has_confirmed_job, "aguardando" em work_status, true em is_scheduling_related e false em pending_confirmation.`;

async function classifyStaffConversation(transcript, pushName) {
  const userMsg = `Nome salvo no WhatsApp (pode ser impreciso): ${pushName || 'desconhecido'}

Transcrição do dia:
${transcript}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: STAFF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock ? textBlock.text.trim() : '{}';
  const clean = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error('[classifier] falha ao parsear resposta do Claude (staff):', raw);
    return {
      staff_name: pushName || null,
      availability_status: null,
      availability_note: null,
      has_confirmed_job: false,
      serving_client_name: null,
      duration_hours: null,
      address: null,
      work_status: 'aguardando',
      start_time: null,
      end_time: null,
      is_scheduling_related: true,
      summary: 'Falha ao classificar automaticamente',
      pending_confirmation: false,
    };
  }
}
