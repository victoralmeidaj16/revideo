import axios from "axios";
import 'dotenv/config';

async function listVoices() {
    try {
        const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
            headers: {
                "xi-api-key": process.env.ELEVEN_API_KEY || "",
            },
        });

        const voices = response.data.voices;
        console.log("Available voices:");
        voices.forEach((voice: any) => {
            console.log(`- ${voice.name} (ID: ${voice.voice_id})`);
        });
    } catch (error) {
        console.error("Error fetching voices:", error);
    }
}

listVoices();
