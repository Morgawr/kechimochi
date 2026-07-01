export interface DriverStartContext {
  /** Resolved spec basename without extension, e.g. "dashboard". */
  specName: string;

  /** Worker-index derived from WDIO_WORKER_ID (0, 1, 2, …). */
  workerIndex: number;

  /** Absolute path to the per-session staging directory (logs/screenshots). */
  stageDirectory: string;
}

export interface PlatformDriver {
  /**
   * Prepare test data, launch the driver/server, and return the WebDriver
   * connection port that WDIO should target for this session, or null when the
   * driver has no port to hand over and WDIO should self-manage the WebDriver
   * (e.g. the web driver lets WDIO auto-select the chromedriver port).
   */
  start(context: DriverStartContext): Promise<number | null>;

  /**
   * Tear down the driver/server.  Called in afterSession.
   */
  stop(): Promise<void>;

  /**
   * Merge any platform-specific variables into the WDIO capabilities before the session opens.
   */
  injectEnv(
    caps: Record<string, unknown>,
    env: Record<string, string>,
  ): void;

  /**
   * Optional in-session seed delivery, called from the platform conf's `before`
   * hook (the session is live, so `browser` is available). Desktop/web deliver
   * the seed pre-session via injectEnv and don't implement this; Android can't
   * redirect its fixed sandbox path with an env var, so it pushes the prepared
   * data dir into the app sandbox here before launching the app.
   */
  seedSession?(): Promise<void>;
}