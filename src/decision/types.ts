import type { JsonValue } from "../types.ts";

export type DecisionEntry = Exclude<JsonValue, undefined>;

export type DecisionCriteria = Record<string, DecisionEntry>;

export interface ChoiceQuestion {
  type: "choice";
  criteria: DecisionCriteria;
  instructions?: DecisionEntry;
}

export interface NoulQuestion {
  type: "noul";
  criteria?: { true?: DecisionEntry; false?: DecisionEntry } | null;
  instructions?: DecisionEntry;
}

export interface ScoreQuestion {
  type: "score";
  criteria: DecisionEntry[];
  instructions?: DecisionEntry;
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export type DecisionQuestions = Record<string, DecisionQuestion>;

export interface DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> {
  state: DecisionEntry;
  questions: Q;
  images?: string[];
}

export interface ChoiceAnswer {
  [key: string]: JsonValue;
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  [key: string]: JsonValue;
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  [key: string]: JsonValue;
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, DecisionEntry>;
  probabilities: Record<string, number>;
}

export type DecisionAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export type DecisionAnswerFor<Q extends DecisionQuestion> = Q extends ChoiceQuestion
  ? ChoiceAnswer
  : Q extends NoulQuestion
    ? NoulAnswer
    : ScoreAnswer;

export interface DecisionUsage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: JsonValue;
}

export interface DecisionResponse<Q extends DecisionQuestions = DecisionQuestions> {
  model: string;
  answers: { [K in keyof Q]: DecisionAnswerFor<Q[K]> };
  usage?: DecisionUsage;
}

export interface DecisionProviderCapabilities {
  choice: boolean;
  noul: boolean;
  score: boolean;
  images?: boolean;
}

export interface DecisionProvider {
  readonly id: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly capabilities: DecisionProviderCapabilities;
  decide<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResponse<Q>>;
}
