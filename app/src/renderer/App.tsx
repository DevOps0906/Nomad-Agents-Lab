import { useEffect, useState } from 'react';
import { FluentProvider, Tab, TabList, Text, makeStyles } from '@fluentui/react-components';
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
});

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

export function App() {
  const styles = useStyles();
  const dark = usePrefersDark();
  const [selected, setSelected] = useState<NavId>('S-02');
  const current = NAV_ITEMS.find((item) => item.id === selected) ?? NAV_ITEMS[0];

  return (
    <FluentProvider theme={dark ? darkTheme : lightTheme} className={styles.provider}>
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
    </FluentProvider>
  );
}
