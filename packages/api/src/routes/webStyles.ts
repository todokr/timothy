import { css } from "hono/css";

export const globalStyles = css`
  :root {
    color-scheme: dark;

    --bg: #08090b;
    --panel: #0e1013;
    --panel-edge: #1a1d22;
    --line: #2a1116;
    --line-strong: #7a1020;
    --accent: #ff2e3e;
    --cyan: #00e5e8;
    --yellow: #fcee0a;
    --text: #d3d7de;
    --text-dim: #7b828e;

    --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --font-ui: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;

    --gap: 1rem;
    --gap-lg: 2rem;
  }

  html,
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
  }

  body {
    padding: 2rem 1.5rem 4rem;
    font-family: var(--font-ui);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  a {
    color: var(--cyan);
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap);
  margin: 0 0 0.25rem;
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text);
`;

export const statusClass = css`
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 400;
  letter-spacing: 0.18em;
  color: var(--cyan);
  white-space: nowrap;
`;

/**
 * 左から入った罫線が途中で一段下がって右へ抜ける、HUD 風の区切り線。
 * ::before が上段の水平線、::after が縦のつなぎと下段の水平線を描く。
 */
export const stepRuleClass = css`
  position: relative;
  height: 12px;
  margin-bottom: var(--gap-lg);

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 58%;
    border-top: 1px solid var(--line-strong);
  }

  &::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 42%;
    height: 100%;
    border-left: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
  }
`;

/** 全周の枠ではなく、対角 2 箇所に L 字のブラケットを出す。 */
export const panelClass = css`
  position: relative;

  &::before,
  &::after {
    content: "";
    position: absolute;
    width: 12px;
    height: 12px;
    border-style: solid;
    border-color: var(--accent);
    pointer-events: none;
  }

  &::before {
    top: -1px;
    left: -1px;
    border-width: 1px 0 0 1px;
  }

  &::after {
    right: -1px;
    bottom: -1px;
    border-width: 0 1px 1px 0;
  }
`;

/** 画面端の装飾。内容に意味はないので aria-hidden で隠す。 */
export const railClass = css`
  position: fixed;
  top: 0;
  bottom: 0;
  width: 1.25rem;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 0.5rem;
  line-height: 1.2;
  letter-spacing: 0.05em;
  text-align: center;
  word-break: break-all;
  color: var(--line-strong);
  opacity: 0.7;
  pointer-events: none;
  user-select: none;

  &[data-side="left"] {
    left: 0;
  }

  &[data-side="right"] {
    right: 0;
  }

  @media (max-width: 70rem) {
    display: none;
  }
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
  margin-bottom: var(--gap-lg);
  padding: 1.5rem;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

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
  padding: 4rem 1rem;
  text-align: center;
  color: var(--text-dim);
  background: var(--panel);
  border: 1px solid var(--panel-edge);
`;

export const errorPageClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: var(--accent);
`;

export const rowNumberClass = css`
  width: 2.5rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--text-dim);
`;

export const urlClass = css`
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.01em;
  word-break: break-all;
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

/*
 * --line-strong は罫線用の暗い赤で、文字に使うと 1.74:1 しか出ない。
 * 下の日本語 (--text-dim) との対比は文字色ではなく字間と太さで作る。
 */
export const emptyTitleClass = css`
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--text);
`;
