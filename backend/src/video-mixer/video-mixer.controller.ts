import { 
  Controller, 
  Post, 
  UseInterceptors, 
  UploadedFiles, 
  Body,
  BadRequestException 
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { VideoMixerService } from './video-mixer.service';

@Controller('')
export class VideoMixerController {
  constructor(private readonly videoService: VideoMixerService) {}

  @Post('video-mixer')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'clips', maxCount: 6 }, 
        { name: 'audio', maxCount: 1 }, 
      ],
      {
        storage: diskStorage({
          destination: './uploads', 
          filename: (req, file, cb) => {
            const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
            cb(null, `${randomName}${extname(file.originalname)}`);
          },
        }),
      },
    ),
  )
  async stitchVideo(
    @UploadedFiles() files: { clips?: Express.Multer.File[], audio?: Express.Multer.File[] },
    @Body('variations') variations: string 
  ) {
    if (!files.clips || files.clips.length < 2) {
      throw new BadRequestException('Minimal upload 2 video klip.');
    }
    if (!files.audio || files.audio.length === 0) {
      throw new BadRequestException('File audio diperlukan.');
    }

    // Ambil path absolut dari file yang diupload
    const clipPaths = files.clips.map(file => file.path);
    const audioPath = files.audio[0].path;
    const targetVar = parseInt(variations) || 1;

    // Panggil Service
    const result = await this.videoService.generateStitchedVideos(
      clipPaths,
      audioPath,
      targetVar
    );

    return result;
  }
}