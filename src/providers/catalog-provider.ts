import type { ModelProfile, ProviderAdapter, ProviderEndpoint, ProviderId, ProviderRequest, ProviderResponse } from "../contracts/provider.js";

export type CatalogProviderOptions = {
  id: ProviderId;
  name?: string;
  models: ModelProfile[];
};

export function createCatalogProvider(options: CatalogProviderOptions): ProviderAdapter {
  return {
    id: options.id,
    name: options.name ?? `${options.id} catalog`,
    executable: false,
    health(_endpointOverride?: ProviderEndpoint) {
      return {
        available: true
      };
    },
    listModels() {
      return options.models;
    },
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      return {
        ok: false,
        content: `Provider ${options.id} is registered for model discovery only and is not yet executable. Configure it as an openai-compatible provider or wait for its native adapter to be wired.`,
        model: request.model,
        provider: options.id,
        errorClass: "unsupported"
      };
    }
  };
}
