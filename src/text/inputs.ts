import type { ObservedAction, PageState } from "../types.ts";
import { isString } from "../json.ts";

export type DeterministicInputs = Record<string, string>;

function normalized(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function metadata(action: ObservedAction): string[] {
  return [action.label, action.name, action.placeholder, action["aria-label"], action.id]
    .flatMap(value => isString(value) && value.trim() ? [normalized(value)] : []);
}

function matchScore(key: string, action: ObservedAction): number {
  const target = normalized(key);

  if (!target) return 0;
  let score = 0;

  for (const value of metadata(action)) {
    if (value === target) score = Math.max(score, 4);
    else if (value === `${target} address` || value === `${target} field` || value === `${target} input`) score = Math.max(score, 3);
    else if (value.split(" ").includes(target)) score = Math.max(score, 2);
  }

  return score;
}

export function deterministicFieldValue(action: ObservedAction, page: PageState, inputs: DeterministicInputs): { key: string; value: string } | null {
  const ranked = Object.keys(inputs)
    .map(key => ({ key, score: matchScore(key, action) }))
    .filter(candidate => candidate.score >= 3)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length || ranked[1]?.score === ranked[0].score) return null;
  const best = ranked[0];
  const competingFields = page.actions.filter(candidate => candidate.kind === "fill" && candidate.id !== action.id && matchScore(best.key, candidate) >= best.score);

  if (competingFields.length) return null;

  return { key: best.key, value: inputs[best.key] };
}
