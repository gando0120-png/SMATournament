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
  if (ids.length !== LOSS_BAND_TEAM_COUNT) {
    errors.push(`expected ${LOSS_BAND_TEAM_COUNT} teams, got ${ids.length}`);
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
    if (unplaced.length !== LOSS_BAND_TEAM_COUNT) {
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
    const expectedUnplaced = state.thirdPlaceMatch === true ? 4 : 2;
    if (unplaced.length !== expectedUnplaced) {
      errors.push(
        `final phase should have ${expectedUnplaced} unplaced teams, got ${unplaced.length}`
      );
    }
    if (state.thirdPlaceMatch === true) {
      if (
        !Array.isArray(state.thirdPlaceFinalists) ||
        state.thirdPlaceFinalists.length !== 2
      ) {
        errors.push("final phase with thirdPlaceMatch requires 2 thirdPlaceFinalists");
      }
    }
  }

  if (state.phase === LossBandPhase.THIRD_PLACE) {
    if (state.thirdPlaceMatch !== true) {
      errors.push("third_place phase requires thirdPlaceMatch");
    }
    if (
      !Array.isArray(state.thirdPlaceFinalists) ||
      state.thirdPlaceFinalists.length !== 2
    ) {
      errors.push("third_place phase requires exactly 2 thirdPlaceFinalists");
    } else {
      for (const id of state.thirdPlaceFinalists) {
        if (state.teams[id]?.finalPlacement != null) {
          errors.push(`third-place finalist ${id} must not have placement yet`);
        }
      }
    }
    if (unplaced.length !== 2) {
      errors.push(
        `third_place phase should have 2 unplaced teams, got ${unplaced.length}`
      );
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
  const expected = EXPECTED_BAND_COUNTS_AT_ROUND_START[roundNumber];
  if (!expected) {
    return { valid: false, errors: [`no expected counts for round ${roundNumber}`] };
  }
  const actual = getActiveBandCounts(state);
  if (!bandCountsEqual(actual, expected)) {
    return {
      valid: false,
      errors: [
        `R${roundNumber} band counts actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
      ],
      actual,
      expected,
    };
  }
  return { valid: true, errors: [], actual, expected };
}

/**
 * @param {object} pairings
 * @param {object} state
 */
export function validatePairingsCoverage(pairings, state) {
  const errors = [];
  const paired = pairings.matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]);
  const unplaced = listUnplacedEntryIds(state);

  if (paired.length !== unplaced.length) {
    errors.push(
      `paired ${paired.length} !== unplaced ${unplaced.length}`
    );
  }
  if (new Set(paired).size !== paired.length) {
    errors.push("duplicate in pairings");
  }
  const unplacedSet = new Set(unplaced);
  for (const id of paired) {
    if (!unplacedSet.has(id)) {
      errors.push(`paired id not unplaced: ${id}`);
    }
  }
  for (const id of unplaced) {
    if (!paired.includes(id)) {
      errors.push(`unplaced id not paired: ${id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
