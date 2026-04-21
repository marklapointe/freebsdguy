import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { OllamaService } from '../server/lib/ai-service';

vi.mock('axios');

describe('Ollama Service Proxy', () => {
    const config = { baseUrl: 'http://localhost:11434', modelId: 'llama3' };
    const service = new OllamaService(config);

    it('getModels should return model names via proxy', async () => {
        const mockResponse = {
            data: {
                models: [
                    { name: 'llama3:latest' },
                    { name: 'mistral:latest' }
                ]
            }
        };
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

        const models = await service.getModels();
        expect(models).toEqual(['llama3:latest', 'mistral:latest']);
        expect(axios.get).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
    });

    it('summarize should return summary via proxy', async () => {
        const mockResponse = {
            data: {
                message: {
                    content: 'This is a summary.'
                }
            }
        };
        vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

        const summary = await service.summarize('Content to summarize');
        expect(summary).toBe('This is a summary.');
        expect(axios.post).toHaveBeenCalledWith(
            'http://localhost:11434/api/chat',
            expect.objectContaining({ 
                model: 'llama3', 
                messages: expect.arrayContaining([
                    expect.objectContaining({ role: 'user', content: 'Content to summarize' })
                ])
            }),
            expect.any(Object)
        );
    });
});
