/**
 * EmergencyExport Cloud Functions 権限制御
 */
import assert from "node:assert/strict";
import { exportEmergencyTournament } from "../src/emergency-export.js";

function notFoundGet() {
  return Promise.resolve({ exists: false, data: () => null });
}

function makeDb({ operatorEnabled, tournament }) {
  return {
    collection(name) {
      if (name === "operators") {
        return {
          doc() {
            return {
              get: async () => ({
                exists: operatorEnabled === true,
                data: () => (operatorEnabled ? { enabled: true } : { enabled: false }),
              }),
            };
          },
        };
      }
      if (name === "tournaments") {
        return {
          doc(id) {
            return {
              get: async () =>
                tournament
                  ? { exists: true, id, data: () => tournament }
                  : { exists: false, data: () => null },
              collection() {
                return {
                  doc() {
                    return { get: notFoundGet };
                  },
                  get: async () => ({
                    docs: [],
                    forEach() {},
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

{
  await assert.rejects(
    () =>
      exportEmergencyTournament(makeDb({ operatorEnabled: false, tournament: { name: "x" } }), {
        uid: "user-1",
        tournamentId: "t1",
      }),
    /PERMISSION_DENIED|運営者/
  );
}

{
  await assert.rejects(
    () =>
      exportEmergencyTournament(makeDb({ operatorEnabled: true, tournament: null }), {
        uid: "op-1",
        tournamentId: "missing",
      }),
    /大会が見つかりません/
  );
}

{
  const result = await exportEmergencyTournament(
    makeDb({
      operatorEnabled: true,
      tournament: {
        name: "[E2E] empty",
        eventDate: "2099-12-31",
        status: "open",
        createdBy: "uid-secret",
        email: "hidden@example.com",
      },
    }),
    { uid: "op-1", tournamentId: "t-empty", projectId: "smatournament-ce785" }
  );
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.export.exportMeta.tournamentId, "t-empty");
  assert.equal(result.export.source.tournament.createdBy, undefined);
  assert.equal(JSON.stringify(result).includes("uid-secret"), false);
  assert.equal(JSON.stringify(result).includes("hidden@example.com"), false);
  assert.match(result.fileName, /^sma-emergency-export-t-empty-/);
}

console.log("emergency-export.functions.test.mjs: all passed");
