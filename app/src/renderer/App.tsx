import { useCallback, useEffect, useState } from 'react';
import { Button, FluentProvider, Spinner, Tab, TabList, Text, makeStyles } from '@fluentui/react-components';
import type { EnvCheckResult, SourceItem } from '../shared/ipc';
import { invoke } from './api';
import { Onboarding } from './Onboarding';
import { darkTheme, lightTheme } from './theme';

/** 좌측 내비 항목(docs/03_SCREENS_UX.md S-02 nav). 화면 내용은 각 기능 작업에서 채운다. */
const NAV_ITEMS = [
  { id: 'S-02', label: '대시보드' },
  { id: 'S-03', label: 'Second Brain' },
  { id: 'S-04', label: '스킬' },
  { id: 'S-06', label: '실행 기록' },
  { id: 'S-08', label: '설정' },
] as const;

type NavId = (typeof NAV_ITEMS)[number]['id'];

const useStyles = makeStyles({
  provider: { height: '100%' },
  shell: {
    display: 'grid',
    gridTemplateColumns: 'var(--layout-sidebar) 1fr',
    height: '100%',
  },
  nav: {
    backgroundColor: 'var(--color-surface)',
    borderRight: '1px solid var(--color-border)',
    paddingTop: 'calc(var(--spacing) * 4)',
    paddingInline: 'calc(var(--spacing) * 2)',
  },
  brand: {
    display: 'block',
    fontSize: 'var(--text-h2)',
    fontWeight: 600,
    paddingInline: 'calc(var(--spacing) * 3)',
    paddingBottom: 'calc(var(--spacing) * 4)',
  },
  main: {
    padding: 'calc(var(--spacing) * 6)',
    overflow: 'auto',
  },
  title: { fontSize: 'var(--text-h1)', margin: 0 },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--text-body)' },
  center: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 'calc(var(--spacing) * 4)',
    padding: 'calc(var(--spacing) * 6)',
    textAlign: 'center',
  },
});

/** 시작 오류 원인 문구(경로·원문 없음). 데이터 위치 재지정은 task-015. */
const BOOT_ERROR_TEXT: Record<string, string> = {
  config_corrupt: '앱 설정 파일(boot_config.json)이 손상되어 데이터 위치를 알 수 없습니다.',
  data_dir_missing: '데이터 위치 폴더를 찾을 수 없습니다. 외장 드라이브라면 연결한 뒤 다시 시도하세요.',
  db_missing: '데이터 위치에 SSR 데이터(ssr.db)가 없습니다.',
  schema_too_new: '데이터가 이 앱보다 새 버전에서 만들어졌습니다. 앱을 업데이트하세요.',
  db_open_failed: '데이터 파일을 열 수 없습니다.',
  boot_failed: '앱을 시작하는 중 문제가 생겼습니다.',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return dark;
}

function isNavId(value: unknown): value is NavId {
  return NAV_ITEMS.some((item) => item.id === value);
}

function Shell() {
  const styles = useStyles();
  const [selected, setSelected] = useState<NavId>('S-02');
  const current = NAV_ITEMS.find((item) => item.id === selected) ?? NAV_ITEMS[0];

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="주 메뉴">
        <Text className={styles.brand}>SSR+</Text>
        <TabList
          vertical
          selectedValue={selected}
          onTabSelect={(_event, data) => {
            if (isNavId(data.value)) setSelected(data.value);
          }}
        >
          {NAV_ITEMS.map((item) => (
            <Tab key={item.id} value={item.id}>
              {item.label}
            </Tab>
          ))}
        </TabList>
      </nav>
      <main className={styles.main}>
        <h1 className={styles.title}>{current.label}</h1>
        <p className={styles.muted}>이 화면은 이후 작업에서 구현합니다.</p>
      </main>
    </div>
  );
}

/** 앱 상태 라우팅: 점검 결과의 데이터 위치 상태로 S-01·오류·셸을 고른다. */
export function App() {
  const styles = useStyles();
  const dark = usePrefersDark();
  const [env, setEnv] = useState<EnvCheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setFailed(false);
    try {
      setEnv(await invoke<EnvCheckResult>('env.check'));
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // 화면은 로딩·오류에서만 점검 결과로 정한다(마법사 중 "다시 확인"으로 화면이 바뀌지 않게). 마법사 완료는 onDone.
  // 데이터 위치는 있는데 연결 폴더가 0개면 마법사 3단계로 재개한다.
  const [mode, setMode] = useState<'loading' | 'onboarding' | 'resume' | 'shell' | 'error'>('loading');
  useEffect(() => {
    if (failed || env?.dataDir === 'error') {
      setMode('error');
      return;
    }
    if (!env) return;
    let cancelled = false;
    void (async () => {
      let next: 'onboarding' | 'resume' | 'shell' = 'onboarding';
      if (env.dataDir === 'set') {
        try {
          next = (await invoke<SourceItem[]>('sources.list')).length === 0 ? 'resume' : 'shell';
        } catch {
          next = 'shell';
        }
      }
      if (!cancelled) setMode((m) => (m === 'loading' || m === 'error' ? next : m));
    })();
    return () => {
      cancelled = true;
    };
  }, [env, failed]);

  let content;
  if (mode === 'loading') {
    content = (
      <div className={styles.center}>
        <Spinner label="환경을 확인하는 중…" />
      </div>
    );
  } else if (mode === 'error') {
    content = (
      <div className={styles.center} role="alert">
        <h1 className={styles.title}>시작할 수 없습니다</h1>
        <p className={styles.muted}>
          {BOOT_ERROR_TEXT[env?.bootError ?? 'boot_failed'] ?? BOOT_ERROR_TEXT['boot_failed']}
        </p>
        <div>
          <Button appearance="primary" onClick={() => void check()} disabled={checking}>
            다시 시도
          </Button>
        </div>
      </div>
    );
  } else if (mode === 'onboarding' || mode === 'resume') {
    content = (
      <Onboarding
        env={env}
        checking={checking}
        onRecheck={() => void check()}
        onDone={() => setMode('shell')}
        resume={mode === 'resume'}
      />
    );
  } else {
    content = <Shell />;
  }

  return (
    <FluentProvider theme={dark ? darkTheme : lightTheme} className={styles.provider}>
      {content}
    </FluentProvider>
  );
}
