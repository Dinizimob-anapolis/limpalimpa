-- Mensagens brutas recebidas/enviadas na instância "limpa-limpa" do Evolution API
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  remote_jid TEXT NOT NULL,          -- identificador da conversa (numero@s.whatsapp.net)
  push_name TEXT,                    -- nome salvo no whatsapp do cliente, se vier
  from_me BOOLEAN NOT NULL,          -- true = atendente mandou, false = cliente mandou
  body TEXT,
  message_type TEXT,
  wa_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_remote_jid ON messages(remote_jid);
CREATE INDEX IF NOT EXISTS idx_messages_wa_timestamp ON messages(wa_timestamp);

-- Classificação diária por cliente, gerada pelo Claude no fechamento das 19h
CREATE TABLE IF NOT EXISTS daily_status (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  remote_jid TEXT NOT NULL,
  client_name TEXT,
  status TEXT NOT NULL,              -- pagou | contratou | aguardando_pagamento | nao_contratou | em_atendimento
  value NUMERIC,
  service_type TEXT,
  is_new_client BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_date, remote_jid)
);

-- Histórico dos relatórios enviados (pra consultar depois / dashboard)
CREATE TABLE IF NOT EXISTS daily_reports (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL UNIQUE,
  total_recebido NUMERIC NOT NULL DEFAULT 0,
  servicos_contratados INT NOT NULL DEFAULT 0,
  clientes_atendidos INT NOT NULL DEFAULT 0,
  pagamentos_pendentes INT NOT NULL DEFAULT 0,
  orcamentos_sem_fechamento INT NOT NULL DEFAULT 0,
  report_text TEXT,
  sent_at TIMESTAMPTZ
);
