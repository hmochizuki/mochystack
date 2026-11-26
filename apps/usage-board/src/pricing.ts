export type TokenCounts = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export type Billing = {
  model: string;
  speed: string;
  tokens: TokenCounts;
};

type UsdPerMillion = TokenCounts;

type PriceCard = {
  rates: UsdPerMillion;
  longPrompt?: { aboveTokens: number; rates: UsdPerMillion };
};

function card(input: number, output: number, cacheRead: number): PriceCard {
  return { rates: { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead } };
}

// 2026-11 時点の API 定価（claude-api スキルの models.md と model-migration.md）。サブスクリプションの請求額ではない。
const priceCards: Record<string, PriceCard> = {
  "claude-fable-5-2": card(8, 40, 0.2),
  "claude-fable-5-1": card(10, 50, 0.25),
  "claude-fable-5": card(10, 50, 1),
  "claude-opus-5-5": card(4, 20, 0.2),
  "claude-opus-5": card(5, 25, 0.5),
  "claude-opus-4-8": card(5, 25, 0.5),
  "claude-opus-4-7": card(5, 25, 0.5),
  "claude-opus-4-6": card(5, 25, 0.5),
  "claude-sonnet-5-5": card(2, 10, 0.1),
  "claude-sonnet-5": card(2, 10, 0.2),
  "claude-sonnet-4-6": card(3, 15, 0.3),
  "claude-haiku-5-5": {
    ...card(0.1, 0.5, 0.01),
    longPrompt: { aboveTokens: 100_000, rates: card(0.5, 2.5, 0.05).rates },
  },
  "claude-haiku-4-5": card(1, 5, 0.1),
};

function promptTokens(tokens: TokenCounts): number {
  return tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
}

export function costUsd(billing: Billing): number | null {
  if (billing.speed !== "standard") return null;
  const priceCard = priceCards[billing.model.replace(/-\d{8}$/, "")];
  if (priceCard === undefined) return null;
  const { longPrompt } = priceCard;
  const rates =
    longPrompt !== undefined && promptTokens(billing.tokens) > longPrompt.aboveTokens ? longPrompt.rates : priceCard.rates;
  const { tokens } = billing;
  return (
    (tokens.input * rates.input +
      tokens.output * rates.output +
      tokens.cacheWrite5m * rates.cacheWrite5m +
      tokens.cacheWrite1h * rates.cacheWrite1h +
      tokens.cacheRead * rates.cacheRead) /
    1_000_000
  );
}
