export interface Theme {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
}

export interface VoiceConfig {
    name: string;
    details: string; // e.g., "Male, Deep, British"
    provider: "elevenlabs" | "openai" | "google";
    providerId: string; // the voice_id
}

export interface VideoTemplate {
    id: string;
    name: string;
    emoji: string;
    description: string;
    structure: string;
}

export interface Brand {
    id: string;
    name: string;
    niche: string;
    description?: string; // Brand knowledge base — tone of voice, target audience, values, style
    theme: Theme;
    voice: VoiceConfig;
    logoPath?: string; // Path to brand logo in /public
    watermarkOpacity?: number;
}
