/**
 * 大会入力バリデーション（DOM 非依存）
 */
import { EntryLimits, TournamentLimits, DEFAULT_PREFERRED_BLOCK_SIZE } from "./constants.js";
import {
  getAdditionalMemberFieldKeys,
  getMemberFieldLabel,
  normalizeTeamSize,
} from "./entry-members.js";
import {
  isAllowedBlockCount,
  MIN_TEAMS_PER_BLOCK,
  MAX_TEAMS_PER_BLOCK,
  validateBlockConfiguration,
} from "./block-configuration.js";
import { TournamentFormat } from "./tournament-format.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePositiveInt(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return null;
  }
  return num;
}

function parseDateOnly(value) {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function parseDateTime(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function validateRequiredString(value, fieldKey, label, limits, errors) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    errors[fieldKey] = `${label}を入力してください。`;
    return null;
  }
  if (limits?.maxLength && trimmed.length > limits.maxLength) {
    errors[fieldKey] = `${label}は${limits.maxLength}文字以内で入力してください。`;
    return null;
  }
  return trimmed;
}

function validateIntField(value, fieldKey, label, limits, errors) {
  const num = parsePositiveInt(value);
  if (num === null) {
    errors[fieldKey] = `${label}は整数で入力してください。`;
    return null;
  }
  if (num < limits.min || num > limits.max) {
    errors[fieldKey] = `${label}は${limits.min}〜${limits.max}の範囲で入力してください。`;
    return null;
  }
  return num;
}

function resolveInputTournamentFormat(input) {
  if (input.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    return TournamentFormat.SINGLE_ELIMINATION;
  }
  if (input.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS) {
    return TournamentFormat.QUALIFYING_AND_FINALS;
  }
  if (
    input.preferredBlockSize !== "" &&
    input.preferredBlockSize != null &&
    input.preferredBlockSize !== undefined
  ) {
    return "legacy";
  }
  return null;
}

function validateLegacyPreferredBlockSize(input, errors) {
  const preferredBlockSizeRaw =
    input.preferredBlockSize === "" ||
    input.preferredBlockSize === null ||
    input.preferredBlockSize === undefined
      ? DEFAULT_PREFERRED_BLOCK_SIZE
      : input.preferredBlockSize;
  return validateIntField(
    preferredBlockSizeRaw,
    "preferredBlockSize",
    "ブロック基本人数",
    TournamentLimits.preferredBlockSize,
    errors
  );
}

function validateNewQualifyingFields(input, maxTeams, errors) {
  const blockCount = validateIntField(
    input.blockCount,
    "blockCount",
    "ブロック数",
    { min: 4, max: 32 },
    errors
  );

  const qualifiersPerBlock = validateIntField(
    input.qualifiersPerBlock,
    "qualifiersPerBlock",
    "各ブロックからの通過数",
    { min: 1, max: 2 },
    errors
  );

  if (blockCount == null || maxTeams == null) {
    return { blockCount, qualifiersPerBlock };
  }

  if (!isAllowedBlockCount(blockCount)) {
    errors.blockCount = "ブロック数は 4 / 8 / 16 / 32 から選択してください。";
  }

  if (qualifiersPerBlock != null && qualifiersPerBlock !== 1 && qualifiersPerBlock !== 2) {
    errors.qualifiersPerBlock = "各ブロックからの通過数は 1 または 2 を選択してください。";
  }

  if (
    isAllowedBlockCount(blockCount) &&
    maxTeams < blockCount * MIN_TEAMS_PER_BLOCK
  ) {
    errors.maxTeams = `${blockCount}ブロックを作成するには、募集チーム数を${blockCount * MIN_TEAMS_PER_BLOCK}チーム以上に設定してください。`;
  }

  if (
    isAllowedBlockCount(blockCount) &&
    qualifiersPerBlock != null &&
    (qualifiersPerBlock === 1 || qualifiersPerBlock === 2) &&
    maxTeams != null
  ) {
    const config = validateBlockConfiguration({
      teamCount: maxTeams,
      blockCount,
      qualifiersPerBlock,
    });
    if (!config.valid) {
      for (const message of config.errors) {
        if (message.includes("blockCount ×")) {
          errors.maxTeams = `${blockCount}ブロックを作成するには、募集チーム数を${blockCount * MIN_TEAMS_PER_BLOCK}チーム以上に設定してください。`;
        } else if (message.includes("qualifiersPerBlock")) {
          errors.qualifiersPerBlock = message;
        } else if (message.includes("blockCount")) {
          errors.blockCount = message;
        } else if (message.includes("決勝進出数")) {
          errors.qualifiersPerBlock = message;
        } else if (message.includes("最大ブロック人数")) {
          errors.blockCount = `${blockCount}ブロックでは1ブロックあたり最大${Math.ceil(maxTeams / blockCount)}チームとなり、予選対戦表の上限8チームを超えます。ブロック数を増やしてください。`;
        }
      }
    }
  }

  return { blockCount, qualifiersPerBlock };
}

/**
 * @param {object} input
 * @returns {{ valid: boolean, errors: Record<string, string>, values: object|null }}
 */
