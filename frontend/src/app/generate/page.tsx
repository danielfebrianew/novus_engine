"use client";

import { useState, useRef, useEffect } from "react";
import { UploadCloud, CheckCircle, Loader2, Play, AlertCircle, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import toast, { Toaster } from 'react-hot-toast';
import ImageCropper from "@/components/ImageCropper";

// Import Service yang baru dibuat
import { apiService } from "@/services/api";
import { ProgressData } from "@/types/api";

// --- UTILS (Dipindahkan ke luar komponen) ---
const blobToFile = (theBlob: Blob, fileName: string): File => {
  const extension = fileName.substring(fileName.lastIndexOf('.'));
  const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
  const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9-]/g, '_');
  const finalName = `${cleanName}_${new Date().getTime()}${extension}`;
  
  return new File([theBlob], finalName, {
    lastModified: new Date().getTime(),
    type: theBlob.type
  });
};

export default function VideoGeneratorPage() {
  // --- HYDRATION CHECK ---
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

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
  
  // Form Inputs
  const [productName, setProductName] = useState("");
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
      e.target.value = ""; // Reset input
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

  // --- API HANDLERS (Refactored) ---

  const handleProcessImages = async () => {
    if (readyFiles.length === 0) return toast.error("Belum ada foto yang dipilih!");
    if (!productName.trim()) return toast.error("Nama produk wajib diisi!");

    setLoading(true);
    const toastId = toast.loading("Mengupload gambar...");
    setLoadingMsg("Mengupload gambar...");

    try {
      // 1. Upload Images
      const urls = await apiService.uploadImages(readyFiles);
      setUploadedImageUrls(urls);
      
      toast.loading("Menganalisa visual & membuat script...", { id: toastId });
      setLoadingMsg("Menganalisa gambar & membuat script...");

      // 2. Analyze (Generate Text) - Ambil gambar pertama sebagai referensi
      const aiContent = await apiService.analyzeImage({
        imageUrl: urls[0],
        productName: productName
      });

      setScript(aiContent.voiceover);
      setCaption(aiContent.tiktokCaption);
      setPrompts(aiContent.videoPrompts);

      toast.success("Analisa Selesai!", { id: toastId });
      setStep(2);

    } catch (error) {
      console.error("[Process Error]:", error);
      toast.error("Gagal memproses gambar/analisa.", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVideo = async () => {
    setStep(3);
    setLoading(true);
    setProgressValue(0);

    const jobId = `JOB-${Date.now()}`;
    // Setup SSE
    const eventSource = new EventSource(apiService.getProgressUrl(jobId));

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const data: ProgressData = parsed.data ?? parsed;

        if (data.message) setLoadingMsg(data.message);
        if (typeof data.progress === 'number') setProgressValue(data.progress);
        if (data.message?.includes("COMPLETED")) setProgressValue(100);
      } catch (e) { console.error("SSE Parse Error", e); }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    const processToast = toast.loading("Sedang memproses video...");

    try {
      const resultData = await apiService.generateVideo({
        images: uploadedImageUrls,
        prompts,
        script,
        jobId
      });

      setResults(resultData.variations);
      setStep(4);
      toast.success("Video Selesai!", { id: processToast });

    } catch (error) {
      console.error("Generate Video Error:", error);
      toast.error("Gagal Generate Video.", { id: processToast });
      setStep(2); // Kembali ke step review jika gagal
    } finally {
      setLoading(false);
      eventSource.close();
    }
  };

  // --- RENDERERS ---

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8 font-sans text-slate-900">
      <Toaster position="top-center" reverseOrder={false} />

      {/* HEADER & INPUT FORM AREA */}
      <div className="max-w-xl mx-auto mb-10 text-center space-y-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">AI Video Generator</h1>
          <p className="text-slate-500">Upload foto produk, crop 9:16, biarkan AI bekerja.</p>
        </div>

        {/* Input Form yang dirapikan */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 text-left">
          <label className="text-sm font-semibold text-slate-700 ml-1">
            Nama Produk / Brand <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            placeholder="Contoh: Sepatu Lari Nike Zoom Air"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            disabled={loading || step > 1} // Disable saat loading atau sudah lewat step 1
            className="bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
          />
        </div>
      </div>

      <ImageCropper
        isOpen={cropperOpen}
        imageSrc={cropperImgSrc}
        onClose={() => setCropperOpen(false)}
        onCropComplete={onCropFinished}
      />

      <div className="max-w-5xl mx-auto space-y-8">

        {/* STEP 1: UPLOAD & CROP */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <Card className="border-dashed border-2 border-slate-300 shadow-none bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="p-4 bg-white shadow-sm rounded-full">
                  {loading ? <Loader2 className="h-8 w-8 text-blue-500 animate-spin" /> : <UploadCloud className="h-8 w-8 text-blue-500" />}
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-semibold text-slate-800">Tambah Foto Produk</h3>
                  <p className="text-sm text-slate-500 max-w-sm mx-auto">
                    Format: JPG/PNG. Rasio crop otomatis 9:16.
                  </p>
                </div>
                
                <div className="relative mt-4">
                  <Button variant="outline" className="cursor-pointer border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800">
                    Pilih File Gambar
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onSelectFile}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={loading}
                  />
                </div>
              </CardContent>
            </Card>

            {/* List Foto Preview */}
            {readyFiles.length > 0 && (
              <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">Siap Upload ({readyFiles.length})</h3>
                    <Button 
                      size="sm" 
                      onClick={handleProcessImages} 
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Lanjut Proses
                    </Button>
                 </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {readyFiles.map((file, idx) => (
                    <div key={idx} className="relative group aspect-9/16 bg-white rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                      <img
                        src={URL.createObjectURL(file)}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-600 shadow-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="absolute bottom-0 w-full bg-linear-to-t from-black/60 to-transparent text-white text-[10px] p-2 text-center pt-4">
                        Img {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: REVIEW */}
        {step === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">
             {/* ... (Kode UI step 2 sama, hanya logic handlerGenerateVideo yang berubah di atas) ... */}
             {/* Copy Paste bagian UI Step 2 kamu yang lama, tidak ada perubahan UI signifikan disini selain handler */}
             <Card className="flex flex-col h-full">
               <CardHeader>
                 <CardTitle>Social Media Caption</CardTitle>
                 <CardDescription>Generated by AI based on your product image.</CardDescription>
               </CardHeader>
               <CardContent className="flex-1 flex flex-col gap-4">
                 <Textarea 
                   value={caption} 
                   onChange={(e) => setCaption(e.target.value)} 
                   className="flex-1 min-h-[200px] resize-none"
                 />
                 <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(caption); toast.success("Copied!"); }}>
                   <Copy className="mr-2 h-4 w-4" /> Copy Caption
                 </Button>
               </CardContent>
             </Card>

             <Card className="flex flex-col h-full">
               <CardHeader>
                 <CardTitle>Visual Prompts</CardTitle>
                 <CardDescription>AI generated prompts for video generation.</CardDescription>
               </CardHeader>
               <CardContent className="space-y-3 flex-1 overflow-y-auto max-h-[300px]">
                 {prompts.map((p, i) => (
                   <div key={i} className="p-3 bg-slate-100 rounded text-sm text-slate-700 border border-slate-200">
                     <span className="font-bold text-slate-400 mr-2">#{i+1}</span> {p}
                   </div>
                 ))}
               </CardContent>
               <div className="p-6 pt-0 border-t mt-auto">
                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                    <Button onClick={handleGenerateVideo} className="flex-1 bg-blue-600 hover:bg-blue-700">
                      <Play className="w-4 h-4 mr-2" /> Generate Video
                    </Button>
                  </div>
               </div>
             </Card>
          </div>
        )}

        {/* STEP 3: LOADING PROGRESS */}
        {step === 3 && (
           /* Gunakan UI Step 3 yang lama, logic progress value sudah di handle di state */
           <Card className="py-20 animate-in fade-in duration-500 border-none shadow-none bg-transparent">
             <CardContent className="flex flex-col items-center justify-center space-y-8">
               <div className="relative">
                 <div className="absolute inset-0 bg-blue-200 rounded-full animate-ping opacity-75"></div>
                 <div className="relative p-6 bg-white rounded-full shadow-lg border border-blue-100">
                   <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />
                 </div>
               </div>
               <div className="text-center space-y-2">
                 <h3 className="text-2xl font-bold text-slate-800">Generating Video...</h3>
                 <p className="text-slate-500">{loadingMsg}</p>
               </div>
               <div className="w-full max-w-md space-y-2">
                 <Progress value={progressValue} className="h-2" />
                 <div className="flex justify-between text-xs text-slate-400">
                   <span>Processing</span>
                   <span>{progressValue}%</span>
                 </div>
               </div>
               <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-4 py-2 rounded-full border border-amber-100">
                  <AlertCircle className="w-4 h-4" /> Jangan tutup halaman ini.
               </div>
             </CardContent>
           </Card>
        )}

        {/* STEP 4: RESULTS */}
        {step === 4 && (
          /* UI Step 4 tetap sama */
          <div className="space-y-6 animate-in slide-in-from-bottom-10 duration-500">
             <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
               <div>
                 <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                   <CheckCircle className="text-green-500" /> Selesai!
                 </h2>
               </div>
               <Button onClick={() => window.location.reload()}>Buat Baru</Button>
             </div>
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {results.map((url, idx) => (
                  <div key={idx} className="bg-black rounded-lg overflow-hidden aspect-9/16 shadow-lg">
                    <video src={url} controls className="w-full h-full object-cover" />
                  </div>
                ))}
             </div>
          </div>
        )}

      </div>
    </div>
  );
}