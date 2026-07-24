/**
 * SMATournament — データモデル・正規化（後方互換）
 */
(function () {
  const FORMATS = ["round_robin", "blocks", "knockout", "blocks_and_knockout"];
  const SCHEDULE_VIEWS = ["blocks", "knockout", "operations", "list"];

  const FORMAT_LABELS = {
    round_robin: "総当たり",
    blocks: "ブロック予選",
    knockout: "トーナメント",
    blocks_and_knockout: "ブロック予選 + 決勝T",
  };

  const VIEW_LABELS = {
    blocks: "ブロック表示",
    knockout: "トーナメント表示",
    operations: "運営進行表",
    list: "試合一覧",
  };

  function defaultScheduleView(format) {
    if (format === "blocks" || format === "blocks_and_knockout") return "blocks";
    if (format === "knockout") return "knockout";
    return "operations";
  }

  function availableViews(format) {
    const views = ["operations", "list"];
    if (format === "blocks" || format === "blocks_and_knockout") views.unshift("blocks");
    if (format === "knockout" || format === "blocks_and_knockout") {
      views.splice(format === "blocks_and_knockout" ? 1 : 0, 0, "knockout");
    }
    return views;
  }

  function createEmptyState() {
    return {
      version: "0.2",
      currentStep: 1,
      scheduleView: "operations",
      tournament: {
        name: "",
        date: "",
        format: "round_robin",
        teamCount: 4,
        courtCount: 2,
        blockCount: 2,
        matchesPerTeam: 3,
        finalTeamCount: 2,
      },
      teams: [],
      matches: [],
      blocks: [],
      knockout: null,
    };
  }

  function createTeam(id, name) {
    return { id, name: name.trim() };
  }

  function createMatch(id, matchNumber, court, teamAId, teamBId, extras) {
    return {
      id,
      matchNumber,
      court,
      teamAId,
      teamBId,
      status: "pending",
      winnerId: null,
      scoreA: null,
      scoreB: null,
      round: extras?.round ?? 1,
      blockId: extras?.blockId ?? null,
      phase: extras?.phase ?? "qualifying",
      bracketMatchId: extras?.bracketMatchId ?? null,
    };
  }

  function normalizeMatch(match, index) {
    return {
      ...match,
      matchNumber: match.matchNumber ?? index + 1,
      round: match.round ?? 1,
      blockId: match.blockId ?? null,
      phase: match.phase ?? "qualifying",
      bracketMatchId: match.bracketMatchId ?? null,
      status: match.status ?? "pending",
    };
  }

  function normalizeState(raw) {
    const base = createEmptyState();
    if (!raw) return base;

    const tournament = {
      ...base.tournament,
      ...(raw.tournament ?? {}),
    };

    if (!FORMATS.includes(tournament.format)) {
      tournament.format = "round_robin";
    }

    if (!Number.isInteger(tournament.blockCount) || tournament.blockCount < 1) {
      tournament.blockCount = Math.max(2, Math.ceil(tournament.teamCount / 4));
    }

    const matches = (raw.matches ?? []).map(normalizeMatch);
    const format = tournament.format;
    let scheduleView = raw.scheduleView ?? defaultScheduleView(format);
    if (!SCHEDULE_VIEWS.includes(scheduleView) || !availableViews(format).includes(scheduleView)) {
      scheduleView = defaultScheduleView(format);
    }

    return {
      ...base,
      ...raw,
      version: "0.2",
      currentStep: raw.currentStep ?? 1,
      scheduleView,
      tournament,
      teams: raw.teams ?? [],
      matches,
      blocks: raw.blocks ?? [],
      knockout: raw.knockout ?? null,
    };
  }

  function getTeamById(state, teamId) {
    if (!teamId) return null;
    return state.teams.find((team) => team.id === teamId) ?? null;
  }

  function validateTournament(tournament) {
    const errors = [];
    if (!tournament.name.trim()) errors.push("大会名を入力してください。");
    if (!tournament.date) errors.push("開催日を入力してください。");

    const teamCount = Number(tournament.teamCount);
    if (!Number.isInteger(teamCount) || teamCount < 2) {
      errors.push("参加チーム数は2以上の整数で入力してください。");
    }

    const courtCount = Number(tournament.courtCount);
    if (!Number.isInteger(courtCount) || courtCount < 1) {
      errors.push("コート数は1以上の整数で入力してください。");
    }

    const format = tournament.format ?? "round_robin";

    if (format === "blocks" || format === "blocks_and_knockout") {
      const blockCount = Number(tournament.blockCount);
      if (!Number.isInteger(blockCount) || blockCount < 2) {
        errors.push("ブロック数は2以上の整数で入力してください。");
      }
      if (Number.isInteger(teamCount) && Number.isInteger(blockCount) && blockCount > teamCount) {
        errors.push("ブロック数は参加チーム数以下にしてください。");
      }

      const matchesPerTeam = Number(tournament.matchesPerTeam);
      if (!Number.isInteger(matchesPerTeam) || matchesPerTeam < 1) {
        errors.push("各チームの予選試合数は1以上の整数で入力してください。");
      }
    }

    if (format === "round_robin" || format === "blocks" || format === "blocks_and_knockout") {
      const matchesPerTeam = Number(tournament.matchesPerTeam);
      if (!Number.isInteger(matchesPerTeam) || matchesPerTeam < 1) {
        errors.push("各チームの予選試合数は1以上の整数で入力してください。");
      }
    }

    if (format === "knockout") {
      if (teamCount > 32) errors.push("トーナメント形式は32チームまで対応しています。");
      if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].includes(teamCount)) {
        // teamCount 2-32 ok
      }
    }

    const finalTeamCount = Number(tournament.finalTeamCount);
    if (!Number.isInteger(finalTeamCount) || finalTeamCount < 1) {
      errors.push("決勝進出チーム数は1以上の整数で入力してください。");
    }

    if (Number.isInteger(teamCount) && Number.isInteger(finalTeamCount) && finalTeamCount > teamCount) {
      errors.push("決勝進出チーム数は参加チーム数以下にしてください。");
    }

    if (
      (format === "round_robin" || format === "blocks") &&
      Number.isInteger(teamCount) &&
      Number.isInteger(Number(tournament.matchesPerTeam)) &&
      (teamCount * Number(tournament.matchesPerTeam)) % 2 !== 0
    ) {
      errors.push("参加チーム数 × 予選試合数は偶数である必要があります。");
    }

    return errors;
  }

  function validateTeams(teams, teamCount) {
    const errors = [];
    const warnings = [];
    const names = teams.map((team) => team.name.trim());

    if (teams.length !== teamCount) {
      errors.push("チーム数が設定と一致しません。");
    }

    names.forEach((name, index) => {
      if (!name) errors.push(`チーム ${index + 1} の名前が空です。`);
    });

    const seen = new Map();
    names.forEach((name, index) => {
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) {
        warnings.push(`「${name}」はチーム ${seen.get(key) + 1} と重複しています。`);
      } else {
        seen.set(key, index);
      }
    });

    return { errors, warnings };
  }

  window.SMATournamentModels = {
    FORMATS,
    FORMAT_LABELS,
    VIEW_LABELS,
    SCHEDULE_VIEWS,
    defaultScheduleView,
    availableViews,
    createEmptyState,
    createTeam,
    createMatch,
    normalizeState,
    getTeamById,
    validateTournament,
    validateTeams,
  };
})();
