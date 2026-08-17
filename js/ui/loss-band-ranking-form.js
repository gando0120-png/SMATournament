/**
 * SE / H2H 向け: rankingMode（通常トーナメント / 順位決定方式）設定フォーム
 */
import { MatchFormat, resolveMatchFormat } from "../domain/aggregate-match-format.js";
import {
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
  RankingMode,
} from "../domain/loss-band/constants.js";
import {
  normalizeLossBandSideOptions,
  resolveRankingMode,
} from "../domain/loss-band/config.js";
import { TournamentFormat } from "../domain/tournament-format.js";

/**
 * @param {HTMLElement|null|undefined} rootEl
 */
export function initLossBandRankingForm(
  rootEl = document.getElementById("lossBandRankingSection")
) {
  if (!rootEl) {
    return null;
  }

  let locked = false;
  /** @type {object} */
  let draft = {
    rankingMode: RankingMode.SINGLE_ELIMINATION,
    ...normalizeLossBandSideOptions({
      guaranteedMatchCount: LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
    }),
  };

  function getTournamentFormat() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return (
      form?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
      form?.dataset?.tournamentFormat ||
      ""
    );
  }

  function getMatchFormat() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return resolveMatchFormat(
      form?.querySelector('input[name="matchFormat"]:checked')?.value
    );
  }

  function isLossBandSelectable() {
    return getMatchFormat() !== MatchFormat.MULTI_TEAM_TOTAL;
  }

  function render() {
    const isLossBand = draft.rankingMode === RankingMode.LOSS_BAND;
    const canSelectLossBand = isLossBandSelectable();
    const disabledAttr = locked ? "disabled" : "";
    const lossBandDisabled =
      locked || !canSelectLossBand ? "disabled" : "";

    rootEl.innerHTML = `
      <fieldset class="field" id="rankingModeFieldset">
        <legend class="field__label">トーナメント進行方式</legend>
        <label class="field field--inline" for="rankingModeSingleElim">
          <input type="radio" id="rankingModeSingleElim" name="rankingMode" value="${RankingMode.SINGLE_ELIMINATION}" ${
            !isLossBand ? "checked" : ""
          } ${disabledAttr}>
          <span>通常トーナメント</span>
        </label>
        <label class="field field--inline" for="rankingModeLossBand">
          <input type="radio" id="rankingModeLossBand" name="rankingMode" value="${RankingMode.LOSS_BAND}" ${
            isLossBand ? "checked" : ""
          } ${lossBandDisabled}>
          <span>順位決定方式</span>
        </label>
        <p class="field__hint">現在、順位決定方式は64チーム・1対1形式のみ対応しています。</p>
        ${
          !canSelectLossBand
            ? `<p class="field__hint">複数チーム同時対戦では順位決定方式を選べません。</p>`
            : ""
        }
      </fieldset>
      <div class="loss-band-ranking-options${isLossBand && canSelectLossBand ? "" : " hidden"}" data-loss-band-options>
        <label class="field field--inline" for="lossBandRematchAvoidance">
          <input type="checkbox" id="lossBandRematchAvoidance" name="rematchAvoidance" ${
            draft.rematchAvoidance ? "checked" : ""
          } ${disabledAttr}>
          <span>再戦回避</span>
        </label>
        <label class="field field--inline" for="lossBandThirdPlaceMatch">
          <input type="checkbox" id="lossBandThirdPlaceMatch" name="thirdPlaceMatch" ${
            draft.thirdPlaceMatch ? "checked" : ""
          } ${disabledAttr}>
          <span>3位決定戦</span>
        </label>
        <label class="field field--inline" for="lossBandExchangeMatches">
          <input type="checkbox" id="lossBandExchangeMatches" name="exchangeMatches" ${
            draft.exchangeMatches ? "checked" : ""
          } ${disabledAttr}>
          <span>交流戦</span>
        </label>
        <label class="field" for="lossBandGuaranteedMatchCount">
          <span class="field__label">最低保証試合数</span>
          <input class="field__input" type="number" id="lossBandGuaranteedMatchCount" name="guaranteedMatchCount" min="1" max="20" value="${
            draft.guaranteedMatchCount ?? LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT
          }" ${disabledAttr}>
        </label>
        <p class="field__hint">標準の最低保証は ${LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT} 試合です。募集チーム数は 33〜64 にしてください（不足分は BYE）。</p>
      </div>
      <p class="field__hint loss-band-ranking-lock${locked ? "" : " hidden"}" data-ranking-lock>ブラケット作成後のため変更できません。</p>
    `;
  }

  function readFromDom() {
    const rankingMode = resolveRankingMode(
      rootEl.querySelector('input[name="rankingMode"]:checked')?.value
    );
    const optionsRoot = rootEl.querySelector("[data-loss-band-options]");
    draft = {
      rankingMode,
      rematchAvoidance: Boolean(
        optionsRoot?.querySelector("#lossBandRematchAvoidance")?.checked
      ),
      thirdPlaceMatch: Boolean(
        optionsRoot?.querySelector("#lossBandThirdPlaceMatch")?.checked
      ),
      exchangeMatches: Boolean(
        optionsRoot?.querySelector("#lossBandExchangeMatches")?.checked
      ),
      guaranteedMatchCount: Number(
        optionsRoot?.querySelector("#lossBandGuaranteedMatchCount")?.value ||
          LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT
      ),
    };
    if (rankingMode === RankingMode.LOSS_BAND && !isLossBandSelectable()) {
      draft.rankingMode = RankingMode.SINGLE_ELIMINATION;
    }
  }

  function syncVisibility() {
    const isSe = getTournamentFormat() === TournamentFormat.SINGLE_ELIMINATION;
    const isH2h = getMatchFormat() !== MatchFormat.MULTI_TEAM_TOTAL;
    rootEl.classList.toggle("hidden", !isSe || !isH2h);
    if (isSe && isH2h) {
      const options = rootEl.querySelector("[data-loss-band-options]");
      const isLossBand = draft.rankingMode === RankingMode.LOSS_BAND;
      options?.classList.toggle("hidden", !isLossBand);
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !rootEl.contains(target)) {
      return;
    }
    readFromDom();
    const options = rootEl.querySelector("[data-loss-band-options]");
    options?.classList.toggle(
      "hidden",
      draft.rankingMode !== RankingMode.LOSS_BAND || !isLossBandSelectable()
    );
    const lossBandRadio = rootEl.querySelector("#rankingModeLossBand");
    if (lossBandRadio instanceof HTMLInputElement) {
      lossBandRadio.disabled = locked || !isLossBandSelectable();
    }
  }

  /**
   * @returns {object}
   */
  function readInput() {
    if (getTournamentFormat() !== TournamentFormat.SINGLE_ELIMINATION) {
      return {};
    }
    if (getMatchFormat() === MatchFormat.MULTI_TEAM_TOTAL) {
      return {};
    }
    readFromDom();
    if (draft.rankingMode !== RankingMode.LOSS_BAND) {
      // 未設定の既存大会を single_elimination フィールドで上書きしない
      return {};
    }
    return {
      rankingMode: RankingMode.LOSS_BAND,
      rematchAvoidance: draft.rematchAvoidance === true,
      thirdPlaceMatch: draft.thirdPlaceMatch === true,
      exchangeMatches: draft.exchangeMatches === true,
      guaranteedMatchCount:
        draft.guaranteedMatchCount ?? LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
    };
  }

  /**
   * @param {object} tournament
   */
  function populate(tournament) {
    const main = tournament?.bracketMatchConfig?.main || tournament || {};
    const rankingMode = resolveRankingMode(main.rankingMode ?? tournament?.rankingMode);
    draft = {
      rankingMode,
      ...normalizeLossBandSideOptions({
        ...main,
        guaranteedMatchCount:
          main.guaranteedMatchCount ?? LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
      }),
    };
    render();
    syncVisibility();
  }

  /**
   * @param {boolean} nextLocked
   */
  function setLocked(nextLocked) {
    locked = Boolean(nextLocked);
    readFromDom();
    render();
    syncVisibility();
  }

  function refresh() {
    if (getMatchFormat() === MatchFormat.MULTI_TEAM_TOTAL && draft.rankingMode === RankingMode.LOSS_BAND) {
      draft.rankingMode = RankingMode.SINGLE_ELIMINATION;
      render();
    }
    syncVisibility();
    const lossBandRadio = rootEl.querySelector("#rankingModeLossBand");
    if (lossBandRadio instanceof HTMLInputElement) {
      lossBandRadio.disabled = locked || !isLossBandSelectable();
    }
  }

  rootEl.addEventListener("change", onChange);
  rootEl.addEventListener("input", onChange);

  document.addEventListener("change", (event) => {
    if (
      event.target?.name === "tournamentFormat" ||
      event.target?.name === "matchFormat"
    ) {
      refresh();
    }
  });

  render();
  syncVisibility();

  return {
    readInput,
    populate,
    setLocked,
    refresh,
  };
}
