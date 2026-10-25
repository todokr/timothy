/**
 * ブリッジ（本体 HTML の中）と親画面（外枠ページ）が postMessage でやり取りするメッセージの種別。
 * すべてのメッセージは { tim: 1, type: <種別>, ... } の形にする。
 */
export const BRIDGE_MESSAGES = {
  // 本体→親
  READY: "tim:ready",
  COMPOSE: "tim:compose",
  KEY: "tim:key",
  PICK_ENDED: "tim:pick-ended",
  ANCHOR_STATES: "tim:anchor-states",
  FOCUS_RESULT: "tim:focus-result",
  OPEN_LINK: "tim:open-link",
  // 親→本体
  SET_PICK: "tim:set-pick",
  SET_ANCHORS: "tim:set-anchors",
  FOCUS: "tim:focus",
  CLEAR_SELECTION: "tim:clear-selection",
} as const;
