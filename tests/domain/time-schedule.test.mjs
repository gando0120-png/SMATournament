/**
 * 大会スケジュール設定・時刻計算
 */
import assert from "node:assert/strict";
import {
  validateTimeScheduleInput,
  buildTimeScheduleDoc,
  normalizeTimeScheduleDoc,
  normalizeTimeScheduleOverrides,
  emptyTimeScheduleOverrides,
  isTimeScheduleConfigured,
  parseHmToMinutes,
  formatMinutesToHm,
  formatMinutesAsDisplayTime,
  resolveQualifyingRoundCount,
  resolveFinalsRoundCount,
  buildTournamentTimePlan,
  formatTimeScheduleDuration,
  formatTimeScheduleRange,
  resolveTournamentTimeScheduleSummary,
  computeQualifyingRoundStartMinutes,
  buildQualifyingPublicTimeSchedule,
  formatQualifyingRoundTitle,
  formatQualifyingMatchScheduledLabel,
  applyQualifyingScheduledTimesToScheduleSection,
  buildFinalsPublicTimeSchedule,
  applyFinalsScheduledTimesToRounds,
  applyFinalsScheduledTimesToBracketSection,
  formatScheduledRoundHeading,
  setTimeScheduleOverride,
  clearTimeScheduleOverride,
  toPublicTimeScheduleLookup,
  formatManualScheduledMarker,
  resolveScheduledSlotForMatch,
} from "../../js/domain/time-schedule.js";
import { getQualifyingRoundCountForTeamCount } from "../../js/domain/qualifying-schedule.js";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { buildTournamentSettingsUpdateFields } from "../../js/domain/tournament-settings-update.js";

function settings(overrides = {}) {
  return {
    dayStartTime: "09:00",
    matchDurationMinutes: 20,
    matchIntervalMinutes: 5,
    qualifyingToFinalsIntervalMinutes: 60,
    ...overrides,
  };
}

function baseTournamentInput(overrides = {}) {
  return {
    name: "スケジュールテスト大会",
    eventDate: "2099-12-01",
    venue: "会場",
    entryDeadline: "2099-11-01T12:00",
    maxTeams: "16",
    teamSize: "2",
    courtCount: "4",
    winsRequired: "2",
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: "4",
    qualifiersPerBlock: "1",
    finalTeamCount: "8",
    ...overrides,
  };
}

// ── ケース1: 予選5節 + 決勝3ラウンド ──
{
  const plan = buildTournamentTimePlan({
    settings: settings(),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: {
      finalized: true,
      blocks: [{ rounds: [{}, {}, {}, {}, {}] }],
    },
    finalsBracket: { roundCount: 3, finalized: true },
  });
  assert.equal(plan.configured, true);
  assert.equal(plan.estimated, false);
  assert.deepEqual(plan.qualifyingRoundStartTimes, [
    "09:00",
    "09:25",
    "09:50",
    "10:15",
    "10:40",
  ]);
  assert.equal(plan.qualifyingEndTime, "11:00");
  assert.equal(plan.finalsStartTime, "12:00");
  assert.deepEqual(plan.finalsRoundStartTimes, ["12:00", "12:25", "12:50"]);
  assert.equal(plan.tournamentEndTime, "13:10");
  assert.equal(plan.durationMinutes, 250);
  assert.equal(formatTimeScheduleDuration(plan.durationMinutes), "約4時間10分");
  assert.equal(formatTimeScheduleRange(plan), "9:00 ～ 13:10");

  const summary = resolveTournamentTimeScheduleSummary({
    settings: settings(),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: {
      finalized: true,
      blocks: [{ rounds: [{}, {}, {}, {}, {}] }],
    },
    finalsBracket: { roundCount: 3 },
  });
  assert.equal(summary.visible, true);
  assert.equal(summary.label, "大会予定時間");
  assert.equal(summary.rangeText, "9:00 ～ 13:10");
  assert.equal(summary.durationText, "所要時間：約4時間10分");
}

