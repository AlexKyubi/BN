window.BN_CONFIG = {
  // Google Sheets CSV export URL.
  // This file is an example and can be committed.
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/REPLACE_ME/export?format=csv&gid=0",

  // Default password for client-side login gate.
  // Keep the real value only in public/runtime-config.js (ignored by git).
  defaultPassword: "REPLACE_ME",

  // Sulpak stock proxy base URL.
  sulpakProxyBase: "http://127.0.0.1:8080",

  // Parallel requests for stock refresh (1..30).
  stockRefreshConcurrency: 12,

  // Client timeout for one stock request.
  stockFetchTimeoutMs: 12000
};
