import type { ImageGenerationProvider } from "../config/runtime-config.js";

export const DEFAULT_FAL_IMAGE_MODEL = "fal-ai/flux-2/klein/9b";
export const DEFAULT_BYTEPLUS_IMAGE_MODEL = "seedream-5-0-260128";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2-medium";
export const BYTEPLUS_IMAGE_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const FAL_IMAGE_BASE_URL = "https://fal.run";
export const OPENAI_IMAGE_BASE_URL = "https://api.openai.com/v1";

export type ImageAspectKey = "square" | "landscape" | "portrait";
export type FalImageSizeStyle = "image_size_preset" | "aspect_ratio" | "gpt_literal";
export type FalPayloadValue = string | number | boolean;
export type OpenAIImageQuality = "low" | "medium" | "high";

export type ImageModelOption = {
  id: string;
  label: string;
  aliases: readonly string[];
  description: string;
  fal?: {
    sizeStyle: FalImageSizeStyle;
    sizes: Record<ImageAspectKey, string>;
    defaults: Record<string, FalPayloadValue>;
    supports: readonly string[];
    editEndpoint?: string;
    editSupports?: readonly string[];
    maxReferenceImages?: number;
  };
  openai?: {
    apiModel: string;
    quality: OpenAIImageQuality;
    sizes: Record<ImageAspectKey, string>;
    supports: readonly string[];
    editSupports?: readonly string[];
    maxReferenceImages?: number;
  };
};

