import { css } from "hono/css";

export const globalStyles = css`
  :root {
    color-scheme: light;

    --gray-0: #ffffff;
    --gray-25: #fcfcfd;
    --gray-50: #f8f9fa;
    --gray-100: #f1f3f5;
    --gray-200: #e9ecef;
    --gray-300: #dee2e6;
    --gray-400: #adb5bd;
    --gray-500: #6b7280;
    --gray-700: #495057;
    --gray-900: #212529;

    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --accent-soft: #eff4ff;

    --danger: #c92a2a;
    --danger-soft: #fff5f5;

    --radius-sm: 6px;
    --radius-md: 10px;
    --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05);

    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;

    --font-sans: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  }

  html,
  body {
    margin: 0;
    background: var(--gray-50);
    color: var(--gray-900);
  }

  body {
    padding: var(--space-6) var(--space-4);
    font-family: var(--font-sans);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
      animation: none !important;
    }
  }
`;

/*
 * 60rem のままだと 6 列のテーブル (実測 1221px) が収まらず、1280px の画面でも
 * 削除ボタンに横スクロールなしで届かない。一覧性を優先して 78rem まで広げる。
 * フォームの入力欄は個別に max-width を持つので、広げても間延びしない。
 */
export const containerClass = css`
  max-width: 78rem;
  margin: 0 auto;
`;

export const headerClass = css`
  margin: 0 0 var(--space-5);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--gray-900);
`;

export const tableWrapClass = css`
  overflow-x: auto;
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: var(--space-3) var(--space-4);
    text-align: left;
    vertical-align: middle;
    white-space: nowrap;
  }

  th {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--gray-500);
    border-bottom: 1px solid var(--gray-200);
  }

  td {
    font-size: 0.875rem;
    border-bottom: 1px solid var(--gray-100);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--gray-25);
  }

  /* 説明は長くなりうるので、この列だけ折り返しを許す。 */
  td:nth-child(2) {
    white-space: normal;
    min-width: 12rem;
    color: var(--gray-700);
  }

  /* 有効期限と作成日時。桁を揃える。 */
  td:nth-child(4),
  td:nth-child(5) {
    font-variant-numeric: tabular-nums;
    color: var(--gray-700);
  }
`;

export const shareCellClass = css`
  display: flex;
  gap: var(--space-2);
  align-items: center;
`;

export const formClass = css`
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  label {
    display: block;
    margin-bottom: var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--gray-700);
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    height: 2.25rem;
    margin-top: var(--space-1);
    padding: 0 var(--space-3);
    font: inherit;
    font-weight: 400;
    color: var(--gray-900);
    background: var(--gray-0);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    transition: border-color 120ms linear, box-shadow 120ms linear;
  }

  input[type="number"] {
    max-width: 8rem;
  }

  input[type="text"]::placeholder {
    color: var(--gray-400);
  }

  input[type="text"]:focus,
  input[type="number"]:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  input[type="file"] {
    display: block;
    margin-top: var(--space-1);
    font: inherit;
    font-size: 0.875rem;
    color: var(--gray-700);
  }

  textarea,
  select {
    display: block;
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-weight: 400;
    color: var(--gray-900);
    background: var(--gray-0);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
  }

  textarea {
    width: 100%;
    max-width: 32rem;
    min-height: 4.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    resize: vertical;
  }

  select {
    height: 2.25rem;
    padding: 0 var(--space-2);
  }

  textarea:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  input[type="file"]::file-selector-button {
    margin-right: var(--space-3);
    padding: 0 var(--space-3);
    height: 1.75rem;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--gray-700);
    background: transparent;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
`;

export const dropZoneClass = css`
  margin-bottom: var(--space-4);
  padding: var(--space-6) var(--space-4);
  font-size: 0.875rem;
  text-align: center;
  color: var(--gray-500);
  border: 2px dashed var(--gray-300);
  border-radius: var(--radius-md);
  transition:
    color 120ms linear,
    border-color 120ms linear,
    background-color 120ms linear;

  &[data-dragging="true"] {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: var(--accent);
  }
`;

export const submitButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  padding: 0 var(--space-4);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: #fff;
  background: var(--accent);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--gray-0), 0 0 0 4px var(--accent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const errorBoxClass = css`
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  font-size: 0.875rem;
  color: var(--danger);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;

  &[hidden] {
    display: none;
  }
`;

export const emptyClass = css`
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-500);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  p {
    margin: 0;
  }
`;

export const errorPageClass = css`
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--danger);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const ghostButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  padding: 0 var(--space-3);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  color: var(--gray-700);
  background: transparent;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear, border-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--gray-100);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--gray-0), 0 0 0 4px var(--accent);
  }

  &:disabled {
    color: var(--gray-400);
    cursor: not-allowed;
  }
`;

export const dangerButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  padding: 0 var(--space-3);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--danger);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--gray-0), 0 0 0 4px var(--accent);
  }

  &:disabled {
    color: var(--gray-400);
    cursor: not-allowed;
  }
`;

export const rowErrorClass = css`
  margin-left: var(--space-2);
  font-size: 0.8125rem;
  color: var(--danger);
`;

export const previewClass = css`
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  line-height: 1.7;
  color: var(--gray-700);
  word-break: break-all;
  white-space: pre-wrap;
  background: var(--gray-100);
  border-radius: var(--radius-sm);
`;

export const tokenListClass = css`
  margin-bottom: var(--space-4);

  label {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin-bottom: var(--space-2);
    font-weight: 400;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
  }

  span {
    color: var(--gray-500);
  }
`;

/*
 * 危険度は色だけで示さない。色覚特性や白黒印刷で区別が付かなくなると、
 * 隔離を弱める設定を安全なものと同じに見せてしまう。記号と文言を必ず伴わせる。
 */
export const riskBadgeClass = css`
  flex-shrink: 0;
  padding: 0 var(--space-2);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.5rem;
  border-radius: var(--radius-sm);

  &[data-risk="caution"] {
    color: #92400e;
    background: #fef3c7;
  }

  &[data-risk="danger"] {
    color: var(--danger);
    background: var(--danger-soft);
  }
`;

/*
 * フォーム下部のボタン列。ghostButtonClass は一覧の行高に合わせて 1.75rem なので、
 * そのまま置くと送信ボタン (2.25rem) と高さが揃わない。行内での寸法は変えたくないため、
 * この文脈でだけ上書きする。
 */
export const formActionsClass = css`
  display: flex;
  gap: var(--space-2);

  button {
    height: 2.25rem;
    font-size: 0.875rem;
  }
`;

export const previewLabelClass = css`
  margin: 0 0 var(--space-2);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--gray-500);
`;