// 最後の節・ラウンドに試合間を足さない
{
  const plan = buildTournamentTimePlan({
    settings: settings(),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
    schedule: { finalized: true, blocks: [{ rounds: [{}, {}, {}, {}, {}] }] },
    finalsBracket: { roundCount: 3 },
  });
  const lastQualifyingStart = parseHmToMinutes(plan.qualifyingRoundStartTimes[4]);
  assert.equal(lastQualifyingStart + 20, parseHmToMinutes(plan.qualifyingEndTime));
  const lastFinalsStart = parseHmToMinutes(plan.finalsRoundStartTimes[2]);
  assert.equal(lastFinalsStart + 20, parseHmToMinutes(plan.tournamentEndTime));
}

// ── ケース2: ブロック節数 3/5/3/5 → 最大5 ──
{
  const resolved = resolveQualifyingRoundCount({
    schedule: {
      finalized: true,
      blocks: [
        { rounds: [{}, {}, {}] },
        { rounds: [{}, {}, {}, {}, {}] },
        { rounds: [{}, {}, {}] },
        { rounds: [{}, {}, {}, {}, {}] },
      ],
    },
  });
  assert.equal(resolved.count, 5);
  assert.equal(resolved.estimated, false);
}

{
  assert.equal(getQualifyingRoundCountForTeamCount(4), 3);
  assert.equal(getQualifyingRoundCountForTeamCount(5), 5);
  assert.equal(getQualifyingRoundCountForTeamCount(6), 5);
}

// ── ケース3: 一発トーナメント 4ラウンド ──
{
  const plan = buildTournamentTimePlan({
    settings: settings({ qualifyingToFinalsIntervalMinutes: 0 }),
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
    finalsBracket: { roundCount: 4, finalized: true },
  });
  assert.equal(plan.configured, true);
  assert.equal(plan.hasQualifying, false);
  assert.equal(plan.estimated, false);
  assert.deepEqual(plan.finalsRoundStartTimes, ["09:00", "09:25", "09:50", "10:15"]);
  assert.equal(plan.finalsStartTime, "09:00");
  assert.equal(plan.tournamentEndTime, "10:35");
  assert.equal(plan.qualifyingEndTime, null);
  assert.equal(formatTimeScheduleRange(plan), "9:00 ～ 10:35");
}

// ── ケース4: 未設定はエラーなし・非表示 ──
{
  const empty = validateTimeScheduleInput({});
  assert.equal(empty.valid, true);
  assert.equal(empty.values.dayStartTime, null);
  assert.equal(buildTimeScheduleDoc(empty.values), null);
  assert.equal(isTimeScheduleConfigured(null), false);
  assert.equal(isTimeScheduleConfigured({}), false);

  const plan = buildTournamentTimePlan({
    settings: null,
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
  });
  assert.equal(plan.configured, false);

  const summary = resolveTournamentTimeScheduleSummary({ settings: null });
  assert.equal(summary.visible, false);

  const tournamentValidation = validateTournamentInput(baseTournamentInput());
  assert.equal(tournamentValidation.valid, true);
  assert.equal(tournamentValidation.values.dayStartTime, null);
  assert.equal(tournamentValidation.values.matchDurationMinutes, null);
}

// validation: 異常値
{
  const nanDuration = validateTimeScheduleInput({
    dayStartTime: "09:00",
    matchDurationMinutes: "abc",
    matchIntervalMinutes: "5",
    qualifyingToFinalsIntervalMinutes: "60",
  });
  assert.equal(nanDuration.valid, false);
  assert.ok(nanDuration.errors.matchDurationMinutes);

  const zeroDuration = validateTimeScheduleInput({
    dayStartTime: "09:00",
    matchDurationMinutes: "0",
    matchIntervalMinutes: "5",
    qualifyingToFinalsIntervalMinutes: "60",
  });
  assert.equal(zeroDuration.valid, false);

  const badTime = validateTimeScheduleInput({
    dayStartTime: "25:00",
    matchDurationMinutes: "20",
    matchIntervalMinutes: "5",
    qualifyingToFinalsIntervalMinutes: "60",
  });
  assert.equal(badTime.valid, false);

  const partial = validateTimeScheduleInput({
    dayStartTime: "09:00",
  });
  assert.equal(partial.valid, false);

  const intervalZero = validateTimeScheduleInput({
    dayStartTime: "09:00",
    matchDurationMinutes: "20",
    matchIntervalMinutes: "0",
    qualifyingToFinalsIntervalMinutes: "0",
  });
  assert.equal(intervalZero.valid, true);
  assert.equal(intervalZero.values.matchIntervalMinutes, 0);
}

