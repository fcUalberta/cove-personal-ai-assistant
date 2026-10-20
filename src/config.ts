import { resolve } from "node:path";

export interface AppConfig {
  port: number;
  dataDirectory: string;
  localModel: {
    baseUrl?: string;
    model: string;
  };
  cloudModel: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  google: {
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
  };
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 4312),
    dataDirectory: resolve(process.cwd(), ".data"),
    localModel: {
      baseUrl: process.env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1",
      model: process.env.LOCAL_LLM_MODEL ?? "llama3.1:8b",
    },
    cloudModel: {
      enabled: process.env.CLOUD_ESCALATION_ENABLED === "true",
      baseUrl: process.env.CLOUD_LLM_BASE_URL,
      apiKey: process.env.CLOUD_LLM_API_KEY,
      model: process.env.CLOUD_LLM_MODEL,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://127.0.0.1:4312/api/integrations/google/callback",
    },
  };
}
