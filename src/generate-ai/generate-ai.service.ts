import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import AdmZip from 'adm-zip';
import { VideoUtilsHelper } from './helpers/video-utils.helper';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { pipeline } from 'stream/promises'; // Ensure this is imported if used in _downloadFile (though logic is in helper now)

@Injectable()
export class GenerateAiService implements OnModuleInit {
  private readonly logger = new Logger(GenerateAiService.name);
  private openai: OpenAI;
  private gemini: GoogleGenAI;
  private tempDir = './temp';
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    private configService: ConfigService,
    private videoUtilsHelper: VideoUtilsHelper
  ) {
    this.logger.log("🔄 Initializing GenerateAiService...");

    // 1. Init OpenAI
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!openAiKey) throw new Error("OPENAI_API_KEY is missing");
    this.openai = new OpenAI({ apiKey: openAiKey });
    
    // 2. Init Gemini
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
        this.gemini = new GoogleGenAI({ apiKey: geminiKey });
    } else {
        throw new Error("GEMINI_API_KEY is missing");
    }

    // 3. Ensure Temp Directory
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir);

    // 4. Init AWS S3 (DENGAN LOGGING & VALIDASI)
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    
    // Ambil bucket name ke variabel lokal dulu
    const bucket = this.configService.get<string>('AWS_BUCKET_NAME');

    this.logger.log(`Checking AWS Config -> Region: ${region}, Bucket: ${bucket}`);

    // Validasi Manual: Pastikan semua variabel ada
    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error("⚠️ AWS S3 Configuration is MISSING in .env file!");
    }

    // Assign ke property class SETELAH validasi sukses
    this.bucketName = bucket;

    try {
        this.s3Client = new S3Client({
            region: region,
            credentials: {
                accessKeyId: accessKeyId,
                secretAccessKey: secretAccessKey,
            },
        });
        this.logger.log(`✅ AWS S3 Client Initialized! Bucket: ${this.bucketName}`);
    } catch (err) {
        this.logger.error("❌ Failed to initialize S3 Client:", err);
        throw err;
    }
  }

  // --- Auto Cleanup Temp Folder saat Server Start ---
  async onModuleInit() {
    this.cleanTempFolder();
  }

  private cleanTempFolder() {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      const files = fs.readdirSync(this.tempDir);
      if (files.length > 0) {
        this.logger.warn(`🧹 Membersihkan ${files.length} file sampah di temp...`);
        for (const file of files) {
          if (file.endsWith('.mp4') || file.endsWith('.zip') || file.endsWith('.wav')) {
             fs.unlinkSync(path.join(this.tempDir, file));
          }
        }
      }
    } catch (error) {
      this.logger.error('Gagal clean temp folder:', error);
    }
  }

  // =================================================================
  // UPLOAD HELPER (S3)
  // =================================================================
  private async _uploadToS3(fileInput: string | Buffer, fileName: string, contentType: string): Promise<string> {
    if (!this.s3Client) throw new InternalServerErrorException("S3 Client belum siap.");

    try {
      let body: Buffer<ArrayBufferLike>;
      if (typeof fileInput === 'string') {
          body = fs.readFileSync(fileInput); // Baca file dari disk jika inputnya path
      } else {
          body = fileInput; // Pakai buffer langsung jika dari upload
      }

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read', 
      }));

      const region = this.configService.get<string>('AWS_REGION');
      return `https://${this.bucketName}.s3.${region}.amazonaws.com/${fileName}`;
      
    } catch (error) {
      this.logger.error(`S3 Upload Error: ${error.message}`);
      throw new InternalServerErrorException("Gagal upload ke AWS S3");
    }
  }

  // =================================================================
  // PUBLIC: UPLOAD IMAGE (Updated with Auto-Crop)
  // =================================================================
  async uploadImages(files: Array<Express.Multer.File>) {
    try {
        const uploadedUrls: string[] = [];

        // Loop setiap file yang diupload
        for (const file of files) {
            // Nama file unik
            const fileName = `input_${Date.now()}_${Math.round(Math.random()*1000)}_${file.originalname}`;
            
            this.logger.log(`Uploading raw image (frontend cropped): ${fileName}`);

            // Langsung upload Buffer (Tanpa Sharp Crop)
            const publicUrl = await this._uploadToS3(file.buffer, fileName, file.mimetype);
            uploadedUrls.push(publicUrl);
        }
        
        return { 
            message: `${files.length} images uploaded successfully`,
            imageUrls: uploadedUrls 
        };
    } catch (error) {
        throw new InternalServerErrorException("Gagal upload image: " + error.message);
    }
  }

  // =================================================================
  // A. PUBLIC METHOD: 1. ANALYZE IMAGE (OpenAI)
  // =================================================================
  async generateText(imageUrl: string, count: number = 4) {
    this.logger.log(`OpenAI: Analyzing image for ${count} prompts...`);

    let finalImageUrl = imageUrl;

    let durationPrompt = "Target ≈20 detik (±35-40 kata)";
    switch (count) {
      case 4: durationPrompt = "Target ≈20 detik (±35-40 kata)"; break;
      case 5: durationPrompt = "Target ≈25 detik (±40-45 kata)"; break;
      case 6: durationPrompt = "Target ≈30 detik (±45-50 kata)"; break;
      default: throw new InternalServerErrorException('Count must be 4, 5, or 6');
    }

    const promptText = `
      Analisa gambar ini dengan TELITI dan detail visual yang jelas.
      
      Tugasmu adalah membuat 3 output dalam format JSON:
      
      1. "voiceover": 
         Naskah voiceover WILAYAH PADAT tapi TIDAK TERBURU-BURU. 
         Durasi: ${durationPrompt}. 
         Gunakan storytelling santai dan akrab. 
         Pakai kalimat mengalir. 
         WAJIB ditutup dengan ajakan: "Langsung cek keranjang kuning di bawah video ini."

      2. "tiktokCaption": 
         Caption TikTok FULL (1 paragraf). 
         Awali dengan headline clickbait. 
         Tambahkan 4–5 hashtag relevan.

      3. "videoPrompts": 
         Buatkan ARRAY berisi ${count} prompt visual berbeda dalam Bahasa Inggris. 
         Setiap prompt HARUS menggunakan angle/gerakan kamera BERBEDA (Close Up, Slow Pan Left, Zoom In, dll). 
         Fokus pada estetika produk.
      
      FORMAT OUTPUT WAJIB PERSIS JSON: 
      { "voiceover": "...", "tiktokCaption": "...", "videoPrompts": [...] }
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: finalImageUrl } }] }],
        response_format: { type: 'json_object' },
      });
      
      const content = response.choices[0].message.content;
      if (!content) throw new Error('OpenAI returned empty content');
      return JSON.parse(content);

    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('OpenAI Error');
    }
  }

  // =================================================================
  // B. PUBLIC METHOD: PROCESS VARIATIONS -> ZIP OUTPUT
  // =================================================================
  async processVideoVariations(images: string[], prompts: string[], script: string) {
    let cleanupFiles: string[] = [];
    const PROCESS_ID = `REQ_${Date.now()}`; 

    try {
      const totalClips = prompts.length;
      let targetVariations = 0;

      if (totalClips === 4) targetVariations = 20;      
      else if (totalClips === 5) targetVariations = 50; 
      else if (totalClips === 6) targetVariations = 100;
      else throw new Error("Jumlah prompt harus 4, 5, atau 6.");

      this.logger.log(`[${PROCESS_ID}] Start Engine: ${totalClips} clips -> ${targetVariations} vars`);

      // 1. GENERATE RAW CLIPS (Parallel - Sama seperti sebelumnya)
      const videoTasks = prompts.map((promptText, idx) => {
         // Logic Round Robin Image
         const selectedImage = images[idx] ? images[idx] : images[0]; 
         return this._generateSingleVideo(promptText, selectedImage, idx, PROCESS_ID)
            .then(url => ({ status: 'success', url, index: idx }))
            .catch(err => ({ status: 'failed', error: err, index: idx }));
      });

      const audioTask = this._generateAudio(script); 

      const [videoResults, audioPath] = await Promise.all([
        Promise.all(videoTasks),
        audioTask
      ]);
      cleanupFiles.push(audioPath);

      // 2. DOWNLOAD RAW CLIPS
      const successVideos = videoResults
        .filter((r): r is { status: 'success', url: string, index: number } => r.status === 'success')
        .sort((a, b) => a.index - b.index);

      if (successVideos.length !== totalClips) throw new Error("Gagal generate sebagian klip.");

      const rawClipPaths: string[] = [];
      for (const vid of successVideos) {
        const rawFileName = path.join(this.tempDir, `raw_${PROCESS_ID}_${vid.index}.mp4`);
        await this.videoUtilsHelper.downloadFile(vid.url, rawFileName);
        
        rawClipPaths.push(rawFileName);
        cleanupFiles.push(rawFileName);
      }

      // 3. STITCHING & UPLOAD PER VARIATION
      const uniqueOrders = this.videoUtilsHelper.generateUniqueShuffles(totalClips, targetVariations);
      this.logger.log(`[${PROCESS_ID}] Stitching & Uploading ${uniqueOrders.length} variations...`);

      const resultUrls: string[] = []; // Array untuk menampung URL hasil

      for (let i = 0; i < uniqueOrders.length; i++) {
        const order = uniqueOrders[i];
        const orderedPaths = order.map(index => rawClipPaths[index]);
        
        // A. Stitch Visual
        const tempVisualPath = path.join(this.tempDir, `vis_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(tempVisualPath);
        
        await this.videoUtilsHelper.mergeVideoFiles(orderedPaths, tempVisualPath);

        // B. Merge Audio (Final Video)
        const finalFileName = `VARIATION_${PROCESS_ID}_${i+1}.mp4`;
        const finalVarPath = path.join(this.tempDir, finalFileName);
        cleanupFiles.push(finalVarPath);
        
        await new Promise((resolve, reject) => {
            ffmpeg()
              .input(tempVisualPath)
              .input(audioPath)
              .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0'])
              .save(finalVarPath)
              .on('end', resolve)
              .on('error', reject);
        });

        // C. UPLOAD INDIVIDUAL VIDEO TO S3 (Ganti ZIP logic)
        this.logger.log(`[${PROCESS_ID}] Uploading Variant ${i+1}/${uniqueOrders.length}...`);
        
        // Upload file hasil merge (finalVarPath) ke S3
        const s3Url = await this._uploadToS3(finalVarPath, `results/${PROCESS_ID}/${finalFileName}`, 'video/mp4');
        
        resultUrls.push(s3Url);
      }

      // 4. CLEANUP & RETURN
      // Hapus file sampah lokal
      cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

      this.logger.log(`[${PROCESS_ID}] DONE! ${resultUrls.length} videos uploaded.`);
      
      // Return Array of URLs
      return { 
          jobId: PROCESS_ID,
          totalVariations: resultUrls.length,
          variations: resultUrls 
      };

    } catch (error) {
       cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
       const msg = error instanceof Error ? error.message : JSON.stringify(error);
       this.logger.error(`[${PROCESS_ID}] ERROR: ${msg}`);
       throw new InternalServerErrorException(msg);
    }
  }

  // =================================================================
  // C. PRIVATE WORKERS (API INTERACTIONS)
  // =================================================================

  private async _generateSingleVideo(prompt: string, imageUrl: string, index: number, reqId: string): Promise<string> {
    const apiKey = this.configService.get<string>('WAVESPEED_API_KEY');
    const urlSubmit = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1-pro-fast/image-to-video";
    
    const payload = { 
        camera_fixed: false, 
        duration: 5, 
        image: imageUrl, 
        prompt: prompt, 
        resolution: "480p", 
        seed: -1 
    };

    this.logger.verbose(`[${reqId}][Clip ${index}] Payload: ${JSON.stringify(payload)}`);

    const submitResp = await fetch(urlSubmit, {
        method: 'POST',
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(payload)
    });

    if (!submitResp.ok) {
        const errText = await submitResp.text();
        this.logger.error(`[${reqId}][Clip ${index}] Wavespeed Error: ${errText}`);
        throw new Error(errText);
    }
    
    const { data: { id: requestId } } = await submitResp.json();
    this.logger.log(`[${reqId}][Clip ${index}] Job ID: ${requestId} | Polling...`);

    let attempts = 0;
    while (attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        const statusResp = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });
        const statusData = await statusResp.json();
        
        if (statusData.data.status === "completed") {
            this.logger.log(`[${reqId}][Clip ${index}] COMPLETED!`);
            return statusData.data.outputs[0];
        }
        if (statusData.data.status === "failed") throw new Error(statusData.data.error);
    }
    throw new Error("Wavespeed Timeout");
  }

  private async _generateAudio(textScript: string): Promise<string> {
    if (!this.gemini) throw new Error("GEMINI_API_KEY missing");
    this.logger.log("Generating Audio TTS...");

    const response = await this.gemini.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-tts',
        config: { responseModalities: ['audio'] as any, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } } },
        contents: [{ role: 'user', parts: [{ text: textScript }] }]
    });

    const outputFileName = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    let audioCreated = false;

    for await (const chunk of response) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const { data, mimeType } = chunk.candidates[0].content.parts[0].inlineData;
            // Panggil helper convertToWav
            const buffer = this.videoUtilsHelper.convertToWav(data || '', mimeType || '');
            await fs.promises.writeFile(outputFileName, buffer);
            audioCreated = true;
            return outputFileName;
        }
    }
    
    if (!audioCreated) throw new Error("Gemini stream finished without audio data.");
    return outputFileName; 
  }
}