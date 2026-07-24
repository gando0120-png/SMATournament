/**
 * SMATournament — localStorage 管理
 */
(function () {
  const STORAGE_KEY = "smatournament-state";
  const VERSION = "0.2";

  function save(state) {
    const payload = {
      ...state,
      version: VERSION,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.SMATournamentStorage = {
    STORAGE_KEY,
    VERSION,
    save,
    load,
    clear,
  };
})();
