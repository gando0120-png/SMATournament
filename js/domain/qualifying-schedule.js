/**
 * 予選総当たり対戦表生成（DOM 非依存）
 */

export const BYE_SYMBOL = "BYE";

/** 4チームは指定テンプレート順を厳守 */
const FOUR_TEAM_ROUND_TEMPLATE = [
  [
    ["A", "B"],
    ["C", "D"],
  ],
  [
    ["A", "C"],
    ["B", "D"],
  ],
  [
    ["A", "D"],
    ["B", "C"],
  ],
];

const MIN_TEAMS = 3;
const MAX_TEAMS = 8;

/**
 * @param {number} index 0-based
 */
export function getTeamSymbol(index) {
  return String.fromCharCode(65 + index);
}

/**
 * @param {number} teamCount
 */
export function getRequiredCourtCount(teamCount) {
  return Math.floor(teamCount / 2);
}

/**
 * @param {number} teamCount
 */
export function isSupportedTeamCount(teamCount) {
  return Number.isInteger(teamCount) && teamCount >= MIN_TEAMS && teamCount <= MAX_TEAMS;
}

/**
 * 円形法による総当たり（4チームは固定テンプレート）
 * @param {number} teamCount
 * @returns {Array<{ matches: string[][], byes: string[] }>}
 */
export function generateRoundRobinRounds(teamCount) {
  if (teamCount === 4) {
    return FOUR_TEAM_ROUND_TEMPLATE.map((matches) => ({
      matches: matches.map(([home, away]) => [home, away]),
      byes: [],
    }));
  }

  const symbols = Array.from({ length: teamCount }, (_, index) => getTeamSymbol(index));
  let teams = [...symbols];
  if (teamCount % 2 === 1) {
    teams.push(BYE_SYMBOL);
  }

  const slotCount = teams.length;
  const rounds = [];

  for (let roundIndex = 0; roundIndex < slotCount - 1; roundIndex += 1) {
    const matches = [];
    const byes = [];

    for (let i = 0; i < slotCount / 2; i += 1) {
      const home = teams[i];
      const away = teams[slotCount - 1 - i];

      if (home === BYE_SYMBOL && away !== BYE_SYMBOL) {
        byes.push(away);
      } else if (away === BYE_SYMBOL && home !== BYE_SYMBOL) {
        byes.push(home);
      } else if (home !== BYE_SYMBOL && away !== BYE_SYMBOL) {
        matches.push([home, away]);
      }
    }

    rounds.push({ matches, byes });

    const fixed = teams[0];
    const rotating = teams.slice(1);
    rotating.unshift(rotating.pop());
    teams = [fixed, ...rotating];
  }

  return rounds;
}

/**
 * @param {number} startCourt
 * @param {number} courtCount
 */
function buildCourtNumbers(startCourt, courtCount) {
  return Array.from({ length: courtCount }, (_, index) => startCourt + index);
}

/**
 * @param {object} block - blockDraw.blocks item
 * @param {Map<string, { id: string, teamName?: string }>} entryLookup
 * @param {number} startCourt
 */
function buildBlockSchedule(block, entryLookup, startCourt) {
  const entryIds = block.entryIds || [];
  const teamCount = entryIds.length;

  if (!isSupportedTeamCount(teamCount)) {
    return {
      blockId: block.id,
      blockName: block.name || `${block.id}ブロック`,
      teamCount,
      supported: false,
      courtNumbers: [],
      teams: [],
      rounds: [],
      nextCourt: startCourt,
    };
  }

  const teams = entryIds.map((entryId, index) => {
    const entry = entryLookup.get(entryId);
    const symbol = getTeamSymbol(index);
    return {
      symbol,
      entryId,
      teamName: entry?.teamName || "（名称未設定）",
    };
  });

  const teamBySymbol = new Map(teams.map((team) => [team.symbol, team]));
  const courtCount = getRequiredCourtCount(teamCount);
  const courtNumbers = buildCourtNumbers(startCourt, courtCount);
  const roundTemplates = generateRoundRobinRounds(teamCount);

  const rounds = roundTemplates.map((template, index) => {
    let courtIndex = 0;
    const matches = template.matches.map(([homeSymbol, awaySymbol]) => {
      const home = teamBySymbol.get(homeSymbol);
      const away = teamBySymbol.get(awaySymbol);
      const court = courtNumbers[courtIndex];
      courtIndex += 1;
      return {
        court,
        homeSymbol,
        awaySymbol,
        homeEntryId: home?.entryId ?? null,
        awayEntryId: away?.entryId ?? null,
        homeTeamName: home?.teamName ?? "—",
        awayTeamName: away?.teamName ?? "—",
      };
    });

    const byes = template.byes.map((symbol) => {
      const team = teamBySymbol.get(symbol);
      return {
        symbol,
        entryId: team?.entryId ?? null,
        teamName: team?.teamName ?? "—",
      };
    });

    return {
      roundNumber: index + 1,
      matches,
      byes,
    };
  });

  return {
    blockId: block.id,
    blockName: block.name || `${block.id}ブロック`,
    teamCount,
    supported: true,
    courtNumbers,
    teams,
    rounds,
    nextCourt: startCourt + courtCount,
  };
}

/**
 * blockDraw/current から予選対戦表を構築
 * @param {object} blockDraw
 * @param {Array<{ id: string, teamName?: string }>} entries
 */
export function buildQualifyingScheduleFromBlockDraw(blockDraw, entries) {
  if (!blockDraw || !Array.isArray(blockDraw.blocks) || blockDraw.blocks.length === 0) {
    return {
      blocks: [],
      totalCourtsUsed: 0,
      hasUnsupportedBlock: false,
    };
  }

  const entryLookup = new Map(entries.map((entry) => [entry.id, entry]));
  let nextCourt = 1;
  let hasUnsupportedBlock = false;

  const blocks = blockDraw.blocks.map((block) => {
    const blockSchedule = buildBlockSchedule(block, entryLookup, nextCourt);
    nextCourt = blockSchedule.nextCourt;
    if (!blockSchedule.supported) {
      hasUnsupportedBlock = true;
    }
    const { nextCourt: _next, ...rest } = blockSchedule;
    return rest;
  });

  return {
    blocks,
    totalCourtsUsed: nextCourt - 1,
    hasUnsupportedBlock,
  };
}

/**
 * テンプレートデータ形式（参照・テスト用）
 * @param {number} teamCount
 */
export function toRoundTemplate(teamCount) {
  const rounds = generateRoundRobinRounds(teamCount);
  return {
    teamCount,
    requiredCourts: getRequiredCourtCount(teamCount),
    roundCount: rounds.length,
    rounds: rounds.map((round) => round.matches),
  };
}
