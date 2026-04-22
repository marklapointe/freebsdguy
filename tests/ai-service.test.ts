import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { OllamaService, OpenAIService, AIServiceFactory } from '../server/lib/ai-service';

vi.mock('axios');

describe('ai-service.ts', () => {
    describe('OllamaService', () => {
        const config = { baseUrl: 'http://localhost:11434', modelId: 'llama3' };
        const service = new OllamaService(config);

        it('summarize works', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { message: { content: 'Summary' } }
            });
            const res = await service.summarize('content');
            expect(res).toBe('Summary');
        });

        it('summarize handles 404', async () => {
            (axios.post as any).mockRejectedValueOnce({
                response: { status: 404 },
                message: 'Not Found'
            });
            await expect(service.summarize('content')).rejects.toThrow(/not found on the Ollama server/);
        });

        it('summarize handles other errors', async () => {
            (axios.post as any).mockRejectedValueOnce(new Error('Network error'));
            await expect(service.summarize('content')).rejects.toThrow(/Ollama summarization failed/);
        });

        it('getModels works', async () => {
            (axios.get as any).mockResolvedValueOnce({
                data: { models: [{ name: 'm1' }, { name: 'm2' }] }
            });
            const res = await service.getModels();
            expect(res).toEqual(['m1', 'm2']);
        });

        it('getModels handles error', async () => {
            (axios.get as any).mockRejectedValueOnce(new Error('Fail'));
            await expect(service.getModels()).rejects.toThrow(/Failed to connect to Ollama server/);
        });
    });

    describe('OpenAIService', () => {
        const config = { baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4', apiKey: 'key' };
        const service = new OpenAIService(config);

        it('summarize works', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { choices: [{ message: { content: 'GPT Summary' } }] }
            });
            const res = await service.summarize('content');
            expect(res).toBe('GPT Summary');
        });

        it('summarize handles 401', async () => {
            (axios.post as any).mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Unauthorized'
            });
            await expect(service.summarize('content')).rejects.toThrow(/OpenAI API Key is invalid or missing/);
        });

        it('summarize handles 404', async () => {
            (axios.post as any).mockRejectedValueOnce({
                response: { status: 404 },
                message: 'Not Found'
            });
            await expect(service.summarize('content')).rejects.toThrow(/OpenAI model .* not found/);
        });

        it('summarize handles other errors', async () => {
            (axios.post as any).mockRejectedValueOnce(new Error('Other'));
            await expect(service.summarize('content')).rejects.toThrow(/OpenAI summarization failed/);
        });

        it('getModels works', async () => {
            const res = await service.getModels();
            expect(res).toContain('gpt-4');
        });
    });

    describe('AIServiceFactory', () => {
        it('creates services', () => {
            expect(AIServiceFactory.create('ollama', { baseUrl: '', modelId: '' })).toBeInstanceOf(OllamaService);
            expect(AIServiceFactory.create('openai', { baseUrl: '', modelId: '' })).toBeInstanceOf(OpenAIService);
        });
    });
});
