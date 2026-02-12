
import 'dotenv/config';
import axios from 'axios';

const voiceIds = [
    "iiidtqDt9FBdT1vfBluA",
    "wBXNqKUATyqu0RtYt25i",
    "zNEsdgTUa3ndwKry8Xcq",
    "RGymW84CSmfVugnA5tvA",
    "0YziWIrqiRTHCxeg1lyc"
];


async function checkVoices() {
    const apiKey = process.env.ELEVEN_API_KEY;
    if (!apiKey) {
        console.error("No API key found");
        return;
    }

    try {
        const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": apiKey }
        });

        console.log(JSON.stringify(response.data.voices, null, 2));

    } catch (error: any) {
        console.error(`Error fetching voices list: ${error.message}`);
    }
}

checkVoices();
