import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { GenerateAiService } from './generate-ai.service';
import { GenerateTextDto, GenerateVideoDto } from './dto/generate-ai.dto'; // Pake DTO Gabungan tadi

@Controller('generate')
export class GenerateAiController {
  constructor(private readonly generateAiService: GenerateAiService) {}

  // 1. ENDPOINT ANALISA (TEXT ONLY)
  @Post('text')
  async generateText(@Body() dto: GenerateTextDto) {
    return this.generateAiService.generateText(dto.imageUrl);
  }

  // 2. ENDPOINT EKSEKUSI (VIDEO FILE)
  @Post('video')
  async generateVideo(
    @Body() dto: GenerateVideoDto, // DTO ini mewajibkan script
    @Res() res: Response
  ) {
    try {
      // Jalankan proses berat (Worker)
      const result = await this.generateAiService.processFullVideo(dto.items, dto.script);

      // Langsung download file
      res.download(result.finalPath, 'video_hasil.mp4', (err) => {
        if (err) {
            console.error("Download Error:", err);
        }
        
        // CLEANUP: Hapus semua file temp setelah user menerima file
        if (fs.existsSync(result.finalPath)) fs.unlinkSync(result.finalPath);
        
        result.cleanupFiles.forEach(f => {
             if (fs.existsSync(f)) fs.unlinkSync(f);
        });
        
        console.log("Cleanup Completed.");
      });

    } catch (error) {
      // Handle error manual karena kita inject @Res()
      res.status(500).json({ 
          statusCode: 500, 
          message: error.message || 'Internal Server Error' 
      });
    }
  }
}