// 自動計算結果を override に保存しない
{
  const doc = buildTimeScheduleDoc(settings());
  assert.deepEqual(doc.overrides, emptyTimeScheduleOverrides());
  assert.equal("qualifyingRoundStartTimes" in doc, false);
  assert.equal("tournamentEndTime" in doc, false);
}

{
  const normalized = normalizeTimeScheduleOverrides({
    qualifyingRounds: { 3: "10:30" },
    qualifyingMatches: { "qualifying-A-R1-M1": "09:05" },
    finalsRounds: "bad",
    extra: { ignored: true },
  });
  assert.equal(normalized.qualifyingRounds["3"], "10:30");
  assert.equal(normalized.qualifyingMatches["qualifying-A-R1-M1"], "09:05");
  assert.deepEqual(normalized.finalsRounds, {});
  assert.deepEqual(normalized.finalsMatches, {});
}

{
  const stored = normalizeTimeScheduleDoc({
    dayStartTime: "9:00",
    matchDurationMinutes: 20,
    matchIntervalMinutes: 5,
    qualifyingToFinalsIntervalMinutes: 60,
    overrides: {},
  });
  assert.equal(stored.configured, true);
  assert.equal(stored.dayStartTime, "09:00");
}

// 抽選前概算
{
  const estimated = resolveQualifyingRoundCount({
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 4,
      maxTeams: 16,
    },
    teamCount: 16,
  });
  assert.equal(estimated.estimated, true);
  assert.equal(estimated.count, 3);

  const fromDraw = resolveQualifyingRoundCount({
    blockDraw: {
      blocks: [
        { entryIds: ["a", "b", "c", "d"] },
        { entryIds: ["e", "f", "g", "h", "i"] },
      ],
    },
  });
  assert.equal(fromDraw.count, 5);
  assert.equal(fromDraw.estimated, true);
}

{
  const finals = resolveFinalsRoundCount({
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 8,
    },
  });
  assert.equal(finals.count, 3);
  assert.equal(finals.estimated, true);
}

{
  const summary = resolveTournamentTimeScheduleSummary({
    settings: settings(),
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 8,
      maxTeams: 16,
    },
    teamCount: 16,
  });
  assert.equal(summary.visible, true);
  assert.equal(summary.label, "大会予定時間（概算）");
}

// 予選対戦表確定・決勝ブラケット未作成 → 概算
{
  const plan = buildTournamentTimePlan({
    settings: settings(),
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 8,
    },
    schedule: {
      finalized: true,
      blocks: [{ rounds: [{}, {}, {}] }],
    },
  });
  assert.equal(plan.configured, true);
  assert.equal(plan.estimated, true);
  assert.deepEqual(plan.qualifyingRoundStartTimes, ["09:00", "09:25", "09:50"]);
}

// 一発トーナメント：ブラケット未作成 → 概算 / 確定 → 概算ではない
{
  const estimated = buildTournamentTimePlan({
    settings: settings({ qualifyingToFinalsIntervalMinutes: 0 }),
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION, maxTeams: 16 },
    teamCount: 16,
  });
  assert.equal(estimated.configured, true);
  assert.equal(estimated.estimated, true);

  const resolved = buildTournamentTimePlan({
    settings: settings({ qualifyingToFinalsIntervalMinutes: 0 }),
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
    finalsBracket: { roundCount: 4, finalized: true },
  });
  assert.equal(resolved.estimated, false);
}