export const IMAGE_MODEL_OPTIONS: Record<ImageGenerationProvider, readonly ImageModelOption[]> = {
  fal: [
    {
      id: DEFAULT_FAL_IMAGE_MODEL,
      label: "FLUX 2 Klein 9B",
      aliases: ["flux-2", "klein", "fal-default"],
      description: "Fast default FAL model with crisp text rendering.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          num_inference_steps: 4,
          output_format: "png",
          enable_safety_checker: false
        },
        supports: ["prompt", "image_size", "num_inference_steps", "seed", "output_format", "enable_safety_checker"],
        editEndpoint: "fal-ai/flux-2/klein/9b/edit",
        editSupports: ["prompt", "image_urls", "num_inference_steps", "seed", "output_format", "enable_safety_checker"],
        maxReferenceImages: 9
      }
    },
    {
      id: "fal-ai/flux-2-pro",
      label: "FLUX 2 Pro",
      aliases: ["flux-2-pro", "flux2-pro", "flux-pro"],
      description: "Studio-quality FLUX 2 model with an editing endpoint.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          num_inference_steps: 50,
          guidance_scale: 4.5,
          num_images: 1,
          output_format: "png",
          enable_safety_checker: false,
          safety_tolerance: "5",
          sync_mode: true
        },
        supports: [
          "prompt", "image_size", "num_inference_steps", "guidance_scale", "num_images",
          "output_format", "enable_safety_checker", "safety_tolerance", "sync_mode", "seed"
        ],
        editEndpoint: "fal-ai/flux-2-pro/edit",
        editSupports: [
          "prompt", "image_urls", "num_inference_steps", "guidance_scale", "num_images",
          "output_format", "enable_safety_checker", "safety_tolerance", "sync_mode", "seed"
        ],
        maxReferenceImages: 9
      }
    },
    {
      id: "fal-ai/z-image/turbo",
      label: "Z-Image Turbo",
      aliases: ["z-image", "z-image-turbo", "zimage", "z"],
      description: "Fast bilingual image model for English and Chinese prompts.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          num_inference_steps: 8,
          num_images: 1,
          output_format: "png",
          enable_safety_checker: false,
          enable_prompt_expansion: false
        },
        supports: [
          "prompt", "image_size", "num_inference_steps", "num_images", "seed",
          "output_format", "enable_safety_checker", "enable_prompt_expansion"
        ]
      }
    },
    {
      id: "fal-ai/nano-banana-pro",
      label: "Nano Banana Pro",
      aliases: ["nano-banana-pro", "banana-pro", "gemini-3-pro-image"],
      description: "Gemini 3 Pro image model for reasoning-heavy generation and editing.",
      fal: {
        sizeStyle: "aspect_ratio",
        sizes: { landscape: "16:9", square: "1:1", portrait: "9:16" },
        defaults: {
          num_images: 1,
          output_format: "png",
          safety_tolerance: "5",
          resolution: "1K"
        },
        supports: [
          "prompt", "aspect_ratio", "num_images", "output_format", "safety_tolerance",
          "seed", "sync_mode", "resolution", "enable_web_search", "limit_generations"
        ],
        editEndpoint: "fal-ai/nano-banana-pro/edit",
        editSupports: [
          "prompt", "image_urls", "aspect_ratio", "num_images", "output_format",
          "safety_tolerance", "seed", "sync_mode", "resolution", "enable_web_search", "limit_generations"
        ],
        maxReferenceImages: 2
      }
    },
    {
      id: "fal-ai/gpt-image-1.5",
      label: "GPT Image 1.5",
      aliases: ["gpt-image-1.5", "gpt-image-15", "gpt-1.5-image"],
      description: "High-adherence GPT image model with literal dimension sizes.",
      fal: {
        sizeStyle: "gpt_literal",
        sizes: { landscape: "1536x1024", square: "1024x1024", portrait: "1024x1536" },
        defaults: {
          quality: "medium",
          num_images: 1,
          output_format: "png"
        },
        supports: ["prompt", "image_size", "quality", "num_images", "output_format", "background", "sync_mode"],
        editEndpoint: "fal-ai/gpt-image-1.5/edit",
        editSupports: ["prompt", "image_urls", "image_size", "quality", "num_images", "output_format", "sync_mode"],
        maxReferenceImages: 16
      }
    },
    {
      id: "fal-ai/gpt-image-2",
      label: "GPT Image 2",
      aliases: ["gpt-image-2", "gpt-2-image"],
      description: "Advanced GPT image model with strong text rendering and photorealism.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_4_3", square: "square_hd", portrait: "portrait_4_3" },
        defaults: {
          quality: "medium",
          num_images: 1,
          output_format: "png"
        },
        supports: ["prompt", "image_size", "quality", "num_images", "output_format", "sync_mode"],
        editEndpoint: "openai/gpt-image-2/edit",
        editSupports: ["prompt", "image_urls", "quality", "num_images", "output_format", "sync_mode", "mask_image_url"],
        maxReferenceImages: 16
      }
    },
    {
      id: "fal-ai/ideogram/v3",
      label: "Ideogram V3",
      aliases: ["ideogram-v3", "ideogram", "ideogram-3"],
      description: "Typography-focused image model with an editing endpoint.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          rendering_speed: "BALANCED",
          expand_prompt: true,
          style: "AUTO"
        },
        supports: ["prompt", "image_size", "rendering_speed", "expand_prompt", "style", "seed"],
        editEndpoint: "fal-ai/ideogram/v3/edit",
        editSupports: ["prompt", "image_urls", "rendering_speed", "expand_prompt", "style", "seed"],
        maxReferenceImages: 1
      }
    },
    {
      id: "fal-ai/recraft/v4/pro/text-to-image",
      label: "Recraft V4 Pro",
      aliases: ["recraft-v4-pro", "recraft-pro", "recraft"],
      description: "Design-oriented model for brand systems and production assets.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          enable_safety_checker: false
        },
        supports: ["prompt", "image_size", "enable_safety_checker", "colors", "background_color"]
      }
    },
    {
      id: "fal-ai/qwen-image",
      label: "Qwen Image",
      aliases: ["qwen-image", "qwen"],
      description: "LLM-based image model for complex prompts and text-heavy outputs.",
      fal: {
        sizeStyle: "image_size_preset",
        sizes: { landscape: "landscape_16_9", square: "square_hd", portrait: "portrait_16_9" },
        defaults: {
          num_inference_steps: 30,
          guidance_scale: 2.5,
          num_images: 1,
          output_format: "png",
          acceleration: "regular"
        },
        supports: [
          "prompt", "image_size", "num_inference_steps", "guidance_scale", "num_images",
          "output_format", "acceleration", "seed", "sync_mode"
        ],
        editEndpoint: "fal-ai/qwen-image-2/pro/edit",
        editSupports: [
          "prompt", "image_urls", "num_inference_steps", "guidance_scale", "num_images",
          "output_format", "acceleration", "seed", "sync_mode"
        ],
        maxReferenceImages: 3
      }
    },
    {
      id: "fal-ai/krea/v2/medium/text-to-image",
      label: "Krea 2 Medium",
      aliases: ["krea-2-medium", "krea-v2-medium", "krea-medium"],
      description: "Expressive Krea model for illustration, anime, painting, and stylized work.",
      fal: {
        sizeStyle: "aspect_ratio",
        sizes: { landscape: "16:9", square: "1:1", portrait: "9:16" },
        defaults: {
          creativity: "medium"
        },
        supports: ["prompt", "aspect_ratio", "creativity", "seed", "image_style_references"]
      }
    },
    {
      id: "fal-ai/krea/v2/large/text-to-image",
      label: "Krea 2 Large",
      aliases: ["krea-2-large", "krea-v2-large", "krea-large"],
      description: "Larger Krea model for photorealism and textured cinematic looks.",
      fal: {
        sizeStyle: "aspect_ratio",
        sizes: { landscape: "16:9", square: "1:1", portrait: "9:16" },
        defaults: {
          creativity: "medium"
        },
        supports: ["prompt", "aspect_ratio", "creativity", "seed", "image_style_references"]
      }
    }
  ],
  byteplus: [
    {
      id: DEFAULT_BYTEPLUS_IMAGE_MODEL,
      label: "Seedream 5.0",
      aliases: ["seedream-5", "seedream-5.0", "seedream5", "5"],
      description: "Current BytePlus ModelArk Seedream default for text-to-image generation."
    },
    {
      id: "seedream-5-0-lite-260128",
      label: "Seedream 5.0 Lite",
      aliases: ["seedream-5-lite", "seedream-5.0-lite", "seedream5-lite", "5-lite"],
      description: "BytePlus ModelArk Seedream 5.0 Lite option documented for image generation."
    },
    {
      id: "seedream-4-5-251128",
      label: "Seedream 4.5",
      aliases: ["seedream-4.5", "seedream-45", "4.5"],
      description: "Previous Seedream generation model; useful if enabled on your Ark account."
    },
    {
      id: "seedream-4-0-250828",
      label: "Seedream 4.0",
      aliases: ["seedream-4", "seedream-4.0", "seedream4", "4"],
      description: "Older Seedream generation model; accounts may need explicit activation."
    }
  ],
  openai: [
    {
      id: "gpt-image-2-low",
      label: "GPT Image 2 Low",
      aliases: ["gpt-image-2-low", "gpt-image-low", "openai-fast", "low"],
      description: "Fastest OpenAI GPT Image 2 generation tier.",
      openai: {
        apiModel: "gpt-image-2",
        quality: "low",
        sizes: { landscape: "1536x1024", square: "1024x1024", portrait: "1024x1536" },
        supports: ["prompt", "size", "n", "quality"],
        editSupports: ["prompt", "image[]", "size", "n", "quality"],
        maxReferenceImages: 16
      }
    },
    {
      id: DEFAULT_OPENAI_IMAGE_MODEL,
      label: "GPT Image 2 Medium",
      aliases: ["gpt-image-2", "gpt-image-2-medium", "gpt-image-medium", "openai-default", "medium"],
      description: "Balanced OpenAI GPT Image 2 generation tier.",
      openai: {
        apiModel: "gpt-image-2",
        quality: "medium",
        sizes: { landscape: "1536x1024", square: "1024x1024", portrait: "1024x1536" },
        supports: ["prompt", "size", "n", "quality"],
        editSupports: ["prompt", "image[]", "size", "n", "quality"],
        maxReferenceImages: 16
      }
    },
    {
      id: "gpt-image-2-high",
      label: "GPT Image 2 High",
      aliases: ["gpt-image-2-high", "gpt-image-high", "openai-high", "high"],
      description: "Highest-fidelity OpenAI GPT Image 2 generation tier.",
      openai: {
        apiModel: "gpt-image-2",
        quality: "high",
        sizes: { landscape: "1536x1024", square: "1024x1024", portrait: "1024x1536" },
        supports: ["prompt", "size", "n", "quality"],
        editSupports: ["prompt", "image[]", "size", "n", "quality"],
        maxReferenceImages: 16
      }
    }
  ]
};

