// S-01 첫 실행 점검(슬라이스 1): Claude Code 확인 → 데이터 위치 → 첫 폴더 연결. 색인·샘플은 이후 작업.
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components';
import type { DataDirWarning, EnvCheckResult, SetDataDirResult, SourceAddResult, SourceItem } from '../shared/ipc';
import { errorCode, invoke } from './api';

const STEPS = ['Claude Code 확인', '데이터 위치', '첫 폴더 연결'] as const;

const useStyles = makeStyles({
  page: {
    maxWidth: '720px',
    marginInline: 'auto',
    padding: 'calc(var(--spacing) * 6)',
    display: 'grid',
    gap: 'calc(var(--spacing) * 4)',
  },
  title: { fontSize: 'var(--text-h1)', margin: 0 },
  steps: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'calc(var(--spacing) * 2)',
    listStyle: 'none',
    padding: 0,
    margin: 0,
    fontSize: 'var(--text-caption)',
  },
  card: { padding: 'calc(var(--spacing) * 4)', display: 'grid', gap: 'calc(var(--spacing) * 3)' },
  row: { display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' },
  h2: { fontSize: 'var(--text-h2)', margin: 0 },
  body: { fontSize: 'var(--text-body)', margin: 0 },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--text-body)', margin: 0 },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', wordBreak: 'break-all' },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'calc(var(--spacing) * 2)' },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'calc(var(--spacing) * 2)',
    padding: 'calc(var(--spacing) * 2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-control)',
  },
  nav: { display: 'flex', justifyContent: 'space-between', gap: 'calc(var(--spacing) * 2)' },
});

/** 상태는 글자 + 배지 색을 함께 쓴다(색만으로 구분 금지). */
function ClaudeCard({ env, checking, onRecheck }: { env: EnvCheckResult | null; checking: boolean; onRecheck: () => void }) {
  const styles = useStyles();
  let badge: { color: 'success' | 'warning' | 'danger'; label: string } | null = null;
  let message = '';
  if (env) {
    switch (env.claude) {
      case 'ok':
        badge = { color: 'success', label: '준비됨' };
        message = `Claude Code ${env.version ?? ''}이(가) 설치되어 있고 로그인되어 있습니다${env.authMethod ? ` (인증 방식: ${env.authMethod})` : ''}.`;
        break;
      case 'missing':
        badge = { color: 'danger', label: '설치 안 됨' };
        message = 'Claude Code를 찾지 못했습니다. Claude Code를 설치한 뒤 "다시 확인"을 누르세요.';
        break;
      case 'logged_out':
        badge = { color: 'warning', label: '로그인 필요' };
        message = '로그인되어 있지 않습니다. 터미널에서 claude 를 실행해 로그인한 뒤 "다시 확인"을 누르세요.';
        break;
      case 'unsupported':
        badge = { color: 'warning', label: '지원하지 않는 버전' };
        message = `현재 버전${env.version ? ` ${env.version}` : '을 확인할 수 없습니다'}. ${env.minVersion} 이상으로 업데이트한 뒤 "다시 확인"을 누르세요.`;
        break;
    }
  }
  return (
    <Card className={styles.card}>
      <h2 className={styles.h2}>Claude Code 설치·로그인 상태</h2>
      {checking || !env ? (
        <Spinner size="small" label="환경을 확인하는 중…" />
      ) : (
        <div className={styles.row}>
          {badge && (
            <Badge appearance="tint" color={badge.color}>
              {badge.label}
            </Badge>
          )}
          <p className={styles.body}>{message}</p>
        </div>
      )}
      <div>
        <Button onClick={onRecheck} disabled={checking}>
          다시 확인
        </Button>
      </div>
    </Card>
  );
}

const DATA_DIR_REJECTED =
  '이 폴더는 데이터 위치로 쓸 수 없습니다. 드라이브 루트·시스템 폴더·홈 폴더 자체·앱 설정 폴더, 그리고 이미 SSR 데이터(ssr.db)가 있는 폴더는 고를 수 없습니다. 다른 폴더를 선택하세요.';
const SOURCE_REJECTED =
  '이 폴더는 연결할 수 없습니다. 드라이브 루트·시스템 폴더·홈 폴더 자체, 데이터 위치나 이미 연결한 폴더와 겹치는 폴더는 고를 수 없습니다. 다른 폴더를 선택하세요.';

function messageFor(code: string, rejected: string): string {
  if (code === 'E_VALIDATION') return rejected;
  if (code === 'E_BUSY') return '이미 진행 중입니다. 잠시 후 다시 시도하세요.';
  return '처리하지 못했습니다. 다시 시도하세요.';
}

