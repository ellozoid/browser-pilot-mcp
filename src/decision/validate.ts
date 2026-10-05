import { isFiniteNumber, isJsonObject, isString } from "../json.ts";
import { DecisionProviderError } from "./errors.ts";
import type { ChoiceAnswer, DecisionAnswer, DecisionQuestion, DecisionQuestions, DecisionRequest, DecisionResponse, DecisionUsage } from "./types.ts";
import type { JsonValue } from "../types.ts";

export function validateChoice(answer: JsonValue, ids: Set<string>): asserts answer is ChoiceAnswer {
  if (!isJsonObject(answer)) throw new Error("Invalid decision response; no action executed.");

  const probabilities = isJsonObject(answer.probabilities) ? answer.probabilities : undefined;
  const choice = answer.choice;
  const values = Object.values(probabilities ?? {});
  const sum = values.reduce<number>((total, value) => total + (isFiniteNumber(value) ? value : NaN), 0);
  const chosen = isString(choice) && probabilities !== undefined ? probabilities[choice] : undefined;

  const valid =
    answer.type === "choice" &&
    isString(choice) &&
    ids.has(choice) &&
    probabilities !== undefined &&
    Object.keys(probabilities).length === ids.size &&
    Object.keys(probabilities).every((key) => ids.has(key)) &&
    [...values, answer.confidence].every(value => isFiniteNumber(value) && value >= 0 && value <= 1) &&
    Math.abs(sum - 1) < 0.02 &&
    isFiniteNumber(chosen) &&
    chosen >= Math.max(...values.map(Number)) - 1e-6;

  if (!valid) throw new Error("Invalid decision response; no action executed.");
}

function decodeAnswer(value: JsonValue, question: DecisionQuestion): DecisionAnswer {
  if (!isJsonObject(value) || value.type !== question.type) throw new Error("Answer type does not match its question");

  if (question.type === "choice") {
    const answer: JsonValue = value;
    validateChoice(answer, new Set(Object.keys(question.criteria)));

    return answer;
  }

  if (question.type === "noul") {
    if (!isFiniteNumber(value.noul) || value.noul < 0 || value.noul > 1) throw new Error("Invalid noul probability");

    return { type: "noul", noul: value.noul };
  }

  if (!isFiniteNumber(value.score) || !isFiniteNumber(value.confidence) || !isJsonObject(value.probabilities) || !isJsonObject(value.legend)) {
    throw new Error("Invalid score response");
  }

  const probabilities = Object.fromEntries(Object.entries(value.probabilities).map(([key, probability]) => {
    if (!isFiniteNumber(probability) || probability < 0 || probability > 1) throw new Error("Invalid score probability");

    return [key, probability];
  }));

  const legend = Object.fromEntries(Object.entries(value.legend).map(([key, entry]) => {
    if (entry === undefined) throw new Error("Invalid score legend");

    return [key, entry];
  }));

  return { type: "score", score: value.score, confidence: value.confidence, probabilities, legend };
}

export function normalizeDecisionResponse<Q extends DecisionQuestions>(provider: string, configuredModel: string, raw: JsonValue, request: DecisionRequest<Q>): DecisionResponse<Q> {
  try {
    if (!isJsonObject(raw)) throw new Error("Response is not an object");
    const body = isJsonObject(raw.result) ? raw.result : raw;

    if (!isJsonObject(body.answers)) throw new Error("Response has no answers object");
    const answers: Record<string, DecisionAnswer> = {};

    for (const [name, question] of Object.entries(request.questions)) {
      answers[name] = decodeAnswer(body.answers[name], question);
    }

    const model = isString(body.model) ? body.model : configuredModel;
    const usage = isJsonObject(body.usage) ? body.usage as DecisionUsage : undefined;

    return { model, answers: answers as DecisionResponse<Q>["answers"], usage };
  } catch (error) {
    if (error instanceof DecisionProviderError) throw error;
    throw new DecisionProviderError(
      "invalid_response",
      provider,
      configuredModel,
      `Decision provider "${provider}" returned an invalid response for model "${configuredModel}": ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error,
    );
  }
}
