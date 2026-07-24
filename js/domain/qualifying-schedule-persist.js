/**
 * 予選対戦表の保存・検証・表示正規化（DOM 非依存）
 */
import {
  BlockDrawStatus,
  MatchStatus,
} from "./constants.js";
import { isSupportedTeamCount } from "./qualifying-schedule.js";

/**
 * @param {string} blockId
 * @param {number} roundNumber
 * @param {number} matchNumber
 */
export function buildQualifyingMatchId(blockId, roundNumber, matchNumber) {
  return `qualifying-${blockId}-R${roundNumber}-M${matchNumber}`;
}

/**
 * @param {object} previewSchedule - buildQualifyingScheduleFromBlockDraw() の戻り値
 * @param {object} blockDraw
 */
export function buildPersistedQualifyingSchedule(previewSchedule, blockDraw) {
  let totalMatchCount = 0;

  const blocks = previewSchedule.blocks
    .filter((block) => block.supported)
    .map((block) => {
      const rounds = block.rounds.map((round) => {
        let matchNumberInRound = 0;
        const matches = round.matches.map((match) => {
          matchNumberInRound += 1;
          totalMatchCount += 1;
          return {
            matchId: buildQualifyingMatchId(block.blockId, round.roundNumber, matchNumberInRound),
            roundNumber: round.roundNumber,
            matchNumber: matchNumberInRound,
            courtNumber: match.court,
            team1: {
              symbol: match.homeSymbol,
              entryId: match.homeEntryId,
              teamName: match.homeTeamName,
            },
            team2: {
              symbol: match.awaySymbol,
              entryId: match.awayEntryId,
              teamName: match.awayTeamName,
            },
            status: MatchStatus.WAITING,
            result: null,
          };
        });

        return {
          roundNumber: round.roundNumber,
          byes: round.byes.map((bye) => ({
            symbol: bye.symbol,
            entryId: bye.entryId,
            teamName: bye.teamName,
          })),
          matches,
        };
      });

      return {
        blockId: block.blockId,
        blockName: block.blockName,
        teamCount: block.teamCount,
        courtNumbers: block.courtNumbers,
        teams: block.teams.map((team) => ({
          symbol: team.symbol,
          entryId: team.entryId,
          teamName: team.teamName,
        })),
        rounds,
      };
    });

  return {
    finalized: true,
    sourceBlockDrawUpdatedAt: blockDraw.updatedAt ?? blockDraw.finalizedAt ?? null,
    blockCount: blocks.length,
    totalMatchCount,
    totalCourtsUsed: previewSchedule.totalCourtsUsed,
    blocks,
  };
}

/**
 * @param {object} previewSchedule
 * @param {object|null|undefined} blockDraw
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateQualifyingScheduleForSave(previewSchedule, blockDraw) {
  if (!blockDraw) {
    return { valid: false, message: "ブロック抽選が存在しません。" };
  }

  if (blockDraw.status !== BlockDrawStatus.FINALIZED) {
    return { valid: false, message: "ブロック抽選が確定していません。" };
  }

  if (!Array.isArray(blockDraw.blocks) || blockDraw.blocks.length === 0) {
    return { valid: false, message: "ブロックが1つ以上必要です。" };
  }

  if (!previewSchedule || !Array.isArray(previewSchedule.blocks) || previewSchedule.blocks.length === 0) {
    return { valid: false, message: "対戦表を生成できませんでした。" };
  }

  if (previewSchedule.hasUnsupportedBlock) {
    return { valid: false, message: "3〜8チーム以外のブロックが含まれています。" };
  }

  const matchIds = new Set();
  const usedCourts = new Set();

  for (const block of previewSchedule.blocks) {
    if (!block.supported || !isSupportedTeamCount(block.teamCount)) {
      return { valid: false, message: `${block.blockName || block.blockId} は3〜8チームの範囲外です。` };
    }

    for (const courtNumber of block.courtNumbers) {
      if (usedCourts.has(courtNumber)) {
        return { valid: false, message: "コート番号がブロック間で重複しています。" };
      }
      usedCourts.add(courtNumber);
    }

    for (const round of block.rounds) {
      const entryIdsInRound = new Set();

      for (let index = 0; index < round.matches.length; index += 1) {
        const match = round.matches[index];
        const matchId = buildQualifyingMatchId(block.blockId, round.roundNumber, index + 1);

        if (matchIds.has(matchId)) {
          return { valid: false, message: "matchId が重複しています。" };
        }
        matchIds.add(matchId);

        for (const entryId of [match.homeEntryId, match.awayEntryId].filter(Boolean)) {
          if (entryIdsInRound.has(entryId)) {
            return { valid: false, message: "同一節で同じチームが複数試合に出ています。" };
          }
          entryIdsInRound.add(entryId);
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Firestore 保存データを表示用に正規化
 * @param {object} persistedSchedule
 */
export function normalizeQualifyingScheduleForDisplay(persistedSchedule) {
  const blocks = (persistedSchedule.blocks || []).map((block) => ({
    blockId: block.blockId,
    blockName: block.blockName,
    teamCount: block.teamCount,
    supported: isSupportedTeamCount(block.teamCount),
    courtNumbers: block.courtNumbers || [],
    teams: block.teams || [],
    rounds: (block.rounds || []).map((round) => ({
      roundNumber: round.roundNumber,
      matches: (round.matches || []).map((match) => ({
        court: match.courtNumber,
        blockId: block.blockId,
        roundNumber: round.roundNumber,
        homeSymbol: match.team1?.symbol,
        awaySymbol: match.team2?.symbol,
        homeEntryId: match.team1?.entryId,
        awayEntryId: match.team2?.entryId,
        homeTeamName: match.team1?.teamName ?? "—",
        awayTeamName: match.team2?.teamName ?? "—",
        team1: match.team1,
        team2: match.team2,
        matchId: match.matchId,
        status: match.status,
      })),
      byes: round.byes || [],
    })),
  }));

  return {
    blocks,
    totalCourtsUsed: persistedSchedule.totalCourtsUsed ?? 0,
    hasUnsupportedBlock: blocks.some((block) => !block.supported),
    finalized: persistedSchedule.finalized === true,
    blockCount: persistedSchedule.blockCount ?? blocks.length,
    totalMatchCount: persistedSchedule.totalMatchCount ?? 0,
  };
}