// Sprint 2: 確定済み節から開始予定時刻（09:00 / 20分 / 5分）
{
  const lookup = buildQualifyingPublicTimeSchedule(settings(), {
    finalized: true,
    blocks: [
      { rounds: [{}, {}, {}] },
      { rounds: [{}, {}, {}, {}, {}] },
    ],
  });
  assert.equal(lookup.rounds["1"].startTime, "09:00");
  assert.equal(lookup.rounds["1"].startTimeDisplay, "9:00");
  assert.equal(lookup.rounds["2"].startTime, "09:25");
  assert.equal(lookup.rounds["2"].startTimeDisplay, "9:25");
  assert.equal(lookup.rounds["3"].startTime, "09:50");
  assert.equal(lookup.rounds["3"].startTimeDisplay, "9:50");
  assert.equal(lookup.rounds["5"].startTime, "10:40");
  assert.equal(formatQualifyingRoundTitle(1, lookup.rounds["1"].startTimeDisplay), "第1節　9:00開始予定");
  assert.equal(formatQualifyingRoundTitle(2, lookup.rounds["2"].startTimeDisplay), "第2節　9:25開始予定");
  assert.equal(formatQualifyingMatchScheduledLabel(lookup.rounds["2"].startTimeDisplay), "9:25予定");
  assert.equal(formatQualifyingRoundTitle(1, null), "第1節");
  assert.equal(formatQualifyingMatchScheduledLabel(null), "");

  const starts = computeQualifyingRoundStartMinutes(settings(), 3);
  assert.deepEqual(starts, [540, 565, 590]);
}

{
  assert.equal(buildQualifyingPublicTimeSchedule(null, {
    finalized: true,
    blocks: [{ rounds: [{}] }],
  }), null);
  assert.equal(buildQualifyingPublicTimeSchedule(settings(), { finalized: true, blocks: [] }), null);
}

{
  const section = applyQualifyingScheduledTimesToScheduleSection(
    {
      ready: true,
      blocks: [
        {
          blockId: "A",
          rounds: [
            {
              roundNumber: 1,
              roundLabel: "第1節",
              matches: [{ matchId: "m1" }, { matchId: "m2" }],
            },
            {
              roundNumber: 2,
              roundLabel: "第2節",
              matches: [{ matchId: "m3" }],
            },
          ],
        },
      ],
    },
    buildQualifyingPublicTimeSchedule(settings(), {
      finalized: true,
      blocks: [{ rounds: [{}, {}] }],
    })
  );
  assert.equal(section.blocks[0].rounds[0].roundHeading, "第1節　9:00開始予定");
  assert.equal(section.blocks[0].rounds[0].matches[0].scheduledStartLabel, "9:00予定");
  assert.equal(section.blocks[0].rounds[0].matches[1].scheduledStartLabel, "9:00予定");
  assert.equal(section.blocks[0].rounds[1].matches[0].scheduledStartLabel, "9:25予定");
}

{
  const section = applyQualifyingScheduledTimesToScheduleSection(
    {
      ready: true,
      blocks: [{ rounds: [{ roundNumber: 1, roundLabel: "第1節", matches: [{ matchId: "m1" }] }] }],
    },
    null
  );
  assert.equal(section.blocks[0].rounds[0].roundHeading, "第1節");
  assert.equal(section.blocks[0].rounds[0].scheduledStartTime, null);
  assert.equal(section.blocks[0].rounds[0].matches[0].scheduledStartLabel, null);
}

{
  assert.equal(formatMinutesToHm(540), "09:00");
  assert.equal(formatMinutesAsDisplayTime(540), "9:00");
  assert.equal(parseHmToMinutes("09:00"), 540);
}

// 大会本体の settings 更新にはスケジュールフィールドを混ぜない
{
  const validation = validateTournamentInput(
    baseTournamentInput({
      dayStartTime: "09:00",
      matchDurationMinutes: "20",
      matchIntervalMinutes: "5",
      qualifyingToFinalsIntervalMinutes: "60",
    })
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.values.dayStartTime, "09:00");
  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      name: "スケジュールテスト大会",
      eventDate: "2099-12-01",
      venue: "会場",
      entryDeadline: new Date("2099-11-01T12:00:00"),
      maxTeams: 16,
      teamSize: 2,
      courtCount: 4,
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 8,
      winsRequired: 2,
    },
    structureLocked: false,
  });
  assert.equal("dayStartTime" in fields, false);
  assert.equal("matchDurationMinutes" in fields, false);
  assert.equal("overrides" in fields, false);
}

