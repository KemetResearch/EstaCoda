export type BrowserBackendKind =
  | "local-cdp"
  | "browserbase"
  | "firecrawl"
  | "camofox"
  | "mock"
  | "unconfigured";

export type BrowserSession = {
  id: string;
  backend: BrowserBackendKind;
  currentUrl?: string;
  createdAt: string;
};

export type WebExtractionResult = {
  url: string;
  title?: string;
  content: string;
  contentType?: string;
  status?: number;
  source: "fetch" | "browser" | "cache" | "mock";
};

export type BrowserSnapshot = {
  sessionId: string;
  url: string;
  title?: string;
  text?: string;
  elements?: Array<{
    ref: string;
    role?: string;
    name?: string;
  }>;
};

export type BrowserActionInput = {
  sessionId?: string;
  ref?: string;
  text?: string;
  key?: string;
  direction?: "up" | "down";
  amount?: number;
  signal?: AbortSignal;
};

export type BrowserNavigateInput = {
  url: string;
  sessionId?: string;
  signal?: AbortSignal;
};

export type BrowserNavigateResult = {
  session: BrowserSession;
  snapshot: BrowserSnapshot;
};

export type BrowserBackendStatus = {
  backend: BrowserBackendKind;
  available: boolean;
  endpoint?: string;
  reason?: string;
  version?: string;
  browser?: string;
};

export type BrowserBackend = {
  kind: BrowserBackendKind;
  isAvailable(): Promise<boolean> | boolean;
  status(): Promise<BrowserBackendStatus> | BrowserBackendStatus;
  navigate(input: BrowserNavigateInput): Promise<BrowserNavigateResult>;
  snapshot?(input?: BrowserActionInput): Promise<BrowserSnapshot>;
  click?(input: BrowserActionInput): Promise<BrowserSnapshot>;
  type?(input: BrowserActionInput): Promise<BrowserSnapshot>;
  scroll?(input: BrowserActionInput): Promise<BrowserSnapshot>;
  press?(input: BrowserActionInput): Promise<BrowserSnapshot>;
  back?(input?: BrowserActionInput): Promise<BrowserSnapshot>;
  getImages?(input?: BrowserActionInput): Promise<Array<{
    src: string;
    alt?: string;
  }>>;
};
