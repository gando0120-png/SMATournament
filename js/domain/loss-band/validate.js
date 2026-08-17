/**
 * 敗戦帯 state / ペアリング不変条件の検証（純関数）
 */
import {
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  LOSS_BAND_TEAM_COUNT,
  LossBandPhase,
} from "./constants.js";
import {
  bandCountsEqual,
  getActiveBandCounts,
  listActiveEntryIds,
  listUnplacedEntryIds,
} from "./state.js";

/**
 * @param {object} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLossBandStateInvariants(state) {
  const errors = [];
  if (!state || typeof state !== "object") {
    return { valid: false, errors: ["state is required"] };
  }

  const ids = listActiveEntryIds(state);
  const teamCount = state.teamCount ?? ids.length;
  if (ids.length !== teamCount) {
    errors.push(`expected ${teamCount} teams, got ${ids.length}`);
  }
  if (new Set(ids).size !== ids.length) {
    errors.push("duplicate entryIds in state");
  }

  for (const entryId of ids) {
    const team = state.teams[entryId];
    if (!Number.isInteger(team.lossCount) || team.lossCount < 0) {
      errors.push(`invalid lossCount for ${entryId}`);
    }
    if (
      team.finalPlacement != null &&
      (!Number.isInteger(team.finalPlacement) || team.finalPlacement < 1)
    ) {
      errors.push(`invalid finalPlacement for ${entryId}`);
    }
  }

  const unplaced = listUnplacedEntryIds(state);
  if (state.phase === LossBandPhase.RANKING) {
    if (unplaced.length !== teamCount) {
      errors.push("ranking phase must not assign finalPlacement yet");
    }
    if (state.finalists != null) {
      errors.push("ranking phase must not have finalists");
    }
  }

  if (state.phase === LossBandPhase.FINAL) {
    if (!Array.isArray(state.finalists) || state.finalists.length !== 2) {
      errors.push("final phase requires exactly 2 finalists");
    } else {
      for (const id of state.finalists) {
        if (state.teams[id]?.finalPlacement != null) {
          errors.push(`finalist ${id} must not have finalPlacement yet`);
        }
      }
    }
    const thirdPending =
      state.thirdPlaceMatch === true &&
      Array.isArray(state.thirdPlaceFinalists) &&
      state.thirdPlaceFinalists.length === 2;
    const expectedUnplaced = thirdPending ? 4 : 2;
    if (unplaced.length !== expectedUnplaced) {
      errors.push(
        `final phase should have ${expectedUnplaced} unplaced teams, got ${unplaced.length}`
      );
    }
    if (thirdPending) {
      for (const id of state.thirdPlaceFinalists) {
        if (state.teams[id]?.finalPlacement != null) {
          errors.push(`thirdPlaceFinalist ${id} must not have finalPlacement yet`);
        }
      }
    }
  }

  if (state.phase === LossBandPhase.THIRD_PLACE) {
    if (
      !Array.isArray(state.thirdPlaceFinalists) ||
      state.thirdPlaceFinalists.length !== 2
    ) {
      errors.push("third_place phase requires 2 thirdPlaceFinalists");
    }
  }

  if (state.phase === LossBandPhase.COMPLETE) {
    if (unplaced.length !== 0) {
      errors.push("complete phase must place all teams");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} state
 * @param {number} roundNumber
 */
export function validateBandCountsAtRoundStart(state, roundNumber) {
  if (state.teamCount !== LOSS_BAND_TEAM_COUNT) {
    // N≠64 は動的帯人数のため固定期待値は検証しない
    return { valid: true, errors: [] };
  }
  const expected = EXPECTED_BAND_COUNTS_AT_ROUND_START[roundNumber];
  if (!expected) {
    return { valid: false, errors: [`no expected bands for R${roundNumber}`] };
  }
  const actual = getActiveBandCounts(state);
  if (!bandCountsEqual(actual, expected)) {
    return {
      valid: false,
      errors: [
        `band counts mismatch at R${roundNumber}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
      ],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * @param {object} pairings
 * @param {object} state
 */
export function validatePairingsCoverage(pairings, state) {
  const errors = [];
  const pairedIds = (pairings.matches ?? []).flatMap((m) => [
    m.team1EntryId,
    m.team2EntryId,
  ]);
  const byeIds = (pairings.byes ?? []).map((b) => b.entryId);
  const covered = [...pairedIds, ...byeIds];
  const unplaced = listUnplacedEntryIds(state);

  if (covered.length !== unplaced.length) {
    errors.push(
      `coverage size ${covered.length} !== unplaced ${unplaced.length}`
    );
  }
  if (new Set(covered).size !== covered.length) {
    errors.push("duplicate entryIds in pairings+byes");
  }
  const unplacedSet = new Set(unplaced);
  for (const id of covered) {
    if (!unplacedSet.has(id)) {
      errors.push(`paired/BYE id not unplaced: ${id}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