// Sprint 3: 予選終了 12:00 + 60分 → 決勝 13:00 / 13:25 / 13:50 / 終了 14:10
{
  const plan = buildTournamentTimePlan({
    settings: settings({ dayStartTime: "10:00" }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: {
      finalized: true,
      blocks: [{ rounds: [{}, {}, {}, {}, {}] }],
    },
    finalsBracket: { roundCount: 3, finalized: true },
  });
  assert.equal(plan.qualifyingEndTime, "12:00");
  assert.deepEqual(plan.finalsRoundStartTimes, ["13:00", "13:25", "13:50"]);
  assert.equal(plan.tournamentEndTime, "14:10");

  const lookup = buildFinalsPublicTimeSchedule({
    settings: settings({ dayStartTime: "10:00" }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: {
      finalized: true,
      blocks: [{ rounds: [{}, {}, {}, {}, {}] }],
    },
    finalsBracket: { roundCount: 3, finalized: true },
  });
  assert.equal(lookup.rounds["1"].startTime, "13:00");
  assert.equal(lookup.rounds["1"].startTimeDisplay, "13:00");
  assert.equal(lookup.rounds["2"].startTime, "13:25");
  assert.equal(lookup.rounds["2"].startTimeDisplay, "13:25");
  assert.equal(lookup.rounds["3"].startTime, "13:50");
  assert.equal(lookup.rounds["3"].startTimeDisplay, "13:50");
  assert.equal(formatScheduledRoundHeading("準決勝", "13:50"), "準決勝　13:50開始予定");
  assert.equal(formatScheduledRoundHeading("1回戦", null), "1回戦");
}

// 一発トーナメント 4ラウンド: 09:00 / 09:25 / 09:50 / 10:15
{
  const lookup = buildFinalsPublicTimeSchedule({
    settings: settings({ qualifyingToFinalsIntervalMinutes: 0 }),
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
    finalsBracket: { roundCount: 4, finalized: true },
  });
  assert.equal(lookup.rounds["1"].startTime, "09:00");
  assert.equal(lookup.rounds["1"].startTimeDisplay, "9:00");
  assert.equal(lookup.rounds["2"].startTime, "09:25");
  assert.equal(lookup.rounds["2"].startTimeDisplay, "9:25");
  assert.equal(lookup.rounds["3"].startTime, "09:50");
  assert.equal(lookup.rounds["3"].startTimeDisplay, "9:50");
  assert.equal(lookup.rounds["4"].startTime, "10:15");
  assert.equal(lookup.rounds["4"].startTimeDisplay, "10:15");
}

{
  assert.equal(
    buildFinalsPublicTimeSchedule({
      settings: settings(),
      tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
      schedule: { finalized: true, blocks: [{ rounds: [{}, {}, {}] }] },
    }),
    null
  );
  assert.equal(
    buildFinalsPublicTimeSchedule({
      settings: null,
      tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
      finalsBracket: { roundCount: 4, finalized: true },
    }),
    null
  );
}

{
  const stamped = applyFinalsScheduledTimesToRounds(
    [
      {
        roundNumber: 1,
        roundLabel: "1回戦",
        matches: [{ matchId: "m1" }, { matchId: "m-bye" }],
      },
      {
        roundNumber: 2,
        roundLabel: "準決勝",
        matches: [{ match: { matchId: "m2" }, teams: {}, displayStatus: "waiting" }],
      },
    ],
    buildFinalsPublicTimeSchedule({
      settings: settings({ dayStartTime: "10:00" }),
      tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
      schedule: { finalized: true, blocks: [{ rounds: [{}, {}, {}, {}, {}] }] },
      finalsBracket: { roundCount: 3, finalized: true },
    })
  );
  assert.equal(stamped[0].roundHeading, "1回戦　13:00開始予定");
  assert.equal(stamped[0].matches[0].scheduledStartLabel, "13:00予定");
  assert.equal(stamped[0].matches[1].scheduledStartLabel, "13:00予定");
  assert.equal(stamped[1].roundHeading, "準決勝　13:25開始予定");
  assert.equal(stamped[1].matches[0].scheduledStartLabel, "13:25予定");
  assert.equal(stamped[1].matches[0].match.scheduledStartLabel, "13:25予定");
}

{
  const section = applyFinalsScheduledTimesToBracketSection(
    {
      ready: true,
      rounds: [{ roundNumber: 1, roundLabel: "決勝", matches: [{ matchId: "f1" }] }],
    },
    null
  );
  assert.equal(section.timeSchedule, null);
  assert.equal(section.rounds[0].roundHeading, "決勝");
  assert.equal(section.rounds[0].scheduledStartTime, null);
  assert.equal(section.rounds[0].matches[0].scheduledStartLabel, null);
}

function settingsWithOverrides(overridePatch = {}, extra = {}) {
  return settings({
    ...extra,
    overrides: {
      ...emptyTimeScheduleOverrides(),
      ...overridePatch,
    },
  });
}

function fourRoundQualifyingSchedule() {
  return {
    finalized: true,
    blocks: [{ rounds: [{}, {}, {}, {}] }],
  };
}

function fiveRoundQualifyingSchedule() {
  return {
    finalized: true,
    blocks: [{ rounds: [{}, {}, {}, {}, {}] }],
  };
}

// Sprint 4: 節 override が後続のアンカーになる
{
  const lookup = buildQualifyingPublicTimeSchedule(
    settingsWithOverrides({ qualifyingRounds: { "2": "09:40" } }),
    fourRoundQualifyingSchedule()
  );
  assert.equal(lookup.rounds["1"].startTime, "09:00");
  assert.equal(lookup.rounds["1"].manual, false);
  assert.equal(lookup.rounds["2"].startTime, "09:40");
  assert.equal(lookup.rounds["2"].manual, true);
  assert.equal(lookup.rounds["3"].startTime, "10:05");
  assert.equal(lookup.rounds["3"].manual, false);
  assert.equal(lookup.rounds["4"].startTime, "10:30");
  assert.equal(lookup.rounds["4"].manual, false);
  assert.equal(formatManualScheduledMarker(true), "（手動）");
  assert.equal(formatManualScheduledMarker(false), "");
}

// 複数の節 override は直近アンカーを使う
{
  const lookup = buildQualifyingPublicTimeSchedule(
    settingsWithOverrides({
      qualifyingRounds: { "2": "09:40", "4": "11:00", "99": "18:00" },
    }),
    fiveRoundQualifyingSchedule()
  );
  assert.equal(lookup.rounds["1"].startTime, "09:00");
  assert.equal(lookup.rounds["2"].startTime, "09:40");
  assert.equal(lookup.rounds["3"].startTime, "10:05");
  assert.equal(lookup.rounds["4"].startTime, "11:00");
  assert.equal(lookup.rounds["5"].startTime, "11:25");
  assert.equal(lookup.rounds["99"], undefined);
}

// 試合 override は当該試合のみ。他試合・次節・大会終了予定は不変
{
  const configured = settingsWithOverrides({
    qualifyingRounds: { "2": "09:40" },
    qualifyingMatches: {
      "qualifying-A-R3-M1": "10:20",
      "missing-match": "12:00",
    },
  });
  const lookup = buildQualifyingPublicTimeSchedule(configured, fourRoundQualifyingSchedule());
  assert.equal(lookup.rounds["3"].startTime, "10:05");
  assert.equal(lookup.rounds["4"].startTime, "10:30");

  const section = applyQualifyingScheduledTimesToScheduleSection(
    {
      ready: true,
      blocks: [
        {
          blockId: "A",
          rounds: [
            {
              roundNumber: 3,
              roundLabel: "第3節",
              matches: [
                { matchId: "qualifying-A-R3-M1" },
                { matchId: "qualifying-A-R3-M2" },
              ],
            },
            {
              roundNumber: 4,
              roundLabel: "第4節",
              matches: [{ matchId: "qualifying-A-R4-M1" }],
            },
          ],
        },
      ],
    },
    lookup
  );
  assert.equal(section.blocks[0].rounds[0].scheduledStartTime, "10:05");
  assert.equal(section.blocks[0].rounds[0].matches[0].scheduledStartTime, "10:20");
  assert.equal(section.blocks[0].rounds[0].matches[0].scheduledStartLabel, "10:20予定");
  assert.equal(section.blocks[0].rounds[0].matches[1].scheduledStartTime, "10:05");
  assert.equal(section.blocks[0].rounds[1].scheduledStartTime, "10:30");
  assert.equal(section.blocks[0].rounds[1].matches[0].scheduledStartTime, "10:30");
  assert.equal("scheduledStartManual" in section.blocks[0].rounds[0].matches[0], false);

  const adminSection = applyQualifyingScheduledTimesToScheduleSection(
    {
      ready: true,
      blocks: [
        {
          rounds: [
            {
              roundNumber: 3,
              matches: [{ matchId: "qualifying-A-R3-M1" }, { matchId: "qualifying-A-R3-M2" }],
            },
          ],
        },
      ],
    },
    lookup,
    { includeManual: true }
  );
  assert.equal(adminSection.blocks[0].rounds[0].scheduledStartManual, false);
  assert.equal(adminSection.blocks[0].rounds[0].matches[0].scheduledStartManual, true);
  assert.equal(adminSection.blocks[0].rounds[0].matches[1].scheduledStartManual, false);

  const planWithoutMatchOverride = buildTournamentTimePlan({
    settings: settingsWithOverrides({ qualifyingRounds: { "2": "09:40" } }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fourRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3 },
  });
  const planWithMatchOverride = buildTournamentTimePlan({
    settings: configured,
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fourRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3 },
  });
  assert.equal(planWithMatchOverride.tournamentEndTime, planWithoutMatchOverride.tournamentEndTime);
  assert.equal(planWithMatchOverride.durationMinutes, planWithoutMatchOverride.durationMinutes);
}

// 自動に戻す: override 削除後は自動値
{
  const applied = setTimeScheduleOverride(
    emptyTimeScheduleOverrides(),
    "qualifyingRounds",
    "2",
    "09:40"
  );
  assert.equal(applied.valid, true);
  assert.equal(applied.overrides.qualifyingRounds["2"], "09:40");
  const cleared = clearTimeScheduleOverride(applied.overrides, "qualifyingRounds", "2");
  assert.equal(cleared.qualifyingRounds["2"], undefined);

  const automatic = buildQualifyingPublicTimeSchedule(settings(), fourRoundQualifyingSchedule());
  const restored = buildQualifyingPublicTimeSchedule(
    settingsWithOverrides(cleared),
    fourRoundQualifyingSchedule()
  );
  assert.equal(restored.rounds["2"].startTime, automatic.rounds["2"].startTime);
  assert.equal(restored.rounds["3"].startTime, automatic.rounds["3"].startTime);
}

{
  const invalidEmpty = setTimeScheduleOverride(emptyTimeScheduleOverrides(), "qualifyingRounds", "1", "");
  assert.equal(invalidEmpty.valid, false);
  const invalidFormat = setTimeScheduleOverride(
    emptyTimeScheduleOverrides(),
    "qualifyingRounds",
    "1",
    "25:00"
  );
  assert.equal(invalidFormat.valid, false);
  const invalidText = setTimeScheduleOverride(
    emptyTimeScheduleOverrides(),
    "qualifyingRounds",
    "1",
    "noon"
  );
  assert.equal(invalidText.valid, false);
}

// 予選最終節を30分後ろへ → 予選終了・決勝開始・以降の決勝も30分後ろ
{
  const base = buildTournamentTimePlan({
    settings: settings(),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fiveRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3 },
  });
  assert.equal(base.qualifyingEndTime, "11:00");
  assert.equal(base.finalsStartTime, "12:00");
  assert.deepEqual(base.finalsRoundStartTimes, ["12:00", "12:25", "12:50"]);
  assert.equal(base.tournamentEndTime, "13:10");

  const shifted = buildTournamentTimePlan({
    settings: settingsWithOverrides({ qualifyingRounds: { "5": "11:10" } }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fiveRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3 },
  });
  assert.equal(shifted.qualifyingRoundStartTimes[4], "11:10");
  assert.equal(shifted.qualifyingEndTime, "11:30");
  assert.equal(shifted.finalsStartTime, "12:30");
  assert.deepEqual(shifted.finalsRoundStartTimes, ["12:30", "12:55", "13:20"]);
  assert.equal(shifted.tournamentEndTime, "13:40");
  assert.equal(shifted.durationMinutes, base.durationMinutes + 30);

  const summary = resolveTournamentTimeScheduleSummary({
    settings: settingsWithOverrides({ qualifyingRounds: { "5": "11:10" } }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fiveRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3 },
  });
  assert.equal(summary.rangeText, "9:00 ～ 13:40");
}

