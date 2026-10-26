CREATE TABLE link_clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  referrer_host TEXT,
  device TEXT NOT NULL,
  browser TEXT NOT NULL
);
CREATE INDEX idx_link_clicks_link_time ON link_clicks (link_id, clicked_at);
