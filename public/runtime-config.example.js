window.BN_CONFIG = {
  // Google Sheets CSV export URL.
  // This file is published on GitHub Pages, so keep a working URL here.
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/1e1dt81yF7OAAv3bzjW8QZIX1e43mbRZ9O3V2Anv0YLc/export?format=csv&gid=0",

  // Sulpak stock proxy base URL (public HTTPS endpoint on your VM).
  sulpakProxyBase: "https://proxy.bn.alexkyubi.com",

  // Parallel requests for stock refresh (1..30).
  stockRefreshConcurrency: 12,

  // Catalog CSV refresh interval while page is open (ms).
  catalogRefreshIntervalMs: 900000,

  // Client timeout for one stock request to proxy. Use 0 to disable abort.
  stockFetchTimeoutMs: 600000,

  // First region bootstrap may be long on a cold server start. 0 = wait without abort.
  regionSyncTimeoutMs: 0,

  // Auth validation should fail fast if proxy is unavailable.
  authValidateTimeoutMs: 15000
};
