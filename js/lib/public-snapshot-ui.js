/**
 * 公開スナップショット更新失敗時の UI 通知
 */
import { showErrorToast } from "../ui/components/toast.js";

/**
 * @param {object|null|undefined} result
 */
export function warnSnapshotRebuildFailure(result) {
  if (result?.snapshotRebuild && !result.snapshotRebuild.ok) {
    showErrorToast(
      "処理は完了しましたが、公開ページの更新に失敗しました。運営画面から公開情報を再更新してください。"
    );
  }
}
