/**
 * トーナメント勝利条件フォーム（ラウンド別）
 */
import {
  buildFinalsMatchRulesPreset,
  estimateFinalsBracketSizeForSettings,
  formatFinalsWinsRequiredShortLabel,
  listFinalsRoundSettings,
  normalizeFinalsMatchRules,
  resolveFinalsWinsRequired,
} from "../domain/finals-match-format.js";
import { TournamentFormat } from "../domain/tournament-format.js";

/**
 * @param {HTMLElement|null|undefined} rootEl
 */
export function initFinalsMatchRulesForm(rootEl = document.getElementById("finalsMatchRulesSection")) {
  if (!rootEl) {
    return null;
  }

  const defaultRadios = () => [...rootEl.querySelectorAll('input[name="winsRequired"]')];
  const perRoundToggle = rootEl.querySelector("#useRoundOverrides");
  const roundsPanel = rootEl.querySelector("#finalsRoundRulesPanel");
  const roundsList = rootEl.querySelector("#finalsRoundRulesList");
  const bracketHint = rootEl.querySelector("#finalsMatchRulesBracketHint");
  const lockNote = rootEl.querySelector("#winsRequiredLockNote");
  const presetButtons = [...rootEl.querySelectorAll("[data-wins-preset]")];

  /** @type {Record<string, 2|3>} */
  let winsByRound = {};
  let locked = false;

  function getDefaultWinsRequired() {
    const checked = rootEl.querySelector('input[name="winsRequired"]:checked');
    return resolveFinalsWinsRequired(checked?.value);
  }

  function getFormContext() {
    const form = rootEl.closest("form") || document.getElementById("tournamentForm");
    return {
      tournamentFormat:
        form?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
        form?.dataset?.tournamentFormat ||
        "",
      maxTeams: document.getElementById("maxTeams")?.value ?? "",
      blockCount: document.getElementById("blockCount")?.value ?? "",
      qualifiersPerBlock:
        form?.querySelector('input[name="qualifiersPerBlock"]:checked')?.value ?? "",
    };
  }

  function isPerRoundEnabled() {
    return Boolean(perRoundToggle?.checked);
  }

  function renderRounds() {
    if (!roundsList) {
      return;
    }

    const context = getFormContext();
    const bracketSize = estimateFinalsBracketSizeForSettings({
      tournamentFormat: context.tournamentFormat || TournamentFormat.SINGLE_ELIMINATION,
      maxTeams: Number.parseInt(String(context.maxTeams), 10),
      blockCount: Number.parseInt(String(context.blockCount), 10),
      qualifiersPerBlock: Number.parseInt(String(context.qualifiersPerBlock), 10),
    });

    if (bracketHint) {
      bracketHint.textContent = bracketSize
        ? `想定トーナメント枠: ${bracketSize}`
        : "募集チーム数などを入力すると、ラウンド一覧を表示します。";
    }

    const rounds = listFinalsRoundSettings(bracketSize);
    const defaultWins = getDefaultWinsRequired();

    if (rounds.length === 0) {
      roundsList.innerHTML = `<p class="field__hint">ラウンドを表示できません。</p>`;
      return;
    }

    roundsList.innerHTML = rounds
      .map((round) => {
        const wins = winsByRound[round.roundKey] ?? defaultWins;
        return `
          <fieldset class="field field--round-wins" data-round-key="${round.roundKey}">
            <legend class="field__label">${round.label}</legend>
            <label class="field field--inline">
              <input type="radio" name="roundWins-${round.roundKey}" value="2" ${
                wins === 2 ? "checked" : ""
              } ${locked ? "disabled" : ""}>
              <span>2セット先取</span>
            </label>
            <label class="field field--inline">
              <input type="radio" name="roundWins-${round.roundKey}" value="3" ${
                wins === 3 ? "checked" : ""
              } ${locked ? "disabled" : ""}>
              <span>3セット先取</span>
            </label>
          </fieldset>
        `;
      })
      .join("");

    roundsList.querySelectorAll("input[type='radio']").forEach((input) => {
      input.addEventListener("change", () => {
        const fieldset = input.closest("[data-round-key]");
        const key = fieldset?.getAttribute("data-round-key");
        if (!key) {
          return;
        }
        winsByRound[key] = resolveFinalsWinsRequired(input.value);
      });
    });
  }

  function syncRoundsPanelVisibility() {
    const enabled = isPerRoundEnabled();
    roundsPanel?.classList.toggle("hidden", !enabled);
    if (enabled) {
      renderRounds();
    }
  }

  function applyPreset(preset) {
    if (locked) {
      return;
    }
    const context = getFormContext();
    const bracketSize = estimateFinalsBracketSizeForSettings({
      tournamentFormat: context.tournamentFormat || TournamentFormat.SINGLE_ELIMINATION,
      maxTeams: Number.parseInt(String(context.maxTeams), 10),
      blockCount: Number.parseInt(String(context.blockCount), 10),
      qualifiersPerBlock: Number.parseInt(String(context.qualifiersPerBlock), 10),
    });
    const built = buildFinalsMatchRulesPreset(preset, bracketSize, getDefaultWinsRequired());
    defaultRadios().forEach((input) => {
      input.checked = input.value === String(built.defaultWinsRequired);
    });
    if (perRoundToggle) {
      perRoundToggle.checked = built.useRoundOverrides;
    }
    winsByRound = { ...built.winsByRound };
    syncRoundsPanelVisibility();
  }

  function setLocked(nextLocked) {
    locked = Boolean(nextLocked);
    defaultRadios().forEach((input) => {
      input.disabled = locked;
      input.setAttribute("aria-disabled", locked ? "true" : "false");
    });
    if (perRoundToggle) {
      perRoundToggle.disabled = locked;
    }
    presetButtons.forEach((btn) => {
      btn.disabled = locked;
    });
    lockNote?.classList.toggle("hidden", !locked);
    renderRounds();
  }

  /**
   * @param {object|null|undefined} tournament
   */
  function populate(tournament) {
    const rules = normalizeFinalsMatchRules(tournament);
    defaultRadios().forEach((input) => {
      input.checked = input.value === String(rules.defaultWinsRequired);
    });
    const hasOverrides = Object.keys(rules.roundOverrides).length > 0;
    if (perRoundToggle) {
      perRoundToggle.checked = hasOverrides;
    }

    const context = {
      tournamentFormat: tournament?.tournamentFormat || getFormContext().tournamentFormat,
      maxTeams: tournament?.maxTeams ?? getFormContext().maxTeams,
      blockCount: tournament?.blockCount ?? getFormContext().blockCount,
      qualifiersPerBlock: tournament?.qualifiersPerBlock ?? getFormContext().qualifiersPerBlock,
    };
    const bracketSize = estimateFinalsBracketSizeForSettings(context);
    winsByRound = {};
    for (const round of listFinalsRoundSettings(bracketSize)) {
      winsByRound[round.roundKey] =
        rules.roundOverrides[round.roundKey] ?? rules.defaultWinsRequired;
    }
    syncRoundsPanelVisibility();
  }

  function readInput() {
    const defaultWinsRequired = getDefaultWinsRequired();
    const useRoundOverrides = isPerRoundEnabled();
    /** @type {Record<string, 2|3>} */
    const roundOverrides = {};

    if (useRoundOverrides && roundsList) {
      roundsList.querySelectorAll("[data-round-key]").forEach((fieldset) => {
        const key = fieldset.getAttribute("data-round-key");
        if (!key) {
          return;
        }
        const checked = fieldset.querySelector(`input[name="roundWins-${key}"]:checked`);
        const wins = resolveFinalsWinsRequired(checked?.value ?? winsByRound[key]);
        winsByRound[key] = wins;
        if (wins !== defaultWinsRequired) {
          roundOverrides[key] = wins;
        }
      });
    }

    return {
      winsRequired: defaultWinsRequired,
      defaultWinsRequired,
      useRoundOverrides,
      roundOverrides,
    };
  }

  perRoundToggle?.addEventListener("change", syncRoundsPanelVisibility);
  defaultRadios().forEach((input) => {
    input.addEventListener("change", () => {
      if (isPerRoundEnabled()) {
        renderRounds();
      }
    });
  });
  presetButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      applyPreset(btn.getAttribute("data-wins-preset"));
    });
  });

  syncRoundsPanelVisibility();

  return {
    populate,
    readInput,
    setLocked,
    refresh: syncRoundsPanelVisibility,
    rootEl,
  };
}

/**
 * @param {ReturnType<typeof initFinalsMatchRulesForm>|null} controller
 * @param {HTMLFormElement|null} formEl
 */
export function mergeFinalsMatchRulesIntoFormInput(controller, formEl) {
  const base = {};
  if (!controller) {
    return base;
  }
  return { ...base, ...controller.readInput() };
}

export { formatFinalsWinsRequiredShortLabel };
