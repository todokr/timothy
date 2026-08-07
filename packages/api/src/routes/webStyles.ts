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

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  overflow: hidden;

  th,
  td {
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--line);
    font-size: 0.875rem;
    vertical-align: top;
  }

  th {
    background: #121419;
    font-weight: 600;
    color: var(--text-dim);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: var(--text-dim);
  }
`;

export const badgeClass = css`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  margin-left: 0.4rem;
  font-size: 0.75rem;
  color: var(--accent);
  border: 1px solid var(--line-strong);
`;

export const formClass = css`
  margin-bottom: var(--gap-lg);
  padding: 1.25rem;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

  label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    margin-top: 0.25rem;
    padding: 0.4rem 0.5rem;
    font: inherit;
    font-weight: 400;
    color: var(--text);
    background: #14171c;
    border: 1px solid var(--panel-edge);
  }
`;

export const dropZoneClass = css`
  margin-bottom: var(--gap);
  padding: 1.5rem;
  text-align: center;
  color: var(--text-dim);
  border: 1px dashed var(--panel-edge);

  &[data-dragging="true"] {
    color: var(--yellow);
    border-color: var(--yellow);
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
  padding: 3rem 1rem;
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