export function defaultImageModel(provider: ImageGenerationProvider): string {
  if (provider === "byteplus") return DEFAULT_BYTEPLUS_IMAGE_MODEL;
  if (provider === "openai") return DEFAULT_OPENAI_IMAGE_MODEL;
  return DEFAULT_FAL_IMAGE_MODEL;
}

export function defaultImageApiKeyEnv(provider: ImageGenerationProvider): string {
  if (provider === "byteplus") return "BYTEPLUS_ARK_API_KEY";
  if (provider === "openai") return "OPENAI_API_KEY";
  return "FAL_KEY";
}

export function defaultImageBaseUrl(provider: ImageGenerationProvider): string {
  if (provider === "byteplus") return BYTEPLUS_IMAGE_BASE_URL;
  if (provider === "openai") return OPENAI_IMAGE_BASE_URL;
  return FAL_IMAGE_BASE_URL;
}

export function resolveImageModel(provider: ImageGenerationProvider, value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const normalized = value.trim().toLowerCase();
  const option = IMAGE_MODEL_OPTIONS[provider].find((candidate) =>
    candidate.id.toLowerCase() === normalized ||
    candidate.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
  return option?.id ?? value;
}

export function imageModelOption(provider: ImageGenerationProvider, value: string | undefined): ImageModelOption | undefined {
  const resolved = resolveImageModel(provider, value);
  if (resolved === undefined) return undefined;
  return IMAGE_MODEL_OPTIONS[provider].find((candidate) => candidate.id === resolved);
}
