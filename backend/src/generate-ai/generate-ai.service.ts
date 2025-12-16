import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios'; 
import { VideoUtilsHelper } from './helpers/video-utils.helper';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
    private videoUtilsHelper: VideoUtilsHelper,
    private eventEmitter: EventEmitter2
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

    // 4. Init AWS S3
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('AWS_BUCKET_NAME');

    this.logger.log(`Checking AWS Config -> Region: ${region}, Bucket: ${bucket}`);

    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error("⚠️ AWS S3 Configuration is MISSING in .env file!");
    }

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

  // --- HELPER LOG & EMIT ---
  // Fungsi ini akan nge-log ke terminal DAN kirim sinyal ke frontend
  private logProgress(jobId: string, message: string, progress: number) {
    this.logger.log(`[${jobId}] ${message}`);
    
    // Kirim event: 'job.progress'
    this.eventEmitter.emit('job.progress', {
      jobId,
      message,
      progress 
    });
  }

  // --- Auto Cleanup Temp Folder on Startup ---
  async onModuleInit() {
    this.cleanTempFolder();
  }

  private cleanTempFolder() {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      const files = fs.readdirSync(this.tempDir);
      if (files.length > 0) {
        this.logger.warn(`🧹 Cleaning ${files.length} temp files...`);
        for (const file of files) {
          if (file.endsWith('.mp4') || file.endsWith('.zip') || file.endsWith('.wav')) {
             fs.unlinkSync(path.join(this.tempDir, file));
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to clean temp folder:', error);
    }
  }

  // =================================================================
  // UPLOAD HELPER (S3)
  // =================================================================
  private async _uploadToS3(fileInput: string | Buffer, fileName: string, contentType: string): Promise<string> {
    if (!this.s3Client) throw new InternalServerErrorException("S3 Client not ready.");

    try {
      let body: Buffer;
      if (typeof fileInput === 'string') {
          body = fs.readFileSync(fileInput);
      } else {
          body = fileInput;
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
      throw new InternalServerErrorException("S3 Upload Failed: " + error.message);
    }
  }

  // =================================================================
  // PUBLIC: UPLOAD IMAGE
  // =================================================================
  async uploadImages(files: Array<Express.Multer.File>) {
    try {
        const uploadedUrls: string[] = [];

        for (const file of files) {
            const fileName = `input_${Date.now()}_${Math.round(Math.random()*1000)}_${file.originalname}`;
            this.logger.log(`Uploading image: ${fileName}`);
            
            // Note: Assuming frontend handles cropping, uploading buffer directly
            // If backend crop needed, call this.videoUtilsHelper.processImageTo916(file.buffer) here
            const publicUrl = await this._uploadToS3(file.buffer, fileName, file.mimetype);
            uploadedUrls.push(publicUrl);
        }
        
        return { 
            message: `${files.length} images uploaded successfully`,
            imageUrls: uploadedUrls 
        };
    } catch (error) {
        throw new InternalServerErrorException("Upload Failed: " + error.message);
    }
  }

  // =================================================================
  // A. PUBLIC METHOD: 1. ANALYZE IMAGE (OpenAI)
  // =================================================================
 async generateText(imageUrl: string, count: number = 4, productName: string = "") {
    // 1. Tentukan target jumlah video berdasarkan jumlah prompt gambar
    let videoTargetCount = 20;
    let durationPrompt = "Target ≈20 seconds";

    switch (count) {
      case 4: 
        videoTargetCount = 5; 
        durationPrompt = "Target ≈20 seconds (±40-45 words)"; 
        break;
      case 5: 
        videoTargetCount = 10; 
        durationPrompt = "Target ≈25 seconds (±40-45 words)"; 
        break;
      case 6: 
        videoTargetCount = 15; 
        durationPrompt = "Target ≈30 seconds (±45-50 words)"; 
        break;
      default: 
        throw new InternalServerErrorException('Count must be 4, 5, or 6');
    }

    this.logger.log(`OpenAI: Analyzing image for ${count} prompts. Target: ${videoTargetCount} variations.`);

    // 2. Prompt yang meminta KOMPONEN, bukan caption utuh (supaya hemat token & cepat)
    const promptText = `
      Analyze this image thoroughly.
      Name of the product is "${productName}".
      
      Task: Create a JSON output containing script, prompts, and CAPTION COMPONENTS to build ${videoTargetCount} variations.
      
      1. "voiceover": Naskah voiceover PADAT & JELAS (Bahasa Indonesia). Durasi: ${durationPrompt}. Gaya: Storytelling/Review jujur ke sahabat. Akhiri dengan ajakan cek keranjang kuning.
      
      2. "captionComponents": Kita butuh bahan untuk merakit banyak caption TikTok unik. Buatkan komponen berikut dalam Bahasa Indonesia:
         - "hooks": 15 variasi headline clickbait/pertanyaan yang bikin penasaran (contoh: "Gak nyangka nemu ini...", "Solusi buat kamu yang...").
         - "bodies": 10 variasi body text yang menjelaskan keunggulan produk "${productName}" dengan angle berbeda (aesthetic, fungsi, harga, dll).
         - "ctas": 5 variasi kalimat ajakan (Call to Action) pendek.
         - "hashtags": 5 set hashtags (tiap set isi 4-5 tag relevan).

      3. "videoPrompts": Array of ${count} distinct English visual prompts. Each must use different camera angles (Close Up, Pan, Zoom, etc). Focus on aesthetics.

      FORMAT JSON ONLY:
      {
        "voiceover": "...",
        "captionComponents": {
            "hooks": ["...", ...],
            "bodies": ["...", ...],
            "ctas": ["...", ...],
            "hashtags": ["...", ...]
        },
        "videoPrompts": [...]
      }
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'user', 
            content: [
                { type: 'text', text: promptText }, 
                { type: 'image_url', image_url: { url: imageUrl } }
            ] 
          }
        ],
        response_format: { type: 'json_object' },
      });
      
      const content = response.choices[0].message.content;
      if (!content) throw new Error('OpenAI returned empty content');
      
      const parsedData = JSON.parse(content);

      // 3. RAKIT CAPTION (The Mixer Logic)
      // Kita generate array caption sebanyak videoTargetCount (20/50/100)
      const generatedCaptions: string[] = [];
      const { hooks, bodies, ctas, hashtags } = parsedData.captionComponents;

      for (let i = 0; i < videoTargetCount; i++) {
        // Ambil acak dari komponen yang ada
        const hook = hooks[Math.floor(Math.random() * hooks.length)];
        const body = bodies[Math.floor(Math.random() * bodies.length)];
        const cta = ctas[Math.floor(Math.random() * ctas.length)];
        const tags = hashtags[Math.floor(Math.random() * hashtags.length)];

        // Gabungkan jadi satu caption utuh
        const fullCaption = `${hook}\n\n${body}\n\n${cta}\n\n${tags}`;
        generatedCaptions.push(fullCaption);
      }

      // 4. Return format final
      return {
        voiceover: parsedData.voiceover,
        videoPrompts: parsedData.videoPrompts,
        captions: generatedCaptions, // Array string sebanyak 20, 50, atau 100
        countSetting: count,
        totalVariations: videoTargetCount
      };

    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('OpenAI Error');
    }
}

  // =================================================================
  // B. PUBLIC METHOD: PROCESS VARIATIONS -> S3 URLS
  // =================================================================
  async processVideoVariations(images: string[], prompts: string[], script: string, jobId: string) {
    let cleanupFiles: string[] = [];
    const PROCESS_ID = jobId;

    try {
      const totalClips = prompts.length;
      let targetVariations = 0;

      if (totalClips === 4) targetVariations = 20;      
      else if (totalClips === 5) targetVariations = 50; 
      else if (totalClips === 6) targetVariations = 100;
      else throw new Error("Prompts must be 4, 5, or 6.");

      this.logger.log(`[${PROCESS_ID}] === MEMULAI ENGINE AI ===`); 

      // 1. GENERATE RAW ASSETS (Parallel)
      const videoTasks = prompts.map(async (promptText, idx) => {
         const selectedImage = images[idx] ? images[idx] : images[0];
         try {
          const url = await this._generateSingleVideo(promptText, selectedImage, idx, PROCESS_ID);
          return ({ status: 'success', url, index: idx });
        } catch (err) {
          return ({ status: 'failed', error: err, index: idx });
        }
      });

      this.logProgress(PROCESS_ID, "Sedang generate Video & Audio...", 10);

      const audioTask = this._generateAudio(script); 
      const [videoResults, audioPath] = await Promise.all([
        Promise.all(videoTasks),
        audioTask
      ]);
      cleanupFiles.push(audioPath);

      // 2. Download Raw Clips
      const successVideos = videoResults
        .filter((r): r is { status: 'success', url: string, index: number } => r.status === 'success')
        .sort((a, b) => a.index - b.index);

      if (successVideos.length !== totalClips) throw new Error("Failed to generate all clips.");

      const rawClipPaths: string[] = [];
      let downloadedCount = 0;
      
      for (const vid of successVideos) {
        const rawFileName = path.join(this.tempDir, `raw_${PROCESS_ID}_${vid.index}.mp4`);
        
        downloadedCount++;
        const percent = 20 + Math.round((downloadedCount / successVideos.length) * 20); // Range 20-40%
        this.logProgress(PROCESS_ID, `Mendownload Clip #${vid.index + 1}/${successVideos.length}...`, percent);
        
        await this.videoUtilsHelper.downloadFile(vid.url, rawFileName);
        rawClipPaths.push(rawFileName);
        cleanupFiles.push(rawFileName);
      }

      // 3. STITCHING & UPLOAD
      const uniqueOrders = this.videoUtilsHelper.generateUniqueShuffles(totalClips, targetVariations);
      this.logProgress(PROCESS_ID, `Memulai Stitching ${uniqueOrders.length} variasi...`, 40);

      const resultUrls: string[] = [];

      for (let i = 0; i < uniqueOrders.length; i++) {
        const order = uniqueOrders[i];
        const orderedPaths = order.map(index => rawClipPaths[index]);
        
        // A. Stitch Visual
        const tempVisualPath = path.join(this.tempDir, `vis_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(tempVisualPath);
        
        await this.videoUtilsHelper.mergeVideoFiles(orderedPaths, tempVisualPath);

        // B. Merge Audio
        const finalFileName = `VARIATION_${PROCESS_ID}_${i+1}.mp4`;
        const finalVarPath = path.join(this.tempDir, `VAR_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(finalVarPath);
        
        await new Promise((resolve, reject) => {
            ffmpeg()
              .input(tempVisualPath).input(audioPath)
              .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0'])
              .save(finalVarPath).on('end', resolve).on('error', reject);
        });

        const percent = 40 + Math.round(((i + 1) / uniqueOrders.length) * 55);
        this.logProgress(PROCESS_ID, `Mengupload Variasi ${i+1}/${uniqueOrders.length}...`, percent);

        // C. Upload to S3
        const s3Url = await this._uploadToS3(finalVarPath, `results/${PROCESS_ID}/${finalFileName}`, 'video/mp4');
        resultUrls.push(s3Url);
      }

      // 4. CLEANUP
      cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

      this.logProgress(PROCESS_ID, "Selesai! File berhasil diunggah...", 100);
      
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
  // C. PRIVATE WORKERS (Axios Implementation)
  // =================================================================

  private async _generateSingleVideo(prompt: string, imageUrl: string, index: number, reqId: string): Promise<string> {
    const apiKey = this.configService.get<string>('WAVESPEED_API_KEY');
    const urlSubmit = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1-pro-fast/image-to-video";
    
    const payload = { 
        camera_fixed: false, 
        duration: 5, 
        image: imageUrl, 
        prompt: prompt, 
        resolution: "720p", 
        seed: -1 
    };

    this.logProgress(reqId, `[Clip ${index}] Memulai generate video...`, 12);

    try {
      // 1. Submit Job
      const submitResp = await axios.post(urlSubmit, payload, {
        headers: { 
            "Content-Type": "application/json", 
            "Authorization": `Bearer ${apiKey}` 
        }
      });

      const requestId = submitResp.data.data.id;
      this.logProgress(reqId, `[Clip ${index}] ID: ${requestId} | Sedang memproses AI...`, 15);

      // 2. Polling Logic
      let attempts = 0;
      while (attempts < 60) {
          attempts++;
          await new Promise(r => setTimeout(r, 3000));
          
          const statusResp = await axios.get(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
              headers: { "Authorization": `Bearer ${apiKey}` }
          });
          
          const statusData = statusResp.data;
          
          if (statusData.data.status === "completed") {
              this.logProgress(reqId, `[Clip ${index}] Selesai dibuat!`, 18);
              return statusData.data.outputs[0];
          }
          if (statusData.data.status === "failed") {
              throw new Error(statusData.data.error || "Generation Failed");
          }
      }
      throw new Error("Wavespeed Timeout");

    } catch (error) {
        // Axios error handling
        const msg = axios.isAxiosError(error) 
            ? error.response?.data?.error || error.message 
            : (error as Error).message;
            
        this.logger.error(`[${reqId}][Clip ${index}] Wavespeed Error: ${msg}`);
        throw new Error(msg);
    }
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