/**
 * エントリー完了後案内の domain テスト
 */
import assert from "node:assert/strict";
import {
  ENTRY_COMPLETION_DEFAULT_LINK_LABEL,
  EntryCompletionLimits,
  isAllowedEntryCompletionLinkUrl,
  validateEntryCompletionGuidanceInput,
  buildEntryCompletionGuidanceView,
  buildEntryCompletionGuidanceDoc,
  pickEntryCompletionFieldsForPublicSnapshot,
} from "../../js/domain/entry-completion-guidance.js";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { buildTournamentSettingsUpdateFields } from "../../js/domain/tournament-settings-update.js";
import { buildPublicTournamentSnapshot } from "../../js/domain/public-tournament-snapshot.js";

function baseTournamentInput(overrides = {}) {
  return {
    name: "案内テスト大会",
    eventDate: "2099-12-01",
    venue: "会場",
    entryDeadline: "2099-11-01T12:00",
    maxTeams: "16",
    teamSize: "2",
    courtCount: "2",
    winsRequired: "2",
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    ...overrides,
  };
}

assert.equal(isAllowedEntryCompletionLinkUrl(""), true);
assert.equal(isAllowedEntryCompletionLinkUrl(null), true);
assert.equal(isAllowedEntryCompletionLinkUrl("https://line.me/ti/g2/abc"), true);
assert.equal(isAllowedEntryCompletionLinkUrl("http://example.com"), false);
assert.equal(isAllowedEntryCompletionLinkUrl("javascript:alert(1)"), false);
assert.equal(isAllowedEntryCompletionLinkUrl("data:text/html,<script>"), false);
assert.equal(isAllowedEntryCompletionLinkUrl("ftp://example.com"), false);
assert.equal(isAllowedEntryCompletionLinkUrl("not a url"), false);

{
  const view = buildEntryCompletionGuidanceView({});
  assert.equal(view.visible, false);
}

{
  const message = "エントリーありがとうございます。\n集合は9:00です。";
  const view = buildEntryCompletionGuidanceView({
    entryCompletionMessage: message,
  });
  assert.equal(view.visible, true);
  assert.equal(view.message, message);
  assert.equal(view.linkUrl, null);
}

{
  const view = buildEntryCompletionGuidanceView({
    entryCompletionMessage: "LINEで連絡します。",
    entryCompletionLinkUrl: "https://line.me/ti/g2/abc",
    entryCompletionLinkLabel: "LINEオープンチャットに参加",
  });
  assert.equal(view.linkLabel, "LINEオープンチャットに参加");
}

{
  const view = buildEntryCompletionGuidanceView({
    entryCompletionLinkUrl: "https://example.com/info",
  });
  assert.equal(view.visible, true);
  assert.equal(view.linkLabel, ENTRY_COMPLETION_DEFAULT_LINK_LABEL);
}

{
  const view = buildEntryCompletionGuidanceView({
    entryCompletionMessage: "ご案内",
    entryCompletionLinkUrl: "javascript:alert(1)",
  });
  assert.equal(view.message, "ご案内");
  assert.equal(view.linkUrl, null);
}

{
  const tooLong = "あ".repeat(EntryCompletionLimits.message.maxLength + 1);
  const result = validateEntryCompletionGuidanceInput({
    entryCompletionMessage: tooLong,
  });
  assert.equal(result.valid, false);
}

{
  const none = validateTournamentInput(baseTournamentInput());
  assert.equal(none.valid, true);
  assert.equal(none.values.entryCompletionMessage, "");
  assert.equal(buildEntryCompletionGuidanceDoc(none.values), null);

  const withGuidance = validateTournamentInput(
    baseTournamentInput({
      entryCompletionMessage: "駐車場は西側です。\nご注意ください。",
      entryCompletionLinkUrl: "https://example.com/parking",
      entryCompletionLinkLabel: "駐車場マップ",
    })
  );
  assert.equal(withGuidance.valid, true);
  const docBody = buildEntryCompletionGuidanceDoc(withGuidance.values);
  assert.equal(docBody.entryCompletionLinkUrl, "https://example.com/parking");

  const badUrl = validateTournamentInput(
    baseTournamentInput({
      entryCompletionLinkUrl: "http://insecure.example",
    })
  );
  assert.equal(badUrl.valid, false);
}

// 大会設定更新ペイロードには案内フィールドを含めない（サブコレクションへ分離）
{
  const validation = validateTournamentInput(
    baseTournamentInput({
      entryCompletionMessage: "新しい案内",
      entryCompletionLinkUrl: "https://example.com/new",
    })
  );
  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      name: "案内テスト大会",
      eventDate: "2099-12-01",
      venue: "会場",
      entryDeadline: new Date("2099-11-01T12:00:00"),
      maxTeams: 16,
      teamSize: 2,
      courtCount: 2,
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      winsRequired: 2,
    },
    structureLocked: false,
  });
  assert.equal("entryCompletionMessage" in fields, false);
  assert.equal("entryCompletionLinkUrl" in fields, false);
}

{
  const snap = buildPublicTournamentSnapshot({
    tournament: {
      name: "公開案内大会",
      eventDate: "2099-12-01",
      venue: "会場",
      status: "open",
      maxTeams: 8,
      teamSize: 2,
      courtCount: 1,
      entryCount: 0,
      confirmedCount: 0,
      entryCompletionMessage: "公開OK案内",
      entryCompletionLinkUrl: "https://example.com/ok",
      entryCompletionLinkLabel: "参加する",
      createdBy: "secret-uid",
      privateMemo: "secret",
    },
    entries: [],
  });
  assert.equal(snap.tournament.entryCompletionMessage, "公開OK案内");
  assert.equal("createdBy" in snap.tournament, false);
  assert.deepEqual(pickEntryCompletionFieldsForPublicSnapshot({}), {
    entryCompletionMessage: null,
    entryCompletionLinkUrl: null,
    entryCompletionLinkLabel: null,
  });
}

console.log("entry-completion-guidance.test.mjs: ok");