// 決勝 R2 override が R3 以降のアンカーになる
{
  const lookup = buildFinalsPublicTimeSchedule({
    settings: settingsWithOverrides({ finalsRounds: { "2": "13:00" } }),
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS, finalTeamCount: 8 },
    schedule: fiveRoundQualifyingSchedule(),
    finalsBracket: { roundCount: 3, finalized: true },
  });
  assert.equal(lookup.rounds["1"].startTime, "12:00");
  assert.equal(lookup.rounds["1"].manual, false);
  assert.equal(lookup.rounds["2"].startTime, "13:00");
  assert.equal(lookup.rounds["2"].manual, true);
  assert.equal(lookup.rounds["3"].startTime, "13:25");
  assert.equal(lookup.rounds["3"].manual, false);

  const stamped = applyFinalsScheduledTimesToRounds(
    [
      {
        roundNumber: 2,
        roundLabel: "準決勝",
        matches: [
          { matchId: "final-r2-m1" },
          { matchId: "final-r2-m2" },
        ],
      },
      {
        roundNumber: 3,
        roundLabel: "決勝",
        matches: [{ matchId: "final-r3-m1" }],
      },
    ],
    {
      ...lookup,
      matchOverrides: { "final-r2-m2": "13:15" },
    }
  );
  assert.equal(stamped[0].scheduledStartTime, "13:00");
  assert.equal(stamped[0].matches[0].scheduledStartTime, "13:00");
  assert.equal(stamped[0].matches[1].scheduledStartTime, "13:15");
  assert.equal(stamped[1].scheduledStartTime, "13:25");
  assert.equal(stamped[1].matches[0].scheduledStartTime, "13:25");
}

