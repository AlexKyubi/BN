window.BN_CONFIG = {
  // Google Sheets CSV export URL.
  // This file is an example and can be committed.
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/REPLACE_ME/export?format=csv&gid=0",

  // Sulpak stock proxy base URL (public HTTPS endpoint on your VM).
  sulpakProxyBase: "https://proxy.bn.alexkyubi.com",

  // Parallel requests for stock refresh (1..30).
  stockRefreshConcurrency: 12,

  // Client timeout for one stock request.
  stockFetchTimeoutMs: 12000
};
