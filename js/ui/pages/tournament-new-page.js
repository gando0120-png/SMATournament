/**
 * 大会作成ページ
 */
import { validateTournamentInput } from "../../domain/validators.js";
import { buildQualifyingConfigurationPreview } from "../../domain/block-configuration.js";
import { TournamentFormat } from "../../domain/tournament-format.js";
import { createTournament } from "../../services/tournament-service.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import { classifyError } from "../../lib/errors.js";
import { showToast } from "../components/toast.js";
import { showFormAlert } from "../components/form-errors.js";
import {
  applyTournamentValidationErrors,
  readTournamentCreateFormInput,
} from "../tournament-form-v2.js?v=20260731c";
import { initFinalsMatchRulesForm } from "../finals-match-rules-form.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  form: document.getElementById("viewForm"),
};

const form = document.getElementById("tournamentForm");
const formAlert = document.getElementById("formAlert");
const submitBtn = document.getElementById("submitBtn");
const headerActions = document.getElementById("headerActions");
const qualifyingSettingsSection = document.getElementById("qualifyingSettingsSection");
const qualifyingPreviewList = document.getElementById("qualifyingPreviewList");

let currentUser = null;
const finalsMatchRulesForm = initFinalsMatchRulesForm();

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "form");
  }
}

function getSelectedTournamentFormat() {
  return (
    document.querySelector('input[name="tournamentFormat"]:checked')?.value ??
    TournamentFormat.QUALIFYING_AND_FINALS
  );
}

function renderPreviewRow(label, value) {
  return `<div class="info-list__row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function updateQualifyingPreview() {
  if (!qualifyingPreviewList) {
    return;
  }

  const format = getSelectedTournamentFormat();
  if (format !== TournamentFormat.QUALIFYING_AND_FINALS) {
    qualifyingPreviewList.innerHTML = "";
    return;
  }

  const maxTeams = Number.parseInt(document.getElementById("maxTeams")?.value ?? "", 10);
  const blockCount = Number.parseInt(document.getElementById("blockCount")?.value ?? "", 10);
  const qualifiersPerBlock = Number.parseInt(
    document.querySelector('input[name="qualifiersPerBlock"]:checked')?.value ?? "",
    10
  );

  if (
    !Number.isInteger(maxTeams) ||
    maxTeams < 1 ||
    !Number.isInteger(blockCount) ||
    !Number.isInteger(qualifiersPerBlock)
  ) {
    qualifyingPreviewList.innerHTML = renderPreviewRow("状態", "募集チーム数を入力してください。");
    return;
  }

  const preview = buildQualifyingConfigurationPreview({
    teamCount: maxTeams,
    blockCount,
    qualifiersPerBlock,
  });

  if (!preview.valid) {
    qualifyingPreviewList.innerHTML = renderPreviewRow(
      "状態",
      preview.errors.join(" / ") || "設定を確認してください。"
    );
    return;
  }

  const distributionLines =
    preview.largerBlockCount > 0
      ? [
          renderPreviewRow(
            `${preview.largerBlockTeamSize}チームブロック`,
            String(preview.largerBlockCount)
          ),
          renderPreviewRow(
            `${preview.smallerBlockTeamSize}チームブロック`,
            String(preview.smallerBlockCount)
          ),
        ].join("")
      : renderPreviewRow(`${preview.minBlockSize}チームブロック`, String(preview.blockCount));

  qualifyingPreviewList.innerHTML = [
    renderPreviewRow("予定ブロック数", String(preview.blockCount)),
    renderPreviewRow("最小ブロック人数", String(preview.minBlockSize)),
    renderPreviewRow("最大ブロック人数", String(preview.maxBlockSize)),
    renderPreviewRow("人数が1チーム多いブロック数", String(preview.largerBlockCount)),
    renderPreviewRow("決勝進出予定数", `${preview.qualifierCount}チーム`),
    distributionLines,
  ].join("");
}

function updateFormatSections() {
  const format = getSelectedTournamentFormat();
  const isQualifying = format === TournamentFormat.QUALIFYING_AND_FINALS;
  qualifyingSettingsSection?.classList.toggle("hidden", !isQualifying);
  updateQualifyingPreview();
  finalsMatchRulesForm?.refresh();
}

async function handleSubmit(event) {
  event.preventDefault();

  const validation = validateTournamentInput({
    ...readTournamentCreateFormInput(form),
    ...(finalsMatchRulesForm?.readInput() ?? {}),
  });
  if (!validation.valid) {
    applyTournamentValidationErrors(validation.errors, form, formAlert);
    return;
  }

  submitBtn.disabled = true;

  try {
    await createTournament(validation.values, currentUser.uid);
    showToast("大会を作成しました。");
    window.location.href = "index.html";
  } catch (error) {
    const { message } = classifyError(error);
    showFormAlert(formAlert, message, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

function initConfigView() {
  showFormAlert(
    document.getElementById("configAlert"),
    "Firebase 設定が未入力です。js/firebase-config.js を設定してください。",
    "error"
  );
  showView("config");
}

function initFormView(user) {
  currentUser = user;
  updateFormatSections();
  showView("form");
}

function initOperatorDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "運営者として登録されていません。",
    "warning"
  );
  showView("operatorDenied");
}

function initTournamentNewPage() {
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", updateQualifyingPreview);
  form.addEventListener("change", () => {
    updateFormatSections();
  });

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onReady: initFormView,
    onOperatorDenied: initOperatorDeniedView,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTournamentNewPage);
} else {
  initTournamentNewPage();
}
