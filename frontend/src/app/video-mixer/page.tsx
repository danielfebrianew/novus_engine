"use client"

import { useState, useEffect } from "react" // Tambahkan useEffect
import axios from "axios"
import { Upload, FileVideo, FileAudio, X, Loader2, CheckCircle2, Film } from "lucide-react"
import toast, { Toaster } from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function VideoMixerPage() {
  // --- FIX HYDRATION ERROR START ---
  // Kita tambahkan state untuk memastikan komponen sudah dimuat di browser
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])
  // --- FIX HYDRATION ERROR END ---

  const [loading, setLoading] = useState(false)
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [audioFile, setAudioFile] = useState<File | null>(null)
  
  // State baru sesuai backend
  const [variations, setVariations] = useState<number>(1)
  const [generatedPaths, setGeneratedPaths] = useState<string[]>([])

  // 1. Handle Video Selection (Min 2, Max 6 sesuai backend)
  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      const totalFiles = videoFiles.length + newFiles.length

      if (totalFiles > 6) {
        toast.error("Maksimal hanya boleh 6 video!")
        return
      }

      const validVideos = newFiles.filter(file => file.type.startsWith("video/"))
      if (validVideos.length !== newFiles.length) {
        toast.error("Beberapa file bukan video dan diabaikan.")
      }

      setVideoFiles((prev) => [...prev, ...validVideos])
    }
  }

  // 2. Remove Video
  const removeVideo = (index: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 3. Handle Audio Selection
  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0])
    }
  }

  // 4. SUBMIT PROSES
  const handleSubmit = async () => {
    // Validasi Constraints Backend
    if (videoFiles.length < 2) {
      toast.error("Minimal harus upload 2 video!")
      return
    }
    if (!audioFile) {
      toast.error("Wajib upload 1 file audio!")
      return
    }

    setLoading(true)
    setGeneratedPaths([]) // Reset hasil sebelumnya
    const loadingToast = toast.loading(`Sedang memproses stitching ${variations} variasi...`)

    try {
      const formData = new FormData()

      // Append Videos (Key: 'clips' sesuai Controller NestJS)
      videoFiles.forEach((file) => {
        formData.append("clips", file) 
      })

      // Append Audio (Key: 'audio')
      formData.append("audio", audioFile)

      // Append Variations (Key: 'variations')
      formData.append("variations", variations.toString())

      // --- REQUEST AXIOS ---
      // Note: Backend kita return JSON berisi path, bukan Blob ZIP
      const response = await axios.post("http://localhost:3000/api/v1/video-mix", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 0, // Infinity, karena proses video lama
      })

      // Handle Success
      if (response.data.success) {
        toast.success("Video berhasil di-stitch!")
        setGeneratedPaths(response.data.files) // Simpan path untuk ditampilkan
      }

    } catch (error: any) {
      console.error(error)
      const msg = error.response?.data?.message || "Terjadi kesalahan koneksi ke server."
      toast.error(`Gagal: ${msg}`)
    } finally {
      toast.dismiss(loadingToast)
      setLoading(false)
    }
  }

  // --- FIX HYDRATION ERROR CHECK ---
  // Mencegah render HTML sebelum client siap
  if (!isMounted) {
    return null
  }

  return (
    <div className="container mx-auto max-w-3xl py-10 px-4">
      <Toaster position="top-center" />
      
      <Card className="shadow-lg border-slate-200">
        <CardHeader className="bg-slate-50 border-b">
          <CardTitle className="text-2xl flex items-center gap-2">
            <Film className="w-6 h-6 text-blue-600"/>
            NovaMix Video Mixer
          </CardTitle>
          <CardDescription>
            Upload klip video & audio. NovaMix akan memprosesnya di laptopmu.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6 pt-6">
          
          {/* --- INPUT VIDEOS --- */}
          <div className="space-y-2">
            <Label>Upload Video Clips (Max 6)</Label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition cursor-pointer relative group">
              <Input 
                type="file" 
                multiple 
                accept="video/*" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={handleVideoChange}
                disabled={loading}
              />
              <div className="bg-blue-50 p-3 rounded-full mb-3 group-hover:scale-110 transition-transform">
                <Upload className="h-6 w-6 text-blue-500" />
              </div>
              <p className="text-sm font-medium text-slate-700">Klik untuk upload video</p>
              <p className="text-xs text-slate-400 mt-1">{videoFiles.length} / 6 file terpilih</p>
            </div>

            {/* List Video Terpilih */}
            {videoFiles.length > 0 && (
              <div className="grid grid-cols-1 gap-2 mt-4">
                {videoFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-slate-100 rounded-md border text-sm">
                    <div className="flex items-center truncate gap-3">
                      <div className="bg-slate-200 p-1 rounded">
                         <FileVideo className="h-4 w-4 text-slate-600" />
                      </div>
                      <span className="truncate max-w-[200px] font-medium text-slate-700">{file.name}</span>
                      <span className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-100 hover:text-red-600" onClick={() => removeVideo(idx)} disabled={loading}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* --- INPUT AUDIO --- */}
            <div className="space-y-2">
              <Label>Background Audio</Label>
              <div className="relative">
                <Input 
                  type="file" 
                  accept="audio/*" 
                  onChange={handleAudioChange}
                  disabled={loading}
                  className="cursor-pointer"
                />
              </div>
              {audioFile && (
                 <div className="flex items-center p-2 bg-green-50 text-green-700 rounded text-sm border border-green-200 mt-2">
                    <FileAudio className="h-4 w-4 mr-2" />
                    <span className="truncate">{audioFile.name}</span>
                 </div>
              )}
            </div>

            {/* --- INPUT VARIATIONS --- */}
            <div className="space-y-2">
              <Label>Jumlah Variasi Output</Label>
              <Input 
                type="number" 
                min={1} 
                max={10}
                value={variations}
                onChange={(e) => setVariations(parseInt(e.target.value) || 1)}
                disabled={loading}
              />
              <p className="text-[10px] text-slate-500">Berapa banyak video unik yang ingin dibuat?</p>
            </div>
          </div>

          {/* --- SUBMIT BUTTON --- */}
          <Button 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white" 
            size="lg" 
            onClick={handleSubmit} 
            disabled={loading || videoFiles.length < 2 || !audioFile}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sedang Memproses di Laptop...
              </>
            ) : (
              <>
                <Film className="mr-2 h-4 w-4" />
                Mulai Mixing
              </>
            )}
          </Button>

          {/* --- RESULTS AREA --- */}
          {generatedPaths.length > 0 && (
            <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="text-green-600 h-5 w-5"/>
                <h3 className="font-semibold text-green-800">Proses Selesai!</h3>
              </div>
              <p className="text-sm text-green-700 mb-2">File tersimpan di folder laptop lokal:</p>
              <ul className="space-y-1">
                {generatedPaths.map((path, i) => (
                  <li key={i} className="text-xs font-mono bg-white p-2 rounded border border-green-100 text-slate-600 break-all">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  )
}