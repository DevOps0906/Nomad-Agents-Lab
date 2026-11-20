// Renderer ↔ Main IPC 공통 정의 (docs/04_API.md#공통 규칙).
// Preload와 Main이 같은 허용 목록을 쓴다. 나머지 A-xx 경로는 해당 기능 작업에서 추가한다.

/** Preload가 Main으로 보내는 유일한 invoke 채널. 경로 이름은 인자로 전달한다. */
export const INVOKE_CHANNEL = 'ssr:invoke';

/** 허용된 invoke 경로 이름 목록. */
export const INVOKE_PATHS = [
  'env.check',
  'onboarding.setDataDir',
  'sources.list',
  'sources.add',
  'sources.remove',
  'index.preview',
  'index.start',
  'index.status',
] as const;

export type InvokePath = (typeof INVOKE_PATHS)[number];

export type ErrorCode =
  | 'E_VALIDATION'
  | 'E_NOT_FOUND'
  | 'E_OUT_OF_SCOPE'
  | 'E_CONSENT_REQUIRED'
  | 'E_BUSY'
  | 'E_INTERNAL';

export type InvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode } };

export function isInvokePath(path: unknown): path is InvokePath {
  return typeof path === 'string' && (INVOKE_PATHS as readonly string[]).includes(path);
}

export function failure(code: ErrorCode): InvokeResult<never> {
  return { ok: false, error: { code } };
}

/** contextBridge로 Renderer에 노출하는 API 모양. */
export interface SsrApi {
  invoke(path: string, input?: unknown): Promise<InvokeResult>;
}

// ---- A-01 env.check ----
/** 미설치·미로그인·지원 범위 밖은 오류가 아니라 상태 값이다. */
export type ClaudeState = 'missing' | 'logged_out' | 'unsupported' | 'ok';

export interface ClaudeStatus {
  readonly claude: ClaudeState;
  /** 해석된 버전(숫자 3개). 실행·해석 실패면 null */
  readonly version: string | null;
  /** `auth status`의 인증 방식 종류만(로그인일 때). email·orgId는 보내지 않는다. */
  readonly authMethod: string | null;
}

export type DataDirState = 'unset' | 'set' | 'error';

export interface EnvCheckResult extends ClaudeStatus {
  readonly minVersion: string;
  readonly dataDir: DataDirState;
  /** dataDir가 error일 때 원인 이름(경로·원문 없음) */
  readonly bootError: string | null;
}

// ---- 데이터 위치 지정(onboarding.setDataDir) ----
export type DataDirWarning = 'network' | 'sync' | 'unverified';

export type SetDataDirResult =
  | { readonly status: 'canceled' }
  | { readonly status: 'set'; readonly path: string; readonly warnings: DataDirWarning[] };

// ---- A-02 sources.* ----
export interface SourceItem {
  readonly id: number;
  readonly kind: 'folder' | 'sample';
  readonly path: string;
  readonly label: string;
  readonly status: 'ok' | 'missing' | 'indexing';
  readonly documentCount: number;
  readonly lastIndexedAt: string | null;
}

/** source가 null이면 대화상자 취소 */
export interface SourceAddResult {
  readonly source: SourceItem | null;
}

// ---- A-03 index.* ----
/** 파일 단위 실패 사유 코드(원문 오류·경로 일부 없음) */
export type IndexFileError = 'too_large' | 'binary' | 'read_failed' | 'out_of_scope';
/** 작업 단위 실패 사유 코드 */
export type IndexJobError = 'root_missing' | 'root_changed' | 'data_dir_overlap' | 'internal';

export interface IndexPreview {
  /** 색인 대상 Markdown 파일 수(크기 상한 초과 포함) */
  readonly targets: number;
  /** 기본 제외 규칙으로 뺀 항목 수 */
  readonly excluded: number;
  /** 크기 상한 초과로 건너뛸 파일 수 */
  readonly tooLarge: number;
  /** 루트 확인 실패면 사유, 아니면 null */
  readonly reason: IndexJobError | null;
}

export interface IndexStartResult {
  readonly jobIds: number[];
}

export interface IndexCounts {
  readonly total: number;
  readonly done: number;
  readonly processed: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly deleted: number;
  readonly excluded: number;
  /** 링크·태그 상한(문서당 1000·100)을 넘겨 일부를 버린 문서 수 */
  readonly truncated: number;
}

export interface IndexJobItem {
  readonly jobId: number;
  readonly sourceId: number;
  /** partial = 읽지 못한 폴더·파일이 있어 삭제 처리를 하지 않은 불완전 순회 */
  readonly status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly counts: IndexCounts;
  readonly reason: IndexJobError | null;
  /** 읽지 못한 폴더·파일의 소스 기준 경로(최대 50) */
  readonly unreadable: string[];
}

export interface IndexFailure {
  readonly sourceId: number;
  readonly relPath: string;
  readonly reason: IndexFileError;
}

export interface IndexStatus {
  readonly running: boolean;
  /** 소스별 최근 작업 1건 */
  readonly jobs: IndexJobItem[];
  /** 실패 파일(최대 FAILURE_LIMIT건) */
  readonly failures: IndexFailure[];
}
