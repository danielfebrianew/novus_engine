import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

@Injectable()
export class GenerateAiService {
  private readonly logger = new Logger(GenerateAiService.name);
  private openai: OpenAI;
  private gemini: GoogleGenAI;
  private tempDir = './temp';

  constructor(private configService: ConfigService) {
    // 1. Init OpenAI
    this.openai = new OpenAI({ apiKey: this.configService.get<string>('OPENAI_API_KEY') });
    
    // 2. Init Gemini
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiKey) this.gemini = new GoogleGenAI({ apiKey: geminiKey });

    // 3. Ensure Temp Directory
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir);
  }

  // =================================================================
  // A. PUBLIC METHOD: 1. ANALYZE IMAGE (OpenAI)
  // =================================================================
  async generateText(imageUrl: string, count: number = 4) { // Default 4 kalau kosong
    this.logger.log(`OpenAI: Analyzing image for ${count} prompts...`);

    let durationPrompt = "Target 18-20 detik";
    
    switch (count) {
      case 4: durationPrompt = "Target 18-20 detik"; break;
      case 5: durationPrompt = "Target 23-25 detik"; break;
      case 6: durationPrompt = "Target 28-30 detik"; break;
      default:
        throw new InternalServerErrorException('Count must be 4, 5, or 6');
    }

    const promptText = `
      Analisa gambar ini dengan teliti.
      
      Tugasmu adalah membuat 3 output dalam format JSON:
      
      1. "voiceover": 
         Naskah voiceover PADAT dan JELAS (${durationPrompt}).
         Gaya: Storytelling, santai, akrab, akhiri dengan ajakan cek keranjang kuning.

      2. "tiktokCaption": 
         Caption TikTok lengkap + headline clickbait + 4-5 hashtag.

      3. "videoPrompts": 
         Buatkan ARRAY berisi ${count} prompt visual berbeda dalam Bahasa Inggris.
         - Setiap prompt harus menggambarkan angle/gerakan kamera yang berbeda (misal: Close up, Pan Left, Zoom In, Reveal).
         - Fokus pada detail estetika produk.
      
      Format Output WAJIB JSON:
      {
        "voiceover": "teks naskah...",
        "tiktokCaption": "teks caption...",
        "videoPrompts": [
           "Cinematic close up shot of...", 
           "Slow pan camera showing...",
           "..."
        ]
      }
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageUrl } }] }],
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

  // ===================================================================
  // B. PUBLIC METHOD: 2. EXECUTE VIDEO CREATION (Batch + Audio + Merge)
  // ===================================================================
  async processFullVideo(items: { prompt: string; imageUrl: string }[], script: string) {
    let cleanupFiles: string[] = [];

    try {
      this.logger.log(`=== START EXECUTION (${items.length} clips) ===`);

      // 1. PARALLEL EXECUTION (Video Batch & Audio TTS)
      // Kita jalankan semua task berat secara bersamaan
      this.logger.log("Running Wavespeed & Gemini concurrently...");

      const videoTasks = items.map((item, idx) => 
         this._generateSingleVideo(item.prompt, item.imageUrl, idx, (idx+1).toString()) // Pass Index as Request ID
            .then(url => ({ status: 'success', url, index: idx }))
            .catch(err => ({ status: 'failed', error: err, index: idx }))
      );

      // Generate audio langsung dari script yang dikirim (WAJIB ADA)
      const audioTask = this._generateAudio(script); 

      // Tunggu semua selesai
      const [videoResults, audioPath] = await Promise.all([
        Promise.all(videoTasks),
        audioTask
      ]);
      
      cleanupFiles.push(audioPath); // Masukkan audio ke list hapus

      // 2. Download Valid Videos
      this.logger.log("Downloading clips...");
      const successVideos = videoResults
        .filter((r): r is { status: 'success', url: string, index: number } => r.status === 'success')
        .sort((a, b) => a.index - b.index);

      if (successVideos.length < 2) throw new Error("Minimal 2 video diperlukan untuk penggabungan.");

      const localVideoPaths: string[] = [];
      for (const vid of successVideos) {
        const fileName = path.join(this.tempDir, `clip_${Date.now()}_${vid.index}.mp4`);
        await this._downloadFile(vid.url, fileName);
        localVideoPaths.push(fileName);
        cleanupFiles.push(fileName);
      }

      // 3. Merge Visual Clips
      const mergedVisualPath = path.join(this.tempDir, `visual_merged_${Date.now()}.mp4`);
      cleanupFiles.push(mergedVisualPath);
      await this._mergeVideoFiles(localVideoPaths, mergedVisualPath);

      // 4. Final Merge (Visual + Audio)
      const finalOutputPath = path.join(this.tempDir, `FINAL_${Date.now()}.mp4`);
      this.logger.log("Merging Visual + Audio...");

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(mergedVisualPath)
          .input(audioPath)
          .outputOptions([
              '-c:v copy', '-c:a aac', 
              '-map 0:v:0', '-map 1:a:0', 
              '-shortest' // Potong durasi video mengikuti audio (atau sebaliknya yg terpendek)
          ])
          .save(finalOutputPath)
          .on('end', resolve)
          .on('error', (err) => reject(new Error(`FFmpeg Merge Error: ${err.message}`)));
      });

      return { finalPath: finalOutputPath, cleanupFiles };

    } catch (error) {
      // Emergency Cleanup
      cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
      throw new InternalServerErrorException(error.message);
    }
  }

  // --- HELPER BARU: TRIM VIDEO ---
  private _trimVideo(inputPath: string, outputPath: string, duration: number) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(0)
          .setDuration(duration) // Paksa potong ex: 5 detik
          .output(outputPath)
          .on('end', resolve)
          .on('error', (err) => reject(new Error(`Trim Error: ${err.message}`)))
          .run();
    });
  }

  // =================================================================
  // PROCESS VARIATIONS -> ZIP OUTPUT
  // =================================================================
  async processVideoVariations(imageUrl: string, prompts: string[], script: string) {
    let cleanupFiles: string[] = [];
    
    // 1. Buat ID unik untuk request ini (biar ketahuan kalau Postman ngirim 2x)
    const PROCESS_ID = `REQ_${Date.now()}`; 

    try {
      const totalClips = prompts.length;
      let targetVariations = 0;
      
      // Setting Durasi Fix
      const TARGET_DURATION = 5; 

      if (totalClips === 4) targetVariations = 20;      
      else if (totalClips === 5) targetVariations = 50; 
      else if (totalClips === 6) targetVariations = 100;
      else throw new Error("Jumlah prompt harus 4, 5, atau 6.");

      // LOGGING PENTING: Cek apakah ID ini muncul 2x di terminal?
      this.logger.log(`[${PROCESS_ID}] === START ENGINE ===`);
      this.logger.log(`[${PROCESS_ID}] Input Prompts: ${totalClips} items`);
      this.logger.log(`[${PROCESS_ID}] Target Variations: ${targetVariations} videos`);

      // 2. GENERATE RAW ASSETS (Parallel)
      const videoTasks = prompts.map((promptText, idx) => 
         this._generateSingleVideo(promptText, imageUrl, idx, PROCESS_ID) // Pass ID & Index
            .then(url => ({ status: 'success', url, index: idx }))
            .catch(err => ({ status: 'failed', error: err, index: idx }))
      );

      const audioTask = this._generateAudio(script); 

      const [videoResults, audioPath] = await Promise.all([
        Promise.all(videoTasks),
        audioTask
      ]);
      cleanupFiles.push(audioPath);

      // 3. Download & FORCE TRIM (Potong Paksa)
      const successVideos = videoResults
        .filter((r): r is { status: 'success', url: string, index: number } => r.status === 'success')
        .sort((a, b) => a.index - b.index);

      if (successVideos.length !== totalClips) throw new Error("Gagal generate sebagian klip.");

      const rawClipPaths: string[] = [];
      
      for (const vid of successVideos) {
        // A. Download File Asli (Mungkin 10 detik dari API)
        const rawFileName = path.join(this.tempDir, `raw_${PROCESS_ID}_${vid.index}.mp4`);
        this.logger.log(`[${PROCESS_ID}] Downloading Clip #${vid.index}...`);
        await this._downloadFile(vid.url, rawFileName);
        cleanupFiles.push(rawFileName);

        // B. POTONG PAKSA JADI 5 DETIK (Solusi durasi)
        const trimmedFileName = path.join(this.tempDir, `trim_${PROCESS_ID}_${vid.index}.mp4`);
        this.logger.log(`[${PROCESS_ID}] Trimming Clip #${vid.index} to ${TARGET_DURATION}s...`);
        
        await this._trimVideo(rawFileName, trimmedFileName, TARGET_DURATION);
        
        rawClipPaths.push(trimmedFileName);
        cleanupFiles.push(trimmedFileName);
      }

      // 4. STITCHING VARIATIONS
      const uniqueOrders = this._generateUniqueShuffles(totalClips, targetVariations);
      this.logger.log(`[${PROCESS_ID}] Stitching ${uniqueOrders.length} variations...`);

      const zip = new AdmZip(); 

      for (let i = 0; i < uniqueOrders.length; i++) {
        const order = uniqueOrders[i];
        const orderedPaths = order.map(index => rawClipPaths[index]);
        
        // Stitch Visual
        const tempVisualPath = path.join(this.tempDir, `vis_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(tempVisualPath);
        await this._mergeVideoFiles(orderedPaths, tempVisualPath);

        // Merge Audio
        const finalVarName = `VARIATION_${i+1}.mp4`;
        const finalVarPath = path.join(this.tempDir, `VAR_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(finalVarPath);
        
        await new Promise((resolve, reject) => {
            ffmpeg()
              .input(tempVisualPath) // Input Video (20s)
              .input(audioPath)      // Input Audio
              .outputOptions([
                  '-c:v copy', '-c:a aac', 
                  '-map 0:v:0', '-map 1:a:0',
                  // Hapus -shortest agar video full 20 detik meski audio cuma 15 detik
              ])
              .save(finalVarPath)
              .on('end', resolve)
              .on('error', reject);
        });

        zip.addLocalFile(finalVarPath, "", finalVarName);
      }

      // 5. ZIP
      const finalZipPath = path.join(this.tempDir, `BUNDLE_${PROCESS_ID}.zip`);
      zip.writeZip(finalZipPath);

      this.logger.log(`[${PROCESS_ID}] DONE! Zip created.`);
      return { finalPath: finalZipPath, cleanupFiles };

    } catch (error) {
       cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
       // Type assertion
       const msg = error instanceof Error ? error.message : JSON.stringify(error);
       this.logger.error(`[${PROCESS_ID}] ERROR: ${msg}`);
       throw new InternalServerErrorException(msg);
    }
  }

  // --- HELPER: SHUFFLE ---
  private _generateUniqueShuffles(length: number, limit: number): number[][] {
    const results = new Set<string>();
    const output: number[][] = [];
    const baseIndices = Array.from({ length }, (_, i) => i);
    let attempts = 0;
    
    while (output.length < limit && attempts < limit * 20) {
        attempts++;
        const shuffled = [...baseIndices].sort(() => Math.random() - 0.5);
        const key = shuffled.join(',');
        if (!results.has(key)) {
            results.add(key);
            output.push(shuffled);
        }
    }
    return output;
  }

  // =================================================================
  // C. PRIVATE WORKERS (Internal Use Only)
  // =================================================================

  // 1. Wavespeed Worker
  private async _generateSingleVideo(prompt: string, imageUrl: string, index: number, reqId: string): Promise<string> {
    const apiKey = this.configService.get<string>('WAVESPEED_API_KEY');
    const urlSubmit = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1-pro-fast/image-to-video";
    
    // Payload Body
    const payload = { 
        camera_fixed: false, 
        duration: 5, 
        image: imageUrl, 
        prompt: prompt, 
        resolution: "480p", 
        seed: -1 
    };

    // LOG PARAMETER YANG DIKIRIM (Biar kelihatan di terminal)
    this.logger.debug(`[${reqId}][Clip ${index}] Sending Request to Wavespeed...`);
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
    this.logger.log(`[${reqId}][Clip ${index}] Job ID: ${requestId} | Polling started...`);

    // Polling Logic
    let attempts = 0;
    while (attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000)); // Interval 3 detik
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

  // 2. Gemini TTS Worker
  private async _generateAudio(textScript: string): Promise<string> {
    if (!this.gemini) throw new Error("GEMINI_API_KEY missing");
    this.logger.log("Generating Audio TTS...");

    const response = await this.gemini.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-tts',
        config: { responseModalities: ['audio'] as any, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } } },
        contents: [{ role: 'user', parts: [{ text: textScript }] }]
    });

    const outputFileName = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    for await (const chunk of response) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const { data, mimeType } = chunk.candidates[0].content.parts[0].inlineData;
            // Gunakan helper convertToWav untuk memasang header yang benar
            const buffer = this._convertToWav(data || '', mimeType || '');
            await fs.promises.writeFile(outputFileName, buffer);
            return outputFileName;
        }
    }
    throw new Error("Gemini Audio Generation Failed");
  }

  // 3. Helpers (File & WAV Processing)
  private async _downloadFile(url: string, outputPath: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${url}`);
    // @ts-ignore
    await pipeline(response.body, fs.createWriteStream(outputPath));
  }

  private _mergeVideoFiles(inputs: string[], output: string) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        inputs.forEach(p => command.input(p));
        command.on('end', resolve).on('error', reject).mergeToFile(output, this.tempDir);
    });
  }

  // --- WAV HEADER LOGIC (From your Express code) ---
  private _createWavHeader(dataLength: number, options: any): Buffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
  }

  private _parseMimeType(mimeType: string) {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');
    const options = { numChannels: 1, sampleRate: 24000, bitsPerSample: 16 };
    if (format && format.startsWith('L')) {
        const bits = parseInt(format.slice(1), 10);
        if (!isNaN(bits)) options.bitsPerSample = bits;
    }
    for (const param of params) {
        const [key, value] = param.split('=').map(s => s.trim());
        if (key === 'rate') options.sampleRate = parseInt(value, 10);
    }
    return options;
  }

  private _convertToWav(base64Data: string, mimeType: string): Buffer {
    const options = this._parseMimeType(mimeType);
    const buffer = Buffer.from(base64Data, 'base64');
    const wavHeader = this._createWavHeader(buffer.length, options);
    return Buffer.concat([wavHeader, buffer]);
  }
}