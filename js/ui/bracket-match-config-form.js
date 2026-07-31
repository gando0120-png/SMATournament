/**
 * 予選＋決勝向け: 上位 / 下位の試合形式設定フォーム
 *
 * 各サイドは bracketKind を prefix にした一意の id/name で生成する。
 * refresh() は表示切替のみ行い、ユーザー操作後に DOM を作り直さない。
 */
import { MatchFormat, resolveMatchFormat } from "../domain/aggregate-match-format.js";
import {
  normalizeBracketMatchConfig,
  normalizeBracketMatchSide,
} from "../domain/bracket-match-config.js";
import { TournamentFormat } from "../domain/tournament-format.js";

const SIDE_KEYS = /** @type {const} */ (["main", "consolation"]);

const SIDE_TITLES = {
  main: "上位トーナメント",
  consolation: "下位トーナメント",
};

/**
 * @param {object|null|undefined} side
 */
function cloneSide(side) {
  return {
    enabled: Boolean(side?.enabled),
    matchFormat: side?.matchFormat ?? MatchFormat.HEAD_TO_HEAD_SETS,
    finalsMatchRules: side?.finalsMatchRules
      ? {
          defaultWinsRequired: side.finalsMatchRules.defaultWinsRequired,
          roundOverrides: { ...(side.finalsMatchRules.roundOverrides || {}) },
        }
      : normalizeBracketMatchSide({}).finalsMatchRules,
    aggregateMatchRules: side?.aggregateMatchRules
      ? { ...side.aggregateMatchRules }
      : null,
  };
}

/**
 * @param {string} bracketKind
 * @param {string} field
 */
export function bracketMatchFieldId(bracketKind, field) {
  return `${bracketKind}${field}`;
}

/**
 * @param {string} bracketKind
 * @param {string} field
 */
