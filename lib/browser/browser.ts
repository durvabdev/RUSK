export type BrowserObservation = {
  url?: string;
  title?: string;
  snapshot: string;
};

export type BrowserActionResult = {
  ok: boolean;
  text?: string;
};

export interface BrowserController {
  observe(): Promise<BrowserObservation>;

  navigate(url: string): Promise<BrowserActionResult>;

  click(ref: string): Promise<BrowserActionResult>;

  type(ref: string, text: string): Promise<BrowserActionResult>;

  select(ref: string, value: string): Promise<BrowserActionResult>;

  pressKey(key: string): Promise<BrowserActionResult>;

  hover(ref: string): Promise<BrowserActionResult>;

  goBack(): Promise<BrowserActionResult>;

  scroll(direction: "up" | "down"): Promise<BrowserActionResult>;
}