export function validateTournamentInput(input) {
  const errors = {};

  const name = validateRequiredString(
    input.name,
    "name",
    "大会名",
    TournamentLimits.name,
    errors
  );
  const venue = validateRequiredString(
    input.venue,
    "venue",
    "会場",
    TournamentLimits.venue,
    errors
  );

  const eventDateRaw = typeof input.eventDate === "string" ? input.eventDate.trim() : "";
  const eventDate = parseDateOnly(eventDateRaw);
  if (!eventDateRaw) {
    errors.eventDate = "開催日を入力してください。";
  } else if (!eventDate) {
    errors.eventDate = "開催日の形式が正しくありません。";
  }

  const entryDeadlineDate = parseDateTime(input.entryDeadline);
  if (!input.entryDeadline) {
    errors.entryDeadline = "エントリー締切を入力してください。";
  } else if (!entryDeadlineDate) {
    errors.entryDeadline = "エントリー締切の形式が正しくありません。";
  }

  if (eventDate && entryDeadlineDate) {
    const eventEnd = new Date(`${eventDateRaw}T23:59:59`);
    if (entryDeadlineDate.getTime() > eventEnd.getTime()) {
      errors.entryDeadline = "エントリー締切は開催日より後に設定できません。";
    }
  }

  const maxTeams = validateIntField(
    input.maxTeams,
    "maxTeams",
    "募集チーム数",
    TournamentLimits.maxTeams,
    errors
  );
  const teamSize = validateIntField(
    input.teamSize,
    "teamSize",
    "1チームの人数",
    TournamentLimits.teamSize,
    errors
  );
  const courtCount = validateIntField(
    input.courtCount,
    "courtCount",
    "使用コート数",
    TournamentLimits.courtCount,
    errors
  );

  const format = resolveInputTournamentFormat(input);
  if (format == null) {
    errors.tournamentFormat = "大会形式を選択してください。";
  }

  let preferredBlockSize = null;
  let blockCount = null;
  let qualifiersPerBlock = null;

  if (format === "legacy") {
    preferredBlockSize = validateLegacyPreferredBlockSize(input, errors);
  } else if (format === TournamentFormat.QUALIFYING_AND_FINALS) {
    ({ blockCount, qualifiersPerBlock } = validateNewQualifyingFields(input, maxTeams, errors));
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  const values = {
    name,
    eventDate: eventDateRaw,
    venue,
    entryDeadline: entryDeadlineDate,
    maxTeams,
    teamSize,
    courtCount,
  };

  if (format === TournamentFormat.SINGLE_ELIMINATION) {
    values.tournamentFormat = TournamentFormat.SINGLE_ELIMINATION;
  } else if (format === TournamentFormat.QUALIFYING_AND_FINALS) {
    values.tournamentFormat = TournamentFormat.QUALIFYING_AND_FINALS;
    values.blockCount = blockCount;
    values.qualifiersPerBlock = qualifiersPerBlock;
  } else {
    values.preferredBlockSize = preferredBlockSize;
  }

  return {
    valid: true,
    errors: {},
    values,
  };
}

/**
 * @param {string|null|undefined} tournamentId
 */
export function isValidTournamentId(tournamentId) {
  return (
    typeof tournamentId === "string" &&
    tournamentId.length >= 1 &&
    tournamentId.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(tournamentId)
  );
}

/**
 * 公開エントリー入力バリデーション（teamSize に応じた必須人数）
 * @param {object} input
 * @param {number|string|null|undefined} [teamSize]
 * @returns {{ valid: boolean, errors: Record<string, string>, values: object|null }}
 */
export function validateEntryInput(input, teamSize) {
  const errors = {};
  const normalizedTeamSize = normalizeTeamSize(teamSize);

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!email) {
    errors.email = "メールアドレスを入力してください";
  } else if (email.length > EntryLimits.email.maxLength) {
    errors.email = `メールアドレスは${EntryLimits.email.maxLength}文字以内で入力してください`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "正しいメールアドレスを入力してください";
  }

  const teamName = typeof input.teamName === "string" ? input.teamName.trim() : "";
  const representativeName =
    typeof input.representativeName === "string" ? input.representativeName.trim() : "";

  if (!teamName) {
    errors.teamName = "チーム名を入力してください。";
  }
  if (!representativeName) {
    errors.representativeName = "代表者名を入力してください。";
  }

  for (const fieldKey of getAdditionalMemberFieldKeys(normalizedTeamSize)) {
    const value = typeof input[fieldKey] === "string" ? input[fieldKey].trim() : "";
    if (!value) {
      errors[fieldKey] = `${getMemberFieldLabel(fieldKey)}を入力してください。`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  const values = { email, teamName, representativeName };

  for (const fieldKey of getAdditionalMemberFieldKeys(normalizedTeamSize)) {
    values[fieldKey] = typeof input[fieldKey] === "string" ? input[fieldKey].trim() : "";
  }

  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment) {
    values.comment = comment;
  }

  return { valid: true, errors: {}, values };
}