export function bracketMatchFieldName(bracketKind, field) {
  return `${bracketKind}${field}`;
}

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
  let populatedOnce = false;

  function getTournamentFormat() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return (
      form?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
      form?.dataset?.tournamentFormat ||
      ""
    );
  }

  function isSideLocked(sideKey) {
    return sideKey === "main" ? lockedMain : lockedConsolation;
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

  /**
   * @param {"main"|"consolation"} bracketKind
   */
  function renderSide(bracketKind) {
    const side = draftBySide[bracketKind];
    const locked = isSideLocked(bracketKind);
    const isMulti = side.matchFormat === MatchFormat.MULTI_TEAM_TOTAL;
    const rules = side.finalsMatchRules || { defaultWinsRequired: 2, roundOverrides: {} };
    const agg = side.aggregateMatchRules || {
      teamCount: 4,
      qualifiersCount: 2,
    };
    const finalOnly3 =
      rules.roundOverrides?.final === 3 && rules.defaultWinsRequired === 2;
    const disabledAttr = locked ? "disabled" : "";
    const ariaDisabled = locked ? 'aria-disabled="true"' : 'aria-disabled="false"';

    const enabledId = bracketMatchFieldId(bracketKind, "Enabled");
    const formatH2hId = bracketMatchFieldId(bracketKind, "MatchFormatHeadToHead");
    const formatMultiId = bracketMatchFieldId(bracketKind, "MatchFormatMultiTeam");
    const wins2Id = bracketMatchFieldId(bracketKind, "WinsRequired2");
    const wins3Id = bracketMatchFieldId(bracketKind, "WinsRequired3");
    const finalOnlyId = bracketMatchFieldId(bracketKind, "FinalOnly3");
    const formatName = bracketMatchFieldName(bracketKind, "MatchFormat");
    const winsName = bracketMatchFieldName(bracketKind, "WinsRequired");
    const teamCountName = bracketMatchFieldName(bracketKind, "TeamCount");
    const qualifiersName = bracketMatchFieldName(bracketKind, "QualifiersCount");

    return `
      <fieldset class="field bracket-match-config__card" data-side="${bracketKind}">
        <legend class="field__label">${SIDE_TITLES[bracketKind]}</legend>
        <label class="field field--inline" for="${enabledId}">
          <input type="checkbox" id="${enabledId}" name="${enabledId}" data-side-enabled="${bracketKind}" ${side.enabled ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
          <span>実施する</span>
        </label>
        <div class="bracket-match-config__details${side.enabled ? "" : " hidden"}" data-side-details="${bracketKind}">
          <fieldset class="field">
            <legend class="field__label">形式</legend>
            <label class="field field--inline" for="${formatH2hId}">
              <input type="radio" id="${formatH2hId}" name="${formatName}" value="${MatchFormat.HEAD_TO_HEAD_SETS}" ${!isMulti ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
              <span>1対1トーナメント</span>
            </label>
            <label class="field field--inline" for="${formatMultiId}">
              <input type="radio" id="${formatMultiId}" name="${formatName}" value="${MatchFormat.MULTI_TEAM_TOTAL}" ${isMulti ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
              <span>複数チーム同時対戦</span>
            </label>
          </fieldset>
          <div class="bracket-match-config__h2h${isMulti ? " hidden" : ""}" data-side-h2h="${bracketKind}">
            <fieldset class="field">
              <legend class="field__label">勝利必要数</legend>
              <label class="field field--inline" for="${wins2Id}">
                <input type="radio" id="${wins2Id}" name="${winsName}" value="2" ${rules.defaultWinsRequired !== 3 ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
                <span>2セット先取</span>
              </label>
              <label class="field field--inline" for="${wins3Id}">
                <input type="radio" id="${wins3Id}" name="${winsName}" value="3" ${rules.defaultWinsRequired === 3 ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
                <span>3セット先取</span>
              </label>
            </fieldset>
            <label class="field field--inline" for="${finalOnlyId}">
              <input type="checkbox" id="${finalOnlyId}" name="${finalOnlyId}" data-side-final-only3="${bracketKind}" ${finalOnly3 ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
              <span>決勝のみ3セット先取</span>
            </label>
          </div>
          <div class="bracket-match-config__multi${!isMulti ? " hidden" : ""}" data-side-multi="${bracketKind}">
            <fieldset class="field">
              <legend class="field__label">1試合のチーム数</legend>
              ${[2, 3, 4]
                .map((n) => {
                  const id = bracketMatchFieldId(bracketKind, `TeamCount${n}`);
                  return `
                <label class="field field--inline" for="${id}">
                  <input type="radio" id="${id}" name="${teamCountName}" value="${n}" ${agg.teamCount === n ? "checked" : ""} ${disabledAttr} ${ariaDisabled}>
                  <span>${n}</span>
                </label>`;
                })
                .join("")}
            </fieldset>
            <fieldset class="field">
              <legend class="field__label">通過チーム数</legend>
              ${[1, 2]
                .map((n) => {
                  const id = bracketMatchFieldId(bracketKind, `QualifiersCount${n}`);
                  const optionDisabled = locked || n >= agg.teamCount;
                  return `
                <label class="field field--inline" for="${id}">
                  <input type="radio" id="${id}" name="${qualifiersName}" value="${n}" ${agg.qualifiersCount === n ? "checked" : ""} ${optionDisabled ? "disabled" : ""} ${optionDisabled ? 'aria-disabled="true"' : 'aria-disabled="false"'}>
                  <span>上位${n}</span>
                </label>`;
                })
                .join("")}
            </fieldset>
            <p class="field__hint">セット数: 2（固定） / 合計点方式</p>
          </div>
        </div>
        <p class="field__hint bracket-match-config__lock${locked ? "" : " hidden"}" data-side-lock="${bracketKind}">ブラケット作成後のため変更できません。</p>
      </fieldset>
    `;
  }

  function render() {
    rootEl.innerHTML = `
      <h3 class="panel__title">決勝トーナメント設定</h3>
      <p class="field__hint">上位と下位で異なる対戦形式を設定できます。</p>
      ${SIDE_KEYS.map((key) => renderSide(key)).join("")}
    `;
  }

  /**
   * @param {"main"|"consolation"} sideKey
   */
  function readSideFromDom(sideKey) {
    const enabled = Boolean(
      rootEl.querySelector(`#${bracketMatchFieldId(sideKey, "Enabled")}`)?.checked ??
        rootEl.querySelector(`[data-side-enabled="${sideKey}"]`)?.checked
    );
    const matchFormat = resolveMatchFormat(
      rootEl.querySelector(
        `input[name="${bracketMatchFieldName(sideKey, "MatchFormat")}"]:checked`
      )?.value
    );
    const winsRequired = Number(
      rootEl.querySelector(
        `input[name="${bracketMatchFieldName(sideKey, "WinsRequired")}"]:checked`
      )?.value || 2
    );
    const finalOnly3 = Boolean(
      rootEl.querySelector(`#${bracketMatchFieldId(sideKey, "FinalOnly3")}`)?.checked ??
        rootEl.querySelector(`[data-side-final-only3="${sideKey}"]`)?.checked
    );
    const teamCount = Number(
      rootEl.querySelector(
        `input[name="${bracketMatchFieldName(sideKey, "TeamCount")}"]:checked`
      )?.value || 4
    );
    const qualifiersCount = Number(
      rootEl.querySelector(
        `input[name="${bracketMatchFieldName(sideKey, "QualifiersCount")}"]:checked`
      )?.value || 2
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
          qualifiersCount: Math.min(qualifiersCount, Math.max(1, teamCount - 1)),
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

  /**
   * DOM を壊さず表示・通過数の disabled だけ更新
   */
  function syncDomFromDraft() {
    for (const sideKey of SIDE_KEYS) {
      const side = draftBySide[sideKey];
      rootEl
        .querySelector(`[data-side-details="${sideKey}"]`)
        ?.classList.toggle("hidden", !side.enabled);
      const isMulti = side.matchFormat === MatchFormat.MULTI_TEAM_TOTAL;
      rootEl.querySelector(`[data-side-h2h="${sideKey}"]`)?.classList.toggle("hidden", isMulti);
      rootEl.querySelector(`[data-side-multi="${sideKey}"]`)?.classList.toggle("hidden", !isMulti);

      const teamCount = side.aggregateMatchRules?.teamCount ?? 4;
      rootEl
        .querySelectorAll(
          `input[name="${bracketMatchFieldName(sideKey, "QualifiersCount")}"]`
        )
        .forEach((input) => {
          if (!(input instanceof HTMLInputElement)) return;
          const n = Number(input.value);
          const optionDisabled = isSideLocked(sideKey) || n >= teamCount;
          input.disabled = optionDisabled;
          input.setAttribute("aria-disabled", optionDisabled ? "true" : "false");
          if (optionDisabled && input.checked) {
            const fallback = rootEl.querySelector(
              `input[name="${bracketMatchFieldName(sideKey, "QualifiersCount")}"][value="1"]`
            );
            if (fallback instanceof HTMLInputElement && !fallback.disabled) {
              fallback.checked = true;
              readSideFromDom(sideKey);
            }
          }
        });
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !rootEl.contains(target)) {
      return;
    }
    if (
      !target.matches(
        "[data-side-enabled], [data-side-final-only3], input[type=radio], input[type=checkbox]"
      )
    ) {
      return;
    }

    for (const sideKey of SIDE_KEYS) {
      readSideFromDom(sideKey);
    }
    // 再描画しない。表示切替のみ。ユーザー操作を draft 復元で上書きしない。
    syncDomFromDraft();
  }

  function readInput() {
    if (getTournamentFormat() !== TournamentFormat.QUALIFYING_AND_FINALS) {
      return {};
    }
    for (const sideKey of SIDE_KEYS) {
      readSideFromDom(sideKey);
    }
    return {
      bracketMatchConfig: {
        main: cloneSide(draftBySide.main),
        consolation: cloneSide(draftBySide.consolation),
      },
      winsRequired: draftBySide.main.finalsMatchRules?.defaultWinsRequired ?? 2,
      defaultWinsRequired: draftBySide.main.finalsMatchRules?.defaultWinsRequired ?? 2,
      useRoundOverrides:
        Object.keys(draftBySide.main.finalsMatchRules?.roundOverrides || {}).length > 0,
      roundOverrides: {
        ...(draftBySide.main.finalsMatchRules?.roundOverrides || {}),
      },
      finalsMatchRules: cloneSide(draftBySide.main).finalsMatchRules,
    };
  }

  /**
   * 初期表示・再読込時のみ。操作のたびに呼ばないこと。
   * @param {object} tournament
   */
  function populate(tournament) {
    const config = normalizeBracketMatchConfig(tournament);
    draftBySide.main = config.main;
    draftBySide.consolation = config.consolation;
    render();
    syncVisibility();
    populatedOnce = true;
  }

  /**
   * @param {{ main?: boolean, consolation?: boolean }} locks
   */
  function setLocked(locks = {}) {
    lockedMain = Boolean(locks.main);
    lockedConsolation = Boolean(locks.consolation);
    // ロック適用時のみ再描画（disabled 属性反映）。直前の DOM 入力は draft へ取り込む。
    if (populatedOnce && rootEl.querySelector("[data-side]")) {
      for (const sideKey of SIDE_KEYS) {
        readSideFromDom(sideKey);
      }
    }
    render();
    syncVisibility();
  }

  /**
   * 形式切替など外部からの表示更新。ユーザー入力を draft で上書きしない。
   */
  function refresh() {
    syncVisibility();
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
