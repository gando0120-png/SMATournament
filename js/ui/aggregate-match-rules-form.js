/**
 * 複数チーム・2セット合計の試合形式フォーム
 */
import {
  MatchFormat,
  normalizeAggregateMatchRules,
  resolveMatchFormat,
} from "../domain/aggregate-match-format.js";
import { TournamentFormat } from "../domain/tournament-format.js";

/**
 * @param {HTMLElement|null|undefined} rootEl
 */
export function initAggregateMatchRulesForm(
  rootEl = document.getElementById("aggregateMatchRulesSection")
) {
  if (!rootEl) {
    return null;
  }

  const matchFormatSection = document.getElementById("matchFormatSection");
  const finalsSection = document.getElementById("finalsMatchRulesSection");
  const lockNote = rootEl.querySelector("#aggregateMatchRulesLockNote");
  let locked = false;

  function getTournamentFormat() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return (
      form?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
      form?.dataset?.tournamentFormat ||
      ""
    );
  }

  function getSelectedMatchFormat() {
    const checked = document.querySelector('input[name="matchFormat"]:checked');
    return resolveMatchFormat(checked?.value);
  }

  function syncVisibility() {
    const format = getTournamentFormat();
    const isSe = format === TournamentFormat.SINGLE_ELIMINATION;
    matchFormatSection?.classList.toggle("hidden", !isSe);

    const isMulti = isSe && getSelectedMatchFormat() === MatchFormat.MULTI_TEAM_TOTAL;
    rootEl.classList.toggle("hidden", !isMulti);
    if (finalsSection) {
      finalsSection.classList.toggle("hidden", isMulti);
    }

    syncQualifierOptions();
  }

  function syncQualifierOptions() {
    const teamCount = Number(
      document.querySelector('input[name="aggregateTeamCount"]:checked')?.value || 4
    );
    document.querySelectorAll('input[name="aggregateQualifiersCount"]').forEach((input) => {
      const value = Number(input.value);
      const allowed = value >= 1 && value < teamCount;
      input.disabled = locked || !allowed;
      const label = input.closest("label");
      label?.classList.toggle("hidden", !allowed);
      if (!allowed && input.checked) {
        const fallback = document.querySelector(
          `input[name="aggregateQualifiersCount"][value="1"]`
        );
        if (fallback) fallback.checked = true;
      }
    });
  }

  function readInput() {
    const matchFormat = getSelectedMatchFormat();
    if (matchFormat !== MatchFormat.MULTI_TEAM_TOTAL) {
      return { matchFormat: MatchFormat.HEAD_TO_HEAD_SETS };
    }
    return {
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      teamCount: Number(
        document.querySelector('input[name="aggregateTeamCount"]:checked')?.value || 4
      ),
      qualifiersCount: Number(
        document.querySelector('input[name="aggregateQualifiersCount"]:checked')?.value || 2
      ),
      setCount: 2,
    };
  }

  /**
   * @param {object} tournament
   */
  function populate(tournament) {
    const matchFormat = resolveMatchFormat(tournament?.matchFormat);
    const radio = document.querySelector(`input[name="matchFormat"][value="${matchFormat}"]`);
    if (radio) {
      radio.checked = true;
    } else {
      const h2h = document.querySelector(
        `input[name="matchFormat"][value="${MatchFormat.HEAD_TO_HEAD_SETS}"]`
      );
      if (h2h) h2h.checked = true;
    }

    const rules = normalizeAggregateMatchRules(tournament?.aggregateMatchRules || {});
    const teamRadio = document.querySelector(
      `input[name="aggregateTeamCount"][value="${rules.teamCount}"]`
    );
    if (teamRadio) teamRadio.checked = true;
    const qRadio = document.querySelector(
      `input[name="aggregateQualifiersCount"][value="${rules.qualifiersCount}"]`
    );
    if (qRadio) qRadio.checked = true;

    syncVisibility();
  }

  /**
   * @param {boolean} nextLocked
   */
  function setLocked(nextLocked) {
    locked = Boolean(nextLocked);
    document.querySelectorAll('input[name="matchFormat"]').forEach((input) => {
      input.disabled = locked;
    });
    document.querySelectorAll('input[name="aggregateTeamCount"]').forEach((input) => {
      input.disabled = locked;
    });
    document.querySelectorAll('input[name="aggregateQualifiersCount"]').forEach((input) => {
      input.disabled = locked;
    });
    lockNote?.classList.toggle("hidden", !locked);
    syncQualifierOptions();
  }

  rootEl.addEventListener("change", (event) => {
    if (
      event.target?.name === "aggregateTeamCount" ||
      event.target?.name === "aggregateQualifiersCount"
    ) {
      syncQualifierOptions();
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target?.name === "matchFormat" || event.target?.name === "tournamentFormat") {
      syncVisibility();
    }
  });

  syncVisibility();

  return {
    readInput,
    populate,
    setLocked,
    refresh: syncVisibility,
  };
}
