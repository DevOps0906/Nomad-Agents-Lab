-- 0001 초기 스키마 (docs/05_DATA_MODEL.md). 전진 전용: 적용된 파일은 고치지 않고 다음 번호 파일을 추가한다.
-- 시각은 ISO 8601 UTC 문자열(예: 2026-11-20T08:00:00.000Z), 파일 mtime은 epoch 밀리초 정수.

CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'sample')),
  path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing', 'indexing')),
  created_at TEXT NOT NULL,
  last_indexed_at TEXT
) STRICT;

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  -- 같은 소스 안에서 대소문자만 다른 경로는 같은 문서(Windows 파일 시스템 기준).
  rel_path TEXT NOT NULL COLLATE NOCASE,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('md', 'pdf')),
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'encrypted', 'deleted')),
  -- 실패 사유 코드만(too_large·binary·read_failed). 원문 오류·경로는 넣지 않는다.
  error TEXT,
  indexed_at TEXT,
  -- 이 값이 앱의 현재 파서 버전과 다르면 내용이 같아도 다시 처리한다.
  parser_version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_id, rel_path)
) STRICT;

-- 전문 검색. rowid = documents.id. 토크나이저 trigram(PRD Q11 결정) — 3글자 미만 검색어는 LIKE 대체 경로.
CREATE VIRTUAL TABLE doc_fts USING fts5 (title, body, tokenize = 'trigram');

-- 가상 테이블은 FK CASCADE가 없으므로 트리거로 documents와 맞춘다. 본문(body)은 색인기가 채운다.
CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents
WHEN new.status <> 'deleted' BEGIN
  INSERT INTO doc_fts (rowid, title, body) VALUES (new.id, new.title, '');
END;

CREATE TRIGGER documents_fts_title AFTER UPDATE OF title ON documents BEGIN
  UPDATE doc_fts SET title = new.title WHERE rowid = new.id;
END;

CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
  DELETE FROM doc_fts WHERE rowid = old.id;
END;

CREATE TRIGGER documents_fts_mark_deleted AFTER UPDATE OF status ON documents
WHEN new.status = 'deleted' AND old.status <> 'deleted' BEGIN
  DELETE FROM doc_fts WHERE rowid = new.id;
END;

CREATE TRIGGER documents_fts_restore AFTER UPDATE OF status ON documents
WHEN old.status = 'deleted' AND new.status <> 'deleted' BEGIN
  DELETE FROM doc_fts WHERE rowid = new.id;
  INSERT INTO doc_fts (rowid, title, body) VALUES (new.id, new.title, '');
END;

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  src_doc_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  dst_doc_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  dst_raw TEXT NOT NULL,
  -- 정규화한 대상 키. 같은 대상을 가리키는 표기([[a]]·[[a.md]])는 같은 키가 되어 한 행으로 합쳐진다.
  -- 색인 끝마다 dst_doc_id가 NULL이거나 deleted 문서를 가리키는 행을 이 키로 다시 해석한다.
  dst_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'manual')),
  created_at TEXT NOT NULL,
  UNIQUE (src_doc_id, dst_key, kind),
  CHECK (src_doc_id <> dst_doc_id)
) STRICT;

CREATE TABLE tags (
  doc_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = lower(name)),
  origin TEXT NOT NULL CHECK (origin IN ('frontmatter', 'inline')),
  PRIMARY KEY (doc_id, name)
) STRICT;

CREATE TABLE skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL CHECK (root IN ('user', 'app')),
  path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  ssr_json TEXT,
  content_hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
  error TEXT,
  scanned_at TEXT NOT NULL
) STRICT;

CREATE TABLE grants (
  id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL,
  folders_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  mcp_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
) STRICT;

-- 소스가 지워지면 기억한 허용의 폴더 목록(source id JSON 배열)에서도 뺀다.
CREATE TRIGGER sources_grants_cleanup AFTER DELETE ON sources BEGIN
  UPDATE grants
  SET folders_json = (SELECT json_group_array(value) FROM json_each(grants.folders_json) WHERE value <> old.id)
  WHERE EXISTS (SELECT 1 FROM json_each(grants.folders_json) WHERE value = old.id);
END;

-- 매 실행 외부 처리 동의가 없으면 실행 불가 → external_processing_consent_at NOT NULL.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL,
  skill_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  provider_label TEXT NOT NULL,
  external_processing_consent_at TEXT NOT NULL,
  grant_id INTEGER REFERENCES grants (id) ON DELETE SET NULL,
  retry_of INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (
    status IN ('starting', 'running', 'waiting_permission', 'succeeded', 'partial', 'failed', 'cancelled')
  ),
  error_code TEXT,
  claude_version TEXT,
  session_id TEXT,
  exit_code INTEGER,
  result_summary TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
) STRICT;

CREATE TABLE run_events (
  run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'external_processing_consent', 'system', 'assistant', 'tool_use', 'tool_result',
      'permission_request', 'permission_response', 'result', 'stderr', 'error'
    )
  ),
  request_id TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
) STRICT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE index_jobs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'interrupted')),
  counts TEXT
) STRICT;

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('onboarding_start', 'onboarding_done', 'search', 'preview')),
  ts TEXT NOT NULL
) STRICT;

CREATE INDEX documents_source_id ON documents (source_id);
CREATE INDEX links_src_doc_id ON links (src_doc_id);
CREATE INDEX links_dst_doc_id ON links (dst_doc_id);
CREATE INDEX tags_name ON tags (name);
CREATE INDEX runs_started_at ON runs (started_at);
CREATE INDEX runs_skill_name ON runs (skill_name);
CREATE INDEX grants_skill_name ON grants (skill_name);
CREATE INDEX index_jobs_source_id ON index_jobs (source_id);
