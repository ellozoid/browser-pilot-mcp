import type { ChoiceQuestion, DecisionProvider, DecisionRequest } from "../decision/types.ts";
import { DecisionProviderError } from "../decision/errors.ts";
import { trace } from "../trace.ts";
import { validateChoice } from "../decision/validate.ts";

export async function choiceRequest<Q extends Record<string, ChoiceQuestion>>(
  provider: DecisionProvider,
  request: DecisionRequest<Q>,
  purpose: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await provider.decide(request);
      trace(`${purpose}_response`, response);

      for (const [name, question] of Object.entries(request.questions)) {
        const answer = response.answers[name];

        if (answer?.type !== "choice") throw new Error("Invalid choice response type");
        validateChoice(answer, new Set(Object.keys(question.criteria)));
      }

      return response;
    } catch (error) {
      trace("choice_validation_error", { purpose, attempt, error: String(error) });

      const invalid = error instanceof DecisionProviderError
        ? error.kind === "invalid_response"
        : String(error).includes("Invalid decision response");

      if (!invalid || attempt === 1) throw error;
    }
  }
}
