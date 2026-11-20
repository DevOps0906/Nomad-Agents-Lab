// design/tokens/tokens.css → Fluent v9 테마 오버라이드(task-006 결정, tokens.css 머리말의 대응표).
// 값은 CSS 변수로만 참조한다: tokens.css 한 곳을 바꾸면 Fluent 토큰도 따라 바뀐다. 다크는 .dark 클래스가 같은 변수를 바꾼다.
import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

const tokenOverrides: Partial<Theme> = {
  colorNeutralBackground1: 'var(--color-bg)',
  colorNeutralBackground2: 'var(--color-surface)',
  colorNeutralForeground1: 'var(--color-text)',
  colorNeutralForeground3: 'var(--color-text-muted)',
  colorNeutralStroke2: 'var(--color-border)',
  colorNeutralStrokeAccessible: 'var(--color-input)',
  colorBrandBackground: 'var(--color-primary)',
  colorNeutralForegroundOnBrand: 'var(--color-primary-fg)',
  colorStrokeFocus2: 'var(--color-focus)',
  fontFamilyBase: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  borderRadiusMedium: 'var(--radius-control)',
  borderRadiusXLarge: 'var(--radius-card)',
};

export const lightTheme: Theme = { ...webLightTheme, ...tokenOverrides };
export const darkTheme: Theme = { ...webDarkTheme, ...tokenOverrides };
