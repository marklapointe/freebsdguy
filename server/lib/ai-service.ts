/**
 * AI proxy services — template method over provider chat APIs.
 *
 * TAOCP: common algorithm (chat + extract text + map errors) is defined once;
 * Ollama/OpenAI only plug in transport-specific request/response shapes.
 * Shared system prompts are single sources of truth (no dual copy drift).
 */
import axios, { type AxiosError } from 'axios';

export interface AIServiceConfig {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
}

const SUMMARIZE_SYSTEM =
    'You are a helpful assistant that summarizes blog posts. Provide a concise summary (1-3 sentences) of the following content.';

const ENHANCE_SYSTEM =
    'You are a helpful assistant that enhances blog post content. Improve the flow, grammar, and engagement of the following markdown content while preserving its original meaning and markdown formatting. Return only the enhanced content.';

type ChatRole = { role: 'system' | 'user'; content: string };

function chatMessages(system: string, content: string): ChatRole[] {
    return [
        { role: 'system', content: system },
        { role: 'user', content }
    ];
}

function axiosMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message?: string }).message || 'request failed');
    }
    return 'request failed';
}

function axiosStatus(error: unknown): number | undefined {
    return (error as AxiosError | undefined)?.response?.status;
}

export abstract class AIService {
    protected config: AIServiceConfig;

    constructor(config: AIServiceConfig) {
        this.config = config;
    }

    abstract summarize(content: string): Promise<string>;
    abstract enhance(content: string): Promise<string>;
    abstract getModels(): Promise<string[]>;
}

export class OllamaService extends AIService {
    private async chat(
        system: string,
        content: string,
        timeout: number,
        logVerb: string,
        errNoun: string
    ): Promise<string> {
        console.log(`[OllamaProxy] ${logVerb} with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const response = await axios.post(
                `${this.config.baseUrl}/api/chat`,
                {
                    model: this.config.modelId,
                    messages: chatMessages(system, content),
                    stream: false
                },
                { timeout }
            );
            return String(response.data.message.content).trim();
        } catch (error: unknown) {
            const msg = axiosMessage(error);
            console.error(`[OllamaProxy] ${logVerb} failed:`, msg);
            if (axiosStatus(error) === 404) {
                throw new Error(
                    `Model '${this.config.modelId}' not found on the Ollama server. Please check your AI settings and ensure the model is pulled.`
                );
            }
            throw new Error(`Ollama ${errNoun} failed: ${msg}`);
        }
    }

    async summarize(content: string): Promise<string> {
        return this.chat(SUMMARIZE_SYSTEM, content, 30000, 'Summarizing', 'summarization');
    }

    async enhance(content: string): Promise<string> {
        return this.chat(ENHANCE_SYSTEM, content, 60000, 'Enhancing', 'enhancement');
    }

    async getModels(): Promise<string[]> {
        console.log(`[OllamaProxy] Fetching models from ${this.config.baseUrl}`);
        try {
            const response = await axios.get(`${this.config.baseUrl}/api/tags`, { timeout: 5000 });
            return (response.data.models || []).map((m: { name: string }) => m.name);
        } catch (error) {
            console.error('[OllamaProxy] Failed to fetch models:', error);
            throw new Error('Failed to connect to Ollama server');
        }
    }
}

export class OpenAIService extends AIService {
    private async chat(
        system: string,
        content: string,
        timeout: number,
        logVerb: string,
        errNoun: string
    ): Promise<string> {
        console.log(`[OpenAIProxy] ${logVerb} with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const url = `${this.config.baseUrl}/chat/completions`;
            const response = await axios.post(
                url,
                {
                    model: this.config.modelId,
                    messages: chatMessages(system, content)
                },
                {
                    headers: {
                        Authorization: this.config.apiKey ? `Bearer ${this.config.apiKey}` : undefined,
                        'Content-Type': 'application/json'
                    },
                    timeout
                }
            );
            return String(response.data.choices[0].message.content).trim();
        } catch (error: unknown) {
            const msg = axiosMessage(error);
            console.error(`[OpenAIProxy] ${logVerb} failed:`, msg);
            if (axiosStatus(error) === 401) {
                throw new Error('OpenAI API Key is invalid or missing.');
            }
            if (axiosStatus(error) === 404) {
                throw new Error(`OpenAI model '${this.config.modelId}' not found or endpoint incorrect.`);
            }
            throw new Error(`OpenAI ${errNoun} failed: ${msg}`);
        }
    }

    async summarize(content: string): Promise<string> {
        return this.chat(SUMMARIZE_SYSTEM, content, 30000, 'Summarizing', 'summarization');
    }

    async enhance(content: string): Promise<string> {
        return this.chat(ENHANCE_SYSTEM, content, 60000, 'Enhancing', 'enhancement');
    }

    async getModels(): Promise<string[]> {
        // OpenAI models endpoint is different; surface common chat models for the UI.
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'];
    }
}

export class AIServiceFactory {
    static create(provider: 'ollama' | 'openai', config: AIServiceConfig): AIService {
        if (provider === 'ollama') {
            return new OllamaService(config);
        }
        return new OpenAIService(config);
    }
}
