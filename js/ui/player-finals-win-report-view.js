/**
 * 参加者決勝 勝利報告の押し間違い防止 UI（DOM 生成。確定ロジック非依存）
 */
import {
  PLAYER_FINALS_YOUR_TEAM_LABEL,
  buildPlayerFinalsWinConfirmCopy,
  canShowPlayerFinalsWinReportButton,
  formatPlayerFinalsReportHint,
  resolvePlayerFinalsOwnMatchSides,
} from "../domain/player-finals-win-report.js";

export function escapePlayerFinalsHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function renderNamedTeamBlock(team, escapeHtml) {
  const name = escapeHtml(team.name);
  if (team.isOwn) {
    return `
      <p class="player-finals-match__role">${escapeHtml(PLAYER_FINALS_YOUR_TEAM_LABEL)}</p>
      <p class="player-finals-match__team player-finals-match__team--own">${name}</p>
    `;
  }
  return `<p class="player-finals-match__team">${name}</p>`;
}

/**
 * @param {{ teamName?: string|null }} payload
 */
export function renderPlayerFinalsSelectedTeamName(payload = {}) {
  return String(payload.teamName || "").trim() || "—";
}

/**
 * @param {object} payload
 */
export function renderPlayerFinalsMatchPanel(payload) {
  const escapeHtml = escapePlayerFinalsHtml;
  const state = payload?.state;
  const roundLabel = payload?.roundLabel ? `<p class="panel__desc">${escapeHtml(payload.roundLabel)}</p>` : "";

  if (canShowPlayerFinalsWinReportButton(state)) {
    const sides = resolvePlayerFinalsOwnMatchSides(payload);
    const hint = formatPlayerFinalsReportHint(payload.teamName);
    return `
      <article class="panel player-finals-match">
        <h3 class="panel__title">決勝トーナメント</h3>
        ${roundLabel}
        ${renderNamedTeamBlock(sides.team1, escapeHtml)}
        <p class="player-finals-match__vs">VS</p>
        ${renderNamedTeamBlock(sides.team2, escapeHtml)}
        <p class="player-finals-match__hint">${escapeHtml(hint)}</p>
        <div class="button-row" style="margin-top: var(--space-md);">
          <button type="button" class="btn btn--primary" data-action="report-win">勝利を報告</button>
        </div>
      </article>
    `;
  }

  const message = escapeHtml(payload?.message || "現在報告できる試合がありません。").replace(/\n/g, "<br>");
  return `
    <article class="panel player-finals-match">
      <h3 class="panel__title">決勝トーナメント</h3>
      <p class="panel__desc">${message}</p>
    </article>
  `;
}

/**
 * @param {{ teamName?: string|null, opponentName?: string|null }} params
 */
export function renderPlayerFinalsWinConfirmDialogInner(params = {}) {
  const copy = buildPlayerFinalsWinConfirmCopy(params);
  const escapeHtml = escapePlayerFinalsHtml;
  return `
    <h2 class="confirm-dialog__title" id="playerFinalsWinConfirmTitle">${escapeHtml(copy.title)}</h2>
    <p class="player-finals-confirm__label">${escapeHtml(copy.winnerLabel)}</p>
    <p class="player-finals-confirm__winner">${escapeHtml(copy.winnerName)}</p>
    <p class="player-finals-confirm__label">${escapeHtml(copy.matchLabel)}</p>
    <p class="player-finals-confirm__match">${escapeHtml(copy.matchLine)}</p>
    <p class="confirm-dialog__message">${escapeHtml(copy.body)}</p>
    <p class="form-alert form-alert--error hidden" data-role="dialog-error"></p>
    <div class="confirm-dialog__actions">
      <button type="button" class="btn btn--ghost" data-action="cancel">${escapeHtml(copy.cancelLabel)}</button>
      <button type="button" class="btn btn--primary player-finals-confirm__submit" data-action="confirm">${escapeHtml(copy.confirmLabel)}</button>
    </div>
  `;
}
