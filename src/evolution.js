// Extrai os campos que interessam de um evento "messages.upsert" do Evolution API.
// Retorna null se o evento não for uma mensagem utilizável.
function parseIncomingMessage(payload) {
  const data = payload?.data;
  if (!data || !data.key) return null;

  const remoteJid = data.key.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us')) return null; // ignora grupos

  const fromMe = !!data.key.fromMe;
  const pushName = data.pushName || null;

  const msg = data.message || {};

  // Texto normal (com ou sem legenda)
  const textBody =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    null;

  // Se não veio texto mas veio mídia, gera um marcador — isso é importante
  // porque comprovante de pagamento costuma vir como foto/PDF sem nenhuma legenda.
  let mediaMarker = null;
  if (!textBody) {
    if (msg.imageMessage) mediaMarker = '[Cliente enviou uma imagem (possível comprovante de pagamento)]';
    else if (msg.documentMessage) {
      const fileName = msg.documentMessage.fileName || 'arquivo';
      mediaMarker = `[Cliente enviou um documento/PDF: ${fileName} (possível comprovante de pagamento)]`;
    } else if (msg.audioMessage) mediaMarker = '[Cliente enviou um áudio]';
    else if (msg.videoMessage) mediaMarker = '[Cliente enviou um vídeo]';
    else if (msg.stickerMessage) mediaMarker = null; // sticker não carrega informação útil, ignora
  }

  const body = textBody || mediaMarker;

  const messageType = data.messageType || Object.keys(msg)[0] || 'unknown';
  const waTimestamp = data.messageTimestamp
    ? new Date(Number(data.messageTimestamp) * 1000)
    : new Date();

  return { remoteJid, pushName, fromMe, body, messageType, waTimestamp };
}

async function sendText(to, text) {
  const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number: to,
      text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Evolution API sendText falhou (${res.status}): ${errText}`);
  }

  return res.json();
}

module.exports = { parseIncomingMessage, sendText };
