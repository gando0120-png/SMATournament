/**
 * 大会入力バリデーション（DOM 非依存）
 */
import { TournamentLimits, DEFAULT_PREFERRED_BLOCK_SIZE } from "./constants.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  const preferredBlockSizeRaw =
    input.preferredBlockSize === "" ||
    input.preferredBlockSize === null ||
    input.preferredBlockSize === undefined
      ? DEFAULT_PREFERRED_BLOCK_SIZE
      : input.preferredBlockSize;
  const preferredBlockSize = validateIntField(
    preferredBlockSizeRaw,
    "preferredBlockSize",
    "ブロック基本人数",
    TournamentLimits.preferredBlockSize,
    errors
  );

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  return {
    valid: true,
    errors: {},
    values: {
      name,
      eventDate: eventDateRaw,
      venue,
      entryDeadline: entryDeadlineDate,
      maxTeams,
      teamSize,
      courtCount,
      preferredBlockSize,
    },
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
 * 公開エントリー入力バリデーション（必須項目のみ）
 * @param {object} input
 * @returns {{ valid: boolean, errors: Record<string, string>, values: object|null }}
 */
export function validateEntryInput(input) {
  const errors = {};

  const teamName = typeof input.teamName === "string" ? input.teamName.trim() : "";
  const representativeName =
    typeof input.representativeName === "string" ? input.representativeName.trim() : "";

  if (!teamName) {
    errors.teamName = "チーム名を入力してください。";
  }
  if (!representativeName) {
    errors.representativeName = "代表者名を入力してください。";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  const values = { teamName, representativeName };

  const member2 = typeof input.member2 === "string" ? input.member2.trim() : "";
  const member3 = typeof input.member3 === "string" ? input.member3.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";

  if (member2) {
    values.member2 = member2;
  }
  if (member3) {
    values.member3 = member3;
  }
  if (email) {
    values.email = email;
  }
  if (comment) {
    values.comment = comment;
  }

  return { valid: true, errors: {}, values };
}
