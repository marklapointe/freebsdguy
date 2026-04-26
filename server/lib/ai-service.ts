import axios from 'axios';

export interface AIServiceConfig {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
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
    async summarize(content: string): Promise<string> {
        console.log(`[OllamaProxy] Summarizing with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const response = await axios.post(`${this.config.baseUrl}/api/chat`, {
                model: this.config.modelId,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that summarizes blog posts. Provide a concise summary (1-3 sentences) of the following content.'
                    },
                    {
                        role: 'user',
                        content: content
                    }
                ],
                stream: false
            }, { timeout: 30000 });
            
            return response.data.message.content.trim();
        } catch (error: any) {
            console.error('[OllamaProxy] Summarization failed:', error.message);
            if (error.response?.status === 404) {
                throw new Error(`Model '${this.config.modelId}' not found on the Ollama server. Please check your AI settings and ensure the model is pulled.`);
            }
            throw new Error(`Ollama summarization failed: ${error.message}`);
        }
    }

    async enhance(content: string): Promise<string> {
        console.log(`[OllamaProxy] Enhancing with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const response = await axios.post(`${this.config.baseUrl}/api/chat`, {
                model: this.config.modelId,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that enhances blog post content. Improve the flow, grammar, and engagement of the following markdown content while preserving its original meaning and markdown formatting. Return only the enhanced content.'
                    },
                    {
                        role: 'user',
                        content: content
                    }
                ],
                stream: false
            }, { timeout: 60000 });
            
            return response.data.message.content.trim();
        } catch (error: any) {
            console.error('[OllamaProxy] Enhancement failed:', error.message);
            if (error.response?.status === 404) {
                throw new Error(`Model '${this.config.modelId}' not found on the Ollama server. Please check your AI settings and ensure the model is pulled.`);
            }
            throw new Error(`Ollama enhancement failed: ${error.message}`);
        }
    }

    async getModels(): Promise<string[]> {
        console.log(`[OllamaProxy] Fetching models from ${this.config.baseUrl}`);
        try {
            const response = await axios.get(`${this.config.baseUrl}/api/tags`, { timeout: 5000 });
            return (response.data.models || []).map((m: any) => m.name);
        } catch (error) {
            console.error('[OllamaProxy] Failed to fetch models:', error);
            throw new Error('Failed to connect to Ollama server');
        }
    }
}

export class OpenAIService extends AIService {
    async summarize(content: string): Promise<string> {
        console.log(`[OpenAIProxy] Summarizing with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const url = `${this.config.baseUrl}/chat/completions`;
            const response = await axios.post(url, {
                model: this.config.modelId,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that summarizes blog posts. Provide a concise summary (1-3 sentences) of the following content.'
                    },
                    {
                        role: 'user',
                        content: content
                    }
                ]
            }, {
                headers: {
                    'Authorization': this.config.apiKey ? `Bearer ${this.config.apiKey}` : undefined,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            return response.data.choices[0].message.content.trim();
        } catch (error: any) {
            console.error('[OpenAIProxy] Summarization failed:', error.message);
            if (error.response?.status === 401) {
                throw new Error('OpenAI API Key is invalid or missing.');
            }
            if (error.response?.status === 404) {
                throw new Error(`OpenAI model '${this.config.modelId}' not found or endpoint incorrect.`);
            }
            throw new Error(`OpenAI summarization failed: ${error.message}`);
        }
    }

    async enhance(content: string): Promise<string> {
        console.log(`[OpenAIProxy] Enhancing with model ${this.config.modelId} at ${this.config.baseUrl}`);
        try {
            const url = `${this.config.baseUrl}/chat/completions`;
            const response = await axios.post(url, {
                model: this.config.modelId,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that enhances blog post content. Improve the flow, grammar, and engagement of the following markdown content while preserving its original meaning and markdown formatting. Return only the enhanced content.'
                    },
                    {
                        role: 'user',
                        content: content
                    }
                ]
            }, {
                headers: {
                    'Authorization': this.config.apiKey ? `Bearer ${this.config.apiKey}` : undefined,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });
            return response.data.choices[0].message.content.trim();
        } catch (error: any) {
            console.error('[OpenAIProxy] Enhancement failed:', error.message);
            if (error.response?.status === 401) {
                throw new Error('OpenAI API Key is invalid or missing.');
            }
            if (error.response?.status === 404) {
                throw new Error(`OpenAI model '${this.config.modelId}' not found or endpoint incorrect.`);
            }
            throw new Error(`OpenAI enhancement failed: ${error.message}`);
        }
    }

    async getModels(): Promise<string[]> {
        // OpenAI models endpoint is different, but for now we return an empty list or common ones
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'];
    }
}

export class AIServiceFactory {
    static create(provider: 'ollama' | 'openai', config: AIServiceConfig): AIService {
        if (provider === 'ollama') {
            return new OllamaService(config);
        } else {
            return new OpenAIService(config);
        }
    }
}
