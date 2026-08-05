import { GoogleGenAI } from "@google/genai";

import { serverEnv } from "../../lib/server-env.server.ts";

export type GeminiModelConfig = {
  planningModel: string;
  videoReviewModel: string;
};

export type GeminiClient = Pick<GoogleGenAI, "interactions" | "files">;

export function getGeminiModelConfig(): GeminiModelConfig {
  return {
    planningModel: serverEnv("GEMINI_PLANNING_MODEL") ?? "gemini-3.6-flash",
    videoReviewModel: serverEnv("GEMINI_VIDEO_REVIEW_MODEL") ?? "gemini-3.6-flash",
  };
}

export function createGeminiClient(): GeminiClient {
  const apiKey = serverEnv("GEMINI_API_KEY");
  if (!apiKey || apiKey.length < 8) {
    throw new Error("GEMINI_API_KEY is not configured in the server environment.");
  }
  return new GoogleGenAI({ apiKey });
}
