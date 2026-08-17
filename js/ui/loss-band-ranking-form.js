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
import {
  defaultGuaranteedMatchCount,
  describeLossBandBracketSize,
  renderLossBandBracketSizeRadios,
  resolveUiBracketSize,
} from "./loss-band-bracket-options.js";

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
  /** ユーザーが保証試合数を明示編集したか */
  let guaranteedTouched = false;
  /** @type {object} */
  let draft = {
    rankingMode: RankingMode.SINGLE_ELIMINATION,
    ...normalizeLossBandSideOptions({
      bracketSize: 64,
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
    const bracketSize = resolveUiBracketSize(draft.bracketSize);
    const desc = describeLossBandBracketSize(bracketSize);

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
        <p class="field__hint">順位決定方式は32・64・128チーム枠の1対1形式に対応しています。</p>
        ${
          !canSelectLossBand
            ? `<p class="field__hint">複数チーム同時対戦では順位決定方式を選べません。</p>`
            : ""
        }
      </fieldset>
      <div class="loss-band-ranking-options${isLossBand && canSelectLossBand ? "" : " hidden"}" data-loss-band-options>
        ${renderLossBandBracketSizeRadios({
          name: "lossBandBracketSize",
          idPrefix: "lossBandBracketSize",
          selected: bracketSize,
          locked,
        })}
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
            draft.guaranteedMatchCount ?? desc.guaranteed
          }" ${disabledAttr} data-guaranteed-input>
        </label>
        <p class="field__hint">募集チーム数は ${desc.rangeLabel} にしてください（不足分は BYE）。標準の最低保証は ${desc.guaranteed} 試合です。</p>
      </div>
      <p class="field__hint loss-band-ranking-lock${locked ? "" : " hidden"}" data-ranking-lock>ブラケット作成後のため変更できません。</p>
    `;
  }

  function readFromDom() {
    const rankingMode = resolveRankingMode(
      rootEl.querySelector('input[name="rankingMode"]:checked')?.value
    );
    const optionsRoot = rootEl.querySelector("[data-loss-band-options]");
    const prevBracket = resolveUiBracketSize(draft.bracketSize);
    const nextBracket = resolveUiBracketSize(
      Number(
        optionsRoot?.querySelector('input[name="lossBandBracketSize"]:checked')
          ?.value
      )
    );
    const guaranteedInput = optionsRoot?.querySelector(
      "[data-guaranteed-input]"
    );
    let guaranteedMatchCount = Number(
      guaranteedInput?.value || defaultGuaranteedMatchCount(nextBracket)
    );
    if (
      !guaranteedTouched &&
      nextBracket !== prevBracket &&
      Number(guaranteedInput?.value) === defaultGuaranteedMatchCount(prevBracket)
    ) {
      guaranteedMatchCount = defaultGuaranteedMatchCount(nextBracket);
    }

    draft = {
      rankingMode,
      bracketSize: nextBracket,
      rematchAvoidance: Boolean(
        optionsRoot?.querySelector("#lossBandRematchAvoidance")?.checked
      ),
      thirdPlaceMatch: Boolean(
        optionsRoot?.querySelector("#lossBandThirdPlaceMatch")?.checked
      ),
      exchangeMatches: Boolean(
        optionsRoot?.querySelector("#lossBandExchangeMatches")?.checked
      ),
      guaranteedMatchCount,
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

  function syncBracketHintAndGuaranteed() {
    const hint = rootEl.querySelector("[data-bracket-size-hint]");
    const desc = describeLossBandBracketSize(
      resolveUiBracketSize(draft.bracketSize)
    );
    if (hint) hint.textContent = desc.hint;
    const guaranteedInput = rootEl.querySelector("[data-guaranteed-input]");
    if (
      guaranteedInput instanceof HTMLInputElement &&
      !guaranteedTouched
    ) {
      guaranteedInput.value = String(desc.guaranteed);
      draft.guaranteedMatchCount = desc.guaranteed;
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !rootEl.contains(target)) {
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-guaranteed-input]")
    ) {
      guaranteedTouched = true;
    }
    const prevBracket = resolveUiBracketSize(draft.bracketSize);
    readFromDom();
    if (resolveUiBracketSize(draft.bracketSize) !== prevBracket) {
      syncBracketHintAndGuaranteed();
      // 枠変更時はヒント付きで再描画（ラジオ選択状態を保持）
      render();
      syncVisibility();
      return;
    }
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
      return {};
    }
    return {
      rankingMode: RankingMode.LOSS_BAND,
      bracketSize: resolveUiBracketSize(draft.bracketSize),
      rematchAvoidance: draft.rematchAvoidance === true,
      thirdPlaceMatch: draft.thirdPlaceMatch === true,
      exchangeMatches: draft.exchangeMatches === true,
      guaranteedMatchCount:
        draft.guaranteedMatchCount ??
        defaultGuaranteedMatchCount(resolveUiBracketSize(draft.bracketSize)),
    };
  }

  /**
   * @param {object} tournament
   */
  function populate(tournament) {
    const main = tournament?.bracketMatchConfig?.main || tournament || {};
    const rankingMode = resolveRankingMode(main.rankingMode ?? tournament?.rankingMode);
    const maxTeams = Number.parseInt(String(tournament?.maxTeams ?? ""), 10);
    draft = {
      rankingMode,
      ...normalizeLossBandSideOptions({
        ...main,
        bracketSize: resolveUiBracketSize(main.bracketSize, maxTeams),
        guaranteedMatchCount:
          main.guaranteedMatchCount ??
          defaultGuaranteedMatchCount(
            resolveUiBracketSize(main.bracketSize, maxTeams)
          ),
      }),
    };
    guaranteedTouched = Number.isInteger(main.guaranteedMatchCount);
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
