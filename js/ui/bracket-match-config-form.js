/**
 * 予選＋決勝向け: 上位 / 下位の試合形式設定フォーム
 */
import { MatchFormat, resolveMatchFormat } from "../domain/aggregate-match-format.js";
import {
  normalizeBracketMatchConfig,
  normalizeBracketMatchSide,
} from "../domain/bracket-match-config.js";
import { TournamentFormat } from "../domain/tournament-format.js";

/**
 * @param {HTMLElement|null|undefined} rootEl
 */
export function initBracketMatchConfigForm(
  rootEl = document.getElementById("bracketMatchConfigSection")
) {
  if (!rootEl) {
    return null;
  }

  /** @type {Record<string, object>} */
  const draftBySide = {
    main: normalizeBracketMatchSide({ enabled: true }),
    consolation: normalizeBracketMatchSide({ enabled: true }),
  };

  let lockedMain = false;
  let lockedConsolation = false;

  function getTournamentFormat() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return (
      form?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
      form?.dataset?.tournamentFormat ||
      ""
    );
  }

  function syncVisibility() {
    const isQf = getTournamentFormat() === TournamentFormat.QUALIFYING_AND_FINALS;
    rootEl.classList.toggle("hidden", !isQf);
    document.getElementById("finalsMatchRulesSection")?.classList.toggle("hidden", isQf);
    document.getElementById("aggregateMatchRulesSection")?.classList.toggle("hidden", true);
    document.getElementById("matchFormatSection")?.classList.toggle(
      "hidden",
      isQf || getTournamentFormat() !== TournamentFormat.SINGLE_ELIMINATION
    );
  }

  function renderSide(sideKey, title) {
    const side = draftBySide[sideKey];
    const locked = sideKey === "main" ? lockedMain : lockedConsolation;
    const isMulti = side.matchFormat === MatchFormat.MULTI_TEAM_TOTAL;
    const rules = side.finalsMatchRules || { defaultWinsRequired: 2, roundOverrides: {} };
    const agg = side.aggregateMatchRules || {
      teamCount: 4,
      qualifiersCount: 2,
    };
    const finalOnly3 = rules.roundOverrides?.final === 3 && rules.defaultWinsRequired === 2;

    return `
      <fieldset class="field bracket-match-config__card" data-side="${sideKey}">
        <legend class="field__label">${title}</legend>
        <label class="field field--inline">
          <input type="checkbox" data-side-enabled="${sideKey}" ${side.enabled ? "checked" : ""} ${locked ? "disabled" : ""}>
          <span>実施する</span>
        </label>
        <div class="bracket-match-config__details${side.enabled ? "" : " hidden"}" data-side-details="${sideKey}">
          <fieldset class="field">
            <legend class="field__label">形式</legend>
            <label class="field field--inline">
              <input type="radio" name="${sideKey}MatchFormat" value="${MatchFormat.HEAD_TO_HEAD_SETS}" ${!isMulti ? "checked" : ""} ${locked ? "disabled" : ""}>
              <span>1対1トーナメント</span>
            </label>
            <label class="field field--inline">
              <input type="radio" name="${sideKey}MatchFormat" value="${MatchFormat.MULTI_TEAM_TOTAL}" ${isMulti ? "checked" : ""} ${locked ? "disabled" : ""}>
              <span>複数チーム同時対戦</span>
            </label>
          </fieldset>
          <div class="bracket-match-config__h2h${isMulti ? " hidden" : ""}" data-side-h2h="${sideKey}">
            <fieldset class="field">
              <legend class="field__label">勝利必要数</legend>
              <label class="field field--inline">
                <input type="radio" name="${sideKey}WinsRequired" value="2" ${rules.defaultWinsRequired !== 3 ? "checked" : ""} ${locked ? "disabled" : ""}>
                <span>2セット先取</span>
              </label>
              <label class="field field--inline">
                <input type="radio" name="${sideKey}WinsRequired" value="3" ${rules.defaultWinsRequired === 3 ? "checked" : ""} ${locked ? "disabled" : ""}>
                <span>3セット先取</span>
              </label>
            </fieldset>
            <label class="field field--inline">
              <input type="checkbox" data-side-final-only3="${sideKey}" ${finalOnly3 ? "checked" : ""} ${locked ? "disabled" : ""}>
              <span>決勝のみ3セット先取</span>
            </label>
          </div>
          <div class="bracket-match-config__multi${!isMulti ? " hidden" : ""}" data-side-multi="${sideKey}">
            <fieldset class="field">
              <legend class="field__label">1試合のチーム数</legend>
              ${[2, 3, 4]
                .map(
                  (n) => `
                <label class="field field--inline">
                  <input type="radio" name="${sideKey}TeamCount" value="${n}" ${agg.teamCount === n ? "checked" : ""} ${locked ? "disabled" : ""}>
                  <span>${n}</span>
                </label>`
                )
                .join("")}
            </fieldset>
            <fieldset class="field">
              <legend class="field__label">通過チーム数</legend>
              ${[1, 2]
                .map(
                  (n) => `
                <label class="field field--inline">
                  <input type="radio" name="${sideKey}QualifiersCount" value="${n}" ${agg.qualifiersCount === n ? "checked" : ""} ${locked || n >= agg.teamCount ? "disabled" : ""}>
                  <span>上位${n}</span>
                </label>`
                )
                .join("")}
            </fieldset>
            <p class="field__hint">セット数: 2（固定） / 合計点方式</p>
          </div>
        </div>
        <p class="field__hint bracket-match-config__lock${locked ? "" : " hidden"}" data-side-lock="${sideKey}">ブラケット作成後のため変更できません。</p>
      </fieldset>
    `;
  }

  function render() {
    rootEl.innerHTML = `
      <h3 class="panel__title">決勝トーナメント設定</h3>
      <p class="field__hint">上位と下位で異なる対戦形式を設定できます。</p>
      ${renderSide("main", "上位トーナメント")}
      ${renderSide("consolation", "下位トーナメント")}
    `;
  }

  function readSideFromDom(sideKey) {
    const enabled = Boolean(
      rootEl.querySelector(`[data-side-enabled="${sideKey}"]`)?.checked
    );
    const matchFormat = resolveMatchFormat(
      rootEl.querySelector(`input[name="${sideKey}MatchFormat"]:checked`)?.value
    );
    const winsRequired = Number(
      rootEl.querySelector(`input[name="${sideKey}WinsRequired"]:checked`)?.value || 2
    );
    const finalOnly3 = Boolean(
      rootEl.querySelector(`[data-side-final-only3="${sideKey}"]`)?.checked
    );
    const teamCount = Number(
      rootEl.querySelector(`input[name="${sideKey}TeamCount"]:checked`)?.value || 4
    );
    const qualifiersCount = Number(
      rootEl.querySelector(`input[name="${sideKey}QualifiersCount"]:checked`)?.value || 2
    );

    const prev = draftBySide[sideKey];
    if (matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
      draftBySide[sideKey] = {
        enabled,
        matchFormat,
        finalsMatchRules: prev.finalsMatchRules,
        aggregateMatchRules: {
          teamCount,
          setCount: 2,
          qualifiersCount: Math.min(qualifiersCount, teamCount - 1),
          rankingMethod: "totalScoreDesc",
          tieBreakMethod: "manual",
        },
      };
    } else {
      draftBySide[sideKey] = {
        enabled,
        matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
        aggregateMatchRules: prev.aggregateMatchRules,
        finalsMatchRules: {
          defaultWinsRequired: winsRequired === 3 ? 3 : 2,
          roundOverrides: finalOnly3 && winsRequired !== 3 ? { final: 3 } : {},
        },
      };
    }
  }

  function syncDomFromDraft() {
    for (const sideKey of ["main", "consolation"]) {
      const side = draftBySide[sideKey];
      const details = rootEl.querySelector(`[data-side-details="${sideKey}"]`);
      details?.classList.toggle("hidden", !side.enabled);
      const isMulti = side.matchFormat === MatchFormat.MULTI_TEAM_TOTAL;
      rootEl.querySelector(`[data-side-h2h="${sideKey}"]`)?.classList.toggle("hidden", isMulti);
      rootEl.querySelector(`[data-side-multi="${sideKey}"]`)?.classList.toggle("hidden", !isMulti);
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !rootEl.contains(target)) return;
    if (
      target.matches("[data-side-enabled], input[type=radio], [data-side-final-only3]")
    ) {
      for (const sideKey of ["main", "consolation"]) {
        readSideFromDom(sideKey);
      }
      if (target.name?.endsWith("TeamCount") || target.name?.endsWith("MatchFormat")) {
        render();
        return;
      }
      syncDomFromDraft();
    }
  }

  function readInput() {
    if (getTournamentFormat() !== TournamentFormat.QUALIFYING_AND_FINALS) {
      return {};
    }
    for (const sideKey of ["main", "consolation"]) {
      readSideFromDom(sideKey);
    }
    return {
      bracketMatchConfig: {
        main: draftBySide.main,
        consolation: draftBySide.consolation,
      },
      // レガシー互換フィールド（上位 H2H）
      winsRequired: draftBySide.main.finalsMatchRules?.defaultWinsRequired ?? 2,
      defaultWinsRequired: draftBySide.main.finalsMatchRules?.defaultWinsRequired ?? 2,
      useRoundOverrides: Object.keys(draftBySide.main.finalsMatchRules?.roundOverrides || {}).length > 0,
      roundOverrides: draftBySide.main.finalsMatchRules?.roundOverrides || {},
      finalsMatchRules: draftBySide.main.finalsMatchRules,
    };
  }

  /**
   * @param {object} tournament
   */
  function populate(tournament) {
    const config = normalizeBracketMatchConfig(tournament);
    draftBySide.main = config.main;
    draftBySide.consolation = config.consolation;
    render();
    syncVisibility();
  }

  /**
   * @param {{ main?: boolean, consolation?: boolean }} locks
   */
  function setLocked(locks = {}) {
    lockedMain = Boolean(locks.main);
    lockedConsolation = Boolean(locks.consolation);
    render();
  }

  function refresh() {
    syncVisibility();
    if (getTournamentFormat() === TournamentFormat.QUALIFYING_AND_FINALS) {
      render();
    }
  }

  rootEl.addEventListener("change", onChange);
  document.addEventListener("change", (event) => {
    if (event.target?.name === "tournamentFormat") {
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
