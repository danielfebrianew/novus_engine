import { Test, TestingModule } from '@nestjs/testing';
import { VideoMixerService } from './video-mixer.service';

describe('VideoMixerService', () => {
  let service: VideoMixerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoMixerService],
    }).compile();

    service = module.get<VideoMixerService>(VideoMixerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
