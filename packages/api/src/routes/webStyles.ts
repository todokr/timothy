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

export const containerClass = css`
  max-width: 60rem;
  margin: 0 auto;
`;

export const headerClass = css`
  margin: 0 0 var(--space-5);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--gray-900);
`;

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

  th,
  td {
    padding: 0.7rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--line);
    font-size: 0.8125rem;
    vertical-align: top;
  }

  th {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--cyan);
    background: #121419;
    border-bottom-color: var(--line-strong);
  }

  tbody tr {
    position: relative;
    transition: background-color 120ms linear;
  }

  tbody tr:hover {
    background: #14090c;
  }

  tbody tr:hover td:first-child {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: var(--text-dim);
  }

  /* 減光しつつ本文サイズで AA (4.91:1) を満たすくすんだシアン。 */
  tr[data-expired="true"] a {
    color: #5c898c;
  }
`;

export const badgeClass = css`
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.05rem 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  border: 1px solid var(--line-strong);
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
    margin-bottom: 1rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--cyan);
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    margin-top: 0.35rem;
    padding: 0.45rem 0.1rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    letter-spacing: 0.02em;
    color: var(--text);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--panel-edge);
    border-radius: 0;
    transition: border-color 120ms linear;
  }

  input[type="text"]:focus,
  input[type="number"]:focus {
    outline: none;
    border-bottom-color: var(--cyan);
  }

  input[type="file"] {
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  input[type="file"]::file-selector-button {
    margin-right: 0.6rem;
    padding: 0.3rem 0.7rem;
    font: inherit;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cyan);
    background: transparent;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
`;

export const dropZoneClass = css`
  margin-bottom: 1.5rem;
  padding: 2rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-align: center;
  color: var(--text-dim);
  border: 1px dashed var(--panel-edge);
  transition:
    color 120ms linear,
    border-color 120ms linear,
    background-color 120ms linear;

  &[data-dragging="true"] {
    color: var(--yellow);
    background: #17170a;
    border-color: var(--yellow);
  }
`;

export const submitButtonClass = css`
  padding: 0.55rem 1.6rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #08090b;
  background: var(--yellow);
  border: none;
  cursor: pointer;
  /* 右下の角を斜めに落として HUD のボタンらしくする */
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  transition: opacity 120ms linear;

  &:hover:not(:disabled) {
    opacity: 0.85;
  }

  &:disabled {
    color: var(--text-dim);
    background: #2a2c31;
    cursor: default;
  }
`;

export const errorBoxClass = css`
  margin: 0 0 var(--gap);
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  color: var(--accent);
  background: #1a0d10;
  border: 1px solid var(--line-strong);

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
  margin-left: 0.5rem;
  padding: 0.15rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--cyan);
  background: transparent;
  border: 1px solid var(--panel-edge);
  cursor: pointer;
  transition:
    color 120ms linear,
    border-color 120ms linear;

  &:hover:not(:disabled) {
    border-color: var(--cyan);
  }

  &:disabled {
    color: var(--text-dim);
    cursor: default;
  }
`;

export const dangerButtonClass = css`
  padding: 0.15rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  transition:
    color 120ms linear,
    background-color 120ms linear;

  &:hover:not(:disabled) {
    color: #08090b;
    background: var(--accent);
  }

  &:disabled {
    color: var(--text-dim);
    border-color: var(--panel-edge);
    cursor: default;
  }
`;

export const rowErrorClass = css`
  display: block;
  margin-top: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--accent);
`;
