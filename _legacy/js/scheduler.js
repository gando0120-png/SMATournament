/**
 * SMATournament — 対戦表自動生成（形式別）
 */
(function () {
  function pairKey(teamAId, teamBId) {
    return teamAId < teamBId ? `${teamAId}|${teamBId}` : `${teamBId}|${teamAId}`;
  }

  function buildPairCounts(teams) {
    const counts = new Map();
    teams.forEach((a, i) => {
      teams.forEach((b, j) => {
        if (i >= j) return;
        counts.set(pairKey(a.id, b.id), 0);
      });
    });
    return counts;
  }

  function findBestPairing(teams, remaining, pairCounts) {
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        const teamA = teams[i];
        const teamB = teams[j];
        const remA = remaining.get(teamA.id) ?? 0;
        const remB = remaining.get(teamB.id) ?? 0;
        if (remA <= 0 || remB <= 0) continue;

        const key = pairKey(teamA.id, teamB.id);
        const played = pairCounts.get(key) ?? 0;
        const score = played * 1000 - (remA + remB) + Math.random() * 0.01;

        if (score < bestScore) {
          bestScore = score;
          best = { teamA, teamB, key };
        }
      }
    }

    return best;
  }

  function generateRoundRobinForTeams(teams, matchesPerTeam) {
    if (!teams.length || matchesPerTeam < 1) {
      return { pairings: [], error: "設定が不正です。" };
    }

    const totalMatches = (teams.length * matchesPerTeam) / 2;
    if (!Number.isInteger(totalMatches)) {
      return {
        pairings: [],
        error: "チーム数 × 試合数は偶数である必要があります。",
      };
    }

    const remaining = new Map(teams.map((team) => [team.id, matchesPerTeam]));
    const pairCounts = buildPairCounts(teams);
    const pairings = [];
    let guard = 0;

    while (pairings.length < totalMatches && guard < totalMatches * teams.length * 4) {
      guard += 1;
      const pairing = findBestPairing(teams, remaining, pairCounts);
      if (!pairing) {
        return { pairings: [], error: "ブロック内の対戦表を生成できませんでした。" };
      }

      pairings.push({ teamAId: pairing.teamA.id, teamBId: pairing.teamB.id });
      remaining.set(pairing.teamA.id, remaining.get(pairing.teamA.id) - 1);
      remaining.set(pairing.teamB.id, remaining.get(pairing.teamB.id) - 1);
      pairCounts.set(pairing.key, (pairCounts.get(pairing.key) ?? 0) + 1);
    }

    return { pairings, error: null };
  }

  function assignCourts(pairings, courtCount) {
    const courtUsage = Array.from({ length: courtCount }, () => 0);

    return pairings.map((pairing) => {
      let bestCourt = 1;
      let bestUsage = Infinity;
      for (let court = 1; court <= courtCount; court += 1) {
        const usage = courtUsage[court - 1];
        if (usage < bestUsage) {
          bestUsage = usage;
          bestCourt = court;
        }
      }
      courtUsage[bestCourt - 1] += 1;
      return { ...pairing, court: bestCourt };
    });
  }

  function assignRounds(rawMatches) {
    const pool = rawMatches.map((match) => ({ ...match }));
    const result = [];
    let round = 1;

    while (pool.length > 0) {
      const used = new Set();
      const nextPool = [];

      pool.forEach((match) => {
        if (!used.has(match.teamAId) && !used.has(match.teamBId)) {
          result.push({ ...match, round });
          used.add(match.teamAId);
          used.add(match.teamBId);
        } else {
          nextPool.push(match);
        }
      });

      if (nextPool.length === pool.length) {
        result.push({ ...pool[0], round });
        pool.shift();
      } else {
        pool.length = 0;
        pool.push(...nextPool);
      }

      round += 1;
    }

    return result;
  }

  function distributeTeamsToBlocks(teams, blockCount) {
    const blocks = Array.from({ length: blockCount }, (_, index) => ({
      id: `block-${String.fromCharCode(97 + index)}`,
      name: `${String.fromCharCode(65 + index)}ブロック`,
      teamIds: [],
      matchIds: [],
      qualifyingCount: 1,
    }));

    teams.forEach((team, index) => {
      blocks[index % blockCount].teamIds.push(team.id);
    });

    return blocks;
  }

  function buildMatchesFromPairings(pairings, options) {
    let counter = options.startIndex ?? 1;

    return pairings.map((pairing) => {
      const match = window.SMATournamentModels.createMatch(
        `m${counter}`,
        counter,
        pairing.court,
        pairing.teamAId,
        pairing.teamBId,
        {
          round: pairing.round ?? 1,
          blockId: options.blockId ?? null,
          phase: options.phase ?? "qualifying",
          bracketMatchId: pairing.bracketMatchId ?? null,
        }
      );
      counter += 1;
      return match;
    });
  }

  function generateBlocksPhase(teams, tournament) {
    const blocks = distributeTeamsToBlocks(teams, tournament.blockCount);
    const perBlockQualifying = Math.max(
      1,
      Math.floor(tournament.finalTeamCount / tournament.blockCount)
    );

    blocks.forEach((block) => {
      block.qualifyingCount = perBlockQualifying;
    });

    const allPairings = [];
    const errors = [];

    blocks.forEach((block) => {
      const blockTeams = block.teamIds
        .map((id) => teams.find((team) => team.id === id))
        .filter(Boolean);

      const result = generateRoundRobinForTeams(blockTeams, tournament.matchesPerTeam);
      if (result.error) errors.push(`${block.name}: ${result.error}`);
      else {
        result.pairings.forEach((pairing) => {
          allPairings.push({ ...pairing, blockId: block.id, phase: "qualifying" });
        });
      }
    });

    if (errors.length) return { matches: [], blocks, error: errors[0] };

    const withCourts = assignCourts(allPairings, tournament.courtCount);
    const withRounds = assignRounds(withCourts);
    const matches = buildMatchesFromPairings(withRounds, { phase: "qualifying" });

    matches.forEach((match) => {
      const block = blocks.find((item) => item.id === match.blockId);
      if (block) block.matchIds.push(match.id);
    });

    return { matches, blocks, error: null };
  }

  function generateKnockoutPhase(teams, tournament, options) {
    const knockout = window.SMATournamentBracket.buildKnockout(teams, {
      size: options?.size,
    });

    const pairings = [];
    knockout.slots.forEach((slot) => {
      if (slot.teamAIsBye || slot.teamBIsBye) return;
      if (!slot.teamAId || !slot.teamBId) return;

      pairings.push({
        teamAId: slot.teamAId,
        teamBId: slot.teamBId,
        bracketMatchId: slot.id,
        phase: "knockout",
        blockId: null,
      });
    });

    const withCourts = assignCourts(pairings, tournament.courtCount);
    const withRounds = withCourts.map((pairing) => {
      const slot = knockout.slots.find((item) => item.id === pairing.bracketMatchId);
      return { ...pairing, round: (slot?.roundIndex ?? 0) + 1 };
    });
    const startIndex = options?.startIndex ?? 1;
    const matches = buildMatchesFromPairings(withRounds, {
      startIndex,
      phase: "knockout",
    });

    matches.forEach((match) => {
      const slot = knockout.slots.find((item) => item.id === match.bracketMatchId);
      if (slot) slot.matchId = match.id;
    });

    const slotsById = new Map(knockout.slots.map((slot) => [slot.id, slot]));
    knockout.slots
      .filter((slot) => slot.roundIndex === 0)
      .forEach((slot) => resolveByeAdvance(slot, slotsById));

    return { matches, knockout, error: null };
  }

  function generateFullSchedule(teams, tournament) {
    const format = tournament.format ?? "round_robin";

    if (format === "knockout") {
      const result = generateKnockoutPhase(teams, tournament);
      if (result.error) return result;
      return { matches: result.matches, blocks: [], knockout: result.knockout, error: null };
    }

    if (format === "blocks") {
      return generateBlocksPhase(teams, tournament);
    }

    if (format === "blocks_and_knockout") {
      const blockResult = generateBlocksPhase(teams, tournament);
      if (blockResult.error) return blockResult;

      const knockout = window.SMATournamentBracket.buildEmptyKnockout(tournament.finalTeamCount);
      let counter = blockResult.matches.length + 1;
      const koMatches = [];

      knockout.slots.forEach((slot) => {
        const match = window.SMATournamentModels.createMatch(
          `m${counter}`,
          counter,
          1,
          null,
          null,
          {
            round: slot.roundIndex + blockResult.matches.length,
            phase: "knockout",
            bracketMatchId: slot.id,
          }
        );
        slot.matchId = match.id;
        koMatches.push(match);
        counter += 1;
      });

      const withCourts = assignCourts(
        koMatches.map((match) => ({
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          bracketMatchId: match.bracketMatchId,
          phase: "knockout",
          id: match.id,
        })),
        tournament.courtCount
      );

      koMatches.forEach((match, index) => {
        match.court = withCourts[index]?.court ?? 1;
      });

      return {
        matches: [...blockResult.matches, ...koMatches],
        blocks: blockResult.blocks,
        knockout,
        error: null,
      };
    }

    const rr = generateRoundRobinForTeams(teams, tournament.matchesPerTeam);
    if (rr.error) return { matches: [], blocks: [], knockout: null, error: rr.error };

    const withCourts = assignCourts(
      rr.pairings.map((pairing) => ({ ...pairing, phase: "round_robin" })),
      tournament.courtCount
    );
    const withRounds = assignRounds(withCourts);
    const matches = buildMatchesFromPairings(withRounds, { phase: "round_robin" });

    return { matches, blocks: [], knockout: null, error: null };
  }

  window.SMATournamentScheduler = {
    generateFullSchedule,
    generateRoundRobinForTeams,
    assignRounds,
  };
})();
