import { css } from "hono/css";

export const bodyClass = css`
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: #1f2933;
  background: #f7f8fa;
`;

export const containerClass = css`
  max-width: 60rem;
  margin: 0 auto;
`;

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;
  overflow: hidden;

  th,
  td {
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid #eef1f4;
    font-size: 0.875rem;
    vertical-align: top;
  }

  th {
    background: #f2f4f7;
    font-weight: 600;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: #9aa5b1;
  }
`;

export const badgeClass = css`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  margin-left: 0.4rem;
  font-size: 0.75rem;
  border-radius: 4px;
  background: #fde2e2;
  color: #a61b1b;
`;

export const formClass = css`
  margin-bottom: 2rem;
  padding: 1.25rem;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;

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
    border: 1px solid #cbd2d9;
    border-radius: 4px;
  }
`;

export const dropZoneClass = css`
  margin-bottom: 1rem;
  padding: 1.5rem;
  text-align: center;
  color: #7b8794;
  border: 2px dashed #cbd2d9;
  border-radius: 8px;

  &[data-dragging="true"] {
    border-color: #2f80ed;
    background: #eef5fe;
    color: #2f80ed;
  }
`;

export const errorBoxClass = css`
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  color: #a61b1b;
  background: #fde2e2;
  border-radius: 4px;

  &[hidden] {
    display: none;
  }
`;

export const emptyClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: #7b8794;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;
`;

export const errorPageClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: #a61b1b;
`;
