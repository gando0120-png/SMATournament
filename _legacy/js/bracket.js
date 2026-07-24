/**
 * SMATournament — トーナメント表生成・勝者伝播
 */
(function () {
  const BRACKET_SIZES = [4, 8, 16, 32];
  const ROUND_LABELS = {
    4: ["準決勝", "決勝"],
    8: ["1回戦", "準々決勝", "準決勝", "決勝"],
    16: ["1回戦", "2回戦", "準々決勝", "準決勝", "決勝"],
    32: ["1回戦", "2回戦", "3回戦", "準々決勝", "準決勝", "決勝"],
  };

  function bracketSizeFor(teamCount) {
    return BRACKET_SIZES.find((size) => size >= teamCount) ?? 32;
  }

  function roundCount(size) {
    return Math.log2(size);
  }

  function roundLabel(size, roundIndex) {
    const labels = ROUND_LABELS[size] ?? [];
    return labels[roundIndex] ?? `R${roundIndex + 1}`;
  }

  function createBracketSlot(roundIndex, slotIndex, size) {
    const id = `kb-r${roundIndex}-s${slotIndex}`;
    const nextRound = roundIndex + 1;
    const nextSlotIndex = Math.floor(slotIndex / 2);
    const hasNext = nextRound < roundCount(size);

    return {
      id,
      roundIndex,
      slotIndex,
      roundLabel: roundLabel(size, roundIndex),
      matchId: null,
      teamAId: null,
      teamBId: null,
      teamAIsBye: false,
      teamBIsBye: false,
      winnerId: null,
      nextSlotId: hasNext ? `kb-r${nextRound}-s${nextSlotIndex}` : null,
      nextSide: slotIndex % 2 === 0 ? "a" : "b",
    };
  }

  function buildBracketStructure(size) {
    const rounds = roundCount(size);
    const slots = [];

    for (let r = 0; r < rounds; r += 1) {
      const count = size / 2 ** (r + 1);
      for (let s = 0; s < count; s += 1) {
        slots.push(createBracketSlot(r, s, size));
      }
    }

    return { size, rounds, slots };
  }

  function seedFirstRound(slots, teams) {
    const firstRound = slots.filter((slot) => slot.roundIndex === 0);
    const seeded = [...teams];
    const size = firstRound.length * 2;

    while (seeded.length < size) {
      seeded.push(null);
    }

    firstRound.forEach((slot, index) => {
      const teamA = seeded[index * 2];
      const teamB = seeded[index * 2 + 1];

      if (teamA) slot.teamAId = teamA.id;
      else slot.teamAIsBye = true;

      if (teamB) slot.teamBId = teamB.id;
      else slot.teamBIsBye = true;
    });
  }

  function resolveByeAdvance(slot, slotsById) {
    if (slot.teamAIsBye && slot.teamBId) {
      slot.winnerId = slot.teamBId;
    } else if (slot.teamBIsBye && slot.teamAId) {
      slot.winnerId = slot.teamAId;
    } else if (slot.teamAIsBye && slot.teamBIsBye) {
      slot.winnerId = null;
    }

    if (slot.winnerId && slot.nextSlotId) {
      const next = slotsById.get(slot.nextSlotId);
      if (next) {
        if (slot.nextSide === "a") next.teamAId = slot.winnerId;
        else next.teamBId = slot.winnerId;
      }
    }
  }

  function applyAllByes(slots) {
    const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
    slots
      .filter((slot) => slot.roundIndex === 0)
      .forEach((slot) => resolveByeAdvance(slot, slotsById));

    for (let r = 1; r < roundCount(slotsById.get(slots[0]?.id)?.roundIndex === 0 ? 4 : 8); r += 1) {
      slots
        .filter((slot) => slot.roundIndex === r)
        .forEach((slot) => {
          if (!slot.teamAId && slot.teamBId && !slot.teamBIsBye) {
            slot.winnerId = slot.teamBId;
          } else if (!slot.teamBId && slot.teamAId && !slot.teamAIsBye) {
            slot.winnerId = slot.teamAId;
          }
          if (slot.winnerId && slot.nextSlotId) {
            const next = slotsById.get(slot.nextSlotId);
            if (next) {
              if (slot.nextSide === "a") next.teamAId = slot.winnerId;
              else next.teamBId = slot.winnerId;
            }
          }
        });
    }
  }

  function buildEmptyKnockout(qualifierCount) {
    const size = bracketSizeFor(qualifierCount);
    const structure = buildBracketStructure(size);
    return {
      size,
      rounds: structure.rounds,
      slots: structure.slots,
    };
  }

  function buildKnockout(teams, options) {
    const size = options?.size ?? bracketSizeFor(teams.length);
    const structure = buildBracketStructure(size);
    seedFirstRound(structure.slots, teams);

    const slotsById = new Map(structure.slots.map((slot) => [slot.id, slot]));
    structure.slots
      .filter((slot) => slot.roundIndex === 0)
      .forEach((slot) => resolveByeAdvance(slot, slotsById));

    return {
      size,
      rounds: structure.rounds,
      slots: structure.slots,
    };
  }

  function linkMatchesToBracket(knockout, matches) {
    knockout.slots.forEach((slot) => {
      if (slot.teamAIsBye && slot.teamBIsBye) return;
      if (slot.teamAIsBye || slot.teamBIsBye) return;

      const match = matches.find((item) => item.bracketMatchId === slot.id);
      if (match) slot.matchId = match.id;
    });
  }

  function propagateWinner(state, match) {
    if (!state.knockout || !match.bracketMatchId) return;

    const slot = state.knockout.slots.find((item) => item.id === match.bracketMatchId);
    if (!slot) return;

    slot.winnerId = match.status === "completed" ? match.winnerId : null;

    if (!slot.winnerId || !slot.nextSlotId) return;

    const next = state.knockout.slots.find((item) => item.id === slot.nextSlotId);
    if (!next) return;

    if (slot.nextSide === "a") next.teamAId = slot.winnerId;
    else next.teamBId = slot.winnerId;

    const nextMatch = state.matches.find((item) => item.bracketMatchId === next.id);
    if (nextMatch) {
      if (slot.nextSide === "a") nextMatch.teamAId = slot.winnerId;
      else nextMatch.teamBId = slot.winnerId;
    }
  }

  function syncBracketFromMatches(state) {
    if (!state.knockout) return;

    const slots = [...state.knockout.slots].sort(
      (a, b) => a.roundIndex - b.roundIndex || a.slotIndex - b.slotIndex
    );

    slots.forEach((slot) => {
      const match = state.matches.find((item) => item.bracketMatchId === slot.id);
      slot.winnerId =
        match && match.status === "completed" ? match.winnerId : slot.winnerId ?? null;

      if (slot.teamAIsBye && slot.teamBId && !slot.winnerId) {
        slot.winnerId = slot.teamBId;
      } else if (slot.teamBIsBye && slot.teamAId && !slot.winnerId) {
        slot.winnerId = slot.teamAId;
      }

      if (!slot.winnerId || !slot.nextSlotId) return;

      const next = state.knockout.slots.find((item) => item.id === slot.nextSlotId);
      if (!next) return;

      if (slot.nextSide === "a") next.teamAId = slot.winnerId;
      else next.teamBId = slot.winnerId;

      const nextMatch = state.matches.find((item) => item.bracketMatchId === next.id);
      if (nextMatch) {
        if (slot.nextSide === "a") nextMatch.teamAId = slot.winnerId;
        else nextMatch.teamBId = slot.winnerId;
      }
    });
  }

  function getChampion(state) {
    if (!state.knockout) return null;
    const finalRound = state.knockout.rounds - 1;
    const finalSlot = state.knockout.slots.find(
      (slot) => slot.roundIndex === finalRound && slot.slotIndex === 0
    );
    return finalSlot?.winnerId ?? null;
  }

  function fillKnockoutFromBlockQualifiers(state) {
    if (!state.knockout || !state.blocks.length) return;

    const qualifiers = [];
    state.blocks.forEach((block) => {
      const rows = window.SMATournamentStandings.calculateStandingsForMatches(
        state,
        block.matchIds,
        block.teamIds
      );
      rows.slice(0, block.qualifyingCount).forEach((row) => qualifiers.push(row.teamId));
    });

    const firstRound = state.knockout.slots.filter((slot) => slot.roundIndex === 0);
    firstRound.forEach((slot, index) => {
      slot.teamAId = qualifiers[index * 2] ?? null;
      slot.teamBId = qualifiers[index * 2 + 1] ?? null;
      slot.teamAIsBye = !slot.teamAId;
      slot.teamBIsBye = !slot.teamBId;

      const match = state.matches.find((item) => item.bracketMatchId === slot.id);
      if (match) {
        match.teamAId = slot.teamAId;
        match.teamBId = slot.teamBId;
      }

      const slotsById = new Map(state.knockout.slots.map((item) => [item.id, item]));
      resolveByeAdvance(slot, slotsById);
    });
  }

  window.SMATournamentBracket = {
    BRACKET_SIZES,
    bracketSizeFor,
    roundLabel,
    buildEmptyKnockout,
    buildKnockout,
    linkMatchesToBracket,
    propagateWinner,
    syncBracketFromMatches,
    getChampion,
    fillKnockoutFromBlockQualifiers,
  };
})();
