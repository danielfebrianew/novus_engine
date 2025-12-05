import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { GenerateAiService } from './generate-ai.service';
import { GenerateTextDto, GenerateVideoDto } from './dto/generate-ai.dto';

@Controller('generate')
export class GenerateAiController {
  constructor(private readonly generateAiService: GenerateAiService) {}

  // 1. ANALISA GAMBAR (Dapet Script & Ide Prompt)
  @Post('text')
  async generateText(@Body() dto: GenerateTextDto) {
    // Kirim imageUrl dan promptCount (atau default undefined/4)
    return this.generateAiService.generateText(dto.imageUrl, dto.promptCount);
  }

  // 2. EKSEKUSI VARIASI (Langsung ZIP)
  @Post('video')
  async generateVideo(
    @Body() dto: GenerateVideoDto, 
    @Res() res: Response
  ) {
    try {
      // Validasi: Jumlah prompt harus 4, 5, atau 6
      const count = dto.prompts.length;
      if (![4, 5, 6].includes(count)) {
         return res.status(400).json({ 
             statusCode: 400, 
             message: `Jumlah prompt harus 4, 5, atau 6. Kamu kirim ${count}.` 
         });
      }

      // Panggil Service Variasi
      const result = await this.generateAiService.processVideoVariations(
          dto.imageUrl, 
          dto.prompts, 
          dto.script
      );

      // Download ZIP
      res.download(result.finalPath, 'video_variations.zip', (err) => {
        if (err) console.error("Download Error:", err);

        // CLEANUP
        if (fs.existsSync(result.finalPath)) fs.unlinkSync(result.finalPath);
        result.cleanupFiles.forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
        console.log("Cleanup Selesai.");
      });

    } catch (error) {
      res.status(500).json({ statusCode: 500, message: error.message });
    }
  }
}