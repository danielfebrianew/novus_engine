import { Test, TestingModule } from '@nestjs/testing';
import { GenerateAiService } from './generate-ai.service';

describe('GenerateAiService', () => {
  let service: GenerateAiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GenerateAiService],
    }).compile();

    service = module.get<GenerateAiService>(GenerateAiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
