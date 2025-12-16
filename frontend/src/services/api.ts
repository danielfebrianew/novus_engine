// services/api.ts
import axios from "axios";
import { 
  UploadResponse, 
  AnalyzeRequest, 
  AnalyzeResponse, 
  GenerateVideoRequest, 
  GenerateVideoResponse 
} from "@/types/api";

const API_BASE_URL = "http://localhost:3000/api/v1/generate";

// Instance axios standar
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const apiService = {
  // 1. Upload Images
  uploadImages: async (files: File[]): Promise<string[]> => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const res = await apiClient.post<UploadResponse>("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    // Handle potential wrapper dari backend (jika ada nesting data.data)
    const responseData = res.data as any;
    const actualData = responseData.data || responseData;
    
    if (!actualData.imageUrls) throw new Error("Format response upload tidak valid");
    return actualData.imageUrls;
  },

  // 2. Analyze Image (Generate Text)
  analyzeImage: async (payload: AnalyzeRequest) => {
    const res = await apiClient.post<AnalyzeResponse>("/text", {
      promptCount: 4, // default value
      ...payload
    });

    const responseData = res.data as any;
    return responseData.data || responseData; 
  },

  // 3. Generate Video
  generateVideo: async (payload: GenerateVideoRequest) => {
    // Timeout 15 menit karena proses video lama
    const res = await apiClient.post<GenerateVideoResponse>("/video", payload, {
      timeout: 900000, 
    });

    const responseData = res.data as any;
    return responseData.data || responseData;
  },

  // Helper untuk URL SSE (Event Source tidak pakai Axios)
  getProgressUrl: (jobId: string) => {
    return `${API_BASE_URL}/progress/${jobId}`;
  }
};