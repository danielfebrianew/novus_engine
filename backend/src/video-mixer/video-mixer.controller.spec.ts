import { Test, TestingModule } from '@nestjs/testing';
import { VideoMixerController } from './video-mixer.controller';
import { VideoMixerService } from './video-mixer.service';

describe('VideoMixerController', () => {
  let controller: VideoMixerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoMixerController],
      providers: [VideoMixerService],
    }).compile();

    controller = module.get<VideoMixerController>(VideoMixerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