// 公開 lookup から manual / matchOverrides を落とす
{
  const lookup = buildQualifyingPublicTimeSchedule(
    settingsWithOverrides({
      qualifyingRounds: { "2": "09:40" },
      qualifyingMatches: { "qualifying-A-R3-M1": "10:20" },
    }),
    fourRoundQualifyingSchedule()
  );
  const publicLookup = toPublicTimeScheduleLookup(lookup);
  assert.equal(publicLookup.rounds["2"].startTime, "09:40");
  assert.equal("manual" in publicLookup.rounds["2"], false);
  assert.equal("matchOverrides" in publicLookup, false);
  assert.equal(
    resolveScheduledSlotForMatch(lookup, 3, "qualifying-A-R3-M1").startTime,
    "10:20"
  );
}

// 未設定は null を返し、付与処理もエラーにしない
{
  assert.equal(
    buildQualifyingPublicTimeSchedule(null, fourRoundQualifyingSchedule()),
    null
  );
  const section = applyQualifyingScheduledTimesToScheduleSection(
    {
      ready: true,
      blocks: [{ rounds: [{ roundNumber: 1, roundLabel: "第1節", matches: [{ matchId: "m1" }] }] }],
    },
    null
  );
  assert.equal(section.blocks[0].rounds[0].roundHeading, "第1節");
  assert.equal(section.blocks[0].rounds[0].scheduledStartTime, null);
}

console.log("time-schedule.test.mjs: ok");