export function Onboarding({
  env,
  checking,
  onRecheck,
  onDone,
  resume,
}: {
  env: EnvCheckResult | null;
  checking: boolean;
  onRecheck: () => void;
  onDone: () => void;
  /** 데이터 위치는 있고 연결 폴더가 0개: 3단계(첫 폴더 연결)부터 재개 */
  resume: boolean;
}) {
  const styles = useStyles();
  const [step, setStep] = useState(resume ? 2 : 0);
  const [busy, setBusy] = useState(false);
  const [dataDir, setDataDir] = useState<{ path: string | null; warnings: DataDirWarning[] } | null>(
    resume ? { path: null, warnings: [] } : null,
  );
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, rejected: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageFor(errorCode(e), rejected));
    } finally {
      setBusy(false);
    }
  }

  const chooseDataDir = () =>
    run(async () => {
      const result = await invoke<SetDataDirResult>('onboarding.setDataDir');
      if (result.status === 'set') {
        setDataDir(result);
        setSources(await invoke<SourceItem[]>('sources.list'));
      }
    }, DATA_DIR_REJECTED);

  const addSource = () =>
    run(async () => {
      const { source } = await invoke<SourceAddResult>('sources.add', { kind: 'dialog' });
      if (source) setSources(await invoke<SourceItem[]>('sources.list'));
    }, SOURCE_REJECTED);

  const removeSource = (id: number) =>
    run(async () => {
      await invoke('sources.remove', { sourceId: id });
      setSources(await invoke<SourceItem[]>('sources.list'));
    }, SOURCE_REJECTED);

  const canNext = step === 0 ? true : step === 1 ? dataDir !== null : sources.length > 0;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>첫 실행 점검</h1>
      <ol className={styles.steps} aria-label="진행 단계">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            <Badge appearance={i === step ? 'filled' : 'outline'} color={i < step ? 'success' : 'brand'}>
              {`${i + 1}. ${label}${i < step ? ' (완료)' : ''}`}
            </Badge>
          </li>
        ))}
      </ol>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {step === 0 && <ClaudeCard env={env} checking={checking} onRecheck={onRecheck} />}

      {step === 1 && (
        <Card className={styles.card}>
          <h2 className={styles.h2}>데이터 저장 위치 *</h2>
          <p className={styles.muted}>
            색인·실행 기록을 담을 DB(ssr.db)를 만들 폴더를 고르세요. 원본 문서는 옮기지 않습니다.
          </p>
          {dataDir ? (
            <>
              <div className={styles.row}>
                <Badge appearance="tint" color="success">
                  설정됨
                </Badge>
                <Text className={styles.mono}>{dataDir.path ?? '이전에 지정한 위치를 사용합니다.'}</Text>
              </div>
              {dataDir.warnings.includes('sync') && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    동기화 폴더(OneDrive 등)입니다. 동기화 중 DB 파일이 손상될 수 있어 로컬 폴더를 권장합니다.
                  </MessageBarBody>
                </MessageBar>
              )}
              {dataDir.warnings.includes('unverified') && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    로컬 고정 디스크인지 확인하지 못했습니다. 네트워크·외장 드라이브라면 연결이 끊겼을 때 앱을 열 수 없습니다.
                  </MessageBarBody>
                </MessageBar>
              )}
              {dataDir.warnings.includes('network') && (
                <MessageBar intent="warning">
                  <MessageBarBody>네트워크 위치입니다. 연결이 끊기면 앱을 열 수 없습니다.</MessageBarBody>
                </MessageBar>
              )}
            </>
          ) : (
            <div>
              <Button appearance="primary" onClick={() => void chooseDataDir()} disabled={busy}>
                폴더 선택…
              </Button>
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card className={styles.card}>
          <h2 className={styles.h2}>연결할 폴더 *</h2>
          <p className={styles.muted}>Markdown·PDF가 있는 폴더를 연결하세요. 여러 개를 연결할 수 있습니다.</p>
          {sources.length === 0 ? (
            <p className={styles.muted}>아직 연결한 폴더가 없습니다.</p>
          ) : (
            <ul className={styles.list} aria-label="연결한 폴더">
              {sources.map((s) => (
                <li key={s.id} className={styles.item}>
                  <div>
                    <Text weight="semibold">{s.label}</Text>
                    <div className={styles.mono}>{s.path}</div>
                  </div>
                  <Button size="small" onClick={() => void removeSource(s.id)} disabled={busy}>
                    연결 해제
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button appearance="primary" onClick={() => void addSource()} disabled={busy}>
              폴더 추가…
            </Button>
          </div>
        </Card>
      )}

      <div className={styles.nav}>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
          이전
        </Button>
        {step < STEPS.length - 1 ? (
          <Button appearance="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext || busy}>
            다음
          </Button>
        ) : (
          <Button appearance="primary" onClick={onDone} disabled={!canNext || busy}>
            완료
          </Button>
        )}
      </div>
    </main>
  );
}
