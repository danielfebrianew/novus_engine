"use client";

import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { UploadCloud, CheckCircle, Loader2, Play, AlertCircle, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import toast, { Toaster } from 'react-hot-toast';
import ImageCropper from "@/components/ImageCropper";

import type { UploadResponse, TextAnalysisResponse, VideoGenerationResponse } from "@/types/api";

const blobToFile = (theBlob: Blob, fileName: string): File => {
  return new File([theBlob], fileName, { lastModified: new Date().getTime(), type: theBlob.type });
}

export default function VideoGeneratorPage() {

  // --- HYDRATION FIX ---
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- STATES ---
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [progressValue, setProgressValue] = useState(0);

  // Data State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImgSrc, setCropperImgSrc] = useState<string | null>(null);
  const [readyFiles, setReadyFiles] = useState<File[]>([]);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  
  // These are the state variables causing issues - they must be defined here
  const [script, setScript] = useState("");
  const [caption, setCaption] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  
  const [results, setResults] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- HANDLERS ---

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);

      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setCropperImgSrc(reader.result?.toString() || null);
        setCropperOpen(true);
      });
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const onCropFinished = (croppedBlob: Blob) => {
    if (selectedFile) {
      const croppedFile = blobToFile(croppedBlob, selectedFile.name);
      setReadyFiles(prev => [...prev, croppedFile]);
      toast.success("Foto berhasil dipotong!");
    }
  };

  const removeFile = (index: number) => {
    setReadyFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadToBackend = async () => {
    if (readyFiles.length === 0) {
      toast.error("Belum ada foto yang dipilih!");
      return;
    }

    setLoading(true);
    const loadingToast = toast.loading("Mengupload gambar ke S3...");
    setLoadingMsg("Mengupload gambar...");

    const formData = new FormData();
    readyFiles.forEach((file) => {
      formData.append("files", file);
    });

    try {
      const res = await axios.post<UploadResponse>("http://localhost:3000/api/v1/generate/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      // Handle potential response wrapping
      const responseData = res.data as any;
      const actualData = responseData.data || responseData;
      const urls = actualData.imageUrls;

      if (!urls || !Array.isArray(urls)) {
         throw new Error("Gagal mendapatkan URL gambar.");
      }

      setUploadedImageUrls(urls);
      toast.success(`${urls.length} Gambar berhasil diupload!`, { id: loadingToast });
      
      // Analyze the FIRST image
      await analyzeImage(urls[0]);

    } catch (error) {
      console.error("[Client] Upload Error:", error);
      toast.error("Gagal Upload Gambar.", { id: loadingToast });
      setLoading(false);
    }
  };

  const analyzeImage = async (imageUrl: string) => {
    const loadingToast = toast.loading("AI sedang menganalisa visual...");
    setLoadingMsg("Menganalisa gambar & membuat script...");

    try {
      const res = await axios.post("http://localhost:3000/api/v1/generate/text", {
        imageUrl: imageUrl,
        promptCount: 4
      });

      const responseData = res.data as any;
      const aiContent = responseData.data || responseData;

      setScript(aiContent.voiceover);
      setCaption(aiContent.tiktokCaption);
      setPrompts(aiContent.videoPrompts);

      toast.success("Analisa Selesai!", { id: loadingToast });
      setStep(2);

    } catch (error) {
      console.error("[Client] Analysis Error:", error);
      toast.error("Gagal Analisa AI", { id: loadingToast });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCaption = () => {
    navigator.clipboard.writeText(caption);
    toast.success("Caption berhasil disalin!");
  };

  const handleGenerateVideo = async () => {
    setStep(3); 
    setLoading(true);
    setProgressValue(0); 
    
    // 1. Create a unique Job ID
    const jobId = `JOB-${Date.now()}`;
    console.log("Job ID:", jobId);

    // 2. Setup SSE (Event Source) - Listen for Progress
    // Use the backend URL
    const eventSource = new EventSource(`http://localhost:3000/api/v1/generate/progress/${jobId}`);

    eventSource.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log("SSE Data received:", data);

        // 1. Update Message jika ada
        if (data.message) {
            setLoadingMsg(data.message);
        }

        // 2. Update Progress HANYA jika datanya berupa angka valid
        // Kita cek apakah 'progress' ada di dalam data dan tipenya number
        if (data.progress !== undefined && data.progress !== null && !isNaN(data.progress)) {
            setProgressValue(data.progress);
        } 
        // Opsional: Kalau backend kirim data.status = 'COMPLETED', paksa 100%
        else if (data.message && data.message.includes("COMPLETED")) {
             setProgressValue(100);
        }

    } catch (e) {
        console.error("Error parsing SSE data:", e);
    }
};

    eventSource.onerror = (err) => {
        // SSE error event doesn't always contain a clear error object.
        // It's often just a generic Event.
        console.error("SSE Connection Error (Stream might have closed):", err);
        eventSource.close();
    };

    // 3. Send POST Request
    const processToast = toast.loading("Sedang memproses video... Jangan tutup browser.");

    try {
      const payload = {
        images: uploadedImageUrls,
        prompts: prompts,
        script: script,
        jobId: jobId 
      };

      // Increase timeout significantly for long processes
      const res = await axios.post<VideoGenerationResponse>(
        "http://localhost:3000/api/v1/generate/video", 
        payload,
        { timeout: 900000 } // 15 minutes
      );

      // Handle NestJS wrapper if present
      const responseData = res.data as any;
      const resultData = responseData.data || responseData;

      setResults(resultData.variations);
      setStep(4); 
      toast.success("Video Selesai Dibuat!", { id: processToast });

    } catch (error) {
      console.error("Generate Video Error:", error);
      toast.error("Gagal Generate Video.", { id: processToast });
      setStep(2); 
    } finally {
      setLoading(false);
      eventSource.close(); // Ensure SSE is closed when done
    }
  };

  // --- RENDERERS ---

  if (!isMounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <Toaster position="top-center" reverseOrder={false} />

      <ImageCropper 
        isOpen={cropperOpen}
        imageSrc={cropperImgSrc}
        onClose={() => setCropperOpen(false)}
        onCropComplete={onCropFinished}
      />

      <div className="max-w-5xl mx-auto space-y-8">
        
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">AI Video Generator</h1>
          <p className="text-slate-500">Upload foto produk, crop 9:16, biarkan AI bekerja.</p>
        </div>

        {/* STEP 1: UPLOAD & CROP */}
        {step === 1 && (
          <div className="space-y-6">
            <Card className="border-dashed border-2 border-slate-300 shadow-sm bg-white">
                <CardContent className="flex flex-col items-center justify-center py-10 space-y-4">
                <div className="p-4 bg-blue-50 rounded-full">
                    {loading ? <Loader2 className="h-10 w-10 text-blue-500 animate-spin" /> : <UploadCloud className="h-10 w-10 text-blue-500" />}
                </div>
                <div className="text-center">
                    <h3 className="text-lg font-semibold">{loading ? "Sedang Memproses..." : "Tambah Foto Produk"}</h3>
                    <p className="text-sm text-slate-500 max-w-sm mt-1 mx-auto">
                    Pilih foto satu per satu untuk di-crop manual agar hasil maksimal (Rasio 9:16).
                    </p>
                </div>
                {!loading && (
                    <div className="relative mt-4">
                    <Button size="lg" className="cursor-pointer">Pilih Foto</Button>
                    <input 
                        ref={fileInputRef}
                        type="file" 
                        accept="image/*"
                        onChange={onSelectFile}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    </div>
                )}
                </CardContent>
            </Card>

            {/* List Foto */}
            {readyFiles.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {readyFiles.map((file, idx) => (
                        <div key={idx} className="relative group aspect-9/16 bg-slate-200 rounded-lg overflow-hidden border border-slate-300">
                            <img 
                                src={URL.createObjectURL(file)} 
                                alt="Preview" 
                                className="w-full h-full object-cover"
                            />
                            <button 
                                onClick={() => removeFile(idx)}
                                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="absolute bottom-0 w-full bg-black/50 text-white text-xs p-1 text-center truncate">
                                Foto #{idx + 1}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {readyFiles.length > 0 && !loading && (
                <div className="flex justify-end">
                    <Button size="lg" onClick={handleUploadToBackend} className="w-full md:w-auto">
                        Lanjut: Analisa & Generate ({readyFiles.length} Foto)
                    </Button>
                </div>
            )}
          </div>
        )}

        {/* STEP 2: REVIEW CAPTION & PROMPTS */}
        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in zoom-in duration-300">
            
            {/* KARTU KIRI: CAPTION (Edit & Copy) */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Social Media Caption</CardTitle>
                <CardDescription>Edit caption ini lalu copy untuk postinganmu.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4">
                <Textarea 
                  value={caption} 
                  onChange={(e) => setCaption(e.target.value)} 
                  rows={12} 
                  className="text-base leading-relaxed resize-none flex-1"
                  placeholder="Caption akan muncul di sini..."
                />
                <Button variant="secondary" onClick={handleCopyCaption} className="w-full">
                  <Copy className="mr-2 h-4 w-4" /> Copy Caption
                </Button>
              </CardContent>
            </Card>

            {/* KARTU KANAN: PROMPTS (Read Only) */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Visual Prompts ({prompts.length})</CardTitle>
                <CardDescription>Variasi shot yang akan dibuat oleh AI.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[400px] overflow-y-auto pr-2 flex-1">
                {prompts.map((prompt, idx) => (
                  <div key={idx} className="flex gap-3 items-start bg-slate-100 p-3 rounded-md text-sm border border-slate-200">
                    <span className="font-bold text-slate-400 shrink-0">#{idx + 1}</span>
                    <span className="text-slate-700">{prompt}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* TOMBOL ACTION */}
            <div className="col-span-1 md:col-span-2 flex justify-end gap-3 pt-4 border-t">
               <Button variant="outline" onClick={() => setStep(1)} disabled={loading}>
                 Ulang Upload
               </Button>
               <Button size="lg" onClick={handleGenerateVideo} className="w-full md:w-auto bg-blue-600 hover:bg-blue-700" disabled={loading}>
                 <Play className="mr-2 h-4 w-4" /> Generate {prompts.length * 5} Video
               </Button>
            </div>
          </div>
        )}

        {/* STEP 3: LOADING UI */}
        {step === 3 && (
          <Card className="py-20 animate-in fade-in duration-500">
             <CardContent className="flex flex-col items-center justify-center space-y-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-200 rounded-full animate-ping opacity-75"></div>
                  <div className="relative p-6 bg-white rounded-full shadow-lg border border-blue-100">
                    <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold text-slate-800">Sedang Meracik Video...</h3>
                  <p className="text-slate-500 max-w-md mx-auto">{loadingMsg}</p>
                  
                  <div className="pt-4 flex justify-center">
                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-4 py-2 rounded-full border border-amber-100">
                        <AlertCircle className="w-4 h-4" />
                        Mohon jangan tutup halaman ini.
                    </div>
                  </div>
                </div>
                <Progress value={progressValue} className="w-[60%] h-2" />
                <p className="text-xs text-slate-400">{progressValue || 0}%</p> 
             </CardContent>
          </Card>
        )}

        {/* STEP 4: RESULTS */}
        {step === 4 && (
          <div className="space-y-6 animate-in slide-in-from-bottom-10 duration-500">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
               <div>
                 <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-800">
                   <CheckCircle className="text-green-500" /> Selesai!
                 </h2>
                 <p className="text-slate-500 text-sm">Berhasil membuat {results.length} variasi video.</p>
               </div>
               <Button onClick={() => window.location.reload()}>Buat Baru</Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.map((url, idx) => (
                <div key={idx} className="group relative bg-black rounded-lg overflow-hidden shadow-md aspect-9/16">
                  <video 
                    src={url} 
                    controls 
                    className="w-full h-full object-cover" 
                    preload="metadata"
                  />
                  <div className="absolute top-0 left-0 w-full p-2 bg-linear-to-b from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-xs text-white font-medium">Var #{idx + 1}</p>
                  </div>
                  <div className="absolute bottom-0 left-0 w-full p-2 bg-white/90 translate-y-full group-hover:translate-y-0 transition-transform">
                    <a 
                      href={url} 
                      target="_blank" 
                      download={`video_variation_${idx+1}.mp4`}
                      className="text-xs font-bold text-center block text-blue-600 hover:text-blue-800"
                    >
                      Download MP4
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}