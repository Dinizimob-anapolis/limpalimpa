// Tabela de preços da Limpa Limpa — valores padrão por duração.
// Serve como referência: se o cliente tiver desconto ou plano com preço próprio,
// o valor combinado na conversa tem prioridade sobre esse padrão (ver classifier.js).
const CLIENT_PRICE = { 4: 160, 6: 196, 8: 215 };
const STAFF_PRICE = { 4: 120, 6: 140, 8: 175 };

function clientPriceFor(durationHours) {
  return CLIENT_PRICE[durationHours] ?? null;
}

function staffPriceFor(durationHours) {
  return STAFF_PRICE[durationHours] ?? null;
}

module.exports = { CLIENT_PRICE, STAFF_PRICE, clientPriceFor, staffPriceFor };
