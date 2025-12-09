// src/types/api.ts

// Response dari endpoint /upload
export interface UploadResponse {
  message: string;
  imageUrls: string[]; // Array URL S3
}

// Response dari endpoint /text
export interface TextAnalysisResponse {
  voiceover: string;
  tiktokCaption: string;
  videoPrompts: string[];
}

// Request Body untuk endpoint /video
export interface GenerateVideoRequest {
  images: string[];
  prompts: string[];
  script: string;
}

// Response dari endpoint /video (Sesuai JSON kamu)
export interface VideoGenerationResponse {
  statusCode: number;
  message: string;
  data: {
    jobId: string;
    totalVariations: number;
    variations: string[]; // Array URL Video S3
  };
}