/** Choosing the model a chat talks to, shared by both apps. */
import type { ModelList } from "@studypal/core/llm/models";
import type {
  ChatSummary,
  Provider,
  ProviderKind,
} from "@studypal/core/llm/store";

/**
 * Whether a chat's stored history can be replayed to another provider: every
 * kind but Anthropic speaks the OpenAI chat-completions format.
 */
export const sameWireFormat = (a: ProviderKind | undefined, b: ProviderKind) =>
  a !== undefined && (a === "anthropic") === (b === "anthropic");

/** A provider and one of its models, as chosen in the picker. */
export interface ModelChoice {
  providerId: number;
  model: string;
}

export const choiceKey = (choice: ModelChoice) =>
  `${choice.providerId}:${choice.model}`;

/** The model a chat talks to: its own choice, else its provider's default. */
export function currentModel(
  chat: ChatSummary,
  providers: Provider[],
): string | undefined {
  return (
    chat.model ??
    providers.find((provider) => provider.id === chat.providerId)?.model
  );
}

/**
 * Every provider with the models to offer for it. The configured model, and
 * the one in use, are always offered even if the service does not list them
 * (or the list could not be fetched).
 */
export function modelOptions(
  providers: Provider[],
  lists: ModelList[] | undefined,
  value: ModelChoice | undefined,
): { provider: Provider; models: string[]; error?: string }[] {
  return providers.map((provider) => {
    const list = lists?.find((entry) => entry.providerId === provider.id);
    const models = [...(list?.models ?? [])];
    for (const extra of [
      provider.model,
      value?.providerId === provider.id ? value.model : undefined,
    ]) {
      if (extra && !models.includes(extra)) models.unshift(extra);
    }
    return { provider, models, error: list?.error };
  });
}
