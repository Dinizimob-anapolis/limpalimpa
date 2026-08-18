# Limpa Limpa — Relatório Diário

Escuta as conversas de WhatsApp da Limpa Limpa (via Evolution API), classifica cada conversa do dia
com o Claude e manda um relatório de fechamento todo dia às 19h.

## 1. Adicionar a instância no Evolution API existente

No mesmo Evolution API que já roda a Diniz Imóveis, crie uma nova instância, por exemplo `limpa-limpa`,
e conecte o número de WhatsApp da Limpa Limpa nela (via QR code).

Depois de criada, configure o **webhook** dessa instância apontando para:

```
https://<url-deste-servico-no-railway>/webhook
```

Habilite pelo menos o evento `MESSAGES_UPSERT`.

## 2. Criar o projeto no Railway

1. Crie um projeto novo no Railway (separado do `soothing-stillness`).
2. Suba este código (GitHub ou `railway up`).
3. Adicione um addon **PostgreSQL** ao projeto — o Railway já injeta `DATABASE_URL` automaticamente.
4. Configure as variáveis de ambiente (veja `.env.example`):
   - `ANTHROPIC_API_KEY` — criar em console.anthropic.com → API Keys
   - `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE=limpa-limpa`
   - `REPORT_RECIPIENT_NUMBER` — seu número, que vai receber o relatório
   - `TZ=America/Sao_Paulo`

O schema do banco é criado automaticamente no primeiro start (`db.initSchema()`).

## 3. Testar sem esperar as 19h

Depois do deploy, teste manualmente:

```
GET https://<url-do-servico>/run-report?date=2026-08-18&send=false
```

`send=false` gera e salva o relatório sem mandar no WhatsApp — bom pra conferir o resultado antes.
Tire o `send=false` quando quiser que ele realmente envie.

## Como funciona

1. Toda mensagem (cliente ou atendente) que chega no webhook é salva em `messages`.
2. Às 19h (cron), o serviço agrupa as mensagens do dia por conversa e manda cada transcrição
   pro Claude, que classifica: nome do cliente, status, valor, tipo de serviço.
3. Isso é salvo em `daily_status` (1 linha por cliente/dia) e agregado num resumo.
4. O relatório é montado, salvo em `daily_reports` e enviado por WhatsApp pro número configurado.

## Próximos passos possíveis

- Dashboard tipo o `/dashboard` do `diniz-leads-olx`, lendo `daily_reports` e `daily_status`.
- Separar por tipo de serviço (avulsa / mensal / pós-obra) no resumo.
- Detectar cliente novo vs. recorrente cruzando `remote_jid` com relatórios anteriores.
