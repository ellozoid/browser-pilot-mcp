import { fieldText } from "../model/text.ts";
import type { JsonValue } from "../types.ts";

export interface GeneratedFieldValue {
  text: string | null;
  helper: { model: string; latency_ms: number; usage?: unknown };
}

export interface TextProvider {
  readonly id: string;
  generateFieldValue(context: JsonValue): Promise<GeneratedFieldValue>;
}

export class OpenAiCompatibleTextProvider implements TextProvider {
  readonly id = "openai-compatible";

  generateFieldValue(context: JsonValue): Promise<GeneratedFieldValue> {
    return fieldText(context);
  }
}
